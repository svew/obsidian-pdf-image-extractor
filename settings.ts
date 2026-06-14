import { App, PluginSettingTab, Setting } from "obsidian";
import type PdfImageExtractorPlugin from "./main";

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
	filenameTemplate: "{pdfname}-p{page}-img{index}",
	minWidth: 0,
	minHeight: 0,
	outputFormat: "png",
	jpegQuality: 92,
	overwriteExisting: false,
};

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
			.setDesc(
				"Where extracted images are saved. 'Vault attachments folder' uses Obsidian's configured attachments folder."
			)
			.addDropdown((drop) =>
				drop
					.addOption("default", "Vault attachments folder")
					.addOption("pdf", "Same folder as the PDF")
					.addOption(
						"subfolder",
						"Subfolder of the PDF's folder (template)"
					)
					.addOption("custom", "Custom vault path")
					.setValue(this.plugin.settings.outputFolderMode)
					.onChange(async (value) => {
						this.plugin.settings.outputFolderMode =
							value as OutputFolderMode;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.outputFolderMode === "subfolder") {
			new Setting(containerEl)
				.setName("Subfolder template")
				.setDesc(
					"Relative to the PDF's folder. Supports {pdfname}. Example: {pdfname}-images"
				)
				.addText((text) =>
					text
						.setPlaceholder("{pdfname}")
						.setValue(this.plugin.settings.subfolderTemplate)
						.onChange(async (value) => {
							this.plugin.settings.subfolderTemplate = value;
							await this.plugin.saveSettings();
						})
				);
		}

		if (this.plugin.settings.outputFolderMode === "custom") {
			new Setting(containerEl)
				.setName("Custom folder path")
				.setDesc(
					"Vault-relative path. Will be created if it does not exist."
				)
				.addText((text) =>
					text
						.setPlaceholder("Extracted Images")
						.setValue(this.plugin.settings.customFolderPath)
						.onChange(async (value) => {
							this.plugin.settings.customFolderPath = value;
							await this.plugin.saveSettings();
						})
				);
		}

		new Setting(containerEl)
			.setName("Filename template")
			.setDesc(
				"Supports {pdfname}, {page}, {index}. Extension is added automatically."
			)
			.addText((text) =>
				text
					.setPlaceholder("{pdfname}-p{page}-img{index}")
					.setValue(this.plugin.settings.filenameTemplate)
					.onChange(async (value) => {
						this.plugin.settings.filenameTemplate =
							value || DEFAULT_SETTINGS.filenameTemplate;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Output format")
			.setDesc("File format for saved images.")
			.addDropdown((drop) =>
				drop
					.addOption("png", "PNG (lossless)")
					.addOption("jpeg", "JPEG (smaller, lossy)")
					.setValue(this.plugin.settings.outputFormat)
					.onChange(async (value) => {
						this.plugin.settings.outputFormat =
							value as OutputFormat;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.outputFormat === "jpeg") {
			new Setting(containerEl)
				.setName("JPEG quality")
				.setDesc("Quality between 1 and 100.")
				.addSlider((slider) =>
					slider
						.setLimits(1, 100, 1)
						.setValue(this.plugin.settings.jpegQuality)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.jpegQuality = value;
							await this.plugin.saveSettings();
						})
				);
		}

		new Setting(containerEl)
			.setName("Minimum width (px)")
			.setDesc("Skip images narrower than this. 0 disables the filter.")
			.addText((text) =>
				text
					.setPlaceholder("0")
					.setValue(String(this.plugin.settings.minWidth))
					.onChange(async (value) => {
						const n = Number.parseInt(value, 10);
						this.plugin.settings.minWidth =
							Number.isFinite(n) && n >= 0 ? n : 0;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Minimum height (px)")
			.setDesc("Skip images shorter than this. 0 disables the filter.")
			.addText((text) =>
				text
					.setPlaceholder("0")
					.setValue(String(this.plugin.settings.minHeight))
					.onChange(async (value) => {
						const n = Number.parseInt(value, 10);
						this.plugin.settings.minHeight =
							Number.isFinite(n) && n >= 0 ? n : 0;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Overwrite existing files")
			.setDesc(
				"When off, a numeric suffix is appended to avoid overwriting."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.overwriteExisting)
					.onChange(async (value) => {
						this.plugin.settings.overwriteExisting = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
