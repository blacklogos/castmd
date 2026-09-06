// E2E: the Confluence tree export, end to end inside the popup — detect the
// tenant from the active tab, discover the tree over paginated children calls,
// fetch bodies, convert to Markdown, build the ZIP and download it.
//
// The tenant is a stub served through request interception (helpers/
// confluence-stub.js): real HTTP, real fetch/credentials path, real JSZip, real
// download. Only the Atlassian server is fake.

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildTestExtension } from './helpers/test-build.js';
import { launchWithExtension, waitForDownload, collectErrors } from './helpers/chrome.js';
import { readZip } from './helpers/zip.js';
import { interceptTenant, PAGE_URL, TENANT_ORIGIN } from './helpers/confluence-stub.js';

let build, chrome;

before(async () => {
  build = buildTestExtension({ grantAllUrls: true });
  chrome = await launchWithExtension(build.dir);
});

after(async () => {
  await chrome?.close();
  build?.cleanup();
});

// Every export here downloads "Root.zip". Without a clean directory,
// waitForDownload can match the previous test's file before Chrome has
// overwritten it, and the assertions then read stale entries.
beforeEach(() => {
  for (const name of fs.readdirSync(chrome.downloadDir)) {
    fs.rmSync(`${chrome.downloadDir}/${name}`, { recursive: true, force: true });
  }
});

afterEach(async () => {
  const pages = await chrome.browser.pages();
  for (const page of pages.slice(1)) await page.close().catch(() => {});
});

const clickInPopup = (popup, sel) => popup.evaluate(s => document.querySelector(s).click(), sel);
const waitForStatus = (popup, re) => popup.waitForFunction(
  pattern => new RegExp(pattern).test(document.getElementById('statusText').textContent),
  { timeout: 30_000, polling: 100 }, re.source,
);

// Opens the stub Confluence page, then a popup that sees it as the active tab.
// The popup detects Confluence at DOMContentLoaded, so it is reloaded once the
// Confluence tab is in front.
async function openPopupOverConfluence() {
  const confTab = await chrome.browser.newPage();
  await interceptTenant(confTab);
  await confTab.goto(PAGE_URL, { waitUntil: 'load' });

  const popup = await chrome.browser.newPage();
  const errors = collectErrors(popup);
  const requested = await interceptTenant(popup);
  await popup.goto(chrome.popupUrl, { waitUntil: 'load' });
  await confTab.bringToFront();
  await popup.reload({ waitUntil: 'load' });
  await popup.waitForFunction(() => document.getElementById('tabCount').textContent !== '', { polling: 100 });

  return { confTab, popup, errors, requested };
}

test('the export section only appears when the active tab is a Confluence page', async () => {
  const { confTab, popup, errors } = await openPopupOverConfluence();

  const detected = await popup.evaluate(() => ({
    hidden: document.getElementById('confluenceSection').hidden,
    info: confluenceInfo,
    parsedWiki: ConfluenceApi.parseUrl('https://acme.atlassian.net/wiki/spaces/DEMO/folder/77/Docs'),
    parsedOther: ConfluenceApi.parseUrl('https://example.com/wiki/spaces/DEMO/pages/1/x'),
    parsedNonWiki: ConfluenceApi.parseUrl('https://acme.atlassian.net/jira/software/projects/AB'),
  }));

  assert.equal(detected.hidden, false);
  assert.deepEqual(detected.info, {
    origin: TENANT_ORIGIN, tenant: 'acme', contentType: 'page', id: '1',
  });
  assert.deepEqual(detected.parsedWiki, {
    origin: TENANT_ORIGIN, tenant: 'acme', contentType: 'folder', id: '77',
  });
  assert.equal(detected.parsedOther, null, 'only *.atlassian.net counts');
  assert.equal(detected.parsedNonWiki, null, 'only /wiki/ paths count');
  assert.deepEqual(errors, []);

  await popup.close();
  await confTab.close();
});

test('preview walks the paginated tree and download writes the ZIP', async () => {
  const { confTab, popup, errors, requested } = await openPopupOverConfluence();

  await clickInPopup(popup, 'input[name="confDepth"][value="all"]');
  await clickInPopup(popup, '#confluencePreviewBtn');
  await waitForStatus(popup, /^Found 5 pages$/);

  const afterPreview = await popup.evaluate(() => ({
    downloadHidden: document.getElementById('confluenceDownloadBtn').hidden,
    label: document.getElementById('confluenceDownloadLabel').textContent,
    nodes: confluencePreviewResult.nodes.map(n => `${n.type}:${n.id}:${n.title}`),
    truncated: confluencePreviewResult.truncated,
  }));

  assert.equal(afterPreview.downloadHidden, false);
  assert.equal(afterPreview.label, 'Download ZIP (5 pages)');
  assert.equal(afterPreview.truncated, false);
  assert.deepEqual(afterPreview.nodes, [
    'page:1:Root', 'page:2:Child A', 'page:3:Child B / slash', 'page:5:Locked', 'page:4:Grandchild',
  ], 'whiteboards are dropped, BFS order is preserved');
  assert.ok(requested.some(p => p.includes('cursor=CURSOR2')), 'the second children page must be fetched');

  await clickInPopup(popup, '#confluenceDownloadBtn');
  await waitForStatus(popup, /^Exported 4 pages \(1 skipped — see _skipped\.txt\)$/);

  const zip = await readZip(await waitForDownload(chrome.downloadDir, 'Root.zip'));
  assert.deepEqual(Object.keys(zip).sort(), [
    'Root.md',
    'Root/Child A.md',
    'Root/Child A/Grandchild.md',
    'Root/Child B - slash.md',
    '_skipped.txt',
  ]);
  assert.equal(zip['Root.md'], '# Root\n\nRoot body text.\n\n');
  assert.equal(zip['Root/Child A.md'], '# Child A\n\nChild A body with **bold**.\n\n');
  assert.equal(zip['Root/Child A/Grandchild.md'], '# Grandchild\n\n## Deep\n\n- one\n- two\n\n');
  assert.match(zip['_skipped.txt'], /- Locked: HTTP 403/);
  assert.equal(Object.keys(zip).includes('Root/Locked.md'), false, 'an unreadable page must not ship an empty file');

  const afterDownload = await popup.evaluate(() => ({
    progress: document.getElementById('confluenceProgressText').textContent,
    bar: document.getElementById('confluenceProgressBar').value,
    warnHidden: document.getElementById('confluenceWarn').hidden,
    downloadDisabled: document.getElementById('confluenceDownloadBtn').disabled,
  }));
  assert.equal(afterDownload.progress, '5 / 5', 'progress counts attempts, so it completes even with a skip');
  assert.equal(afterDownload.bar, 100);
  assert.equal(afterDownload.warnHidden, true, 'the "keep the popup open" warning must clear');
  assert.equal(afterDownload.downloadDisabled, false);
  // The stub's Locked page answers 403; Chrome logs that as a resource error.
  assert.deepEqual(errors.filter(e => !/403 \(Forbidden\)/.test(e)), []);

  await popup.close();
  await confTab.close();
});

test('depth 0 exports only the page itself', async () => {
  const { confTab, popup, errors } = await openPopupOverConfluence();

  await clickInPopup(popup, 'input[name="confDepth"][value="0"]');
  await clickInPopup(popup, '#confluencePreviewBtn');
  await waitForStatus(popup, /^Found 1 page$/);
  assert.equal(await popup.$eval('#confluenceDownloadLabel', el => el.textContent), 'Download ZIP (1 page)');

  await clickInPopup(popup, '#confluenceDownloadBtn');
  await waitForStatus(popup, /^Exported 1 pages$/);
  const zip = await readZip(await waitForDownload(chrome.downloadDir, 'Root.zip'));
  assert.deepEqual(Object.keys(zip), ['Root.md']);
  assert.deepEqual(errors, []);

  await popup.close();
  await confTab.close();
});

test('changing the depth discards a stale preview', async () => {
  const { confTab, popup, errors } = await openPopupOverConfluence();

  await clickInPopup(popup, 'input[name="confDepth"][value="1"]');
  await clickInPopup(popup, '#confluencePreviewBtn');
  await waitForStatus(popup, /^Found 4 pages$/);
  assert.equal(await popup.$eval('#confluenceDownloadBtn', el => el.hidden), false);

  await clickInPopup(popup, 'input[name="confDepth"][value="all"]');
  const reset = await popup.evaluate(() => ({
    hidden: document.getElementById('confluenceDownloadBtn').hidden,
    result: confluencePreviewResult,
  }));
  assert.deepEqual(reset, { hidden: true, result: null });

  // Download does nothing without a fresh preview.
  await clickInPopup(popup, '#confluenceDownloadBtn');
  await new Promise(r => setTimeout(r, 300));
  assert.equal(await popup.$eval('#confluenceProgress', el => el.hidden), true);
  assert.deepEqual(errors, []);

  await popup.close();
  await confTab.close();
});
