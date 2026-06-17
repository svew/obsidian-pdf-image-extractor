import PdfImageExtractorPlugin from "main";
import { Command, normalizePath, Notice, TFile, Vault } from "obsidian";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerSource from "pdfjs-dist/build/pdf.worker.min.js";
import { PdfExtractor } from "./pdf-extractor";
import { OutputFolderMode, OutputFormat } from "settings";

export class PdfImageExtractorCommand implements Command
{
    private workerInitialized = false;

    public readonly id = "extract-images-from-pdf";
    public readonly name = "Extract images from PDF";
    public readonly icon = "image-down";

    constructor(public readonly plugin: PdfImageExtractorPlugin) { }
    
    async callback(): Promise<void> {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension.toLowerCase() !== "pdf") {
            new Notice("No PDF file is currently open.");
            return;
        }

        const progress = new Notice("Extracting images from PDF…", 0);

        try {
            this.initWorker();

            const arrayBuffer = await this.plugin.app.vault.readBinary(activeFile);
            const format = this.plugin.getSetting("outputFormat");

            const fileWriter = new VaultFileWriter(
                this.plugin.app.vault,
                this.plugin.getSetting("filenameTemplate"),
                this.plugin.getSetting("outputFolderMode"),
                this.plugin.getSetting("subfolderTemplate"),
                this.plugin.getSetting("customFolderPath"),
                this.plugin.getSetting("overwriteExisting"),
                activeFile.basename,
                this.plugin.getSetting("outputFormat"),
                activeFile.parent ? activeFile.parent.path : "",
            );

            const extractor = new PdfExtractor(
                format,
                this.plugin.getSetting("minWidth"),
                this.plugin.getSetting("minHeight"),
                this.plugin.getSetting("jpegQuality"),
            );

            let saved = 0;
            let skipped = 0;
            let totalPages = 0;

            await extractor.extract(arrayBuffer, async (event) => {
                if (event.kind === "initial") {
                    totalPages = event.pageNumTotal;
                }
                else if (event.kind === "image") {
                    await fileWriter.writeImage(event.imageBytes, event.pageNum, event.imageNum);
                    saved++;
                    progress.setMessage(`Extracting images from page ${event.pageNum}/${totalPages}… (${saved} saved)`);
                }
                else if (event.kind === "skipped") {
                    skipped += 1;
                }
                else if (event.kind === "error") {
                    console.warn(`PDF Image Extractor: ${event.error}` + (event.pageNum ? ` (page ${event.pageNum})` : ""));
                }
            });

            progress.hide();

            if (saved === 0) {
                if (skipped > 0) {
                    new Notice(`No images saved (${skipped} skipped by minimum size filter).`);
                } else {
                    new Notice("No extractable images were found in this PDF.");
                }
            } else {
                const skippedNote = skipped > 0 ? ` (${skipped} skipped by size filter)` : "";
                new Notice(`Extracted ${saved} image${saved === 1 ? "" : "s"} to "${fileWriter.outputFolder || "vault root"}"${skippedNote}.`);
            }
        } catch (err) {
            progress.hide();
            console.error("PDF Image Extractor: failed to extract images", err);
            new Notice("Failed to extract images from PDF. See the developer console for details.");
        }
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
}


// Handles writing files to vault derived from the given active file
class VaultFileWriter {

    private fileExt: string;

    public readonly outputFolder: string;

    constructor(
        private readonly vault: Vault,
        private readonly filenameTemplate: string,
        private readonly outputFolderMode: OutputFolderMode,
        private readonly subfolderTemplate: string,
        private readonly customFolderPath: string,
        private readonly overwriteExisting: boolean,
        private readonly pdfName: string,
        outputFormat: OutputFormat,
        workingFolder: string,
    ) {
        this.fileExt = outputFormat === "jpeg" ? "jpg" : "png";

        this.outputFolder = this.resolveOutputFolder(workingFolder);
        if (this.outputFolder && !this.vault.getAbstractFileByPath(this.outputFolder)) {
            /* async */ this.vault.createFolder(this.outputFolder);
        }
    }

    async writeImage(imageBytes: ArrayBuffer, pageNum: number, imageNum: number): Promise<void> {
        const baseName = this.formatName(this.filenameTemplate, { page: pageNum, index: imageNum });
        const targetPath = await this.getTargetPath(this.outputFolder, baseName, this.fileExt);
        const existing = this.vault.getAbstractFileByPath(targetPath);
        if (existing instanceof TFile) {
            await this.vault.modifyBinary(existing, imageBytes);
        } else {
            await this.vault.createBinary(targetPath, imageBytes);
        }
    }

    private resolveOutputFolder(workingFolder: string) {
        let folder = "";
        switch (this.outputFolderMode) {
            case "pdf":
                folder = workingFolder;
                break;
            case "subfolder": {
                const sub = this.formatName(this.subfolderTemplate, { removeSlashes: false });
                folder = workingFolder ? `${workingFolder}/${sub}` : sub;
                break;
            }
            case "custom":
                folder = this.customFolderPath.trim();
                break;
            case "default":
            default:
                folder = this.getVaultAttachmentFolder(workingFolder);
                break;
        }
        folder = folder ? normalizePath(folder) : "";
        return folder;
    }

    /**
     * Read Obsidian's configured attachments folder and resolve it relative to
     * the source PDF. Handles absolute, relative ("./sub") and root configs.
     */
    private getVaultAttachmentFolder(workingFolder: string): string {
        const vault = this.vault as unknown as {
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
            const rel = configured.slice(2);
            return parent ? `${workingFolder}/${rel}` : rel;
        }
        return configured;
    }

    /**
     * Substitute {pdfname}, {page}, {index} placeholders in a template and
     * strip characters that are not safe for vault paths.
     */
    private formatName(
        template: string,
        args: {
            page?: number,
            index?: number,
            removeSlashes?: boolean
        },
    ): string {
        return template
            .replace(/\{pdfname\}/gi, this.pdfName)
            .replace(/\{page\}/gi, String(args.page ?? ""))
            .replace(/\{index\}/gi, String(args.index ?? ""))
            .replace(/[:*?"<>|]/g, "_")
            .replace('/', (args.removeSlashes ?? true) ? "" : "/")
            .replace('\\', (args.removeSlashes ?? true) ? "" : "\\");
    }

    private async getTargetPath(folder: string, baseName: string, ext: string): Promise<string> {
        const make = (suffix: string) => normalizePath(`${folder ? folder + "/" : ""}${baseName}${suffix}.${ext}`);

        let candidate = make("");
        if (this.overwriteExisting) {
            return candidate;
        }
        let counter = 1;
        while (this.vault.getAbstractFileByPath(candidate)) {
            candidate = make(`-${counter++}`);
        }
        return candidate;
    }
}