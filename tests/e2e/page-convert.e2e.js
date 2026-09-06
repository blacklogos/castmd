// E2E: converting real web pages. Covers the two production entry points —
// the popup (query active tab → inject content.js → convert → download) and
// the service worker path used by the context menu and keyboard shortcut
// (inject → convert → write clipboard → badge).
//
// Loaded from a build whose manifest promotes <all_urls> from optional to
// required: chrome.permissions.request needs a user gesture plus a native
// prompt, which headless Chrome cannot show. See helpers/test-build.js.
//
// The popup runs in a background tab on purpose — its `chrome.tabs.query({
// active: true })` must resolve to the page being converted, exactly as when
// Chrome renders it over the active tab.

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildTestExtension } from './helpers/test-build.js';
import { launchWithExtension, waitForDownload, collectErrors } from './helpers/chrome.js';
import { startFixtureServer } from './helpers/server.js';

let build, chrome, server;

before(async () => {
  build = buildTestExtension({ grantAllUrls: true });
  chrome = await launchWithExtension(build.dir);
  server = await startFixtureServer();
  await chrome.browser.defaultBrowserContext()
    .overridePermissions(server.origin, ['clipboard-read', 'clipboard-write']);
});

after(async () => {
  await server?.close();
  await chrome?.close();
  build?.cleanup();
});

beforeEach(() => {
  for (const name of fs.readdirSync(chrome.downloadDir)) {
    fs.rmSync(`${chrome.downloadDir}/${name}`, { recursive: true, force: true });
  }
});

// A failed assertion skips a test's own close() calls; leftover tabs would then
// change what the "all tabs" flows see.
afterEach(async () => {
  const pages = await chrome.browser.pages();
  for (const page of pages.slice(1)) await page.close().catch(() => {});
});

// Opens the fixture, then the popup, then returns focus to the fixture so the
// popup sees it as the active tab.
async function openPopupOver(fixture) {
  const page = await chrome.browser.newPage();
  const pageErrors = collectErrors(page);
  await page.goto(server.url(fixture), { waitUntil: 'load' });
  const popup = await chrome.browser.newPage();
  const errors = collectErrors(popup);
  await popup.goto(chrome.popupUrl, { waitUntil: 'load' });
  await popup.waitForFunction(() => document.getElementById('tabCount').textContent !== '', { polling: 100 });
  await page.bringToFront();
  return { page, popup, errors, pageErrors };
}

// The popup is a hidden tab for most of these tests, so requestAnimationFrame
// never fires there: every interaction goes through evaluate() and every wait
// polls on a timer instead of puppeteer's default rAF polling.
const clickInPopup = (popup, sel) => popup.evaluate(
  s => document.querySelector(s).click(),
  sel.startsWith('.') || sel.startsWith('[') ? sel : `#${sel}`,
);

const waitForStatus = (popup, re) => popup.waitForFunction(
  pattern => new RegExp(pattern).test(document.getElementById('statusText').textContent),
  { timeout: 20_000, polling: 100 }, re.source ?? re,
);

// ── popup → active tab ─────────────────────────────────────────────────────

test('Save as .md downloads converted markdown for the active tab', async () => {
  const { page, popup, errors } = await openPopupOver('article.html');

  await clickInPopup(popup, 'saveMdBtn');
  await waitForStatus(popup, /^Saved$/);
  const file = await waitForDownload(chrome.downloadDir, 'article.md');
  const md = fs.readFileSync(file, 'utf8');

  assert.match(md, /^# Fixture Article\n/);
  assert.match(md, /## Code\n/);
  assert.match(md, /```python\ndef hello\(name\):\n {4}return f"hi \{name\}"\n```/);
  assert.match(md, /Intro paragraph with \*\*bold\*\*, \*italic\*, `inline_code`, a \[link\]\(https:\/\/example\.com\/docs\) and ~~struck text~~\./);
  assert.match(md, /- first bullet\n- second bullet\n {2}- nested bullet/);
  assert.match(md, /1\. step one\n2\. step two/);
  assert.match(md, /\| Model \| Context \|\n\| --- \| --- \|\n\| gpt-4 \| 8k \|\n\| claude \| 200k \|/);
  assert.match(md, /`castmd --flag`\n\n## Notes\n/, 'a bare code chip must not swallow the next heading');
  assert.match(md, /Exports land as \.md files, or as \.json when the mode says so\./);
  assert.doesNotMatch(md, /Nav link/, 'nav must be skipped');
  assert.doesNotMatch(md, /Footer text/, 'footer must be skipped');
  assert.doesNotMatch(md, /Sidebar text/, 'sidebar must be skipped');
  assert.doesNotMatch(md, /Banner heading/, 'banner must be skipped');
  assert.equal(md.match(/nested bullet/g).length, 1, 'nested list must render once');
  assert.equal(md.match(/inline_code/g).length, 1, 'inline code must not be emitted a second time');
  assert.doesNotMatch(md, /^.+ ## /m, 'no duplicate fragment may push a heading off the line start');

  const tokens = await popup.$eval('#tokenCount', el => el.textContent);
  assert.match(tokens, /^~[\d,]+ tokens$/);
  const preview = await popup.$eval('#previewText', el => el.value);
  assert.equal(preview, md);
  assert.deepEqual(errors, []);

  await popup.close();
  await page.close();
});

test('content.js survives being injected again on a second run', async () => {
  // content.js is re-injected on every action into a world that persists, so a
  // top-level `const` would throw "Identifier has already been declared" the
  // second time and the page would stop answering messages.
  const { page, popup, errors, pageErrors } = await openPopupOver('article.html');

  await clickInPopup(popup, 'saveMdBtn');
  await waitForStatus(popup, /^Saved$/);
  const firstPath = await waitForDownload(chrome.downloadDir, 'article.md');
  const first = fs.readFileSync(firstPath, 'utf8');

  // Remove it so the second save has to produce the file again from scratch.
  fs.rmSync(firstPath);
  await popup.evaluate(() => { document.getElementById('statusText').textContent = ''; });
  await clickInPopup(popup, 'saveMdBtn');
  await waitForStatus(popup, /^Saved$/);
  const second = fs.readFileSync(await waitForDownload(chrome.downloadDir, 'article.md'), 'utf8');

  assert.equal(second, first, 'the second run must convert the same page');
  assert.equal(await popup.evaluate(() => window.__castmdVersion ?? null), null,
    'the content script must not leak into the popup context');
  assert.equal(await page.evaluate(() => window.__castmdVersion), undefined,
    'the version guard lives in the isolated world, not on the page');
  assert.deepEqual(errors, []);
  assert.deepEqual(pageErrors, [], 'a duplicate declaration would surface as a page error');

  await popup.close();
  await page.close();
});

test('JSON and XML modes change the payload and the file extension', async () => {
  const { page, popup, errors } = await openPopupOver('article.html');

  await clickInPopup(popup, '.mode-btn[data-mode="json"]');
  await clickInPopup(popup, 'saveMdBtn');
  await waitForStatus(popup, /^Saved$/);
  const json = JSON.parse(fs.readFileSync(await waitForDownload(chrome.downloadDir, 'article.json'), 'utf8'));
  assert.equal(json.url, server.url('article.html'));
  assert.equal(json.title, 'Fixture article — castmd e2e');
  assert.match(json.markdown, /^# Fixture Article/);
  assert.equal(json.tokens, Math.ceil(json.markdown.length / 4));
  assert.match(json.timestamp, /^\d{4}-\d{2}-\d{2}T/);

  await clickInPopup(popup, '.mode-btn[data-mode="xml"]');
  await popup.evaluate(() => { document.getElementById('statusText').textContent = ''; });
  await clickInPopup(popup, 'saveMdBtn');
  await waitForStatus(popup, /^Saved$/);
  const xml = fs.readFileSync(await waitForDownload(chrome.downloadDir, 'article.xml'), 'utf8');
  assert.match(xml, /^<document>\n<source>http:\/\/127\.0\.0\.1:\d+\/article\.html<\/source>\n<document_content>\n# Fixture Article/);
  assert.match(xml, /<\/document_content>\n<\/document>$/);
  assert.deepEqual(errors, []);

  await popup.close();
  await page.close();
});

test('Save all tabs writes one file per convertible tab and skips the rest', async () => {
  const article = await chrome.browser.newPage();
  await article.goto(server.url('article.html'), { waitUntil: 'load' });
  const notes = await chrome.browser.newPage();
  await notes.goto(server.url('notes.html'), { waitUntil: 'load' });
  const popup = await chrome.browser.newPage();
  const errors = collectErrors(popup);
  await popup.goto(chrome.popupUrl, { waitUntil: 'load' });
  await notes.bringToFront();

  await clickInPopup(popup, 'saveAllTabsBtn');
  await waitForStatus(popup, /^Saving \d+ files$/);

  await waitForDownload(chrome.downloadDir, 'article.md');
  await waitForDownload(chrome.downloadDir, 'notes.md');
  const files = fs.readdirSync(chrome.downloadDir).filter(n => !n.endsWith('.crdownload')).sort();
  assert.deepEqual(files, ['article.md', 'notes.md'],
    'the popup tab and about:blank must be skipped, not written as empty files');
  assert.match(fs.readFileSync(`${chrome.downloadDir}/notes.md`, 'utf8'), /^# Release Notes/);
  assert.equal(await popup.$eval('#statusText', el => el.textContent), 'Saving 2 files');
  assert.deepEqual(errors, []);

  await popup.close();
  await notes.close();
  await article.close();
});

// ── service worker path (context menu / keyboard shortcut) ─────────────────

test('background copy path writes markdown to the clipboard and flashes the badge', async () => {
  const page = await chrome.browser.newPage();
  await page.goto(server.url('article.html'), { waitUntil: 'load' });
  await page.bringToFront();

  const worker = await chrome.worker();
  const tabId = await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    return tab.id;
  }, server.url('article.html'));

  await worker.evaluate(id => convertAndCopyViaBackground(id, 'convert'), tabId);
  await page.waitForFunction(
    () => navigator.clipboard.readText().then(t => t.startsWith('# Fixture Article')),
    { timeout: 15_000, polling: 200 },
  );

  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clipboard, /^# Fixture Article/);
  assert.match(clipboard, /```python/);

  const badge = await worker.evaluate(id => chrome.action.getBadgeText({ tabId: id }), tabId);
  assert.equal(badge, '✓');

  await new Promise(r => setTimeout(r, 2200));
  assert.equal(await worker.evaluate(id => chrome.action.getBadgeText({ tabId: id }), tabId), '',
    'badge must clear itself');
  await page.close();
});

test('background copy path flags failure on a page it cannot script', async () => {
  const page = await chrome.browser.newPage();
  await page.goto(chrome.popupUrl, { waitUntil: 'load' });
  const worker = await chrome.worker();
  const tabId = await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    return tab.id;
  }, chrome.popupUrl);

  await worker.evaluate(id => convertAndCopyViaBackground(id, 'convert'), tabId);
  await new Promise(r => setTimeout(r, 500));
  const badge = await worker.evaluate(id => chrome.action.getBadgeText({ tabId: id }), tabId);
  assert.equal(badge, '✗');
  await page.close();
});
