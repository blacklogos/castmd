# Phase 02: Move the file:// viewer content script to the MAIN world

## Context Links

- Plan overview: [plan.md](plan.md)
- Architecture finding: [../20260816-1835-edit-save-local-md/plan.md](../20260816-1835-edit-save-local-md/plan.md) ("Architecture (the load-bearing finding)")
- `/Users/trivo/Documents/md-convert/md-convert/manifest.json` (lines 14-22)
- `/Users/trivo/Documents/md-convert/md-convert/md-viewer.js`
- `/Users/trivo/Documents/md-convert/md-convert/lib/markdown-to-html.js`

## Overview

One-line manifest change: add `"world": "MAIN"` to the `file:///*`
`content_scripts` entry. Prerequisite for Phase 04: `showSaveFilePicker` is
not exposed to isolated-world content scripts, and routing the call through
background.js + `chrome.scripting.executeScript` loses transient user
activation (`SecurityError`). Same-world, same-gesture is the only reliable
path.

Expected to be behavior-preserving for today's read-only preview. "Expected" is
doing real work in that sentence: it cannot be proven here, only in Chrome.

## Key Insights

- `md-viewer.js` and `lib/markdown-to-html.js` use **no `chrome.*` API**.
  Verified by reading both files end to end: pure DOM +
  `window.MarkdownToHtml`. So the isolated-world privileges being dropped are
  privileges neither script uses.
- `world` on declarative `content_scripts` is stable in Chrome MV3 (Chrome 111+).
  The extension declares no `minimum_chrome_version`; File System Access
  (Phase 04) is also Chromium-only, so the practical floor is already "recent
  Chrome". Not adding a version key (YAGNI); note only.
- `"css"` injection is not world-scoped. `md-viewer.css` keeps working
  unchanged.
- MAIN world means the script shares globals with the page. On a `file://`
  markdown file the "page" is Chrome's plain-text viewer: no author scripts, no
  collision risk in practice. But `window.MarkdownToHtml` becomes page-visible.
- Errors thrown in MAIN world land in the page console, not the extension's
  errors panel. QA has to look at DevTools on the file tab.
- `run_at: document_end` and `include_globs` semantics are unaffected by `world`.
- Still requires "Allow access to file URLs" on the extension card. Unchanged.

## Requirements

1. `manifest.json` file:// entry gains `"world": "MAIN"`. Nothing else changes.
2. No new permission, no new host permission.
3. Existing read-only rendering is visually identical after the change.
4. Requirement 3 is verified **manually in real Chrome**. Not skippable, not
   automatable in this environment.

## Architecture

```json
{
  "matches": ["file:///*"],
  "include_globs": ["*.md", "*.MD", "*.markdown", "*.mdown", "*.mkd"],
  "js": ["lib/markdown-to-html.js", "md-viewer.js"],
  "css": ["md-viewer.css"],
  "run_at": "document_end",
  "world": "MAIN"
}
```

Load order inside the world is unchanged: lib first, viewer second. The
existing `if (!window.MarkdownToHtml) return;` guard in `md-viewer.js` still
covers a failed lib load.

The other `content_scripts`-adjacent flows (`content.js` injected via
`chrome.scripting.executeScript` from popup/background) are **not** in this
entry and must stay isolated-world because they use `chrome.runtime.onMessage`.
Do not touch them.

## Related Code Files

| Path | Action | Change |
|---|---|---|
| `/Users/trivo/Documents/md-convert/md-convert/manifest.json` | modify | Add `"world": "MAIN"` to the single `file:///*` entry |
| `/Users/trivo/Documents/md-convert/md-convert/md-viewer.js` | modify (comment only) | Header comment: note it runs in MAIN world and why (file picker needs it) |

## Implementation Steps

1. Edit `manifest.json`, add `"world": "MAIN"` after `"run_at"` in the file://
   entry. Keep two-space JSON indent.
2. Validate JSON parses: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')) && console.log('ok')"`.
3. Append two lines to the `md-viewer.js` header comment block explaining the
   MAIN-world declaration (needed by `showSaveFilePicker`; script must therefore
   never reference `chrome.*`).
4. Manual QA in Chrome (see Success Criteria) is required before starting
   Phase 03.

## Todo List

- [ ] `"world": "MAIN"` added
- [ ] `manifest.json` parses
- [ ] `md-viewer.js` header comment updated
- [ ] Manual: reload unpacked extension at `chrome://extensions`
- [ ] Manual: "Allow access to file URLs" still enabled after reload
- [ ] Manual: open a plain `.md` file → renders as before
- [ ] Manual: open a `.md` with frontmatter → Phase 01 fix visible
- [ ] Manual: page DevTools console clean (no errors/warnings from the script)
- [ ] Manual: hidden `<pre class="castmd-raw">` still present in Elements panel
- [ ] Manual: dark mode still applies (toggle OS appearance or DevTools emulate `prefers-color-scheme`)

## Success Criteria

Manual QA, real Chrome, unpacked load:

1. `file:///…/plain.md` renders identical to pre-change (headings, code blocks,
   tables, lists, links, images). Side-by-side against a screenshot taken before
   the change is the cheap way to be sure.
2. `file:///…/with-frontmatter.md` renders with no stray `<hr>` and no
   `title:` paragraph.
3. Zero console errors on the file tab.
4. A non-markdown `file://` (e.g. `.txt`) is still untouched.
5. Non-file pages (any https site) unaffected; popup Copy/Save flows still work
   (they use `content.js`, a different injection path; smoke-test one page).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| MAIN-world script silently not injected on file:// in some Chrome build | Low | Feature dead | Manual QA step 1 catches it immediately; revert is a one-line manifest edit |
| Future edit to `md-viewer.js` adds a `chrome.*` call | Medium (over time) | Runtime TypeError, viewer bails | Header comment states the constraint; CLAUDE.md updated in Phase 05 |
| Page-script global collision (`window.MarkdownToHtml`) | Very low | Renderer replaced by page code | Only applies to file:// markdown pages, which have no scripts |
| Older Chrome without `world` support ignores the key | Low | Falls back to isolated world → picker throws in Phase 04 | Phase 04 feature-detects `window.showSaveFilePicker` and disables Save with a tooltip |

## Security Considerations

- MAIN world **drops** privilege rather than adding it: the script loses access
  to extension APIs and shares the page's origin. For a `file://` page that
  origin is opaque-ish per-file and already the trust boundary the viewer
  assumed.
- The renderer's hardening (escape all raw HTML, neutralize `javascript:`/
  `data:` URLs) is unchanged and still the only thing standing between a hostile
  `.md` and script execution. Do not relax it because the world changed.
- No new permission is requested. Write access in Phase 04 rides on an explicit
  per-file File System Access grant, not on the manifest.
- Reminder: `file://` pages can read other local files via relative links; that
  was already true before this change.

## Next Steps

Phase 03: add the Edit/Save toolbar and textarea to `md-viewer.js`, still
without any disk write.
