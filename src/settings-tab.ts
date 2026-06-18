import { PluginSettingTab } from "obsidian";
import type PdfImageExtractorPlugin from "main";
import type { SettingDefinitionItem } from "obsidian";
import { DEFAULT_SETTINGS } from "./settings";

type SettingsKey = keyof typeof DEFAULT_SETTINGS;

export class PdfImageExtractorSettingTab extends PluginSettingTab {
    plugin: PdfImageExtractorPlugin;

    constructor(plugin: PdfImageExtractorPlugin) {
        super(plugin.app, plugin);
        this.plugin = plugin;
    }

    getControlValue(key: string): unknown {
        return this.plugin.getSetting(key as SettingsKey);
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        (this.plugin.settings as Record<string, unknown>)[key] = value;
        await this.plugin.saveSettings();
        this.update();
    }

    getSettingDefinitions(): SettingDefinitionItem<SettingsKey>[] {
        return [
            {
                name: "Output folder",
                desc: "Where extracted images are saved. 'Vault attachments folder' uses Obsidian's configured attachments folder.",
                control: {
                    type: "dropdown",
                    key: "outputFolderMode",
                    defaultValue: DEFAULT_SETTINGS.outputFolderMode,
                    options: {
                        "default": "Vault attachments folder",
                        "pdf": "Same folder as the PDF",
                        "subfolder": "Subfolder of the PDF's folder",
                        "custom": "Custom vault path",
                    },
                },
            },
            {
                name: "Subfolder template",
                desc: "Relative to the PDF's folder. Supports {pdfname}. Example: {pdfname}-images",
                visible: () => this.plugin.getSetting("outputFolderMode") === "subfolder",
                control: {
                    type: "text",
                    key: "subfolderTemplate",
                    defaultValue: DEFAULT_SETTINGS.subfolderTemplate,
                    placeholder: "{pdfname}",
                },
            },
            {
                name: "Custom folder path",
                desc: "Vault-relative path. Will be created if it does not exist.",
                visible: () => this.plugin.getSetting("outputFolderMode") === "custom",
                control: {
                    type: "text",
                    key: "customFolderPath",
                    defaultValue: DEFAULT_SETTINGS.customFolderPath,
                    placeholder: "Extracted Images",
                },
            },
            {
                name: "Filename template",
                desc: "Supports {pdfname}, {page}, {index}. Extension is added automatically.",
                control: {
                    type: "text",
                    key: "filenameTemplate",
                    defaultValue: DEFAULT_SETTINGS.filenameTemplate,
                    placeholder: "{pdfname}-p{page}-img{index}",
                },
            },
            {
                name: "Output format",
                desc: "File format for saved images.",
                control: {
                    type: "dropdown",
                    key: "outputFormat",
                    defaultValue: DEFAULT_SETTINGS.outputFormat,
                    options: {
                        "png": "PNG (lossless)",
                        "jpeg": "JPEG (smaller, lossy)",
                    },
                },
            },
            {
                name: "JPEG quality",
                desc: "Quality between 1 and 100.",
                visible: () => this.plugin.getSetting("outputFormat") === "jpeg",
                control: {
                    type: "slider",
                    key: "jpegQuality",
                    defaultValue: DEFAULT_SETTINGS.jpegQuality,
                    min: 1,
                    max: 100,
                    step: 1,
                },
            },
            {
                name: "Minimum width (pixels)",
                desc: "Skip images narrower than this. 0 disables the filter.",
                control: {
                    type: "number",
                    key: "minWidth",
                    defaultValue: DEFAULT_SETTINGS.minWidth,
                    placeholder: "0",
                },
            },
            {
                name: "Minimum height (pixels)",
                desc: "Skip images shorter than this. 0 disables the filter.",
                control: {
                    type: "number",
                    key: "minHeight",
                    defaultValue: DEFAULT_SETTINGS.minHeight,
                    placeholder: "0",
                },
            },
            {
                name: "Overwrite existing files",
                desc: "When off, a numeric suffix is appended to avoid overwriting.",
                control: {
                    type: "toggle",
                    key: "overwriteExisting",
                    defaultValue: DEFAULT_SETTINGS.overwriteExisting,
                },
            },
        ];
    }
}
