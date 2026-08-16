# Edit + save local .md files in the castmd file:// viewer

Turns the read-only `file:///*.md` viewer into an editor that writes back to
disk via the File System Access API. Research/architecture already settled in
[../20260816-1835-edit-save-local-md/plan.md](../20260816-1835-edit-save-local-md/plan.md);
this doc is the phased build order only.

## Goal

Open `file:///…/now.md` → read rendered HTML → click **Edit** → change text →
click **Save** → native picker once per page load → file on disk updated.
Frontmatter (`---` YAML block) renders correctly instead of garbled.

## Constraints (apply to every phase)

- Plain JS, IIFE pattern, two-space indent, single quotes. No frameworks.
- No new dependencies. `package.json` has only `linkedom` (devDep, tests).
- No build step: files load directly into Chrome.
- Save handler must call `showSaveFilePicker()` synchronously inside the click
  handler, in the **MAIN** world. No background.js relay, no
  `chrome.scripting.executeScript`; those lose transient user activation.
- `npm test` (79 cases today) must stay green through every phase.
- Repo has no `codebase-summary.md` / `code-standards.md` /
  `system-architecture.md` / `project-overview-pdr.md`. Ground truth is
  `CLAUDE.md`, `CONTRIBUTING.md` and the source files themselves.

## Phases

| # | Phase | Status | Depends on |
|---|-------|--------|-----------|
| 01 | [Frontmatter handling in the renderer](phase-01-frontmatter-handling.md) | Not started | none |
| 02 | [MAIN-world content script](phase-02-main-world-content-script.md) | Not started | 01 |
| 03 | [Edit/Save toolbar UI](phase-03-edit-save-ui.md) | Not started | 02 |
| 04 | [File System Access save wiring](phase-04-file-system-access-save.md) | Not started | 03 |
| 05 | [Tests, manual QA, docs](phase-05-tests-and-docs.md) | Not started | 04 |

Phases are strictly sequential. 01 is independently shippable (pure bug fix,
fully covered by node:test). 02-04 only pay off together and can only be
verified in real Chrome.

## Files touched (whole plan)

- `lib/markdown-to-html.js`: frontmatter strip (01)
- `tests/markdown-to-html.test.js`: new cases (01, 05)
- `manifest.json`: `"world": "MAIN"` (02)
- `md-viewer.js`: toolbar, edit mode, save handler (03, 04)
- `md-viewer.css`: editor + toolbar styles (03)
- `README.md`, `CLAUDE.md`: docs (05)

Out of scope: version bump and CHANGELOG entry (both belong to the separate
`/release` step, matching how v1.3.1 was done — not staged ahead of time), live
preview while editing (rejected in brainstorm), handle persistence across
reloads, conflict detection against on-disk changes.

## Definition of done

1. `npm test` green, new frontmatter cases included.
2. Real Chrome, unpacked load, "Allow access to file URLs" enabled: a `.md`
   file with YAML frontmatter renders with no stray `<hr>`/garbled paragraph.
3. Edit → Save → pick the same path → overwrite → reopen the file → edits are
   on disk.
4. Second Save in the same page load writes with no picker prompt.
5. README + CLAUDE.md reflect the feature (CHANGELOG entry written at
   `/release` time, not part of this plan).
