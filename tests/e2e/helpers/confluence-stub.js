// Fake Confluence Cloud v2 tenant, served to the popup through puppeteer
// request interception. Shape mirrors the real API: cursor pagination on
// /children, `body.export_view.value` on a page fetch, 403 for a page the user
// cannot read (exercises the _skipped.txt path).
//
// Tree:
//   1 Root
//   ├── 2 Child A          (paginated: cursor page 1)
//   │   └── 4 Grandchild
//   ├── 3 Child B / slash  (title needs sanitizing, cursor page 2)
//   ├── 5 Locked           (403 on body fetch)
//   └── 6 Whiteboard       (not traversable, must be dropped)

export const TENANT_ORIGIN = 'https://acme.atlassian.net';
export const PAGE_URL = `${TENANT_ORIGIN}/wiki/spaces/DEMO/pages/1/Root+Page`;

const PAGES = {
  1: { id: 1, title: 'Root', parentId: null, html: '<h1>Root</h1><p>Root body text.</p>' },
  2: { id: 2, title: 'Child A', parentId: 1, html: '<p>Child A body with <strong>bold</strong>.</p>' },
  3: { id: 3, title: 'Child B / slash', parentId: 1, html: '<p>Child B body.</p>' },
  4: { id: 4, title: 'Grandchild', parentId: 2, html: '<h2>Deep</h2><ul><li>one</li><li>two</li></ul>' },
  5: { id: 5, title: 'Locked', parentId: 1, html: null }, // 403
};

const CHILDREN = {
  1: [
    { page: 1, results: [{ id: 2, title: 'Child A', type: 'page' }], nextCursor: 'CURSOR2' },
    { page: 2, results: [
      { id: 3, title: 'Child B / slash', type: 'page' },
      { id: 5, title: 'Locked', type: 'page' },
      { id: 6, title: 'Whiteboard', type: 'whiteboard' },
    ], nextCursor: null },
  ],
  2: [{ page: 1, results: [{ id: 4, title: 'Grandchild', type: 'page' }], nextCursor: null }],
};

function json(body, status = 200) {
  return { status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) };
}

// Returns the response for an intercepted tenant URL, or null when the path is
// not part of the stub (so the test can fail loudly on an unexpected call).
export function respondTo(rawUrl) {
  const url = new URL(rawUrl);

  const children = url.pathname.match(/^\/wiki\/api\/v2\/pages\/(\d+)\/children$/);
  if (children) {
    const pages = CHILDREN[children[1]] || [{ page: 1, results: [], nextCursor: null }];
    const cursor = url.searchParams.get('cursor');
    const wanted = cursor === 'CURSOR2' ? 2 : 1;
    const chunk = pages.find(p => p.page === wanted) || { results: [], nextCursor: null };
    return json({
      results: chunk.results,
      _links: chunk.nextCursor
        ? { next: `/wiki/api/v2/pages/${children[1]}/children?limit=250&cursor=${chunk.nextCursor}` }
        : {},
    });
  }

  const page = url.pathname.match(/^\/wiki\/api\/v2\/pages\/(\d+)$/);
  if (page) {
    const rec = PAGES[page[1]];
    if (!rec) return json({ message: 'not found' }, 404);
    const wantsBody = url.searchParams.get('body-format') === 'export_view';
    if (wantsBody && rec.html === null) return json({ message: 'forbidden' }, 403);
    return json({
      id: rec.id,
      title: rec.title,
      parentId: rec.parentId,
      ...(wantsBody ? { body: { export_view: { value: rec.html } } } : {}),
    });
  }

  if (/^\/wiki\/spaces\//.test(url.pathname)) {
    return {
      status: 200, contentType: 'text/html',
      body: '<!doctype html><title>Root Page - Confluence</title><main><h1>Root</h1><p>Stub Confluence page.</p></main>',
    };
  }

  return null;
}

// Installs interception on a page. Returns the list of tenant paths requested.
export async function interceptTenant(page) {
  const seen = [];
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const url = req.url();
    if (!url.startsWith(TENANT_ORIGIN)) { await req.continue().catch(() => {}); return; }
    seen.push(url.slice(TENANT_ORIGIN.length));
    const res = respondTo(url);
    if (!res) { await req.respond({ status: 418, body: `unstubbed ${url}` }).catch(() => {}); return; }
    await req.respond(res).catch(() => {});
  });
  return seen;
}
