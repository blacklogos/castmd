// E2E: the shipped artifact loads in a real Chrome, the service worker boots,
// and the popup initializes without errors. Also guards the properties a Chrome
// Web Store review looks at (MV3, no remote code, permissions still optional).
//
// Runs against a byte-identical copy of the shipped files — no overlay.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildTestExtension, readShippedManifest, REPO_ROOT } from './helpers/test-build.js';
import { launchWithExtension, collectErrors } from './helpers/chrome.js';

let build, chrome;

before(async () => {
  build = buildTestExtension();
  chrome = await launchWithExtension(build.dir);
});

after(async () => {
  await chrome?.close();
  build?.cleanup();
});

// ── shipped artifact guards ────────────────────────────────────────────────

test('manifest — MV3, host permission stays optional', () => {
  const m = readShippedManifest();
  assert.equal(m.manifest_version, 3);
  assert.equal(m.host_permissions, undefined, 'host_permissions must not ship — it is requested on demand');
  assert.deepEqual(m.optional_host_permissions, ['<all_urls>']);
  assert.deepEqual(m.permissions.sort(), ['activeTab', 'clipboardWrite', 'contextMenus', 'scripting', 'tabs']);
  assert.equal(m.version, JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version);
});

test('manifest — every referenced file exists in the build', () => {
  const m = readShippedManifest();
  const referenced = [
    m.background.service_worker,
    m.action.default_popup,
    ...Object.values(m.action.default_icon),
    ...Object.values(m.icons),
    ...m.content_scripts.flatMap(cs => [...cs.js, ...cs.css]),
    'content.js', // injected via chrome.scripting, not declared
  ];
  for (const file of referenced) {
    assert.ok(fs.existsSync(path.join(build.dir, file)), `${file} missing from build`);
  }
});

test('no remotely hosted code and no dynamic evaluation', () => {
  const files = ['popup.html', 'popup.js', 'background.js', 'content.js', 'md-viewer.js',
    'lib/markdown-to-html.js', 'lib/html-to-markdown.js', 'lib/confluence-api.js',
    'lib/confluence-export.js', 'lib/zip-builder.js'];
  for (const file of files) {
    const src = fs.readFileSync(path.join(build.dir, file), 'utf8');
    assert.equal(/<(?:script|link)[^>]+(?:src|href)="https?:/.test(src), false, `${file} loads a remote resource`);
    assert.equal(/\beval\(|new Function\(/.test(src), false, `${file} evaluates code dynamically`);
  }
});

test('the loaded build is exactly the shipped package', () => {
  // Keeps helpers/test-build.js honest: a new repo file must be classified as
  // shipped or not shipped, never silently added to the extension.
  const walk = (dir, prefix = '') => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap(e => (e.isDirectory()
      ? walk(path.join(dir, e.name), `${prefix}${e.name}/`)
      : [`${prefix}${e.name}`]));
  assert.deepEqual(walk(build.dir).sort(), [
    'background.js', 'content.js', 'icon128.png', 'icon16.png', 'icon48.png',
    'lib/confluence-api.js', 'lib/confluence-export.js', 'lib/html-to-markdown.js',
    'lib/markdown-to-html.js', 'lib/zip-builder.js', 'manifest.json',
    'md-viewer.css', 'md-viewer.js', 'popup.html', 'popup.js',
    'vendor/LICENSE-jszip.md', 'vendor/jszip.min.js',
  ]);
});

// ── runtime ────────────────────────────────────────────────────────────────

test('service worker boots and reports the shipped manifest', async () => {
  const worker = await chrome.worker();
  const info = await worker.evaluate(() => ({
    version: chrome.runtime.getManifest().version,
    hasContextMenus: typeof chrome.contextMenus.create === 'function',
    hasScripting: typeof chrome.scripting.executeScript === 'function',
  }));
  assert.equal(info.version, readShippedManifest().version);
  assert.equal(info.hasContextMenus, true);
  assert.equal(info.hasScripting, true);
});

test('context menu registration runs without a runtime error', async () => {
  const worker = await chrome.worker();
  const err = await worker.evaluate(() => new Promise(resolve => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: 'copy-page-md', title: 'Copy page as Markdown', contexts: ['page', 'frame'] },
        () => resolve(chrome.runtime.lastError?.message ?? null));
    });
  }));
  assert.equal(err, null);
});

test('popup initializes clean: tab count filled, Confluence section hidden', async () => {
  const page = await chrome.browser.newPage();
  const errors = collectErrors(page);
  await page.goto(chrome.popupUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('tabCount').textContent !== '');

  const state = await page.evaluate(() => ({
    tabCount: document.getElementById('tabCount').textContent,
    tabCount2: document.getElementById('tabCount2').textContent,
    confluenceHidden: document.getElementById('confluenceSection').hidden,
    statusText: document.getElementById('statusText').textContent,
    buttons: [...document.querySelectorAll('button[id]')].map(b => b.id),
    modeButtons: [...document.querySelectorAll('.mode-btn')].map(b => b.dataset.mode),
  }));

  assert.match(state.tabCount, /^\d+ tabs$/);
  assert.equal(state.tabCount2, state.tabCount);
  assert.equal(state.confluenceHidden, true, 'Confluence export must stay hidden off Confluence');
  assert.equal(state.statusText, '');
  assert.deepEqual(state.modeButtons, ['md', 'json', 'xml']);
  assert.deepEqual(state.buttons.sort(), [
    'closePreview', 'confluenceDownloadBtn', 'confluencePreviewBtn', 'copyAllTabsBtn',
    'copyMdBtn', 'copyOutlineBtn', 'recopyBtn', 'resaveBtn', 'saveAllTabsBtn', 'saveMdBtn',
  ]);
  assert.deepEqual(errors, []);
  await page.close();
});

test('mode toggle relabels the action buttons', async () => {
  const page = await chrome.browser.newPage();
  await page.goto(chrome.popupUrl, { waitUntil: 'load' });

  await page.click('.mode-btn[data-mode="json"]');
  assert.equal(await page.$eval('#copyMdLabel', el => el.textContent), 'Copy as JSON');
  assert.equal(await page.$eval('#saveMdLabel', el => el.textContent), 'Save as .json');

  await page.click('.mode-btn[data-mode="xml"]');
  assert.equal(await page.$eval('#copyMdLabel', el => el.textContent), 'Copy for Claude');
  assert.equal(await page.$eval('#saveAllTabsLabel', el => el.textContent), 'Save all tabs as .xml');

  await page.click('.mode-btn[data-mode="md"]');
  assert.equal(await page.$eval('#saveMdLabel', el => el.textContent), 'Save as .md');
  await page.close();
});

test('conversion failure surfaces an error status instead of throwing', async () => {
  // The popup is its own active tab here, and an extension page cannot be
  // scripted — the exact shape of "the injection failed" at runtime.
  const page = await chrome.browser.newPage();
  const errors = collectErrors(page);
  await page.goto(chrome.popupUrl, { waitUntil: 'load' });
  await page.click('#copyMdBtn');
  await page.waitForFunction(() => document.getElementById('statusRow').className.includes('error'), { timeout: 10_000 });

  const status = await page.$eval('#statusText', el => el.textContent);
  assert.notEqual(status, '');
  assert.deepEqual(errors, [], 'the failure must be handled, not thrown');
  await page.close();
});
