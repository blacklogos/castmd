// E2E: the local .md viewer/editor content script on real file:// pages.
// Chrome runs it only when file access is allowed for the extension; the
// launcher passes --disable-extensions-file-access-check, which is exactly what
// the user's "Allow access to file URLs" toggle does.
//
// The save path stubs window.showSaveFilePicker (a native OS dialog cannot be
// driven headless) and asserts everything after it for real: createWritable →
// write → close → hidden raw <pre> resync → status.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildTestExtension } from './helpers/test-build.js';
import { launchWithExtension, collectErrors } from './helpers/chrome.js';
import { FIXTURE_DIR } from './helpers/server.js';

let build, chrome, workDir;

const fileUrl = (name) => `file://${path.join(workDir, name)}`;

before(async () => {
  build = buildTestExtension();
  chrome = await launchWithExtension(build.dir);
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'castmd-md-'));
  for (const name of ['sample.md', 'hostile.md']) {
    fs.copyFileSync(path.join(FIXTURE_DIR, name), path.join(workDir, name));
  }
  fs.copyFileSync(path.join(FIXTURE_DIR, 'sample.md'), path.join(workDir, 'plain.txt'));
});

after(async () => {
  await chrome?.close();
  build?.cleanup();
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

async function openViewer(name) {
  const page = await chrome.browser.newPage();
  const errors = collectErrors(page);
  await page.goto(fileUrl(name), { waitUntil: 'load' });
  await page.waitForSelector('article.castmd-viewer', { timeout: 10_000 });
  return { page, errors };
}

test('sample.md renders as HTML with the raw source kept hidden', async () => {
  const { page, errors } = await openViewer('sample.md');

  const state = await page.evaluate(() => {
    const article = document.querySelector('article.castmd-viewer');
    const raw = document.querySelector('pre.castmd-raw');
    return {
      title: document.title,
      h1: article.querySelector('h1')?.textContent,
      h1Id: article.querySelector('h1')?.id,
      headings: [...article.querySelectorAll('h2')].map(h => h.textContent),
      codeLang: article.querySelector('pre code')?.className,
      code: article.querySelector('pre code')?.textContent.trim(),
      strong: article.querySelector('strong')?.textContent,
      del: article.querySelector('del')?.textContent,
      link: article.querySelector('a')?.getAttribute('href'),
      checkboxes: [...article.querySelectorAll('input[type=checkbox]')].map(c => c.checked),
      nestedListItems: article.querySelectorAll('ul ul li').length,
      tableAlign: article.querySelector('table th:nth-child(2)')?.getAttribute('style'),
      tableCells: [...article.querySelectorAll('tbody td')].map(td => td.textContent),
      nestedQuote: !!article.querySelector('blockquote blockquote'),
      hr: article.querySelectorAll('hr').length,
      frontmatterLeaked: article.textContent.includes('Frontmatter title'),
      rawHidden: raw.hidden,
      rawStartsWithFence: raw.textContent.startsWith('---'),
    };
  });

  assert.equal(state.title, 'Sample Document');
  assert.equal(state.h1, 'Sample Document');
  assert.equal(state.h1Id, 'sample-document');
  assert.deepEqual(state.headings, ['Code', 'List', 'Table']);
  assert.equal(state.codeLang, 'language-js');
  assert.equal(state.code, 'const answer = 42;');
  assert.equal(state.strong, 'bold');
  assert.equal(state.del, 'struck');
  assert.equal(state.link, 'https://example.com/page');
  assert.deepEqual(state.checkboxes, [true, false]);
  assert.equal(state.nestedListItems, 1);
  assert.equal(state.tableAlign, 'text-align:right');
  assert.deepEqual(state.tableCells, ['gpt-4', '8k', 'claude', '200k']);
  assert.equal(state.nestedQuote, true);
  assert.equal(state.hr, 1);
  assert.equal(state.frontmatterLeaked, false, 'frontmatter must be stripped, not rendered');
  assert.equal(state.rawHidden, true);
  assert.equal(state.rawStartsWithFence, true, 'raw source must be preserved verbatim');
  assert.deepEqual(errors, []);
  await page.close();
});

test('edit toggle round-trips markdown through the preview', async () => {
  const { page, errors } = await openViewer('sample.md');

  assert.equal(await page.$eval('.castmd-toolbar button', b => b.textContent), 'Edit');
  await page.click('.castmd-toolbar button');

  const editing = await page.evaluate(() => ({
    editorVisible: !document.querySelector('.castmd-editor').hidden,
    articleHidden: document.querySelector('article.castmd-viewer').hidden,
    toggleLabel: document.querySelector('.castmd-toolbar button').textContent,
    saveVisible: !document.querySelectorAll('.castmd-toolbar button')[2].hidden,
    editorHasFrontmatter: document.querySelector('.castmd-editor').value.startsWith('---'),
  }));
  assert.deepEqual(editing, {
    editorVisible: true, articleHidden: true, toggleLabel: 'Preview',
    saveVisible: true, editorHasFrontmatter: true,
  });

  await page.$eval('.castmd-editor', el => { el.value = '## Edited heading\n\n- rewritten\n'; });
  await page.click('.castmd-toolbar button');

  const previewed = await page.evaluate(() => ({
    editorHidden: document.querySelector('.castmd-editor').hidden,
    h2: document.querySelector('article.castmd-viewer h2')?.textContent,
    li: document.querySelector('article.castmd-viewer li')?.textContent,
    toggleLabel: document.querySelector('.castmd-toolbar button').textContent,
  }));
  assert.deepEqual(previewed, {
    editorHidden: true, h2: 'Edited heading', li: 'rewritten', toggleLabel: 'Edit',
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test('save writes the editor buffer through the file handle and resyncs the raw source', async () => {
  const page = await chrome.browser.newPage();
  const errors = collectErrors(page);
  // Stub the picker before the content script runs (same MAIN world).
  await page.evaluateOnNewDocument(() => {
    window.__written = [];
    window.__pickerCalls = 0;
    window.showSaveFilePicker = async (opts) => {
      window.__pickerCalls++;
      window.__suggestedName = opts?.suggestedName;
      return {
        createWritable: async () => ({
          write: async (text) => { window.__written.push(text); },
          close: async () => { window.__closed = true; },
        }),
      };
    };
  });
  await page.goto(fileUrl('sample.md'), { waitUntil: 'load' });
  await page.waitForSelector('article.castmd-viewer');

  await page.click('.castmd-toolbar button');             // Edit
  await page.$eval('.castmd-editor', el => { el.value = '# Saved doc\n\nbody\n'; });
  await page.click('.castmd-toolbar button:nth-of-type(3)'); // Save
  await page.waitForFunction(() => document.querySelector('.castmd-status').textContent === 'Saved', { timeout: 10_000 });

  const state = await page.evaluate(() => ({
    written: window.__written,
    closed: window.__closed,
    pickerCalls: window.__pickerCalls,
    suggestedName: window.__suggestedName,
    rawText: document.querySelector('pre.castmd-raw').textContent,
  }));
  assert.deepEqual(state.written, ['# Saved doc\n\nbody\n']);
  assert.equal(state.closed, true);
  assert.equal(state.pickerCalls, 1);
  assert.equal(state.suggestedName, 'sample.md');
  assert.equal(state.rawText, '# Saved doc\n\nbody\n', 'hidden raw source must mirror what was written');

  // Second save reuses the handle — no second picker.
  await page.$eval('.castmd-editor', el => { el.value = '# Second write\n'; });
  await page.click('.castmd-toolbar button:nth-of-type(3)');
  await page.waitForFunction(() => window.__written.length === 2, { timeout: 10_000 });
  assert.equal(await page.evaluate(() => window.__pickerCalls), 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a cancelled picker leaves no status and no write', async () => {
  const page = await chrome.browser.newPage();
  await page.evaluateOnNewDocument(() => {
    window.showSaveFilePicker = async () => {
      const err = new Error('user cancelled');
      err.name = 'AbortError';
      throw err;
    };
  });
  await page.goto(fileUrl('sample.md'), { waitUntil: 'load' });
  await page.waitForSelector('article.castmd-viewer');
  await page.click('.castmd-toolbar button');
  await page.click('.castmd-toolbar button:nth-of-type(3)');
  await new Promise(r => setTimeout(r, 300));
  assert.equal(await page.$eval('.castmd-status', el => el.textContent), '');
  await page.close();
});

test('hostile markdown cannot execute script or emit live markup', async () => {
  const { page, errors } = await openViewer('hostile.md');

  const state = await page.evaluate(() => {
    const article = document.querySelector('article.castmd-viewer');
    return {
      canary: window.__castmdXss ?? null,
      scripts: article.querySelectorAll('script').length,
      iframes: article.querySelectorAll('iframe').length,
      svgs: article.querySelectorAll('svg').length,
      inlineHandlers: [...article.querySelectorAll('*')]
        .filter(el => [...el.attributes].some(a => a.name.startsWith('on'))).length,
      imgs: [...article.querySelectorAll('img')].map(i => i.getAttribute('src')),
      hrefs: [...article.querySelectorAll('a')].map(a => a.getAttribute('href')),
      escapedScriptText: article.textContent.includes("<script>window.__castmdXss = 'inline-script'"),
      // A URL containing a quote also contains a space, so the link syntax
      // never matches and the whole thing stays literal text.
      breakoutIsText: article.textContent.includes('onmouseover="window.__castmdXss'),
      codeSpan: [...article.querySelectorAll('code')].some(c => c.textContent.includes('<script>')),
    };
  });

  assert.equal(state.canary, null, 'no injected script may run');
  assert.equal(state.scripts, 0);
  assert.equal(state.iframes, 0);
  assert.equal(state.svgs, 0);
  assert.equal(state.inlineHandlers, 0, 'no on* attribute may survive rendering');
  assert.deepEqual(state.imgs, ['#'], 'javascript: image source must collapse');
  assert.deepEqual(state.hrefs, ['#', '#', '#'], 'javascript:, data: and vbscript: hrefs must collapse');
  assert.equal(state.breakoutIsText, true, 'an attribute-breakout attempt renders as text');
  assert.equal(state.escapedScriptText, true, 'raw HTML is shown as text');
  assert.equal(state.codeSpan, true);
  assert.deepEqual(errors, []);
  await page.close();
});

test('non-markdown file:// pages are left alone', async () => {
  const page = await chrome.browser.newPage();
  await page.goto(fileUrl('plain.txt'), { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 500));
  const state = await page.evaluate(() => ({
    article: document.querySelectorAll('article.castmd-viewer').length,
    toolbar: document.querySelectorAll('.castmd-toolbar').length,
    preHidden: document.querySelector('pre')?.hidden,
  }));
  assert.deepEqual(state, { article: 0, toolbar: 0, preHidden: false });
  await page.close();
});
