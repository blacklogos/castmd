// E2E: popup "Export as HTML, PDF, DOCX" → export.html → the three outputs.
//
// The fixture page has a real PNG, a lazy-loaded image, an inline SVG diagram
// styled by page CSS, a canvas chart, a rowspan table, lists and code, plus
// noise that must not survive (nav, hidden text, form, an icon-sized SVG).
//
// Outputs are checked by independent readers, not only by string matching:
// DOCX goes through pandoc (structure) and LibreOffice (renders, with header
// and footer fields) when they are installed; the PDF is printed by Chrome's
// own print path (page.pdf honours the same @page rules as the dialog) and
// read back with pdftotext.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { waitForDownload } from './helpers/chrome.js';
import { readZip } from './helpers/zip.js';
import { openExportPage, has } from './helpers/export-page.js';

let chrome, exportPage, exportErrors, workDir, ctx;

before(async () => {
  ctx = await openExportPage();
  ({ chrome, exportPage, exportErrors, workDir } = ctx);
});

after(async () => { await ctx?.close(); });

test('export page shows the cleaned page with every picture embedded', async () => {
  const state = await exportPage.evaluate(() => ({
    status: document.getElementById('status').textContent,
    title: document.getElementById('fTitle').value,
    author: document.getElementById('fAuthor').value,
    tags: document.getElementById('fTags').value,
    text: document.getElementById('doc').textContent,
    h1s: document.querySelectorAll('#doc h1').length,
    imgs: Array.from(document.querySelectorAll('#doc img')).map(i => ({ alt: i.alt, src: i.getAttribute('src').slice(0, 22), w: i.naturalWidth })),
    rowspan: document.querySelector('#doc td[rowspan="2"]')?.textContent,
    link: document.querySelector('#doc a[href*="relative"]')?.getAttribute('href'),
    metaRows: Array.from(document.querySelectorAll('#doc table.castmd-meta th')).map(th => th.textContent),
  }));

  assert.equal(state.status, 'Ready. 2 of 2 images embedded.');
  assert.equal(state.title, 'Export Fixture');
  assert.equal(state.author, 'Jane Writer');
  assert.equal(state.tags, 'castmd, export');
  assert.equal(state.h1s, 1, 'the page h1 is not repeated under the title');
  assert.deepEqual(state.imgs.map(i => i.alt), ['Blue photo', 'Lazy image', 'Flow diagram', 'Bar chart'],
    'photo, lazy image, SVG diagram and canvas chart; the 16px icon is dropped');
  assert.ok(state.imgs.every(i => i.src.startsWith('data:image/')), JSON.stringify(state.imgs));
  assert.ok(state.imgs.every(i => i.w > 0), 'every embedded image decodes');
  assert.equal(state.rowspan, 'PDF');
  assert.match(state.link, /^http:\/\/127\.0\.0\.1:\d+\/relative\/link$/, 'links are absolute');
  assert.deepEqual(state.metaRows, ['Source', 'Author', 'Captured', 'Site', 'Description', 'Tags']);
  for (const noise of ['Navigation text', 'Hidden paragraph', 'form input']) {
    assert.equal(state.text.includes(noise), false, `${noise} must be skipped`);
  }
  assert.deepEqual(exportErrors, []);
});

test('metadata edits flow into the preview and the .html download', async () => {
  await exportPage.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')); };
    set('fAuthor', 'Edited Author');
    set('fTags', 'pdf, docx');
  });
  const preview = await exportPage.$eval('#doc table.castmd-meta', el => el.textContent);
  assert.match(preview, /Edited Author/);

  await exportPage.evaluate(() => document.getElementById('htmlBtn').click());
  const file = await waitForDownload(chrome.downloadDir, 'Export Fixture.html');
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /<meta name="author" content="Edited Author">/);
  assert.match(html, /<meta name="keywords" content="pdf, docx">/);
  assert.match(html, /<h1 class="castmd-title">Export Fixture<\/h1>/);
  assert.equal((html.match(/<img src="data:image\//g) || []).length, 4, 'self-contained: no remote images');
  assert.match(html, /@top-center \{ content: "Export Fixture"/);
  assert.equal(/<script/i.test(html), false);
});

test('.docx has images, table, lists, metadata and header/footer fields', async (t) => {
  await exportPage.evaluate(() => document.getElementById('docxBtn').click());
  const file = await waitForDownload(chrome.downloadDir, 'Export Fixture.docx', 30_000);
  const parts = await readZip(file);

  assert.deepEqual(Object.keys(parts).filter(p => p.startsWith('word/media/')).sort(),
    ['word/media/image1.png', 'word/media/image2.png', 'word/media/image3.png', 'word/media/image4.png']);
  assert.match(parts['docProps/core.xml'], /<dc:creator>Edited Author<\/dc:creator>/);
  assert.match(parts['word/header1.xml'], /Export Fixture/);
  assert.match(parts['word/footer1.xml'], /<w:fldSimple w:instr=" PAGE ">/);

  if (!has('pandoc')) { t.skip('pandoc not installed'); return; }
  const md = execFileSync('pandoc', [file, '-t', 'gfm', '--wrap=none'], { encoding: 'utf8' });
  const standalone = execFileSync('pandoc', [file, '-s', '-t', 'markdown'], { encoding: 'utf8' });
  assert.match(standalone, /^title: Export Fixture$/m, 'Word Title style is the document title');
  assert.match(md, /^## Diagram$/m);
  assert.match(md, /\*\*bold\*\*/);
  assert.match(md, /\[relative link\]\(http:\/\/127\.0\.0\.1:\d+\/relative\/link\)/);
  assert.match(md, /- first bullet\n\s+- nested bullet/);
  assert.match(md, /1\. +step one/);
  assert.match(md, /Header and footer/);
  assert.match(md, /const answer = 42;/);
  assert.equal((md.match(/media\/image\d\.png/g) || []).length, 4);
  assert.match(md, /Edited Author/);
});

test('LibreOffice renders the .docx with header and page-number footer', { skip: !has('soffice') }, async () => {
  const file = path.join(chrome.downloadDir, 'Export Fixture.docx');
  execFileSync('soffice', [`-env:UserInstallation=file://${workDir}/lo-profile`, '--headless',
    '--convert-to', 'pdf', '--outdir', workDir, file], { stdio: 'ignore', timeout: 90_000 });
  const text = execFileSync('pdftotext', ['-enc', 'UTF-8', '-layout', path.join(workDir, 'Export Fixture.pdf'), '-'], { encoding: 'utf8' });
  assert.match(text, /Export Fixture/);
  assert.match(text, /Page 1 of \d/);
  assert.match(text, /Header and footer/);
});

test('print to PDF carries header, footer and page numbers, not the side panel', { skip: !has('pdftotext', ['-v']) }, async () => {
  const pdfPath = path.join(workDir, 'print.pdf');
  await exportPage.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
  const text = execFileSync('pdftotext', ['-enc', 'UTF-8', '-layout', pdfPath, '-'], { encoding: 'utf8' });
  const pages = text.split('\f').filter(p => p.trim());
  assert.match(pages[0], /Export Fixture/);
  assert.match(pages[0], new RegExp(`127\\.0\\.0\\.1 +· +Page 1 of ${pages.length}`));
  assert.match(text, /Header and footer/);
  assert.doesNotMatch(text, /Download \.docx|Show metadata block/, 'the form panel is not printed');
});
