# Phase 04 — Popup UI + orchestration

## Goal

Wire everything together. New "Confluence tree export" section in popup. Detection → depth selector → preview → cap confirm → fetch with progress → ZIP → download.

## Files

- **Edit**: `popup.html` — new section, hidden by default
- **Edit**: `popup.js` — section show/hide based on URL, button handlers, progress UI
- **New**: `lib/confluence-export.js` — orchestrator (uses ConfluenceApi + HtmlToMarkdown + ZipBuilder)

## UI (popup section)

```html
<section id="confluence-section" hidden>
  <h3>Confluence tree export</h3>
  <fieldset>
    <label><input type="radio" name="depth" value="0"> This page only</label>
    <label><input type="radio" name="depth" value="1" checked> + Children (1 level)</label>
    <label><input type="radio" name="depth" value="all"> + All descendants</label>
  </fieldset>
  <button id="confluence-preview">Preview</button>
  <div id="confluence-preview-result" hidden>
    <span id="confluence-page-count"></span>
    <button id="confluence-download">Download ZIP</button>
  </div>
  <div id="confluence-progress" hidden>
    <progress max="100" value="0"></progress>
    <span id="confluence-progress-text"></span>
    <p class="warn">Keep this popup open until export finishes.</p>
  </div>
</section>
```

## Flow

1. `popup.js` on load → `ConfluenceApi.parseUrl(activeTab.url)`. If non-null, unhide section.
2. **Preview button** → `discoverTree(rootId, depth, cap=100)`:
   - If `truncated` → **blocking** `confirm("This subtree exceeds 100 pages. Only the first 100 will be exported. Continue?")`. Cancel = abort.
   - Show count: `"47 pages found"`. Estimate size: skip (no cheap way without fetching bodies; just show count).
3. **Download button**:
   - For each node, queue `getPageWithBody`, convert to MD, push entry. Update progress N/total after each.
   - Build ZIP. Trigger `chrome.downloads.download`.
   - Filename: `{rootTitle}.zip` (sanitized).
   - If any skipped (403/404) → add `_skipped.txt` listing them.
4. Show "Done. Saved to Downloads." → reset state.

## Filename rules

- Path: `{sanitizedTitle}-{shortId}.md` to dodge collisions. (Shorter than full ID — last 6 chars.)
- Actually: prefer just `{sanitizedTitle}.md` and only add `-{id}` if a collision is detected within the same parent. Cleaner output, minor effort.
- Folder structure: replicate tree as Confluence sidebar shows it.

## Error handling

- API auth fails (cookies absent / wrong tenant) → show error: "Not signed in to Confluence — open the page in a tab and try again."
- Any thrown error → catch in orchestrator, display in section, log to console.
- Cancel button during download? **Skip for v1** — user can close popup to abort.

## Steps

1. Build static HTML + CSS for section. Hide by default.
2. URL detection on popup open. Show/hide.
3. Preview button → discover + display count + cap confirm.
4. Download button → orchestrator (fetch loop with progress callback → convert → zip → download).
5. Manual test against a real Confluence space — small tree (~5 pages), medium (~30), over-cap (~150 with cancel + confirm flows).

## Done when

- Visiting a Confluence page surfaces the new section
- Visiting any other site → section stays hidden
- Preview shows accurate count
- Over-cap dialog blocks correctly
- Download produces a valid ZIP with correct hierarchy
- Skipped pages listed in `_skipped.txt`
- Existing single-page convert / outline / download still work

## Out of scope

- Cancel-in-progress button
- Resume interrupted exports
- Saving last-used depth preference

## Open questions

- Should preview also surface tree shape (collapsible list)? **No** — adds UI complexity, count is enough for v1.
