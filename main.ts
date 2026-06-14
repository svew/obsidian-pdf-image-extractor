import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import * as pdfjs from "pdfjs-dist";
import type { PDFPageProxy } from "pdfjs-dist";
import pdfWorkerSource from "pdfjs-dist/build/pdf.worker.min.js";
import {
	DEFAULT_SETTINGS,
	PdfImageExtractorSettingTab,
	type PdfImageExtractorSettings,
} from "./settings";

// PDF.js ImageKind enum values (kept local to avoid relying on a runtime export).
const ImageKind = {
	GRAYSCALE_1BPP: 1,
	RGB_24BPP: 2,
	RGBA_32BPP: 3,
} as const;

// A decoded image pulled out of a PDF page's operator list.
interface ExtractedImage {
	width: number;
	height: number;
	// Either raw pixel data + kind, or a ready-to-draw bitmap (newer PDF.js).
	data?: Uint8ClampedArray | Uint8Array;
	kind?: number;
	bitmap?: ImageBitmap;
}

export default class PdfImageExtractorPlugin extends Plugin {
	settings: PdfImageExtractorSettings = { ...DEFAULT_SETTINGS };

	private workerInitialized = false;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "extract-images-from-pdf",
			name: "Extract images from PDF",
			callback: () => this.extractImagesFromActivePdf(),
		});

		this.addSettingTab(new PdfImageExtractorSettingTab(this.app, this));
	}

	async loadSettings() {
		const loaded = (await this.loadData()) as
			| Partial<PdfImageExtractorSettings>
			| null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * Configure PDF.js to run its worker from an in-memory Blob built from the
	 * bundled worker source, so no separate worker file needs to be shipped.
	 */
	private initWorker() {
		if (this.workerInitialized) {
			return;
		}
		const blob = new Blob([pdfWorkerSource], {
			type: "application/javascript",
		});
		pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
		this.workerInitialized = true;
	}

	private async extractImagesFromActivePdf() {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension.toLowerCase() !== "pdf") {
			new Notice("No PDF file is currently open.");
			return;
		}

		this.initWorker();

		const progress = new Notice("Extracting images from PDF…", 0);
		try {
			const arrayBuffer = await this.app.vault.readBinary(file);
			const folderPath = await this.resolveOutputFolder(file);
			const format = this.settings.outputFormat;
			const ext = format === "jpeg" ? "jpg" : "png";

			const loadingTask = pdfjs.getDocument({
				data: new Uint8Array(arrayBuffer),
				isEvalSupported: false,
			});
			const doc = await loadingTask.promise;

			let saved = 0;
			let skipped = 0;
			const seen = new Set<string>();

			for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
				progress.setMessage(
					`Extracting images… page ${pageNum}/${doc.numPages} (${saved} saved)`
				);
				const page = await doc.getPage(pageNum);
				const images = await this.getPageImages(page, pageNum, seen);

				for (let i = 0; i < images.length; i++) {
					const img = images[i];
					if (
						img.width < this.settings.minWidth ||
						img.height < this.settings.minHeight
					) {
						skipped++;
						continue;
					}
					const bytes = await this.imageToBytes(img, format);
					if (!bytes) {
						continue;
					}
					const baseName = this.formatName(
						this.settings.filenameTemplate,
						file.basename,
						pageNum,
						i + 1
					);
					const targetPath = await this.getTargetPath(
						folderPath,
						baseName,
						ext
					);
					const existing =
						this.app.vault.getAbstractFileByPath(targetPath);
					if (existing instanceof TFile) {
						await this.app.vault.modifyBinary(existing, bytes);
					} else {
						await this.app.vault.createBinary(targetPath, bytes);
					}
					saved++;
				}
				page.cleanup();
			}

			await doc.destroy();
			progress.hide();

			if (saved === 0) {
				if (skipped > 0) {
					new Notice(
						`No images saved (${skipped} skipped by minimum size filter).`
					);
				} else {
					new Notice(
						"No extractable images were found in this PDF."
					);
				}
			} else {
				const skippedNote =
					skipped > 0 ? ` (${skipped} skipped by size filter)` : "";
				new Notice(
					`Extracted ${saved} image${saved === 1 ? "" : "s"} to "${
						folderPath || "vault root"
					}"${skippedNote}.`
				);
			}
		} catch (err) {
			progress.hide();
			console.error("PDF Image Extractor: failed to extract images", err);
			new Notice(
				"Failed to extract images from PDF. See the developer console for details."
			);
		}
	}

	/**
	 * Walk a page's operator list and collect every painted image object.
	 */
	private async getPageImages(
		page: PDFPageProxy,
		pageNum: number,
		seen: Set<string>
	): Promise<ExtractedImage[]> {
		const ops = await page.getOperatorList();
		const OPS = pdfjs.OPS;
		const results: ExtractedImage[] = [];

		for (let i = 0; i < ops.fnArray.length; i++) {
			const fn = ops.fnArray[i];
			const args = ops.argsArray[i];

			if (
				fn === OPS.paintImageXObject ||
				fn === OPS.paintImageXObjectRepeat ||
				// paintJpegXObject only exists in older builds.
				fn === (OPS as Record<string, number>).paintJpegXObject
			) {
				const name = args[0] as string;
				// De-duplicate images referenced multiple times.
				const key = `${pageNum}:${name}`;
				if (seen.has(key)) {
					continue;
				}
				seen.add(key);
				const img = await this.resolveImage(page, name);
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
	private resolveImage(
		page: PDFPageProxy,
		name: string
	): Promise<ExtractedImage | null> {
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
			console.warn(
				`PDF Image Extractor: image object "${name}" not found in page stores.`
			);
			return Promise.resolve(null);
		}

		return new Promise((resolve) => {
			let settled = false;
			const finish = (img: ExtractedImage | null) => {
				if (settled) {
					return;
				}
				settled = true;
				resolve(img);
			};
			// Safety net: never let a single image stall the whole document.
			const timer = setTimeout(() => finish(null), 10000);
			try {
				store!.get(name, (img: ExtractedImage) => {
					clearTimeout(timer);
					finish(img ?? null);
				});
			} catch (e) {
				clearTimeout(timer);
				finish(null);
			}
		});
	}

	/**
	 * Render an extracted image to PNG or JPEG bytes via a canvas.
	 */
	private async imageToBytes(
		img: ExtractedImage,
		format: "png" | "jpeg"
	): Promise<ArrayBuffer | null> {
		const { width, height } = img;
		if (!width || !height) {
			return null;
		}

		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return null;
		}

		if (img.bitmap) {
			ctx.drawImage(img.bitmap, 0, 0);
		} else if (img.data) {
			const rgba = this.toRgba(img.data, width, height, img.kind);
			if (!rgba) {
				return null;
			}
			const imageData = ctx.createImageData(width, height);
			imageData.data.set(rgba);
			ctx.putImageData(imageData, 0, 0);
		} else {
			return null;
		}

		const mime = format === "jpeg" ? "image/jpeg" : "image/png";
		const quality =
			format === "jpeg"
				? Math.min(1, Math.max(0.01, this.settings.jpegQuality / 100))
				: undefined;
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob((b) => resolve(b), mime, quality)
		);
		if (!blob) {
			return null;
		}
		return await blob.arrayBuffer();
	}

	/**
	 * Normalize PDF.js pixel data of various kinds into an RGBA buffer.
	 */
	private toRgba(
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

	/**
	 * Resolve the output folder for the given source PDF based on settings,
	 * creating it if it does not already exist.
	 */
	private async resolveOutputFolder(source: TFile): Promise<string> {
		const parent = source.parent ? source.parent.path : "";
		let folder = "";

		switch (this.settings.outputFolderMode) {
			case "pdf":
				folder = parent;
				break;
			case "subfolder": {
				const sub = this.formatName(
					this.settings.subfolderTemplate || "{pdfname}",
					source.basename,
					0,
					0
				);
				folder = parent ? `${parent}/${sub}` : sub;
				break;
			}
			case "custom":
				folder = this.settings.customFolderPath.trim();
				break;
			case "default":
			default:
				folder = this.getVaultAttachmentFolder(source);
				break;
		}

		folder = folder ? normalizePath(folder) : "";

		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder).catch(() => {
				// Folder may already exist due to a race; ignore.
			});
		}

		return folder;
	}

	/**
	 * Read Obsidian's configured attachments folder and resolve it relative to
	 * the source PDF. Handles absolute, relative ("./sub") and root configs.
	 */
	private getVaultAttachmentFolder(source: TFile): string {
		const vault = this.app.vault as unknown as {
			getConfig(key: string): unknown;
		};
		let configured = "";
		const raw = vault.getConfig?.("attachmentFolderPath");
		if (typeof raw === "string") {
			configured = raw;
		}

		if (configured === "" || configured === "/") {
			return "";
		}
		if (configured.startsWith("./")) {
			const parent = source.parent ? source.parent.path : "";
			const rel = configured.slice(2);
			return parent ? `${parent}/${rel}` : rel;
		}
		return configured;
	}

	/**
	 * Substitute {pdfname}, {page}, {index} placeholders in a template and
	 * strip characters that are not safe for vault paths.
	 */
	private formatName(
		template: string,
		pdfName: string,
		page: number,
		index: number
	): string {
		const out = template
			.replace(/\{pdfname\}/gi, pdfName)
			.replace(/\{page\}/gi, String(page))
			.replace(/\{index\}/gi, String(index));
		return out.replace(/[\\/:*?"<>|]/g, "_");
	}

	/**
	 * Resolve the path to write an image to. When `overwriteExisting` is off
	 * a numeric suffix is appended to avoid clobbering existing files.
	 */
	private async getTargetPath(
		folder: string,
		baseName: string,
		ext: string
	): Promise<string> {
		const safeBase = baseName.replace(/[\\/:*?"<>|]/g, "_");
		const make = (suffix: string) =>
			normalizePath(
				`${folder ? folder + "/" : ""}${safeBase}${suffix}.${ext}`
			);

		let candidate = make("");
		if (this.settings.overwriteExisting) {
			return candidate;
		}
		let counter = 1;
		while (this.app.vault.getAbstractFileByPath(candidate)) {
			candidate = make(`-${counter++}`);
		}
		return candidate;
	}
}
