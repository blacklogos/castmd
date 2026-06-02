// Confluence Cloud REST v2 wrapper used by the tree-export flow.
// Uses fetch with credentials:'include' so logged-in browser cookies authenticate
// against {tenant}.atlassian.net. Requires host permission for the tenant origin
// (caller must request via chrome.permissions before invoking).
//
// Endpoints used:
//   GET /wiki/api/v2/pages/{id}                              ?body-format=export_view
//   GET /wiki/api/v2/pages/{id}/children                     ?limit=250&cursor=...
//   GET /wiki/api/v2/folders/{id}
//   GET /wiki/api/v2/folders/{id}/children
//
// Folder endpoints are best-effort; if a tenant doesn't expose them the caller
// receives a clear error and can downgrade to page-only export.

(function (global) {
  'use strict';

  const PAGE_LIMIT = 250;     // v2 max for children endpoint
  const MAX_RETRIES = 3;
  const BASE_BACKOFF_MS = 1000;

  // ── URL parsing ───────────────────────────────────────────────────────────

  // Returns { origin, tenant, contentType, id } or null when the URL is not a
  // recognised Confluence Cloud page/folder. Whiteboards/databases return null.
  function parseUrl(url) {
    if (!url) return null;
    let u;
    try { u = new URL(url); } catch { return null; }
    if (!/\.atlassian\.net$/i.test(u.hostname)) return null;
    if (!u.pathname.startsWith('/wiki/')) return null;

    const tenant = u.hostname.split('.')[0];
    const origin = u.origin;

    const pageMatch = u.pathname.match(/\/wiki\/spaces\/[^/]+\/pages\/(\d+)/);
    if (pageMatch) return { origin, tenant, contentType: 'page', id: pageMatch[1] };

    const folderMatch = u.pathname.match(/\/wiki\/spaces\/[^/]+\/folder\/(\d+)/);
    if (folderMatch) return { origin, tenant, contentType: 'folder', id: folderMatch[1] };

    return null;
  }

  // ── Low-level fetch w/ 429 backoff ────────────────────────────────────────

  async function apiFetch(origin, path) {
    const url = origin + path;
    let delay = BASE_BACKOFF_MS;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      if (res.status === 429) {
        if (attempt === MAX_RETRIES) throw new Error(`Rate limited (429) — retries exhausted`);
        const ra = parseInt(res.headers.get('Retry-After') || '0', 10);
        await sleep(ra > 0 ? ra * 1000 : delay);
        delay *= 2;
        continue;
      }
      return res;
    }
  }

  async function apiJson(origin, path) {
    const res = await apiFetch(origin, path);
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} for ${path}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // ── Endpoints ─────────────────────────────────────────────────────────────

  // Fetch a page's metadata only (no body). Used for the tree root and to
  // avoid fetching bodies during discovery.
  async function getPageMeta(origin, id) {
    const data = await apiJson(origin, `/wiki/api/v2/pages/${id}`);
    return {
      id: String(data.id),
      title: data.title || 'Untitled',
      parentId: data.parentId ? String(data.parentId) : null
    };
  }

  // Fetch a single page including rendered HTML body.
  async function getPageWithBody(origin, id) {
    const data = await apiJson(origin, `/wiki/api/v2/pages/${id}?body-format=export_view`);
    return {
      id: String(data.id),
      title: data.title || 'Untitled',
      htmlBody: (data.body && data.body.export_view && data.body.export_view.value) || '',
      parentId: data.parentId ? String(data.parentId) : null
    };
  }

  // Fetch a folder's metadata (no body — folders have no content).
  async function getFolder(origin, id) {
    const data = await apiJson(origin, `/wiki/api/v2/folders/${id}`);
    return {
      id: String(data.id),
      title: data.title || 'Untitled folder',
      parentId: data.parentId ? String(data.parentId) : null
    };
  }

  // List direct children of a page or folder. Handles cursor pagination.
  // Returns flat array of { id, title, type } where type is 'page' | 'folder' | 'whiteboard' | ...
  async function listChildren(origin, parentId, parentType) {
    const base = parentType === 'folder'
      ? `/wiki/api/v2/folders/${parentId}/children`
      : `/wiki/api/v2/pages/${parentId}/children`;
    const out = [];
    let cursor = null;
    do {
      const qs = `?limit=${PAGE_LIMIT}` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const data = await apiJson(origin, base + qs);
      for (const child of data.results || []) {
        out.push({
          id: String(child.id),
          title: child.title || 'Untitled',
          type: child.type || 'page'
        });
      }
      cursor = extractCursor(data._links && data._links.next);
    } while (cursor);
    return out;
  }

  // ── Tree discovery (BFS) ──────────────────────────────────────────────────

  // depth: 0 (root only), 1 (root + immediate children), Infinity (all).
  // cap: stop adding nodes after this count, return { truncated: true }.
  // Returns { nodes, truncated, rootTitle } where nodes carry parentId for path reconstruction.
  async function discoverTree(origin, root, depth, cap) {
    const rootMeta = root.contentType === 'folder'
      ? await getFolder(origin, root.id)
      : await getPageMeta(origin, root.id);

    const nodes = [{
      id: rootMeta.id,
      title: rootMeta.title,
      parentId: null,
      type: root.contentType,
      depth: 0
    }];
    let truncated = false;

    if (depth >= 1) {
      // BFS
      const queue = [{ id: rootMeta.id, type: root.contentType, depth: 0 }];
      while (queue.length > 0) {
        const current = queue.shift();
        if (current.depth >= depth) continue;
        let children;
        try {
          children = await listChildren(origin, current.id, current.type);
        } catch (err) {
          // Skip unreadable subtrees but don't abort the whole discovery.
          console.warn(`listChildren failed for ${current.id}:`, err);
          continue;
        }
        for (const child of children) {
          if (nodes.length >= cap) {
            truncated = true;
            break;
          }
          // Only descend into pages and folders — whiteboards/databases have no MD analog.
          const isTraversable = child.type === 'page' || child.type === 'folder';
          if (!isTraversable) continue;
          nodes.push({
            id: child.id,
            title: child.title,
            parentId: current.id,
            type: child.type,
            depth: current.depth + 1
          });
          if (current.depth + 1 < depth) {
            queue.push({ id: child.id, type: child.type, depth: current.depth + 1 });
          }
        }
        if (truncated) break;
      }
    }

    return { nodes, truncated, rootTitle: rootMeta.title };
  }

  // ── Concurrency limiter ───────────────────────────────────────────────────

  // Runs `fn(item, index)` over items with at most `concurrency` in flight.
  // Returns array of { ok: true, value } | { ok: false, error } in input order.
  async function runQueue(items, fn, concurrency) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
      while (true) {
        const idx = next++;
        if (idx >= items.length) return;
        try {
          results[idx] = { ok: true, value: await fn(items[idx], idx) };
        } catch (error) {
          results[idx] = { ok: false, error };
        }
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
    await Promise.all(workers);
    return results;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // The `_links.next` in v2 responses is a path like
  // "/wiki/api/v2/pages/123/children?limit=250&cursor=ABC" — extract the cursor param.
  function extractCursor(nextLink) {
    if (!nextLink) return null;
    try {
      const u = new URL(nextLink, 'https://placeholder');
      return u.searchParams.get('cursor');
    } catch {
      return null;
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  global.ConfluenceApi = {
    parseUrl,
    getPageMeta,
    getPageWithBody,
    getFolder,
    listChildren,
    discoverTree,
    runQueue
  };
})(window);
