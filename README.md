# PDF Image Extractor

An Obsidian plugin that adds a single command — **Extract images from PDF** — which scans the
currently open PDF, pulls out every embedded image using Mozilla's
[PDF.js](https://mozilla.github.io/pdf.js/) library, and saves each one as a PNG into the
attachments folder configured in your vault settings.

## Usage

1. Open a PDF inside Obsidian so it is the active file.
2. Run the command palette (`Ctrl/Cmd + P`) and choose **Extract images from PDF**.
3. The plugin walks every page, extracts the embedded images, and writes them to your
   configured attachments folder. A notice reports how many images were saved.

Saved files are named `<pdf-name>-p<page>-img<n>.png`. Existing files are never overwritten —
a numeric suffix is appended when a name collision occurs.

## How it works

- The PDF is read from the vault as binary and parsed with `pdfjs-dist`.
- For each page, the operator list is inspected for image-painting operators
  (`paintImageXObject`, `paintImageXObjectRepeat`, `paintInlineImageXObject`).
- Each image object's pixel data (or `ImageBitmap`) is drawn to an off-DOM `<canvas>` and
  encoded to PNG.
- The destination folder is resolved from the vault's `attachmentFolderPath` setting,
  including support for vault-root, fixed-folder, and `./relative` configurations.

The PDF.js worker is bundled into the plugin and started from an in-memory Blob URL, so no
extra files need to be shipped or configured.

## Development

```bash
npm install
npm run dev     # watch / rebuild main.js
npm run build   # type-check + production build
```

Copy `main.js`, `manifest.json` (and `styles.css` if present) into
`<vault>/.obsidian/plugins/pdf-image-extractor/` to test inside a vault, or symlink this
folder there during development.
