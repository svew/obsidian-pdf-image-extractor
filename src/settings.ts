
export type OutputFolderMode = "default" | "pdf" | "subfolder" | "custom";
export type OutputFormat = "png" | "jpeg";

export interface PdfImageExtractorSettings {
    outputFolderMode: OutputFolderMode;
    subfolderTemplate: string;
    customFolderPath: string;
    filenameTemplate: string;
    minWidth: number;
    minHeight: number;
    outputFormat: OutputFormat;
    jpegQuality: number;
    overwriteExisting: boolean;
}

export const DEFAULT_SETTINGS: PdfImageExtractorSettings = {
    outputFolderMode: "default",
    subfolderTemplate: "{pdfname}",
    customFolderPath: "",
    filenameTemplate: "{pdfname}-p{page}-{index}",
    minWidth: 30,
    minHeight: 30,
    outputFormat: "png",
    jpegQuality: 92,
    overwriteExisting: false,
};