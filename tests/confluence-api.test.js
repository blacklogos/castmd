// Tests for lib/confluence-api.js — pure helpers only (parseUrl, runQueue).
// Network-bound functions (discoverTree, getPageWithBody) are exercised via
// the manual test matrix; mocking fetch isn't worth the surface area here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './setup.js';

loadLib('lib/confluence-api.js');
const { parseUrl, runQueue } = globalThis.ConfluenceApi;

// ── parseUrl ────────────────────────────────────────────────────────────────

test('parseUrl — page URL', () => {
  const r = parseUrl('https://acme.atlassian.net/wiki/spaces/ENG/pages/12345/Some-Title');
  assert.deepEqual(r, {
    origin: 'https://acme.atlassian.net',
    tenant: 'acme',
    contentType: 'page',
    id: '12345',
  });
});

test('parseUrl — folder URL', () => {
  const r = parseUrl('https://acme.atlassian.net/wiki/spaces/ENG/folder/999/Stuff');
  assert.deepEqual(r, {
    origin: 'https://acme.atlassian.net',
    tenant: 'acme',
    contentType: 'folder',
    id: '999',
  });
});

test('parseUrl — non-atlassian host returns null', () => {
  assert.equal(parseUrl('https://example.com/wiki/spaces/X/pages/1'), null);
});

test('parseUrl — non-wiki path returns null', () => {
  assert.equal(parseUrl('https://acme.atlassian.net/browse/JIRA-1'), null);
});

test('parseUrl — whiteboard / unsupported content type returns null', () => {
  assert.equal(parseUrl('https://acme.atlassian.net/wiki/spaces/X/whiteboard/123'), null);
});

test('parseUrl — invalid input returns null', () => {
  assert.equal(parseUrl(''), null);
  assert.equal(parseUrl('not a url'), null);
  assert.equal(parseUrl(null), null);
  assert.equal(parseUrl(undefined), null);
});

// ── runQueue ────────────────────────────────────────────────────────────────

test('runQueue — preserves input order and captures per-item errors', async () => {
  const items = [1, 2, 3, 4, 5];
  const results = await runQueue(items, async (n) => {
    if (n === 3) throw new Error('boom');
    // Vary delay so completion order != input order.
    await new Promise((r) => setTimeout(r, (10 - n) * 2));
    return n * 10;
  }, 2);
  assert.equal(results.length, 5);
  assert.deepEqual(results[0], { ok: true, value: 10 });
  assert.deepEqual(results[1], { ok: true, value: 20 });
  assert.equal(results[2].ok, false);
  assert.equal(results[2].error.message, 'boom');
  assert.deepEqual(results[3], { ok: true, value: 40 });
  assert.deepEqual(results[4], { ok: true, value: 50 });
});

test('runQueue — respects concurrency limit', async () => {
  let inFlight = 0;
  let peak = 0;
  await runQueue([1, 2, 3, 4, 5, 6, 7, 8], async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 15));
    inFlight--;
  }, 3);
  assert.equal(peak, 3);
});

test('runQueue — empty items returns empty array', async () => {
  const r = await runQueue([], async () => 1, 3);
  assert.deepEqual(r, []);
});

test('runQueue — concurrency larger than items still completes', async () => {
  const r = await runQueue([1, 2], async (n) => n + 1, 10);
  assert.deepEqual(r, [{ ok: true, value: 2 }, { ok: true, value: 3 }]);
});
