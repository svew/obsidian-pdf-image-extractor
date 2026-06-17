import { Plugin } from "obsidian";
import { PdfImageExtractorSettingTab } from "./settings-tab";
import { DEFAULT_SETTINGS, PdfImageExtractorSettings } from "settings";
import { PdfImageExtractorCommand } from "pdf-extractor-command";


export default class PdfImageExtractorPlugin extends Plugin {
    settings: Partial<PdfImageExtractorSettings> = {};

    async onload() {
        await this.loadSettings();

        this.addCommand(new PdfImageExtractorCommand(this));
        this.addSettingTab(new PdfImageExtractorSettingTab(this.app, this));
    }

    async loadSettings() {
        this.settings = await this.loadData() as Partial<PdfImageExtractorSettings> | null ?? {} ;
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    getSetting<T extends keyof PdfImageExtractorSettings>(name: T): PdfImageExtractorSettings[T] {
        if (name in this.settings) {
            return this.settings[name] ?? DEFAULT_SETTINGS[name];
        }
        return DEFAULT_SETTINGS[name];
    }
}



