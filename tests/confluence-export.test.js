// Tests for ConfluenceExport.exportTree — verifies the orchestration of
// fetch-bodies → convert → assemble ZIP entries. ZipBuilder is stubbed so we
// can inspect the entry list directly without unzipping a blob.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './setup.js';
import { makeFetch } from './fetch-mock.js';

loadLib('lib/confluence-api.js');
loadLib('lib/html-to-markdown.js');

// Stub ZipBuilder before loading the orchestrator so the IIFE picks it up.
let lastEntries = null;
globalThis.ZipBuilder = {
  buildZip: async (entries) => {
    lastEntries = entries.slice();
    return { __fakeBlob: true, size: entries.length };
  },
};

loadLib('lib/confluence-export.js');
const { exportTree } = globalThis.ConfluenceExport;

const ORIGIN = 'https://acme.atlassian.net';

beforeEach(() => {
  lastEntries = null;
  globalThis.fetch = makeFetch([]);
});

function pageBody(id, title, html) {
  return {
    id, title,
    body: { export_view: { value: html } },
  };
}

// ── single page ─────────────────────────────────────────────────────────────

test('exportTree — single root page produces one .md entry', async () => {
  globalThis.fetch = makeFetch([
    { match: /\/wiki\/api\/v2\/pages\/1\?body-format=export_view/,
      body: pageBody(1, 'Root', '<p>Hello world</p>') },
  ]);
  const nodes = [{ id: '1', title: 'Root', parentId: null, type: 'page', depth: 0 }];
  const { filename, skipped } = await exportTree(ORIGIN, 'Root', nodes);
  assert.equal(filename, 'Root.zip');
  assert.deepEqual(skipped, []);
  assert.equal(lastEntries.length, 1);
  assert.equal(lastEntries[0].path, 'Root.md');
  assert.match(lastEntries[0].content, /# Root/);
  assert.match(lastEntries[0].content, /Hello world/);
});

// ── hierarchy ───────────────────────────────────────────────────────────────

test('exportTree — child paths mirror the page tree', async () => {
  globalThis.fetch = makeFetch([
    { match: /\/pages\/1\?body/, body: pageBody(1, 'Root', '<p>r</p>') },
    { match: /\/pages\/2\?body/, body: pageBody(2, 'Child A', '<p>a</p>') },
    { match: /\/pages\/3\?body/, body: pageBody(3, 'Grand', '<p>g</p>') },
  ]);
  const nodes = [
    { id: '1', title: 'Root',    parentId: null, type: 'page', depth: 0 },
    { id: '2', title: 'Child A', parentId: '1',  type: 'page', depth: 1 },
    { id: '3', title: 'Grand',   parentId: '2',  type: 'page', depth: 2 },
  ];
  await exportTree(ORIGIN, 'Root', nodes);
  const paths = lastEntries.map(e => e.path).sort();
  assert.deepEqual(paths, [
    'Root.md',
    'Root/Child A.md',
    'Root/Child A/Grand.md',
  ]);
});

// ── filename collision ──────────────────────────────────────────────────────

test('exportTree — collision under same parent gets id-suffix dedupe', async () => {
  globalThis.fetch = makeFetch([
    { match: /\/pages\/1\?body/,        body: pageBody(1, 'Root', '<p>r</p>') },
    { match: /\/pages\/200001\?body/,   body: pageBody(200001, 'Dup', '<p>x</p>') },
    { match: /\/pages\/200002\?body/,   body: pageBody(200002, 'Dup', '<p>y</p>') },
  ]);
  const nodes = [
    { id: '1',      title: 'Root', parentId: null, type: 'page', depth: 0 },
    { id: '200001', title: 'Dup',  parentId: '1',  type: 'page', depth: 1 },
    { id: '200002', title: 'Dup',  parentId: '1',  type: 'page', depth: 1 },
  ];
  await exportTree(ORIGIN, 'Root', nodes);
  const childPaths = lastEntries.map(e => e.path).filter(p => p.startsWith('Root/'));
  // One stays "Dup.md", the other gets "-{last 6 of id}" appended.
  assert.equal(childPaths.length, 2);
  assert.ok(childPaths.includes('Root/Dup.md'));
  assert.ok(
    childPaths.some(p => p === 'Root/Dup-200001.md' || p === 'Root/Dup-200002.md'),
    `expected an id-suffixed sibling, got ${JSON.stringify(childPaths)}`
  );
});

// ── skipped pages ───────────────────────────────────────────────────────────

test('exportTree — failed page fetch goes to _skipped.txt', async () => {
  globalThis.fetch = makeFetch([
    { match: /\/pages\/1\?body/, body: pageBody(1, 'Root', '<p>r</p>') },
    { match: /\/pages\/9\?body/, status: 403, body: { message: 'forbidden' } },
  ]);
  const nodes = [
    { id: '1', title: 'Root',   parentId: null, type: 'page', depth: 0 },
    { id: '9', title: 'Locked', parentId: '1',  type: 'page', depth: 1 },
  ];
  const { skipped } = await exportTree(ORIGIN, 'Root', nodes);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].title, 'Locked');
  const skipEntry = lastEntries.find(e => e.path === '_skipped.txt');
  assert.ok(skipEntry, '_skipped.txt entry missing');
  assert.match(skipEntry.content, /Locked/);
  // The skipped page must NOT appear as a markdown file.
  assert.equal(lastEntries.some(e => e.path.includes('Locked')), false);
});

// ── folder placeholder ──────────────────────────────────────────────────────

test('exportTree — folder nodes get a placeholder markdown (no body fetch)', async () => {
  globalThis.fetch = makeFetch([
    { match: /\/pages\/2\?body/, body: pageBody(2, 'Child', '<p>x</p>') },
    // Folder body should NOT be fetched — no route for /folders.
  ]);
  const nodes = [
    { id: '1', title: 'Stuff', parentId: null, type: 'folder', depth: 0 },
    { id: '2', title: 'Child', parentId: '1',  type: 'page',   depth: 1 },
  ];
  await exportTree(ORIGIN, 'Stuff', nodes);
  const root = lastEntries.find(e => e.path === 'Stuff.md');
  assert.ok(root, 'folder root entry missing');
  assert.match(root.content, /Confluence folder/);
});

// ── onProgress ──────────────────────────────────────────────────────────────

test('exportTree — onProgress called once per page (not per folder)', async () => {
  globalThis.fetch = makeFetch([
    { match: /\/pages\/1\?body/, body: pageBody(1, 'Root', '<p>r</p>') },
    { match: /\/pages\/2\?body/, body: pageBody(2, 'A',    '<p>a</p>') },
    { match: /\/pages\/3\?body/, body: pageBody(3, 'B',    '<p>b</p>') },
  ]);
  const nodes = [
    { id: '1', title: 'Root',   parentId: null, type: 'page',   depth: 0 },
    { id: '2', title: 'A',      parentId: '1',  type: 'page',   depth: 1 },
    { id: '3', title: 'B',      parentId: '1',  type: 'page',   depth: 1 },
    { id: '4', title: 'Folder', parentId: '1',  type: 'folder', depth: 1 },
  ];
  const events = [];
  await exportTree(ORIGIN, 'Root', nodes, (done, total) => events.push([done, total]));
  assert.equal(events.length, 3);
  // Total should be the page count, not the node count (folders excluded).
  assert.ok(events.every(([_done, total]) => total === 3));
  assert.deepEqual(events.map(e => e[0]).sort(), [1, 2, 3]);
});
