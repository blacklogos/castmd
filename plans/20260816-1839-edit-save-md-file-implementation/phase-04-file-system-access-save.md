# Phase 04: Wire Save to the File System Access API

## Context Links

- Plan overview: [plan.md](plan.md)
- Architecture finding (why MAIN world, why no relay): [../20260816-1835-edit-save-local-md/plan.md](../20260816-1835-edit-save-local-md/plan.md)
- Phase 02 (MAIN world): [phase-02-main-world-content-script.md](phase-02-main-world-content-script.md)
- Phase 03 (Save button stub): [phase-03-edit-save-ui.md](phase-03-edit-save-ui.md)
- `/Users/trivo/Documents/md-convert/md-convert/md-viewer.js`

## Overview

Replace the Save stub with a real disk write:
`showSaveFilePicker({ suggestedName })` → `handle.createWritable()` →
`write(editor.value)` → `close()`. Keep the returned `FileSystemFileHandle` in
a module-scope variable; subsequent Save clicks in the same page load reuse it
and skip the picker entirely.

## Key Insights

- File System Access is the **only** write path available. Extensions cannot
  write to arbitrary local files any other way. `chrome.downloads` would create
  a copy in the downloads folder, not update the open file.
- `showSaveFilePicker` requires **transient user activation**. It must be called
  as a direct, synchronous continuation of the click handler. Any `await`
  before it (message round-trip, `chrome.storage` read, `handle.queryPermission`
  on a cold path) can consume/expire the activation → `SecurityError`. So: the
  picker call is the **first** `await` in the handler, always.
- No background.js, no `chrome.runtime.sendMessage`, no
  `chrome.scripting.executeScript`. Phase 02 exists precisely to avoid them.
- `createWritable()` truncates by default (`keepExistingData: false`), so a
  shorter new document does not leave a stale tail. Do not pass
  `keepExistingData: true`.
- The handle keeps readwrite permission for the lifetime of the document once
  granted through the picker. Reusing it needs no re-prompt and no
  `requestPermission()` call on the happy path.
- Handle is **not** persisted across reloads (IndexedDB could, later). Re-pick
  once per page load. This matches the confirmed UX decision; it is not a bug.
- The picker cannot be pre-pointed at the file's own directory: `startIn`
  accepts a handle or a well-known directory name, and the viewer has no handle
  for the file it is displaying (Chrome does not hand content scripts one for
  the current `file://` document). So the **first** save is effectively "Save
  As": the user navigates to the file, selects it, and confirms Chrome's
  "replace existing file?" prompt. Real friction; document it, don't fight it.
- User cancelling the picker throws `AbortError`. That is not an error state:
  clear status, no red text.
- No new manifest permission. File-URL access is already a prerequisite for the
  viewer to run; File System Access consent is its own per-file gate.

## Requirements

Functional:
1. First Save click → native save picker, `suggestedName` = decoded filename
   from `location.pathname`.
2. On picker resolve → write the textarea's current value → close writable →
   status `Saved`.
3. Subsequent Save clicks in the same page load → no picker, write straight
   through the stored handle.
4. Picker cancelled → no error, no state change, handle stays unset.
5. Write failure (quota, permission revoked, disk error) → status shows the
   error, handle cleared so the next click re-prompts.
6. `showSaveFilePicker` missing (non-Chromium / old build) → Save button
   disabled with an explanatory `title`, no exception.

Non-functional:
- Plain JS, IIFE, no deps, no `chrome.*`.
- Save handler stays a direct button listener; picker call is the first `await`.

## Architecture

Module-scope state, added near the top of the editor section:

```js
// Kept for the lifetime of this page load only. Re-picking after a reload is
// intentional (no IndexedDB persistence; see plan, deliberately deferred).
let fileHandle = null;
```

Filename:

```js
// `fileName` already exists above for document.title; reuse it, do not
// recompute. decodeURIComponent(location.pathname.split('/').pop())
```

Handler (replaces the Phase 03 stub body):

```js
saveBtn.addEventListener('click', async () => {
  const text = editor.value;
  try {
    // FIRST await must be the picker. Anything awaited before it can burn the
    // transient user activation and make showSaveFilePicker throw SecurityError.
    if (!fileHandle) {
      fileHandle = await window.showSaveFilePicker({ suggestedName: fileName });
    }
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
    rawPre.textContent = text;      // keep the hidden "view source" copy honest
    setStatus('Saved');
  } catch (e) {
    if (e && e.name === 'AbortError') { setStatus(''); return; }  // user cancelled
    fileHandle = null;              // force a fresh picker next click
    setStatus(`Save failed: ${e.message}`);
  }
});
```

Feature detection, right after the buttons are built:

```js
if (!window.showSaveFilePicker) {
  saveBtn.disabled = true;
  saveBtn.title = 'Saving needs a Chromium browser with the File System Access API';
}
```

Optional, not required: pass
`types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'] } }]`
to the picker so the extension is preserved when the user retypes a name. Adds
6 lines. Skip unless QA shows extension-mangling.

## Related Code Files

| Path | Action | Change |
|---|---|---|
| `/Users/trivo/Documents/md-convert/md-convert/md-viewer.js` | modify | `fileHandle` module var, real save handler, feature detection |

No manifest change. No CSS change (Phase 03 covers `:disabled` inheriting the
default look; add a `.castmd-btn:disabled { opacity: .5; cursor: default; }`
rule only if it looks wrong).

## Implementation Steps

1. Add `let fileHandle = null;` with the comment above, inside the IIFE,
   above the toolbar construction.
2. Confirm `fileName` from the existing `document.title` logic is in scope; do
   not recompute it (DRY).
3. Replace the Phase 03 stub listener body with the handler above. Keep it an
   `async` arrow registered via `addEventListener('click', …)` on `saveBtn`.
4. Add the `showSaveFilePicker` feature-detect guard.
5. Reload the extension, run the manual save loop (see Success Criteria).
6. Re-run `npm test` (nothing lib-side changed; confirms nothing was broken by
   accident).

## Todo List

- [ ] `fileHandle` module var added with rationale comment
- [ ] Save handler implemented, picker is the first `await`
- [ ] `AbortError` handled silently
- [ ] Failure path clears `fileHandle` and shows the message
- [ ] `rawPre.textContent` updated after a successful write
- [ ] Feature detection disables Save where unsupported
- [ ] Manual: first Save → picker appears, choosing the same path overwrites
- [ ] Manual: reopen file in a new tab → edits present
- [ ] Manual: second Save in the same page load → no picker, status `Saved`
- [ ] Manual: cancel the picker → no error, Save still works afterwards
- [ ] Manual: save a frontmatter file → `---` block intact on disk
- [ ] Manual: save a shorter document → no leftover trailing content
- [ ] Manual: page reload → next Save prompts again (expected)
- [ ] `npm test` still green

## Success Criteria

1. Edit → Save → pick the same file → confirm replace → close tab → reopen
   `file:///…` → the edit is on disk (also verify with `cat` in a terminal).
2. Second Save writes with no dialog.
3. A file with YAML frontmatter round-trips byte-for-byte apart from the
   intended edit (frontmatter preserved: the textarea holds raw source).
4. Saving a document shortened by half leaves no tail from the old content.
5. Cancelling the picker leaves the page usable and unmodified.
6. No console errors on any of the above.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| External change to the file between load and save is overwritten (no conflict detection, last write wins) | Medium (VS Code open on the same file) | Data loss | **Explicitly accepted for v1.** Do not build detection. Document in CHANGELOG/README so the user knows |
| `SecurityError` from lost user activation | Low, if the handler is written as specified | Feature broken | Picker is the first `await`; no relay; MAIN world (Phase 02). If it appears, the handler was refactored; revert to the shape above |
| First save is a "Save As" and the user picks a wrong path, creating a duplicate | Medium | Confusing, no data loss | `suggestedName` pre-fills the filename; document the behavior in README |
| Handle silently loses permission mid-session | Low | Save fails once | Catch clears `fileHandle`, next click re-prompts |
| Partial write if `close()` throws | Very low | Corrupt file | `createWritable()` writes to a swap file and commits on `close()`, so a failed close leaves the original intact |
| Non-Chromium browser | Low (Chrome extension) | No save | Feature detection disables the button |

## Security Considerations

- Write scope is exactly one file, chosen by the user in a native OS dialog per
  page load. The extension cannot widen it and requests no new permission.
- The handle lives in a JS closure only. Never write it to
  `chrome.storage`/`localStorage`/IndexedDB in this phase. No persistence means
  no stale grant to leak.
- Content written is `editor.value` verbatim: no rendering, no escaping, no
  transformation. The file gets exactly what the user typed.
- Do not add a "save to a path from the document contents" shortcut of any kind;
  arbitrary-path writes driven by file content would be a real vulnerability.
- Error strings come from DOM exceptions and go into `textContent`, not
  `innerHTML`. Keep it that way.

## Next Steps

Phase 05: full test run, manual QA checklist, CHANGELOG/README/CLAUDE.md
updates. Deliberately deferred beyond this plan: IndexedDB handle persistence
across reloads (YAGNI until the one-picker-per-load friction actually annoys),
`Cmd/Ctrl+S` shortcut, `beforeunload` unsaved-changes guard, conflict detection.
