import { App, PluginSettingTab, Setting } from "obsidian";
import type PdfImageExtractorPlugin from "main";
import { DEFAULT_SETTINGS, OutputFolderMode, OutputFormat } from "./settings";


export class PdfImageExtractorSettingTab extends PluginSettingTab {
    private plugin: PdfImageExtractorPlugin;

    constructor(app: App, plugin: PdfImageExtractorPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Output folder")
            .setDesc("Where extracted images are saved. 'Vault attachments folder' uses Obsidian's configured attachments folder.")
            .addDropdown((drop) => drop
                .addOption("default", "Vault attachments folder")
                .addOption("pdf", "Same folder as the PDF")
                .addOption("subfolder", "Subfolder of the PDF's folder")
                .addOption("custom", "Custom vault path")
                .setValue(this.plugin.getSetting("outputFolderMode"))
                .onChange(async (value) => {
                    this.plugin.settings.outputFolderMode = value as OutputFolderMode;
                    await this.plugin.saveSettings();
                    this.display();
                })
            );

        if (this.plugin.getSetting("outputFolderMode") === "subfolder") {
            new Setting(containerEl)
                .setName("Subfolder template")
                .setDesc("Relative to the PDF's folder. Supports {pdfname}. Example: {pdfname}-images")
                .addText((text) => text
                    .setPlaceholder("{pdfname}")
                    .setValue(this.plugin.getSetting("subfolderTemplate"))
                    .onChange(async (value) => {
                        this.plugin.settings.subfolderTemplate = value;
                        await this.plugin.saveSettings();
                    })
                );
        }

        if (this.plugin.getSetting("outputFolderMode") === "custom") {
            new Setting(containerEl)
                .setName("Custom folder path")
                .setDesc("Vault-relative path. Will be created if it does not exist.")
                .addText((text) => text
                    .setPlaceholder("Extracted Images")
                    .setValue(this.plugin.getSetting("customFolderPath"))
                    .onChange(async (value) => {
                        this.plugin.settings.customFolderPath = value;
                        await this.plugin.saveSettings();
                    })
                );
        }

        new Setting(containerEl)
            .setName("Filename template")
            .setDesc("Supports {pdfname}, {page}, {index}. Extension is added automatically.")
            .addText((text) => text
                .setPlaceholder("{pdfname}-p{page}-img{index}")
                .setValue(this.plugin.getSetting("filenameTemplate"))
                .onChange(async (value) => {
                    this.plugin.settings.filenameTemplate = value || DEFAULT_SETTINGS.filenameTemplate;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Output format")
            .setDesc("File format for saved images.")
            .addDropdown((drop) => drop
                .addOption("png", "PNG (lossless)")
                .addOption("jpeg", "JPEG (smaller, lossy)")
                .setValue(this.plugin.getSetting("outputFormat"))
                .onChange(async (value) => {
                    this.plugin.settings.outputFormat = value as OutputFormat;
                    await this.plugin.saveSettings();
                    this.display();
                })
            );

        if (this.plugin.getSetting("outputFormat") === "jpeg") {
            new Setting(containerEl)
                .setName("JPEG quality")
                .setDesc("Quality between 1 and 100.")
                .addSlider((slider) => slider
                    .setLimits(1, 100, 1)
                    .setValue(this.plugin.getSetting("jpegQuality"))
                    .onChange(async (value) => {
                        this.plugin.settings.jpegQuality = value;
                        await this.plugin.saveSettings();
                    })
                );
        }

        new Setting(containerEl)
            .setName("Minimum width (pixels)")
            .setDesc("Skip images narrower than this. 0 disables the filter.")
            .addText((text) => text
                .setPlaceholder("0")
                .setValue(String(this.plugin.getSetting("minWidth")))
                .onChange(async (value) => {
                    const n = Number.parseInt(value);
                    if (!Number.isFinite(n) || n < 0) {
                        text.setValue(String(this.plugin.getSetting("minWidth")));
                        return;
                    }
                    this.plugin.settings.minWidth = n;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Minimum height (pixels)")
            .setDesc("Skip images shorter than this. 0 disables the filter.")
            .addText((text) =>
                text
                    .setPlaceholder("0")
                    .setValue(String(this.plugin.getSetting("minHeight")))
                    .onChange(async (value) => {
                        const n = Number.parseInt(value);
                        if (!Number.isFinite(n) || n < 0) {
                            text.setValue(String(this.plugin.getSetting("minHeight")));
                            return;
                        }
                        this.plugin.settings.minHeight = n;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Overwrite existing files")
            .setDesc("When off, a numeric suffix is appended to avoid overwriting.")
            .addToggle((toggle) => toggle
                .setValue(this.plugin.getSetting("overwriteExisting"))
                .onChange(async (value) => {
                    this.plugin.settings.overwriteExisting = value;
                    await this.plugin.saveSettings();
                })
            );
    }
}
