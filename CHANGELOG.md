## v1.2.0 — 2026-05-17

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
