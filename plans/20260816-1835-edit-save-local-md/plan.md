# Edit + save local .md files from the file:// viewer

Brainstorm only, not implemented. Triggered by: opening `now.md` (Astro
content file) via castmd's existing read-only file:// viewer, wanting to
edit and save in place instead of switching to an editor.

## Problem

`md-viewer.js` renders file:///*.md as read-only HTML (Chrome's own
plain-text `<pre>` view swapped for formatted output). No write-back.

## Decisions (confirmed with user)

- Save UX: one-time native file picker, then persists for the tab's
  session (no re-prompt on subsequent saves in same tab/reload-free
  session). Fully silent save is not a thing Chromium allows — no
  extension can force-skip the first-save picker.
- Editor: plain `<textarea>` toggle, reusing the exact Preview & Edit
  pattern already in `popup.html`/`popup.js` (not split-pane live
  preview, not WYSIWYG contenteditable).

## Prerequisite bug (found during research, not yet fixed)

`lib/markdown-to-html.js` has zero frontmatter handling. Rendering
`now.md` (which has a `---\ntitle: ...\n---` YAML block, standard for
Astro content) today produces a stray `<hr>` + the frontmatter fields
as a garbled paragraph, ahead of the real content. Confirmed by
actually running the converter against the file. This should be fixed
before or alongside edit+save — otherwise "preview" is already wrong
on the exact file that prompted this idea, and "edit" would be editing
a doc whose preview lied about its own content.

## Architecture (the load-bearing finding)

Writing back to disk requires the File System Access API
(`showSaveFilePicker` → `handle.createWritable()`) — no other write
path exists for extensions. Two platform constraints shape the design:

1. `showSaveFilePicker` is **not exposed to isolated-world content
   scripts** (Chrome's default world). It works fine on `file://`
   pages themselves (file: is a secure context) — the gate is
   isolated vs. main world, not the protocol.
2. Passing the save action through a message relay (isolated world →
   background.js → `chrome.scripting.executeScript` into MAIN world)
   risks losing "transient user activation" across the async hops,
   which throws `SecurityError` on the picker call. Documented,
   long-standing Chromium behavior, not a one-off bug.

Resolution: `md-viewer.js` uses **no `chrome.*` APIs today** (checked —
pure DOM + `window.MarkdownToHtml`). So instead of a relay, just
declare its content_scripts entry as `"world": "MAIN"` in
`manifest.json`. The Save button's click handler then calls
`showSaveFilePicker()` directly, same world, same synchronous gesture
chain — no relay, no background.js involvement, no lost activation.

## Other risks flagged, not solved for v1 (YAGNI)

- No conflict detection if the file changes on disk between load and
  save (e.g. edited in VS Code at the same time). Last write wins.
  Acceptable for v1; note it, don't build for it.
- Handle isn't persisted across page reloads (IndexedDB could do this
  later) — re-picking on every fresh load of the same file is fine per
  the "one-time per session" decision above.
- No new manifest permission needed — write access rides on the
  file-URL access the user already opted into for the viewer to run at
  all; File System Access consent is its own per-file gate.

## Next steps

1. Fix frontmatter handling in `lib/markdown-to-html.js` (strip or
   render collapsed, don't garble).
2. Add `"world": "MAIN"` to the file:// content_scripts entry.
3. Add Edit/Save UI to `md-viewer.js`, reusing `.preview-textarea`
   styling from `popup.html`.
4. Wire `showSaveFilePicker({ suggestedName: fileName })` →
   `createWritable()` → write, keep handle in module-scope JS var for
   the session.

Run `/plan` when ready to turn this into phased implementation.
