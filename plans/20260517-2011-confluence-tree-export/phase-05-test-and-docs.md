# Phase 05 — Manual test pass + docs

## Goal

Verify end-to-end on real Confluence content, update project docs, prep for release.

## Test matrix

Pick a Confluence Cloud space user has access to (any atlassian.net tenant).

| # | Scenario | Expected |
|---|---|---|
| 1 | Single page (depth 0) | 1 .md file in ZIP, root title |
| 2 | Page with 5 children (depth 1) | 6 .md, tree mirrored |
| 3 | Deep subtree, 30 pages (depth all) | 30 .md, full hierarchy |
| 4 | Over-cap subtree (depth all, real space) | Confirm dialog shows correct count, cancel aborts |
| 5 | Over-cap, accept | Exports exactly 100, no error |
| 6 | Page with macros (Jira issue, panel) | Exports — ugly but valid MD |
| 7 | Subtree with one 403 page | Skipped, listed in `_skipped.txt` |
| 8 | Folder root (not page) | Uses folder title for ZIP name |
| 9 | Non-Confluence tab | Section hidden |
| 10 | Confluence whiteboard URL | Section hidden (unsupported) |
| 11 | Logged out (no session cookie) | Helpful error message |
| 12 | Filename collision (2 children same title) | `-{id}` suffix added |
| 13 | Existing single-page convert | Still works |
| 14 | Existing outline.html flow | Still works |

## Docs updates

- **CLAUDE.md**: add a one-line bullet under Architecture for the new flow. Update the "Known Duplicated Code" section if Phase 01 changed anything (it doesn't — content.js untouched).
- **README** (if present): add bullet under features.
- **CHANGELOG**: new entry (per global rules — user-visible behavior change).
- **plans/.../reports/v1-ship-report.md**: short release-readiness note.

## Performance sanity check

- 50-page subtree: should complete in < 60s on decent connection. If much slower, recheck concurrency = 3 and backoff.
- Memory: 100 pages × ~50KB HTML × in-memory ZIP = ~5MB. Fine.

## Release prep

- Bump `manifest.json` version (minor — new feature, non-breaking).
- No new permissions added — re-verify manifest unchanged on that front.
- Reload extension on Chrome, click through once more.

## Done when

- All 14 test scenarios pass
- CHANGELOG + CLAUDE.md updated
- Manifest version bumped
- Ship report written in `reports/v1-ship-report.md`

## Out of scope

- Automated tests (project has none — not the time to start)
- Webstore publishing (separate workflow)

## Open questions

- Should we add a 2-min telemetry / log of usage? **No** — extension has no telemetry today, don't introduce.
