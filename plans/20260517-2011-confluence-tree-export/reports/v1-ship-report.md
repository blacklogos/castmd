# Ship report — Confluence tree export v1

Date: 2026-05-17
Branch: `feat/confluence-tree-export`

## What shipped

Feature: bulk-export a Confluence Cloud page tree as a ZIP of Markdown files.

| Phase | Status | Files touched |
|-------|--------|---------------|
| 01 — Extract HTML→MD module | ✅ | `lib/html-to-markdown.js` (new), `popup.html` (script tag) |
| 02 — Confluence API client | ✅ | `lib/confluence-api.js` (new) |
| 03 — Vendor JSZip + builder | ✅ | `vendor/jszip.min.js`, `vendor/LICENSE-jszip.md`, `lib/zip-builder.js`, `popup.html` |
| 04 — Popup UI + orchestrator | ✅ | `lib/confluence-export.js` (new), `popup.html` (section + CSS), `popup.js` (handlers + detection) |
| 05 — Docs + version bump | ✅ | `CHANGELOG.md`, `CLAUDE.md`, `manifest.json` (1.1.0 → 1.2.0) |

## Sanity checks done

- `node --check` on all 6 JS files — pass
- `manifest.json` JSON-valid
- No manifest permission additions (uses existing `optional_host_permissions`)
- `content.js` untouched (no regression risk to single-page flow)
- Script load order in `popup.html` correct (JSZip before zip-builder, all libs before popup.js)

## What's NOT done (deferred)

- Manual browser testing on a real Confluence Cloud tenant (no access in this session)
- Verification of folder endpoints (`/wiki/api/v2/folders/{id}`, `/wiki/api/v2/folders/{id}/children`) — written speculatively, may need adjustment if tenant doesn't expose them
- Verification of `parentId` field presence in v2 children response — assumed based on documentation

## Manual test checklist (next session, real tenant)

| # | Scenario | Expected |
|---|---|---|
| 1 | Non-Confluence tab | Section hidden |
| 2 | Confluence whiteboard URL | Section hidden |
| 3 | Page with no children, depth 0 | ZIP w/ 1 `.md` |
| 4 | Page + 5 children, depth 1 | ZIP w/ 6 `.md`, tree mirrored |
| 5 | Deep subtree, depth all | Full hierarchy in ZIP |
| 6 | Over-cap subtree | Confirm dialog blocks, accept exports 100 |
| 7 | One 403 page in subtree | Listed in `_skipped.txt` |
| 8 | Folder root | ZIP filename uses folder title |
| 9 | Logged out | Helpful 401/403 error |
| 10 | Permission denied at prompt | Error in status row |
| 11 | Existing single-page convert | Still works |
| 12 | Existing copy-all-tabs | Still works |

## Risks if rolled out before manual test

- **Folder endpoints might not exist on v2** — would surface as "HTTP 404 for /wiki/api/v2/folders/{id}". Fix: fall back to page endpoint or treat folder children via same `/pages/{id}/children` shape. Easy patch.
- **`parentId` field shape** — if it's nested or named differently in v2 responses, tree linkage breaks. Same easy patch.
- **Cookie auth failure** — if Atlassian requires `X-Atlassian-Token: no-check` or similar for v2 API from non-browser origins, fetches fail. Mitigation: add header.

## Unresolved questions

- None blocking. All deferred items are verifiable in 5 min on a real tenant.
