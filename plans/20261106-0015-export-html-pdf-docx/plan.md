# Export page as HTML / PDF / DOCX

Decisions (Tri, 2026-11-06): export page in a new tab, PDF via Chrome print dialog,
DOCX hand-rolled OOXML on vendored JSZip, worktree `feat/export-html-pdf-docx` off main.

## Flow

popup "Export page…" → request optional `<all_urls>` (images; denial is non-fatal)
→ inject `content.js` + `export-capture.js` → capture cleaned main-content HTML
→ `chrome.storage.session` → open `export.html?id=…`.

export page: sanitize → inline images as data URLs → editable metadata form +
header/footer fields → live preview → Download HTML / Save as PDF / Download DOCX.

## Files

- `content.js`: expose `findMainContent`, `shouldSkipElement`, `findPageTitle` on `window.__castmd`
- `export-capture.js` (injected): clone main content, drop skipped/hidden nodes,
  absolutize links, resolve lazy/srcset images, inline SVG and canvas as images, read page meta
- `lib/export-sanitize.js`: tag/attr allowlist, URL scheme filter
- `lib/export-document.js`: metadata block, document CSS, `@page` header/footer CSS, standalone HTML
- `lib/docx-parts.js`: static OOXML parts (content types, rels, styles, numbering, core props, header/footer)
- `lib/html-to-docx.js`: DOM walk → `document.xml` (headings, paragraphs, runs, links, lists, code, quotes, tables, images)
- `export.html`, `export.js`: the export page
- `popup.html/js`: new button; `manifest.json`: `storage` permission

## Header/footer tokens

`{title}` `{url}` `{date}` `{page}` `{pages}`. PDF: CSS margin boxes + `counter(page)`.
DOCX: PAGE / NUMPAGES fields. Standalone HTML: same `@page` rules, print only.

## Out of scope

Markdown output still drops images (unchanged). Content body is not editable, only metadata.

## Verify

Unit: sanitize, document builder, docx body. E2E: popup → export page on fixture with
img/svg/canvas/table; HTML download, DOCX download (unzip + pandoc), PDF via page.pdf + pdftotext.
