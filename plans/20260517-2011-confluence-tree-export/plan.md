# Confluence Tree Export

Add ability to download a Confluence Cloud page + its descendants as a ZIP of Markdown files mirroring the page hierarchy.

## Scope (locked)

- **Source**: Confluence Cloud only (`*.atlassian.net`). No Server/DC.
- **Depth**: user picks — `This page only` / `+ children (1 level)` / `+ all descendants`.
- **Cap**: hard cap **100 pages**. Over cap → blocking confirm dialog ("This will export N pages, continue?"). No silent truncation.
- **Preview gate**: always show count + est. size before fetching content.
- **Output**: single ZIP, folder structure mirrored, named after root page/folder title.
- **Auth**: browser session cookies via `fetch(..., {credentials: 'include'})`. No PAT.
- **Macros / attachments**: out of scope. `export_view` placeholder HTML is fine. Images keep absolute atlassian.net URLs.
- **Runtime**: in popup. Show "keep this open" warning. Service worker NOT used for the job (MV3 idle risk).

## UI changes

New section in `popup.html`, only visible when active tab is a Confluence Cloud page/folder:

```
─── Confluence tree export ────────────────
  Depth: ( ) This page  (•) + Children  ( ) + All descendants
  [ Preview ]
  → "47 pages, ~2.1 MB"   [ Download ZIP ]
  ▓▓▓▓▓▓▓▓░░░░ 18/47
```

Existing single-page "Download MD" button untouched.

## Architecture

```
popup.js
  └─ confluence-export.js      orchestrates: detect → discover → preview → fetch → zip → download
        ├─ confluence-api.js   fetch wrappers (children, page-with-body), pagination, 429 backoff
        ├─ html-to-markdown.js extracted pure HTML→MD (shared w/ existing single-page flow)
        └─ vendor/jszip.min.js vendored, MV3 CSP-safe
```

`content.js` keeps its current copy for now — refactor risk not worth it for v1.

## Phases

1. [Phase 01 — Extract HTML→MD module](phase-01-extract-conversion-module.md)
2. [Phase 02 — Confluence API client + tree discovery](phase-02-api-client.md)
3. [Phase 03 — Vendor JSZip + ZIP builder](phase-03-zip-builder.md)
4. [Phase 04 — Popup UI + orchestration](phase-04-popup-ui.md)
5. [Phase 05 — Manual test pass + docs](phase-05-test-and-docs.md)

## Risks

- MV3 popup close kills job → warning + cap mitigates
- Atlassian 429 rate-limit → concurrency 3, exp backoff
- Filename collisions in same folder → `-{pageId}` suffix
- Permissions (403/404) → skip + `_skipped.txt` in ZIP root
- Macro-heavy pages → ugly MD, accept

## Success criteria

- Export 50-page subtree end-to-end without errors
- ZIP opens, folder tree matches Confluence sidebar
- Over-cap confirm dialog actually blocks
- Existing single-page convert + outline features still work
- No new permissions added to manifest

## Open questions

None. Ready to implement.
