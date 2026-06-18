# PDF Image Extractor

An Obsidian plugin provides a command to find all the embedded images in the currently opened PDF file, and saves each one to a subfolder in your vault.

<img width="838" height="640" alt="Recording 2026-06-17 171259" src="https://github.com/user-attachments/assets/4ff2c956-d643-485f-a21b-15d3bd7b8605" />

## Usage

1. Open a PDF inside Obsidian.
2. Run the command palette (`Ctrl/Cmd + P`) and choose **PDF Image Extractor: Extract images from PDF**.
3. The plugin walks every page, extracts the embedded images, and writes them to your configured attachments folder.

By default, saved files are named `{pdfname}-p{page}-{index}.png` and placed in the same attachments folder as specified by your vault settings, but this can be configured in the plugin settings.

## Reporting Bugs

Please submit bug reports to this repo's issues.

## Contributing

Contributions are welcome, though please create an issue first before beginning any work so there's no miscommunications.


## Development

```bash
npm install
npm run dev     # watch / rebuild main.js
npm run build   # type-check + production build
```

Copy `main.js`, `manifest.json` into `<vault>/.obsidian/plugins/pdf-image-extractor/` to test inside a vault.
