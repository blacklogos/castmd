# Phase 05: Tests, manual QA, documentation

## Context Links

- Plan overview: [plan.md](plan.md)
- Phases 01-04: [01](phase-01-frontmatter-handling.md) · [02](phase-02-main-world-content-script.md) · [03](phase-03-edit-save-ui.md) · [04](phase-04-file-system-access-save.md)
- `/Users/trivo/Documents/md-convert/md-convert/CHANGELOG.md`
- `/Users/trivo/Documents/md-convert/md-convert/README.md` (line 19 documents the viewer)
- `/Users/trivo/Documents/md-convert/md-convert/CLAUDE.md` (line 50, "Local .md viewer" design decision)
- `/Users/trivo/Documents/md-convert/md-convert/CONTRIBUTING.md` (manual-verification expectations)

## Overview

Close out: green automated suite, a manual QA pass that actually exercises the
browser-only paths, and docs that match reality. No version bump: that belongs
to the separate `/release` workflow.

## Key Insights

- Automated coverage only reaches `lib/`. Everything added in Phases 02-04 is
  browser-coupled (manifest world, DOM toolbar, native picker) and cannot be
  unit-tested here. CONTRIBUTING already sets that expectation; the QA checklist
  is the real gate.
- README line 19 already documents the viewer ("**Local .md viewer** — Open a
  `file:///…/*.md` file and it renders as formatted HTML…"). Extend that bullet
  rather than adding a new one (checked: no other "file viewer" mention in
  README; `CLAUDE.md` line 50 and `CHANGELOG.md` v1.3.0 are the other two).
- CHANGELOG entry is deliberately NOT written in this phase. v1.3.1 was
  released with the entry written fresh during `/release`, not staged ahead of
  time as an `## Unreleased` section — this plan keeps that same workflow.
  The bullet points a future `/release` run needs are captured in this phase's
  Next Steps instead, so nothing gets lost, but `CHANGELOG.md` itself is
  untouched here.
- CLAUDE.md's "Local .md viewer" bullet must gain the MAIN-world constraint:
  it is the thing a future contributor will break first (adding a `chrome.*`
  call to `md-viewer.js` silently kills the viewer).
- Repo has no `codebase-summary.md` / `code-standards.md` /
  `system-architecture.md` / `project-overview-pdr.md`; nothing to sync there.

## Requirements

1. `npm test` green: 85 cases (79 existing + 6 frontmatter).
2. Manual QA checklist executed in real Chrome, results recorded.
3. `README.md` viewer bullet extended with edit/save + the one-picker-per-page
   caveat + last-write-wins caveat.
4. `CLAUDE.md` viewer design-decision bullet updated (MAIN world + why, edit/save
   flow, no-persistence choice).
5. No version bump anywhere (`manifest.json`, `package.json`, `index.html`,
   `content.js` `CONTENT_VERSION` all untouched). `CHANGELOG.md` also untouched
   here — entry gets written when `/release` actually runs.

## Architecture

Docs only — README and CLAUDE.md, in this phase. The CHANGELOG entry itself is
NOT written here (see Next Steps for the drafted text to reuse at `/release`
time).

README bullet (replace line 19):

```markdown
- **Local .md viewer + editor** — Open a `file:///…/*.md` file and it renders as
  formatted HTML; click Edit to modify it and Save to write back to disk
  (requires "Allow access to file URLs" on the extension card in
  `chrome://extensions`). Chrome asks where to save once per page load; the file
  is overwritten as-is, so close it in other editors first
```

## Related Code Files

| Path | Action | Change |
|---|---|---|
| `/Users/trivo/Documents/md-convert/md-convert/tests/markdown-to-html.test.js` | verify | 6 Phase 01 cases present, suite 85 |
| `/Users/trivo/Documents/md-convert/md-convert/README.md` | modify | Replace the viewer bullet (line 19) |
| `/Users/trivo/Documents/md-convert/md-convert/CLAUDE.md` | modify | Update the "Local .md viewer" design-decision bullet (line 50) |

Not touched: `manifest.json` version, `package.json` version, `index.html`,
`CONTRIBUTING.md`, `CHANGELOG.md` (entry written at `/release` time, see Next
Steps for the drafted text).

## Implementation Steps

1. Run `npm test`. Expect `pass 85 / fail 0`. Fix before continuing if not.
2. Prepare QA fixtures **outside the repo** (e.g. in a scratch dir, never
   committed):
   - `plain.md`: headings, code fence, nested list, table, blockquote, link,
     image, hr.
   - `frontmatter.md`: `---\ntitle: Now\nupdated: 2026-08-16\n---` then content.
   - `midrule.md`: content with a `---` hr in the middle.
   - `long.md`: 2000+ lines.
3. `chrome://extensions` → reload the unpacked extension → confirm "Allow access
   to file URLs" is still on.
4. Work the QA checklist below, noting anything that fails.
5. Update the README bullet.
6. Update the CLAUDE.md viewer bullet.
7. Re-read the diff end to end: no version strings changed, no stray fixture
   files added to the repo, `CHANGELOG.md` untouched.

## Todo List

Automated:
- [ ] `npm test` → 85 pass / 0 fail

Manual QA (real Chrome, unpacked, file URL access on):
- [ ] `plain.md` renders as before the change (compare against v1.3.1 behavior)
- [ ] `frontmatter.md` renders with no stray `<hr>`, no `title:` paragraph
- [ ] `midrule.md` still shows the mid-document `<hr>`
- [ ] Toolbar visible, sticky on scroll, hidden in print preview
- [ ] Edit → textarea shows raw source including the `---` block
- [ ] Type an edit → Preview → render reflects it
- [ ] Save (first) → picker opens with the right suggested filename
- [ ] Choose the original path → confirm replace → status `Saved`
- [ ] Verify on disk (`cat` the file): edit present, frontmatter intact
- [ ] Reopen the file in a new tab → edit persisted, renders correctly
- [ ] Edit again → Save (second) → no picker, status `Saved`
- [ ] Cancel the picker on a fresh page load → no error, Save still works after
- [ ] Reload the page → next Save prompts again (expected, not a bug)
- [ ] Shorten the document by half → Save → no leftover tail on disk
- [ ] `long.md` → edit/preview/save without lag or layout break
- [ ] Dark mode: toolbar, buttons, textarea all readable
- [ ] Non-markdown `file://` (`.txt`) untouched
- [ ] Regular https page: popup Copy as Markdown / Save as .md still work
- [ ] No errors in the file tab console, popup console, or service worker console

Docs:
- [ ] README viewer bullet updated
- [ ] CLAUDE.md viewer bullet updated (MAIN world + edit/save + limits)
- [ ] No version numbers changed anywhere, `CHANGELOG.md` untouched

## Success Criteria

- `npm test`: 85/85.
- Every manual checklist item passes, or a failure is written down with the
  exact repro before the plan is called done.
- `git diff --stat` shows only: `lib/markdown-to-html.js`,
  `tests/markdown-to-html.test.js`, `manifest.json`, `md-viewer.js`,
  `md-viewer.css`, `README.md`, `CLAUDE.md`. `CHANGELOG.md` is NOT in the diff.
- No fixture `.md` files inside the repo, no `.zip` rebuilt, no version bump.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Manual QA skipped because "tests pass" | Medium | Ships a dead feature; nothing in the suite touches Phases 02-04 | Checklist is a hard gate; CONTRIBUTING already requires browser verification |
| Docs overstate the UX ("saves silently") | Medium | User confusion, bad issue reports | README/CHANGELOG wording above states the picker-once and last-write-wins behavior plainly |
| Fixture files accidentally committed | Low | Repo noise | Fixtures live outside the repo; stage exact files only, never `git add .` |
| Someone bumps the version here | Low | Breaks the `/release` workflow's assumptions | Explicit out-of-scope note in every phase |

## Security Considerations

- Docs must state the write behavior accurately: one user-chosen file per page
  load, no background writes, no persistence of the grant. Understating it is a
  trust problem, not just a docs problem.
- CLAUDE.md must carry the "no `chrome.*` in `md-viewer.js`" rule. A future
  contributor adding one would break the viewer and might reach for a
  background relay, which reintroduces the user-activation failure.
- Re-confirm during QA that the renderer still escapes raw HTML after the
  re-render-on-toggle path was added (type `<script>alert(1)</script>` into the
  editor, toggle to Preview, expect escaped text and no dialog).

## Next Steps

- Hand off to `/release` for the version bump + tag + zip + GitHub release +
  the CHANGELOG entry (not written in this phase — drafted here for reuse):

  ```markdown
  ### New features
  - Edit and save local `.md` files from the file:// viewer: an Edit button
    swaps the rendered page for a plain textarea, Save writes back to disk via
    the File System Access API
    - First Save per page load opens the native file picker (Chromium requires
      a user-chosen destination); later Saves in the same page load write
      silently
    - The picker cannot be pre-pointed at the file's own folder, so the first
      save is effectively "Save As" onto the original path
    - No conflict detection: if the file changed on disk since it was opened,
      the save overwrites it (last write wins)
    - Handle is not persisted across reloads — the picker reappears once per
      page load

  ### Bug fixes
  - Local .md viewer garbled YAML frontmatter: a leading `---` block rendered
    as a stray `<hr>` plus the metadata fields as a paragraph, above the real
    content. A leading frontmatter block is now stripped before rendering (a
    `---` anywhere else is still a horizontal rule); the editor still sees the
    raw source, so frontmatter survives a save

  ### Architecture
  - `file:///*` content script now declared with `"world": "MAIN"`.
    `showSaveFilePicker` is not exposed to isolated-world content scripts, and
    relaying the call through the service worker loses the transient user
    activation the picker requires. `md-viewer.js` and `lib/markdown-to-html.js`
    use no `chrome.*` API, so the move costs nothing — but they must stay that
    way

  ### Tests
  - 6 new node:test cases for frontmatter handling in
    `lib/markdown-to-html.js` (present, absent, unterminated, mid-document
    `---`, empty block, CRLF). Suite now 85 cases
  ```

- Deferred backlog (not bugs, do not build preemptively): IndexedDB handle
  persistence across reloads, `Cmd/Ctrl+S` shortcut, `beforeunload` guard for
  unsaved edits, on-disk conflict detection, optional frontmatter display block
  instead of a plain strip.
- Explicitly dropped during brainstorm/planning, not deferred: opening the file
  in an external editor (Sublime Text, notes app) or revealing it in Finder —
  both require a native-messaging-host installer, a different mechanism and
  install story from everything else here. Skipped for now; revisit as its own
  scoped feature if it comes up again.
