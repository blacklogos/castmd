# Phase 02 — Confluence API client + tree discovery

## Goal

Build `lib/confluence-api.js` — wraps Confluence Cloud v2 REST endpoints needed for tree discovery and content fetch. Pure-function style, no UI.

## Endpoints used

Base: `https://{tenant}.atlassian.net/wiki/api/v2`

- `GET /pages/{id}/children?limit=250&cursor=...` — list direct children. Paginated via `cursor` in `_links.next`.
- `GET /pages/{id}?body-format=export_view` — single page with rendered HTML body.
- (Folders) `GET /folders/{id}/children` — same shape if root is a folder, not a page.

Auth: `fetch(url, { credentials: 'include' })` — browser cookies. Verify with one manual probe before coding.

## Public API (proposed)

```js
window.ConfluenceApi = {
  parseUrl(url),                  // → { tenant, contentType: 'page'|'folder', id, spaceKey } | null
  listChildren(tenant, id, type), // → async generator of child {id, title, type}
  getPageWithBody(tenant, id),    // → { id, title, htmlBody, parentId }
  discoverTree(tenant, rootId, depth, cap)
                                   // → { nodes: [{id, title, parentId, path: [...titles]}], truncated: bool }
}
```

`discoverTree` does BFS, respects depth (0/1/Infinity), stops early at `cap`, returns `truncated: true` if hit.

## Rate-limit handling

- Concurrency cap: **3** in-flight requests.
- On `429`: read `Retry-After`, else exponential backoff (1s → 2s → 4s, max 3 retries).
- On `403`/`404`: do NOT retry. Mark node as skipped, continue.
- On network error: 1 retry then skip.

## URL parsing

Cloud URL shapes seen in the wild:
- `https://X.atlassian.net/wiki/spaces/{SPACE}/pages/{ID}/{slug}`
- `https://X.atlassian.net/wiki/spaces/{SPACE}/folder/{ID}`
- `https://X.atlassian.net/wiki/spaces/{SPACE}/pages/{ID}` (no slug)
- Whiteboards / databases / etc. — **not supported**, `parseUrl` returns `null`.

## Files

- **New**: `lib/confluence-api.js`
- No popup/manifest changes this phase — pure module, manually tested via `popup.html` devtools console.

## Steps

1. Manual probe in browser devtools on a real Confluence page:
   - `await fetch('/wiki/api/v2/pages/{id}/children', {credentials:'include'}).then(r => r.json())`
   - Confirm shape, pagination links, status codes.
2. Implement `parseUrl` — table-driven with regex per pattern.
3. Implement `listChildren` async generator handling cursor pagination.
4. Implement `getPageWithBody` returning `{ id, title, htmlBody: data.body.export_view.value, parentId: data.parentId }`.
5. Implement `discoverTree` (BFS, depth-aware, cap-aware, returns truncated flag).
6. Implement concurrency limiter + 429 backoff as a small `runQueue(tasks, n)` helper.
7. Smoke-test from popup devtools console on a small real subtree (~10 pages).

## Done when

- `parseUrl` correctly identifies page vs folder vs unsupported across 5 sample URLs
- `discoverTree(rootId, Infinity, 10)` on a real space returns ≤10 nodes with parent linkage intact
- `getPageWithBody` returns non-empty HTML for at least one sample page
- 429 backoff demonstrably triggers (force by spamming requests)

## Out of scope

- UI
- ZIP packaging
- Markdown conversion (uses Phase 01's module)
- Attachments / images / macros

## Open questions

- Folder children endpoint exact path — verify in probe step. If `/folders/{id}/children` doesn't exist on v2, may need v1 fallback or treat folder as just-another-content-id on `/pages/{id}/children`. Resolve at probe time.
