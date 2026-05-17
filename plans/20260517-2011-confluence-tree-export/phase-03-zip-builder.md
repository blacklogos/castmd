# Phase 03 — Vendor JSZip + ZIP builder

## Goal

Vendor JSZip locally (MV3 CSP forbids remote scripts) and wrap it in a tiny `lib/zip-builder.js` so the orchestrator just calls `buildZip(entries)`.

## Files

- **New**: `vendor/jszip.min.js` — copy from official JSZip release (~95KB minified). Pin version, document in file header comment.
- **New**: `lib/zip-builder.js`
- **Edit**: `popup.html` — load `vendor/jszip.min.js` then `lib/zip-builder.js`.

## Public API

```js
window.ZipBuilder = {
  // entries: [{ path: 'Parent/Child.md', content: '# ...' }]
  // returns Blob
  buildZip(entries)
}
```

## Steps

1. Download JSZip 3.x minified from official GitHub release. Put `vendor/jszip.min.js`. Add header comment with version + source URL + license note.
2. Implement `buildZip`:
   ```js
   const zip = new JSZip();
   for (const e of entries) zip.file(e.path, e.content);
   return await zip.generateAsync({ type: 'blob' });
   ```
3. Wire script tags in `popup.html`.
4. Smoke-test from popup devtools console: build a 3-file zip, trigger `chrome.downloads.download` with the blob URL, verify ZIP opens and structure is correct.

## Done when

- ZIP downloads, opens in macOS Finder, contains exact tree
- File names with spaces/punctuation survive intact
- No CSP / MV3 warnings in extension console

## Out of scope

- Compression tuning (default DEFLATE level is fine)
- Streaming (100-page cap → in-memory is safe)
- Progress events from JSZip (we report progress from the fetch loop, not the zip step)

## Open questions

- License: JSZip is MIT/GPLv3 dual-licensed. Add NOTICE / LICENSE-jszip entry? Confirm what we already do for other deps (likely none — this is the first vendored dep). Add `vendor/LICENSE-jszip.txt`.
