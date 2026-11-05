// Brand presets: validation of untrusted brand files, on/off toggles, the
// print margin-box CSS, and the branded DOCX parts (logo header, contact
// footer, brand typefaces in styles, embedded obfuscated fonts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './setup.js';

for (const lib of ['lib/export-sanitize.js', 'lib/brand-preset.js', 'lib/export-document.js', 'lib/html-to-docx-inline.js', 'lib/html-to-docx-body.js',
  'lib/html-to-docx-table.js', 'lib/docx-image-run.js', 'lib/docx-brand-parts.js', 'lib/docx-package.js']) loadLib(lib);
const { validateBrand, resolveBrand, defaultToggles, contactLines } = globalThis.BrandPreset;
const Doc = globalThis.ExportDocument;
const { build } = globalThis.DocxPackage;
const { obfuscate, dataUrlBytes } = globalThis.DocxBrandParts;

const FONT = 'data:font/ttf;base64,' + Buffer.from(Array.from({ length: 64 }, (_, i) => i)).toString('base64');
const LOGO = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"/>').toString('base64');
const RAW = {
  castmdBrand: 1, id: 'acme', name: 'Acme', header: '{title}', footer: 'Page {page} of {pages}',
  logo: { src: LOGO, alt: 'Acme', aspect: 2 },
  colors: { accent: '#EFC427', tableHeader: '#FFF7CC' },
  fonts: { heading: { family: 'Acme Display', files: { bold: FONT } }, body: { family: 'Acme Sans', files: { regular: FONT, bold: FONT } } },
  fields: [
    { id: 'hq', label: 'HQ', value: '1 Main St', line: 1 },
    { id: 'web', value: 'acme.test', href: 'https://acme.test', line: 2 },
    { id: 'email', value: 'hi@acme.test', href: 'mailto:hi@acme.test', line: 2 },
  ],
};
const META = { title: 'Report', url: 'https://src.test/a', captured: '2026-11-06' };

test('validateBrand accepts the documented shape', () => {
  const b = validateBrand(RAW);
  assert.equal(b.name, 'Acme');
  assert.equal(b.colors.accent, '#EFC427');
  assert.equal(b.colors.text, '#1D1D1F', 'missing colors fall back to defaults');
  assert.deepEqual(Object.keys(b.fonts), ['heading', 'body']);
  assert.equal(b.fields.length, 3);
});

test('validateBrand rejects values that would reach CSS or OOXML unescaped', () => {
  const bad = (patch, re) => assert.throws(() => validateBrand({ ...RAW, ...patch }), re);
  bad({ castmdBrand: 2 }, /Not a castmd brand file/);
  bad({ id: 'Acme Corp' }, /id must be/);
  bad({ colors: { accent: 'red;} body{display:none' } }, /colors.accent must be #RRGGBB/);
  bad({ logo: { src: 'https://evil.test/x.svg', aspect: 2 } }, /logo.src/);
  bad({ logo: { src: LOGO } }, /logo.aspect/);
  bad({ fonts: { body: { family: "x'; } *{", files: { regular: FONT } } } }, /plain font name/);
  bad({ fonts: { body: { family: 'Sans', files: { regular: 'data:font/ttf;base64,AA")' } } } }, /TTF\/OTF data URL/);
  bad({ fields: [{ id: 'x', value: 'a', href: 'javascript:alert(1)' }] }, /href must be/);
  bad({ fields: [{ id: 'x', value: 'a' }, { id: 'x', value: 'b' }] }, /repeated/);
  bad({ fonts: { body: { family: 'Phông"Chữ', files: { regular: FONT } } } }, /plain font name/);
});

test('validateBrand accepts font families with Vietnamese letters', () => {
  // Regression: the editor reads the family from the font file, and an ASCII-only
  // check refused to save any font named in Vietnamese.
  const fonts = { heading: { family: 'Phông Chữ Đẹp', files: { regular: FONT } } };
  assert.equal(validateBrand({ ...RAW, fonts }).fonts.heading.family, 'Phông Chữ Đẹp');
  const nfd = 'Phông Chữ'.normalize('NFD');   // combining marks, as some name tables store them
  assert.equal(validateBrand({ ...RAW, fonts: { heading: { family: nfd, files: { regular: FONT } } } }).fonts.heading.family, nfd);
});

test('toggles switch off logo, fonts and single fields', () => {
  const b = validateBrand(RAW);
  const t = defaultToggles(b);
  assert.deepEqual(t, { logo: true, fonts: true, fields: { hq: true, web: true, email: true } });
  const view = resolveBrand(b, { logo: false, fonts: false, fields: { hq: true, web: false, email: true } });
  assert.equal(view.logo, null);
  assert.equal(view.fonts, null);
  assert.deepEqual(contactLines(view), [[{ text: 'HQ: 1 Main St', href: '' }], [{ text: 'hi@acme.test', href: 'mailto:hi@acme.test' }]]);
});

test('branded print CSS: logo, header, contact block, page counters, brand fonts', () => {
  const view = resolveBrand(validateBrand(RAW));
  const css = Doc.documentCss({ header: '{title}', footer: 'Page {page} of {pages}', brand: view }, META);
  assert.match(css, /@top-left \{ content: url\("data:image\/svg\+xml,/);
  assert.match(css, /@top-right \{ content: "Report"/);
  assert.match(css, /@bottom-left \{ content: "HQ: 1 Main St" "\\A" "acme.test  ·  hi@acme.test"; white-space: pre;/);
  assert.match(css, /@bottom-right \{ content: "Page " counter\(page\) " of " counter\(pages\)/);
  assert.match(css, /@font-face \{ font-family: 'Acme Display'; src: url\(data:font\/ttf;base64,[^)]+\); font-weight: 700;/);
  assert.match(css, /\.castmd-doc h1, .*\{ font-family: 'Acme Display', 'Acme Sans', sans-serif; \}/);
  assert.match(css, /border-bottom: 2px solid #EFC427/);

  const plain = Doc.documentCss({ header: '{title}', footer: '', brand: null }, META);
  assert.equal(plain.includes('@top-left'), false);
});

test('branded preview bars carry the logo and linked contact lines', () => {
  const view = resolveBrand(validateBrand(RAW));
  const html = Doc.articleHtml({ bodyHtml: '<p>x</p>', meta: META, includeMeta: false, brand: view, header: '{title} | {page}' });
  assert.match(html, /^<div class="castmd-brand-bar top"><img src="data:image\/svg\+xml;base64,[^"]+" alt="Acme"><span>Report \|<\/span><\/div>/);
  assert.match(html, /<a href="https:\/\/acme.test">acme.test<\/a> &middot; <a href="mailto:hi@acme.test">hi@acme.test<\/a>/);
});

test('font obfuscation is the ECMA-376 XOR and reverses itself', () => {
  const bytes = dataUrlBytes(FONT);
  const guid = '{00112233-4455-6677-8899-AABBCCDDEEFF}';
  const out = obfuscate(bytes, guid);
  assert.equal(out[0], bytes[0] ^ 0xFF, 'byte 0 uses the last GUID byte');
  assert.equal(out[15], bytes[15] ^ 0x00);
  assert.equal(out[16], bytes[16] ^ 0xFF, 'key repeats over the first 32 bytes');
  assert.deepEqual(Array.from(out.slice(32)), Array.from(bytes.slice(32)), 'the rest is untouched');
  assert.deepEqual(Array.from(obfuscate(out, guid)), Array.from(bytes));
});

test('branded docx: logo header, contact footer, typefaces, embedded fonts', () => {
  const view = resolveBrand(validateBrand(RAW));
  const logoPng = new Uint8Array([137, 80, 78, 71]);
  const entries = build({
    bodyHtml: '<table><tr><th>A</th></tr></table>', meta: META, includeMeta: false, brand: view,
    header: '{title}', footer: 'Page {page} of {pages}',
    images: { [LOGO]: { bytes: logoPng, ext: 'png', width: 400, height: 200 } },
  });
  const part = (p) => entries.find(e => e.path === p)?.content;
  assert.match(part('word/header1.xml'), /<a:blip r:embed="rIdLogo"\/>.*<w:tab\/><\/w:r><w:r><w:t xml:space="preserve">Report</);
  assert.match(part('word/header1.xml'), /<w:bottom w:val="single" w:sz="12" w:space="4" w:color="EFC427"\/>/);
  assert.match(part('word/_rels/header1.xml.rels'), /Target="media\/brand-logo.png"/);
  assert.equal(part('word/media/brand-logo.png'), logoPng);
  const footer = part('word/footer1.xml');
  assert.match(footer, /HQ: 1 Main St<\/w:t><\/w:r><w:r><w:tab\/><\/w:r><w:r><w:t xml:space="preserve">Page <\/w:t>/);
  assert.match(footer, /acme.test  ·  hi@acme.test/);
  const styles = part('word/styles.xml');
  assert.match(styles, /<w:rPrDefault><w:rPr><w:rFonts w:ascii="Acme Sans"/);
  assert.match(styles, /w:styleId="Title">.*?<w:rFonts w:ascii="Acme Display"/);
  assert.match(part('word/document.xml'), /<w:shd w:val="clear" w:color="auto" w:fill="FFF7CC"\/>/);
  const fontTable = part('word/fontTable.xml');
  assert.match(fontTable, /<w:font w:name="Acme Display">.*<w:embedBold r:id="rIdFont1" w:fontKey="\{[0-9A-F-]{36}\}"\/>/);
  assert.match(fontTable, /<w:font w:name="Acme Sans">.*<w:embedRegular r:id="rIdFont2".*<w:embedBold r:id="rIdFont3"/);
  assert.equal(entries.filter(e => /^word\/fonts\/font\d\.odttf$/.test(e.path)).length, 3);
  assert.match(part('word/settings.xml'), /<w:embedTrueTypeFonts\/>/);
  assert.match(part('[Content_Types].xml'), /Extension="odttf" ContentType="application\/vnd.openxmlformats-officedocument.obfuscatedFont"/);
  assert.match(part('word/_rels/document.xml.rels'), /Target="fontTable.xml"/);
});

test('brand with logo and fonts switched off adds no font parts and no logo', () => {
  const view = resolveBrand(validateBrand(RAW), { logo: false, fonts: false, fields: {} });
  const entries = build({ bodyHtml: '<p>x</p>', meta: META, includeMeta: false, brand: view, header: '', footer: '', images: {} });
  assert.equal(entries.some(e => e.path.includes('fontTable') || e.path.includes('brand-logo')), false);
  assert.match(entries.find(e => e.path === 'word/styles.xml').content, /<w:rFonts w:ascii="Georgia"/);
});
