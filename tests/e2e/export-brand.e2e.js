// E2E: brand presets on the export page. Importing a .castmd-brand.json,
// the on/off toggles (persisted across reloads), branded PDF and DOCX output,
// the "View style" dialog, and the brand editor (create, validate, export,
// edit). Fixture brand "Acme" is made up; real brands never live in the repo.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { waitForDownload } from './helpers/chrome.js';
import { readZip } from './helpers/zip.js';
import { fakeFontBytes } from './helpers/fake-font.js';
import { openExportPage, has, waitReady } from './helpers/export-page.js';

let chrome, exportPage, workDir, ctx;

before(async () => {
  ctx = await openExportPage();
  ({ chrome, exportPage, workDir } = ctx);
});

after(async () => { await ctx?.close(); });

const BRAND_FILE = new URL('./fixtures/acme.castmd-brand.json', import.meta.url).pathname;
const brandState = () => exportPage.evaluate(() => ({
  selected: document.getElementById('brandSelect').value,
  header: document.getElementById('fHeader').value,
  footer: document.getElementById('fFooter').value,
  toggles: Array.from(document.querySelectorAll('#brandToggles input')).map(i => i.parentElement.textContent.trim() + '=' + i.checked),
  logo: !!document.querySelector('#doc .castmd-brand-bar.top img'),
  bottom: document.querySelector('#doc .castmd-brand-bar.bottom')?.textContent || '',
}));

test('importing a brand file applies logo, contact block and its templates', async () => {
  const input = await exportPage.$('#brandFile');
  await input.uploadFile(BRAND_FILE);
  await exportPage.waitForFunction(() => /Imported brand preset "Acme"/.test(document.getElementById('status').textContent),
    { timeout: 10_000, polling: 100 });
  const s = await brandState();
  assert.equal(s.selected, 'acme');
  assert.equal(s.header, '{title}');
  assert.equal(s.footer, 'Page {page} of {pages}');
  assert.deepEqual(s.toggles, ['Logo=true', 'HQ 1 Main Street, Springfield=true', 'Web acme.test=true', 'Email hello@acme.test=true']);
  assert.ok(s.logo);
  assert.match(s.bottom, /HQ: 1 Main Street, Springfield/);
  assert.match(s.bottom, /hello@acme\.test/);
});

test('switching a contact field off removes it, and the choice survives a reload', async () => {
  await exportPage.evaluate(() => {
    const box = Array.from(document.querySelectorAll('#brandToggles input')).find(i => i.parentElement.textContent.includes('hello@acme.test'));
    box.click();
  });
  assert.doesNotMatch((await brandState()).bottom, /hello@acme/);

  await exportPage.reload({ waitUntil: 'load' });
  await waitReady(exportPage);
  const s = await brandState();
  assert.equal(s.selected, 'acme', 'preset stays selected');
  assert.ok(s.toggles.includes('Email hello@acme.test=false'), 'toggle stays off');
  assert.doesNotMatch(s.bottom, /hello@acme/);
});

test('branded PDF: logo header and contact footer on every page', { skip: !has('pdftotext', ['-v']) }, async () => {
  const pdfPath = path.join(workDir, 'branded.pdf');
  await exportPage.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
  const text = execFileSync('pdftotext', ['-enc', 'UTF-8', '-layout', pdfPath, '-'], { encoding: 'utf8' });
  const pages = text.split('\f').filter(p => p.trim());
  pages.forEach((page, i) => {
    assert.match(page, /HQ: 1 Main Street, Springfield/, `page ${i + 1} footer`);
    assert.match(page, new RegExp(`Page ${i + 1} of ${pages.length}`));
  });
  assert.doesNotMatch(text, /hello@acme/, 'switched-off field is not printed');
});

test('branded .docx: logo in header, contact lines in footer, off field absent', async () => {
  for (const name of fs.readdirSync(chrome.downloadDir)) fs.rmSync(path.join(chrome.downloadDir, name), { force: true });
  await exportPage.evaluate(() => document.getElementById('docxBtn').click());
  const parts = await readZip(await waitForDownload(chrome.downloadDir, 'Export Fixture.docx', 30_000));
  assert.match(parts['word/_rels/header1.xml.rels'], /Target="media\/brand-logo.png"/, 'SVG logo rasterized to PNG');
  assert.ok(parts['word/media/brand-logo.png']);
  assert.match(parts['word/footer1.xml'], /HQ: 1 Main Street, Springfield/);
  assert.match(parts['word/footer1.xml'], /acme\.test/);
  assert.doesNotMatch(parts['word/footer1.xml'], /hello@acme/);
  assert.match(parts['word/document.xml'], /w:fill="FFF7CC"/, 'brand table header color');
});

// Brand style viewer and editor (no command-line builder needed).
const LOGO_FILE = new URL('./fixtures/acme-brand/logo.svg', import.meta.url).pathname;
const editor = (sel) => `#brandEditor ${sel}`;
const notice = () => exportPage.$eval(editor('.be-notice'), el => el.textContent);
async function upload(sel, file) {
  await (await exportPage.$(editor(sel))).uploadFile(file);
}

test('View style shows swatches, Vietnamese specimens and the header/footer mock', async () => {
  await exportPage.click('#viewBrandBtn');
  const v = await exportPage.$eval('#brandViewer', d => ({
    open: d.open,
    title: d.querySelector('h2').textContent,
    swatches: Array.from(d.querySelectorAll('.bv-swatch code')).map(c => c.textContent),
    specimen: d.querySelector('.bv-specimen').textContent,
    logo: !!d.querySelector('.bv-logo'),
    foot: d.querySelector('.bv-page-foot').textContent.replace(/\s+/g, ' '),
  }));
  assert.equal(v.open, true);
  assert.equal(v.title, 'Acme style');
  assert.equal(v.swatches.length, 4);
  assert.match(v.specimen, /Tiêu đề thương hiệu/);
  assert.ok(v.logo);
  assert.match(v.foot, /hello@acme\.test/, 'viewer shows every field, even ones switched off');
  assert.match(v.foot, /Page 1 of 2/);
  await exportPage.click('#brandViewer [data-act="close"]');
  assert.equal(await exportPage.$eval('#brandViewer', d => d.open), false);
});

test('brand editor refuses to save a preset without a name', async () => {
  await exportPage.click('#newBrandBtn');
  await exportPage.click(editor('[data-act="save"]'));
  assert.match(await notice(), /Cannot save: name is required/);
  assert.equal(await exportPage.$eval('#brandEditor', d => d.open), true, 'dialog stays open');
  await exportPage.click(editor('[data-act="cancel"]'));
});

test('brand editor creates a preset from browsed logo and font files', async () => {
  const fontPath = path.join(workDir, 'TestSans-Regular.ttf');
  fs.writeFileSync(fontPath, fakeFontBytes('Test Sans'));

  await exportPage.click('#newBrandBtn');
  await exportPage.type(editor('input[data-path="name"]'), 'Test Co');
  await upload('input[data-file="logo"]', LOGO_FILE);
  await exportPage.waitForSelector(editor('img.bv-logo'));
  await upload('input[data-file="font:heading:regular"]', fontPath);
  await exportPage.waitForFunction(() => /Heading font Regular: Test Sans/.test(document.querySelector('#brandEditor .be-notice').textContent));
  await exportPage.type(editor('input[data-path="fields.0.label"]'), 'Office');
  await exportPage.type(editor('input[data-path="fields.0.value"]'), '9 Đường Láng, Hà Nội');
  await exportPage.click(editor('[data-act="add-field"]'));
  await exportPage.type(editor('input[data-path="fields.1.value"]'), 'testco.example');
  await exportPage.type(editor('input[data-path="fields.1.href"]'), 'https://testco.example');
  await exportPage.select(editor('select[data-path="fields.1.line"]'), '2');
  await exportPage.click(editor('[data-act="save"]'));

  await exportPage.waitForFunction(() => !document.getElementById('brandEditor').open, { timeout: 5_000 });
  const s = await brandState();
  assert.equal(s.selected, 'test-co');
  assert.deepEqual(s.toggles, ['Logo=true', 'Brand typefaces Test Sans=true',
    'Office 9 Đường Láng, Hà Nội=true', 'Testco-example testco.example=true']);
  assert.ok(s.logo, 'preview shows the new logo');
  assert.match(s.bottom, /Office: 9 Đường Láng, Hà Nội/);
});

test('Export downloads the edited preset as a brand file that imports cleanly', async () => {
  for (const name of fs.readdirSync(chrome.downloadDir)) fs.rmSync(path.join(chrome.downloadDir, name), { force: true });
  await exportPage.click('#exportBrandBtn');
  const brand = JSON.parse(fs.readFileSync(await waitForDownload(chrome.downloadDir, 'test-co.castmd-brand.json'), 'utf8'));
  assert.equal(brand.castmdBrand, 1);
  assert.equal(brand.name, 'Test Co');
  assert.equal(brand.fonts.heading.family, 'Test Sans');
  assert.match(brand.logo.src, /^data:image\/svg\+xml;base64,/);
  assert.deepEqual(brand.fields.map(f => [f.id, f.line, f.href]),
    [['office', 1, ''], ['testco-example', 2, 'https://testco.example']]);
});

test('editing keeps the id and the off toggles, and renames the preset', async () => {
  await exportPage.evaluate(() => {
    Array.from(document.querySelectorAll('#brandToggles input')).find(i => i.parentElement.textContent.includes('testco.example')).click();
  });
  await exportPage.click('#editBrandBtn');
  assert.equal(await exportPage.$eval(editor('h2'), h => h.textContent), 'Edit brand');
  await exportPage.$eval(editor('input[data-path="name"]'), el => { el.value = ''; });
  await exportPage.type(editor('input[data-path="name"]'), 'Test Company');
  await exportPage.click(editor('[data-act="save"]'));
  await exportPage.waitForFunction(() => !document.getElementById('brandEditor').open, { timeout: 5_000 });

  const s = await brandState();
  assert.equal(s.selected, 'test-co', 'id kept on rename');
  assert.equal(await exportPage.$eval('#brandSelect', el => el.selectedOptions[0].textContent), 'Test Company');
  assert.ok(s.toggles.includes('Testco-example testco.example=false'), 'off toggle kept');
  assert.equal(await exportPage.$$eval('#brandSelect option', o => o.length), 3, 'None, Acme, Test Company');
});
