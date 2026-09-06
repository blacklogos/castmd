# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Chrome Extension (Manifest V3) that converts webpage HTML to Markdown, extracts heading outlines, and analyzes arbitrary URLs. No build step — files are loaded directly by Chrome.

## Loading & Testing

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select this directory
4. After code changes, click the reload icon on the extension card

Two automated suites, both `node:test`, no build step:

- `npm test` — pure lib modules (`lib/*.js`) under Node, real DOM via `linkedom`.
- `npm run test:e2e` — the extension loaded unpacked into Chrome for Testing and
  driven with puppeteer: popup UI, content script injection, service worker,
  the local `.md` viewer/editor on real `file://` pages, and the Confluence
  export against a stubbed tenant (real fetch, real JSZip, real download).
  Chrome for Testing is downloaded once into `~/.cache/puppeteer` on first run;
  `CHROME_PATH` overrides it, `CASTMD_E2E_HEADED=1` shows the window. Branded
  Google Chrome cannot be used — it ignores `--load-extension`.

`npm run test:all` runs both. Details and the one deliberate deviation from the
shipped artifact (host permissions, see `tests/e2e/helpers/test-build.js`) are
documented in that helper.

## Architecture

```
manifest.json              Extension config (MV3, permissions, entry points)
popup.html/js              Extension popup UI — orchestrates all user actions
content.js                 Injected into every page — core conversion logic
background.js              Service worker — context menu, keyboard shortcut, badge
md-viewer.js/css           Content script — renders local file:// *.md files as HTML
lib/markdown-to-html.js    Pure MD→HTML renderer (used by md-viewer.js)
lib/html-to-markdown.js    Pure HTML→MD conversion (used by Confluence flow)
lib/confluence-api.js      Confluence Cloud v2 REST client + tree discovery
lib/zip-builder.js         Thin wrapper over JSZip
lib/confluence-export.js   Orchestrator: discover → fetch → convert → ZIP
vendor/jszip.min.js        Vendored JSZip 3.10.1 (MV3 CSP forbids remote scripts)
```

### Message Flow

```
popup.js       ──(chrome.tabs.sendMessage)──►      content.js  (convert, getOutline, getPageMeta)
background.js  ──(chrome.scripting.executeScript)─► content.js  then a clipboard write in the page
```

### Key Design Decisions

- **Content detection** (`findMainContent`): tries semantic HTML selectors in priority order (`main`, `article`, `[role="main"]`, etc.), falls back to content-density analysis (text length minus link text, divided by element count).
- **`shouldSkipElement`**: filters out nav/header/footer/sidebar elements, and anything computed-invisible. Only `content.js` has it — the background worker injects `content.js` as a file rather than a serialized function, so nothing needs to be duplicated for `executeScript` any more.
- **Flat block pass**: `convertToMarkdown` (and `elementToMarkdown` in the lib) query all block tags at once, then skip any node whose parent chain hits `p,li,ul,ol,pre,table` — the owning converter already walked it. Without that check, inline `<code>` in a paragraph, a nested `<ul>`, and `<li><p>` each render twice, and the duplicate lands mid-line where it breaks the following heading.
- **Filenames** are the popup's job (`slugifyUrl` in `popup.js` for downloads, `HtmlToMarkdown.sanitizeTitle` for ZIP entries). `sanitizeTitle` also has to be traversal-safe: titles become ZIP paths.
- **Confluence tree export** (`lib/confluence-*.js`): runs entirely in popup context. Discovers page tree via Confluence Cloud v2 children API (paginated, BFS, hard cap 100), fetches rendered HTML bodies (`body-format=export_view`) at concurrency 3 with 429 backoff, converts via `lib/html-to-markdown.js`, packages into a ZIP via vendored JSZip, downloads via `<a download>`. MV3 service worker is **not** used — popup-bound execution avoids worker idle-kill on multi-minute jobs. Permission for `https://{tenant}.atlassian.net/*` is requested on-demand at preview time.
- **Local .md viewer + editor** (`md-viewer.js` + `lib/markdown-to-html.js`): declared content script on `file:///*` with markdown-extension globs, run with `"world": "MAIN"` (not the default isolated world) — its Save button needs `showSaveFilePicker`, which is not exposed to isolated-world content scripts, and relaying the call through `background.js` would lose the transient user activation the picker requires. Both files must stay free of `chrome.*` API calls or the MAIN-world script silently loses access to them. Only activates on Chrome's plain-text viewer layout (body with a single `<pre>`), hides the raw `<pre>` (kept in DOM, and kept in sync after a save), and inserts a rendered `<article class="castmd-viewer">`. The renderer escapes all raw HTML (file:// pages share an origin, so passthrough would be XSS) and neutralizes `javascript:`/`data:` URLs. Requires the user to enable "Allow access to file URLs" in `chrome://extensions`; without it Chrome never injects the script. A leading YAML frontmatter block is stripped before rendering (`lib/markdown-to-html.js`'s `stripFrontmatter`), but the editor textarea is always seeded from the raw source, frontmatter included, so saving never drops it. Edit swaps the rendered article for a textarea holding the raw source; Save writes it back via `showSaveFilePicker` → `createWritable()`, keeping the resulting `FileSystemFileHandle` in a module-scope variable for the page load so later saves skip the picker. No handle persistence across reloads and no conflict detection against external changes to the file — both deliberately deferred, not bugs.
- **Pure conversion module** (`lib/html-to-markdown.js`): exposes `HtmlToMarkdown.htmlStringToMarkdown(html, {pageTitle})`. Intentionally duplicates pure block-converter functions from `content.js` rather than refactoring the content script (refactor risk not worth it for this feature). Adds `sanitizeTitle`, which preserves spaces and case for human-readable filenames inside the ZIP.

### Permissions Used

`activeTab`, `scripting`, `clipboardWrite`, `contextMenus`, `tabs`, `optional_host_permissions: <all_urls>`. Host permissions are requested on-demand: `<all_urls>` for the "all tabs" flows, and narrower `https://{tenant}.atlassian.net/*` for Confluence export.

## Known Duplicated Code

`inlineNodesToMarkdown`, `getMarkdownForElement`, `handleCodeBlock`, `detectLanguage`, `handleTable`, `handleLists`, `collapseInlineWhitespace`, `cleanText`, and the `isRenderedByAncestor` block-ownership check exist in both `content.js` (live page DOM) and `lib/html-to-markdown.js` (HTML fetched over the network, no live page). **A conversion fix in one must be applied to the other**; every conversion bug found so far existed in both copies. Refactoring `content.js` to import the shared module is deferred — it would require switching the content script to ES modules and dynamic import.
