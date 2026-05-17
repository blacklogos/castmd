# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Chrome Extension (Manifest V3) that converts webpage HTML to Markdown, extracts heading outlines, and analyzes arbitrary URLs. No build step — files are loaded directly by Chrome.

## Loading & Testing

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select this directory
4. After code changes, click the reload icon on the extension card

Pure lib modules (`lib/html-to-markdown.js`, `lib/confluence-api.js`) have a node-based test suite. Run with `npm install && npm test` (devDep: `linkedom` for DOM). End-to-end verification (popup UI, content script, background worker, real Confluence calls) is still manual in the browser.

## Architecture

```
manifest.json              Extension config (MV3, permissions, entry points)
popup.html/js              Extension popup UI — orchestrates all user actions
content.js                 Injected into every page — core conversion logic
background.js              Service worker — handles URL analysis via temp tabs
outline.html/js            Standalone page for extracting outlines from pasted MD
lib/html-to-markdown.js    Pure HTML→MD conversion (used by Confluence flow)
lib/confluence-api.js      Confluence Cloud v2 REST client + tree discovery
lib/zip-builder.js         Thin wrapper over JSZip
lib/confluence-export.js   Orchestrator: discover → fetch → convert → ZIP
vendor/jszip.min.js        Vendored JSZip 3.10.1 (MV3 CSP forbids remote scripts)
```

### Message Flow

```
popup.js  ──(chrome.tabs.sendMessage)──►  content.js   (convert, getOutline, getPageTitle)
popup.js  ──(chrome.runtime.sendMessage)──►  background.js  (analyzeUrl)
background.js  ──(scripting.executeScript)──►  extractContent() runs in temp tab
```

### Key Design Decisions

- **Content detection** (`findMainContent`): tries semantic HTML selectors in priority order (`main`, `article`, `[role="main"]`, etc.), falls back to content-density analysis (text length minus link text, divided by element count).
- **`shouldSkipElement`**: filters out nav/header/footer/sidebar elements. This logic is **intentionally duplicated** in both `content.js` and inside `background.js`'s `extractContent` function — the latter runs via `scripting.executeScript` in a separate tab context where it can't reference outer scope.
- **Filename sanitization** (`sanitizeFileName` in `content.js`): uses the URL pathname slug, falls back to hostname, caps at 35 chars.
- **Theme persistence**: stored in `chrome.storage.local` under key `theme`. Vampire theme (Easter egg) stored separately under `vampireTheme`, triggered by 5 rapid clicks on `.credits`.
- **Confluence tree export** (`lib/confluence-*.js`): runs entirely in popup context. Discovers page tree via Confluence Cloud v2 children API (paginated, BFS, hard cap 100), fetches rendered HTML bodies (`body-format=export_view`) at concurrency 3 with 429 backoff, converts via `lib/html-to-markdown.js`, packages into a ZIP via vendored JSZip, downloads via `<a download>`. MV3 service worker is **not** used — popup-bound execution avoids worker idle-kill on multi-minute jobs. Permission for `https://{tenant}.atlassian.net/*` is requested on-demand at preview time.
- **Pure conversion module** (`lib/html-to-markdown.js`): exposes `HtmlToMarkdown.htmlStringToMarkdown(html, {pageTitle})`. Intentionally duplicates pure block-converter functions from `content.js` rather than refactoring the content script (refactor risk not worth it for this feature). Adds `sanitizeTitle` which is more permissive than `content.js`'s `sanitizeFileName` — preserves spaces/case for human-readable filenames inside the ZIP.

### Permissions Used

`activeTab`, `scripting`, `clipboardWrite`, `contextMenus`, `tabs`, `optional_host_permissions: <all_urls>`. Host permissions are requested on-demand: `<all_urls>` for the "all tabs" flows, and narrower `https://{tenant}.atlassian.net/*` for Confluence export.

## Known Duplicated Code

`findMainContent`, `isValidContentContainer`, `findContentByDensity`, `shouldSkipElement`, `findPageTitle`, `cleanText` exist in `content.js` (top-level). `content.js` and `background.js` historically also duplicated these via `scripting.executeScript` (serialization constraint — only self-contained functions can be injected). Additionally, `inlineNodesToMarkdown`, `getMarkdownForElement`, `handleCodeBlock`, `detectLanguage`, `handleTable`, `handleLists`, `cleanText` are duplicated in `lib/html-to-markdown.js` so the popup can convert HTML fetched over the network (no live page DOM). Refactoring `content.js` to import the shared module is deferred — would require switching content script to ES modules and dynamic import.
