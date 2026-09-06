## Unreleased

### Bug fixes
- Page conversion emitted duplicate content: inline `<code>` inside a paragraph or a heading, a nested `<ul>`/`<ol>`, and `<p>` wrapped inside an `<li>` were each rendered twice — once by the block that owns them and once by the flat element pass. The stray copy also landed mid-line, so the heading that followed it stopped being a heading. Ancestor ownership is now explicit: `pre`/`table` cover their whole subtree, `p`/`li`/`h1`–`h6` cover inline descendants only (`content.js` and `lib/html-to-markdown.js`, so both the page flows and the Confluence export)
- A `<pre>` or `<table>` nested inside a list item is no longer flattened into the item's text: the item keeps its prose and the block keeps its fence or its rows. A list behind a `<div>` inside an `<li>`, or hanging straight off another list, used to disappear entirely under the first version of the ownership check
- A `<code>` element that no block owns now ends its own line instead of running into the next block — bare code chips between headings are common in API docs
- Nested tables folded their rows and cells into the outer table (`handleTable` reached through `querySelectorAll`); rows and cells are now matched to their own table
- Paragraphs kept the source HTML's line wrapping, so a paragraph broken across source lines came out with hard newlines and leading spaces (4+ spaces of indentation would even open a code block). Whitespace runs now collapse to one space
- `<br>` no longer loses its Markdown hard break: the two trailing spaces used to be collapsed to one, which renders as a plain space. The hard-break pass also no longer treats a literal NUL in page text as a break
- `" .zip"` and `" .md"` keep their space: the space-before-punctuation cleanup now requires whitespace or end of string after the punctuation
- Confluence export progress bar stopped short of 100% whenever a page was skipped (403 or fetch error), leaving a finished export looking hung. Progress now counts attempts
- Context menu handler no longer throws when Chrome reports a click without a tab
- `parseUrl` rejects `http://` tenants, so the popup can no longer ask for host permission on a cleartext origin

### Tests
- New e2e suite: the extension is loaded unpacked into Chrome for Testing and driven with puppeteer — popup init and error paths, content-script injection and re-injection, markdown/JSON/XML downloads, all-tabs fan-out, the service worker clipboard path, the local `.md` viewer/editor including a hostile-input XSS check, and the full Confluence export against a stubbed tenant (real fetch, real JSZip, real ZIP download). `npm run test:e2e`, `npm run test:all`
- Unit suite grew to 104 cases: block-ownership regressions for every nesting shape that broke (code in headings, `<pre>`/`<table>` in list items, div-wrapped and malformed nested lists, nested tables), source-wrapping collapse, hard breaks, ZIP-path traversal in `sanitizeTitle`, https-only tenant parsing

### Cleanup
- Removed dead code from `content.js`: the unused `convertAndCopy` message branch, its `writeToClipboard` helper, and `sanitizeFileName` (filenames are the popup's job). Every action re-injects this file into the page, so the trim is on the hot path

## v1.4.0 — 2026-08-17

### New features
- Edit and save local `.md` files from the file:// viewer: an Edit button swaps the rendered page for a plain textarea, Save writes back to disk via the File System Access API
  - First Save per page load opens the native file picker (Chromium requires a user-chosen destination); later Saves in the same page load write silently
  - The picker cannot be pre-pointed at the file's own folder, so the first save is effectively "Save As" onto the original path — a new Copy path button copies the file's absolute path so you can jump straight to its folder (`Cmd+Shift+G` on macOS) instead of browsing manually
  - No conflict detection: if the file changed on disk since it was opened, the save overwrites it (last write wins)
  - Handle is not persisted across reloads — the picker reappears once per page load

### Bug fixes
- Local .md viewer garbled YAML frontmatter: a leading `---` block rendered as a stray `<hr>` plus the metadata fields as a paragraph, above the real content. A leading frontmatter block is now stripped before rendering (a `---` anywhere else is still a horizontal rule); the editor still sees the raw source, so frontmatter survives a save
- Viewer toolbar (Edit/Copy path/Save) rendered in the browser's default serif font instead of the intended sans-serif stack

### Architecture
- `file:///*` content script now declared with `"world": "MAIN"`. `showSaveFilePicker` is not exposed to isolated-world content scripts, and relaying the call through the service worker loses the transient user activation the picker requires. `md-viewer.js` and `lib/markdown-to-html.js` use no `chrome.*` API, so the move costs nothing — but they must stay that way

### UI
- Viewer toolbar redesigned to match the popup's visual style: castmd wordmark, button shadow and violet hover glow, border separating it from the article content, dark mode included

### Tests
- 6 new node:test cases for frontmatter handling in `lib/markdown-to-html.js` (present, absent, unterminated, mid-document `---`, empty block, CRLF). Suite now 85 cases

## v1.3.1 — 2026-08-16

### Bug fixes
- Fixed "Error when click on the ext" (#3): `content.js` was re-injected into the same tab's isolated world on every action (popup click, context menu, keyboard shortcut). Its top-level `const CONTENT_VERSION` threw `Identifier 'CONTENT_VERSION' has already been declared` on the 2nd+ action against the same tab. Wrapped the file in an IIFE so each injection gets its own function scope
- `background.js`'s context-menu / `Ctrl+Shift+M` path had no error handling for that failure and silently did nothing; added try/catch and an error badge (✗) so a failure is now visible
- Fixed popup window ballooning to ~800px wide with empty space after opening the preview panel alongside the Confluence export section. Root cause: unbounded `body` height pushed the document past Chrome's popup auto-sizing range, triggering an oversized fallback that never shrank back. Capped `body` at `max-height: 600px` with internal scrolling

## v1.3.0 — 2026-07-14

### New features
- Local .md file viewer: opening a `file:///…/*.md` file renders it as formatted HTML (GitHub-style, light/dark via `prefers-color-scheme`). Requires enabling "Allow access to file URLs" on the extension card in `chrome://extensions`
  - Supports ATX headings (with anchor ids), fenced code blocks, nested lists, task lists, GFM tables, blockquotes, inline formatting, links, images
  - Activates only on Chrome's plain-text viewer layout; raw source stays in the DOM, hidden
  - Hardened for untrusted input: raw HTML escaped (never passed through), `javascript:`/`data:` URLs neutralized with control-char stripping, nesting recursion capped at depth 100 (a 5KB file of `>` chars previously would have crashed the renderer)

### Architecture
- New pure module `lib/markdown-to-html.js` (MD→HTML), IIFE pattern matching `lib/html-to-markdown.js`; no DOM dependency
- Content script declared in manifest for `file:///*` with markdown-extension globs; conversion runs entirely in-page, no service worker involvement

### Tests
- 35 new node:test cases for `lib/markdown-to-html.js` covering all block types, XSS escaping, URL scheme filtering, and stack-depth regressions (suite now 79 cases)

## v1.2.0 — 2026-07-13

### New features
- Confluence Cloud tree export — when active tab is a Confluence Cloud page or folder, popup surfaces a new section to bulk-export the page + descendants as a ZIP of Markdown files mirroring the page hierarchy
  - Depth selector: this page / + children / + all descendants
  - Preview step shows page count before fetching bodies
  - Hard cap of 100 pages with blocking confirm dialog when exceeded
  - Permission requested on-demand for `https://{tenant}.atlassian.net/*` only
  - Pages user can't access (403/404) are skipped and listed in `_skipped.txt`
  - Concurrency capped at 3 in-flight requests; exponential backoff on 429
- Vendored JSZip 3.10.1 (`vendor/jszip.min.js`, MIT/GPLv3)

### Architecture
- Pure HTML→Markdown conversion functions extracted into `lib/html-to-markdown.js` so popup can convert HTML fetched over the network (not just from injected content scripts)
- `content.js` left untouched — keeps its own copy of conversion logic for live-page injection

### Tests
- Added node-based auto-tests covering `lib/html-to-markdown.js`, `lib/confluence-api.js`, and `lib/confluence-export.js` (`tests/*.test.js`, 44 cases). Includes fetch-mocked tests for `discoverTree` (depth, BFS, cursor pagination, cap truncation, 403 subtree skip, type filtering) and `exportTree` (hierarchical paths, filename collision dedupe, `_skipped.txt`, folder placeholders, progress callbacks). Run with `npm install && npm test`. Devdep: `linkedom` for DOM. Browser-coupled paths (popup/content/background) still verified manually.

## v1.1.0 — 2026-04-29

### New features
- Save all tabs as files — bulk-export every open tab in current window as separate `.md` / `.json` / `.xml` files (filename collisions deduped with `-2`, `-3` suffixes)

### Bug fixes
- Article extraction on every.to and other SPA-rendered editorial sites — added `[itemprop="articleBody"]` (schema.org), `.post-body`, `.article-body` selectors
- Density-fallback content detection no longer picks individual paragraph wrappers — now scores by paragraph text per element, requires ≥2 `<p>` tags

## v1.0.0 — 2026-04-27

### New features
- Light theme popup (Linear/Vercel/Raycast-inspired — white bg, violet glow hover)
- Output modes: MD · JSON · XML (Claude `<document>` wrapper format)
- Token count + model fit display — gpt-4, gpt-4o, claude, gemini
- All-tabs export — merge all open tabs into one Markdown session document
- Preview & edit panel — review and tweak output before re-copying or saving
- Right-click context menu — "Copy page as Markdown" on any page
- Keyboard shortcut — `Ctrl+Shift+M`
- Inline formatting preserved — bold, italic, links, inline code survive conversion

### Improvements
- Smart content detection — removes nav, sidebars, footers automatically
- GitHub support — adds `.markdown-body`, `#readme` selectors
- ARIA role-based skip (was tag-based — caused GitHub content to be stripped)
- Context menus registered on `onInstalled` + `onStartup` (survives service worker restart)

### Changes
- Rebranded from md·convert → castmd
- Removed URL analyzer and outline extractor (niche features)
- Removed selection+context copy (unreliable across SPA pages)
- Trimmed permissions footprint (removed `webRequest`, `storage`, `host_permissions`)
