import { PDFPageProxy } from "pdfjs-dist";
import * as pdfjs from "pdfjs-dist";

export interface PdfExtractEventInitial {
    kind: "initial";
    pageNumTotal: number;
}

export interface PdfExtractEventImage {
    kind: "image";
    imageBytes: ArrayBuffer;
    pageNum: number;
    imageNum: number;
}

export interface PdfExtractEventSkipped {
    kind: "skipped";
    pageNum: number;
}

export interface PdfExtractEventError {
    kind: "error";
    error: string;
    pageNum?: number;
}

export type PdfExtractEvent =
    | PdfExtractEventInitial
    | PdfExtractEventImage
    | PdfExtractEventSkipped
    | PdfExtractEventError;

export type EventCallback = (event: PdfExtractEvent) => void | Promise<void>;

interface ExtractedImage {
    width: number;
    height: number;
    // Either raw pixel data + kind, or a ready-to-draw bitmap (newer PDF.js).
    data?: Uint8ClampedArray | Uint8Array;
    kind?: number;
    bitmap?: ImageBitmap;
}

// PDF.js ImageKind enum values (kept local to avoid relying on a runtime export).
const ImageKind = {
    GRAYSCALE_1BPP: 1,
    RGB_24BPP: 2,
    RGBA_32BPP: 3,
} as const;


export class PdfExtractor {
    constructor(
        private readonly format: "png" | "jpeg",
        private readonly minWidth: number,
        private readonly minHeight: number,
        private readonly jpegQuality: number,
    ) { }

    async extract(pdfBytes: ArrayBuffer, eventCallback: EventCallback): Promise<void> {
        const loadingTask = pdfjs.getDocument({
            data: new Uint8Array(pdfBytes),
            isEvalSupported: false,
        });
        const doc = await loadingTask.promise;

        await eventCallback({
            kind: "initial",
            pageNumTotal: doc.numPages,
        });

        let imageNum = 0;
        const seen = new Set<string>();

        for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
            const page = await doc.getPage(pageNum);
            const images = await this.findImageObjects(page, pageNum, seen, eventCallback);

            for (let i = 0; i < images.length; i++) {
                const img = images[i];
                if (img.width < this.minWidth || img.height < this.minHeight) {
                    await eventCallback({
                        kind: "skipped",
                        pageNum: pageNum,
                    })
                    continue;
                }
                const bytes = await this.imageObjectToRgbBytes(img);
                if (!bytes) continue;
                imageNum += 1;
                await eventCallback({
                    kind: "image",
                    imageBytes: bytes,
                    pageNum: pageNum,
                    imageNum: imageNum,
                });
            }
            page.cleanup();
        }
        await doc.destroy();
    }

    // Normalize PDF.js pixel data of various kinds into an RGBA buffer
    convertPdfDataToRgb(
        data: Uint8ClampedArray | Uint8Array,
        width: number,
        height: number,
        kind?: number
    ): Uint8ClampedArray | null {
        const rgba = new Uint8ClampedArray(width * height * 4);

        if (kind === ImageKind.RGBA_32BPP) {
            rgba.set(data.subarray(0, rgba.length));
            return rgba;
        }

        if (kind === ImageKind.RGB_24BPP) {
            for (let i = 0, j = 0; j < rgba.length; i += 3, j += 4) {
                rgba[j] = data[i];
                rgba[j + 1] = data[i + 1];
                rgba[j + 2] = data[i + 2];
                rgba[j + 3] = 255;
            }
            return rgba;
        }

        if (kind === ImageKind.GRAYSCALE_1BPP) {
            // 1 bit per pixel, rows padded to a byte boundary.
            const rowBytes = (width + 7) >> 3;
            let p = 0;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const byte = data[y * rowBytes + (x >> 3)];
                    const bit = (byte >> (7 - (x & 7))) & 1;
                    const v = bit ? 255 : 0;
                    rgba[p++] = v;
                    rgba[p++] = v;
                    rgba[p++] = v;
                    rgba[p++] = 255;
                }
            }
            return rgba;
        }

        // Fallback: try to interpret as RGBA if the size matches, else RGB.
        if (data.length === width * height * 4) {
            rgba.set(data.subarray(0, rgba.length));
            return rgba;
        }
        if (data.length === width * height * 3) {
            for (let i = 0, j = 0; j < rgba.length; i += 3, j += 4) {
                rgba[j] = data[i];
                rgba[j + 1] = data[i + 1];
                rgba[j + 2] = data[i + 2];
                rgba[j + 3] = 255;
            }
            return rgba;
        }

        return null;
    }

    // Render an extracted image to PNG or JPEG bytes via a canvas.
    async imageObjectToRgbBytes(img: ExtractedImage): Promise<ArrayBuffer | null> {
        const { width, height } = img;
        if (!width) return null;
        if (!height) return null;

        const canvas = activeDocument.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        if (img.bitmap) {
            ctx.drawImage(img.bitmap, 0, 0);
        } else if (img.data) {
            const rgba = this.convertPdfDataToRgb(img.data, width, height, img.kind);
            if (!rgba) return null;
            const imageData = ctx.createImageData(width, height);
            imageData.data.set(rgba);
            ctx.putImageData(imageData, 0, 0);
        } else {
            return null;
        }

        const mime = this.format === "jpeg" ? "image/jpeg" : "image/png";
        const quality = this.format === "jpeg" ? Math.min(1, Math.max(0.01, this.jpegQuality / 100)) : undefined;
        const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob((b) => resolve(b), mime, quality)
        );
        if (!blob) return null;
        return await blob.arrayBuffer();
    }


    // Walk a page's operator list and collect every painted image object.
    async findImageObjects(page: PDFPageProxy, pageNum: number, seen: Set<string>, eventCallback: EventCallback): Promise<ExtractedImage[]> {
        const ops = await page.getOperatorList();
        const OPS = pdfjs.OPS;
        const results: ExtractedImage[] = [];

        for (let i = 0; i < ops.fnArray.length; i++) {
            const fn = ops.fnArray[i];
            const args = ops.argsArray[i] as unknown[];

            const isImageObj = fn === OPS.paintImageXObject
                            || fn === OPS.paintImageXObjectRepeat
                            || fn === (OPS as Record<string, number>).paintJpegXObject; // paintJpegXObject only exists in older builds.
            if (isImageObj) {
                const name = args[0] as string;
                // De-duplicate images referenced multiple times.
                const key = `${pageNum}:${name}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const img = await this.fetchImageObject(page, name, pageNum, eventCallback);
                if (img) {
                    results.push(img);
                }
            } else if (fn === OPS.paintInlineImageXObject) {
                const img = args[0] as ExtractedImage;
                if (img && img.width && img.height) {
                    results.push(img);
                }
            }
        }

        return results;
    }


    /**
     * Resolve an image XObject from the page's object stores.
     *
     * PDF.js keeps single-page images in `page.objs` but promotes images that
     * are shared across pages (or otherwise cached) into `page.commonObjs`.
     * Calling `objs.get(name, cb)` for an id that actually lives in
     * `commonObjs` registers a callback on a placeholder whose promise never
     * settles, which would hang extraction forever. We therefore pick the store
     * that actually holds the object, and guard with a timeout so a missing
     * object can never stall the whole run.
     */
    fetchImageObject(page: PDFPageProxy, name: string, pageNum: number, eventCallback: EventCallback): Promise<ExtractedImage | null> {
        type ObjStore = {
            get(name: string, cb: (img: ExtractedImage) => void): void;
            has?(name: string): boolean;
        };
        const objs = page.objs as unknown as ObjStore;
        const commonObjs = page.commonObjs as unknown as ObjStore;

        let store: ObjStore | null = null;
        if (commonObjs?.has?.(name)) {
            store = commonObjs;
        } else if (objs?.has?.(name)) {
            store = objs;
        }

        if (!store) {
            // Neither store reports the object yet. Falling back to a blind
            // callback risks an unsettled promise, so report it as missing.
            void eventCallback({
                kind: "error",
                error: `Image object "${name}" not found in page stores.`,
                pageNum: pageNum,
            });
            return Promise.resolve(null);
        }

        return new Promise((resolve) => {
            let settled = false;
            const finish = (img: ExtractedImage | null) => {
                if (settled) return;
                settled = true;
                resolve(img);
            };
            // Safety net: never let a single image stall the whole document.
            const timer = window.setTimeout(() => finish(null), 10000);
            try {
                store.get(name, (img: ExtractedImage) => {
                    window.clearTimeout(timer);
                    finish(img ?? null);
                });
            } catch (e) {
                void eventCallback({
                    kind: "error",
                    error: String(e),
                    pageNum: pageNum,
                });
                window.clearTimeout(timer);
                finish(null);
            }
        });
    }
}
