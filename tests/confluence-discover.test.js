// Tests for ConfluenceApi.discoverTree — fetch is mocked at the global level.
// Covers depth handling, BFS traversal, cursor pagination, cap truncation,
// folder roots, error skipping, and unsupported child type filtering.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './setup.js';
import { makeFetch } from './fetch-mock.js';

loadLib('lib/confluence-api.js');
const { discoverTree } = globalThis.ConfluenceApi;

const ORIGIN = 'https://acme.atlassian.net';

beforeEach(() => {
  // Each test installs its own routes.
  globalThis.fetch = makeFetch([]);
});

// ── depth handling ──────────────────────────────────────────────────────────

test('discoverTree — depth 0 returns root only (page)', async () => {
  globalThis.fetch = makeFetch([
    { match: '/wiki/api/v2/pages/1', body: { id: 1, title: 'Root' } },
  ]);
  const { nodes, truncated, rootTitle } = await discoverTree(
    ORIGIN, { contentType: 'page', id: '1' }, 0, 100
  );
  assert.equal(rootTitle, 'Root');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].id, '1');
  assert.equal(nodes[0].depth, 0);
  assert.equal(truncated, false);
});

test('discoverTree — folder root uses /folders endpoint', async () => {
  globalThis.fetch = makeFetch([
    { match: '/wiki/api/v2/folders/42', body: { id: 42, title: 'Big Folder' } },
  ]);
  const { nodes, rootTitle } = await discoverTree(
    ORIGIN, { contentType: 'folder', id: '42' }, 0, 100
  );
  assert.equal(rootTitle, 'Big Folder');
  assert.equal(nodes[0].type, 'folder');
});

test('discoverTree — depth 1 fetches immediate children only', async () => {
  globalThis.fetch = makeFetch([
    { match: '/wiki/api/v2/pages/1?', body: { id: 1, title: 'Root' } },
    { match: '/wiki/api/v2/pages/1', body: { id: 1, title: 'Root' } },
    { match: /\/wiki\/api\/v2\/pages\/1\/children/, body: {
      results: [
        { id: 2, title: 'Child A', type: 'page' },
        { id: 3, title: 'Child B', type: 'page' },
      ],
    }},
  ]);
  const { nodes } = await discoverTree(
    ORIGIN, { contentType: 'page', id: '1' }, 1, 100
  );
  assert.equal(nodes.length, 3);
  assert.deepEqual(nodes.map(n => n.id).sort(), ['1', '2', '3']);
  // Children carry the right parent id and depth.
  const childA = nodes.find(n => n.id === '2');
  assert.equal(childA.parentId, '1');
  assert.equal(childA.depth, 1);
});

test('discoverTree — depth Infinity walks full subtree (BFS)', async () => {
  globalThis.fetch = makeFetch([
    { match: '/wiki/api/v2/pages/1', body: { id: 1, title: 'Root' } },
    { match: /\/wiki\/api\/v2\/pages\/1\/children/, body: {
      results: [{ id: 2, title: 'A', type: 'page' }],
    }},
    { match: /\/wiki\/api\/v2\/pages\/2\/children/, body: {
      results: [{ id: 3, title: 'B', type: 'page' }],
    }},
    { match: /\/wiki\/api\/v2\/pages\/3\/children/, body: { results: [] } },
  ]);
  const { nodes } = await discoverTree(
    ORIGIN, { contentType: 'page', id: '1' }, Infinity, 100
  );
  assert.equal(nodes.length, 3);
  // BFS order: root, then depth-1, then depth-2.
  assert.deepEqual(nodes.map(n => n.id), ['1', '2', '3']);
  assert.deepEqual(nodes.map(n => n.depth), [0, 1, 2]);
});

// ── cap / truncation ────────────────────────────────────────────────────────

test('discoverTree — truncated when node count hits cap', async () => {
  const manyKids = Array.from({ length: 10 }, (_, i) => ({
    id: 100 + i, title: `K${i}`, type: 'page',
  }));
  globalThis.fetch = makeFetch([
    { match: '/wiki/api/v2/pages/1', body: { id: 1, title: 'Root' } },
    { match: /\/wiki\/api\/v2\/pages\/1\/children/, body: { results: manyKids } },
  ]);
  const { nodes, truncated } = await discoverTree(
    ORIGIN, { contentType: 'page', id: '1' }, 1, 5
  );
  assert.equal(truncated, true);
  // cap is the ceiling — discover stops adding once nodes.length >= cap.
  assert.equal(nodes.length, 5);
});

// ── cursor pagination ───────────────────────────────────────────────────────

test('discoverTree — follows _links.next cursor across pages', async () => {
  globalThis.fetch = makeFetch([
    { match: '/wiki/api/v2/pages/1', body: { id: 1, title: 'Root' } },
    // Page 1 of children — includes a next link.
    { match: /\/wiki\/api\/v2\/pages\/1\/children\?limit=250$/, body: {
      results: [{ id: 2, title: 'A', type: 'page' }],
      _links: { next: '/wiki/api/v2/pages/1/children?limit=250&cursor=PAGE2' },
    }},
    // Page 2 — no further next link.
    { match: /cursor=PAGE2/, body: {
      results: [{ id: 3, title: 'B', type: 'page' }],
    }},
  ]);
  const { nodes } = await discoverTree(
    ORIGIN, { contentType: 'page', id: '1' }, 1, 100
  );
  assert.equal(nodes.length, 3);
  assert.deepEqual(nodes.map(n => n.id).sort(), ['1', '2', '3']);
});

// ── error / type filtering ──────────────────────────────────────────────────

test('discoverTree — skips subtree when listChildren returns 403', async () => {
  globalThis.fetch = makeFetch([
    { match: '/wiki/api/v2/pages/1', body: { id: 1, title: 'Root' } },
    { match: /\/wiki\/api\/v2\/pages\/1\/children/, body: {
      results: [
        { id: 2, title: 'Public', type: 'page' },
        { id: 9, title: 'Locked', type: 'page' },
      ],
    }},
    { match: /\/wiki\/api\/v2\/pages\/2\/children/, body: { results: [] } },
    { match: /\/wiki\/api\/v2\/pages\/9\/children/, status: 403, body: { message: 'forbidden' } },
  ]);
  // Silence the console.warn the lib emits on subtree failure.
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const { nodes } = await discoverTree(
      ORIGIN, { contentType: 'page', id: '1' }, Infinity, 100
    );
    // Root + 2 immediate kids — the locked one is still surfaced as a node,
    // but its children aren't fetched.
    assert.equal(nodes.length, 3);
    assert.deepEqual(nodes.map(n => n.id).sort(), ['1', '2', '9']);
  } finally {
    console.warn = origWarn;
  }
});

test('discoverTree — filters out unsupported child types (whiteboard, database)', async () => {
  globalThis.fetch = makeFetch([
    { match: '/wiki/api/v2/pages/1', body: { id: 1, title: 'Root' } },
    { match: /\/wiki\/api\/v2\/pages\/1\/children/, body: {
      results: [
        { id: 2, title: 'Page',       type: 'page' },
        { id: 3, title: 'Whiteboard', type: 'whiteboard' },
        { id: 4, title: 'Database',   type: 'database' },
      ],
    }},
  ]);
  const { nodes } = await discoverTree(
    ORIGIN, { contentType: 'page', id: '1' }, 1, 100
  );
  assert.equal(nodes.length, 2);
  assert.deepEqual(nodes.map(n => n.id).sort(), ['1', '2']);
});
