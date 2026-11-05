// Unit tests for the export pipeline libs: sanitizer, document builder, DOCX
// package. Real DOM via linkedom (tests/setup.js); the DOCX output is checked
// at the XML level here and opened by pandoc/LibreOffice in the e2e suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './setup.js';

loadLib('lib/export-sanitize.js');
loadLib('lib/export-document.js');
loadLib('lib/html-to-docx-inline.js');
loadLib('lib/html-to-docx-body.js');
loadLib('lib/html-to-docx-table.js');
loadLib('lib/docx-image-run.js');
loadLib('lib/brand-preset.js');
loadLib('lib/docx-brand-parts.js');
loadLib('lib/docx-package.js');
const { sanitize } = globalThis.ExportSanitize;
const Doc = globalThis.ExportDocument;
const { build } = globalThis.DocxPackage;

const META = { title: 'Fish & "Chips"', url: 'https://example.com/a', author: 'Ann', captured: '2026-11-06', siteName: 'example.com', tags: 'food' };
const part = (entries, path) => entries.find(e => e.path === path)?.content;

test('sanitize drops scripts, handlers and unsafe URLs, keeps content', () => {
  const out = sanitize('<section onclick="x()"><h2 style="color:red">Hi</h2><script>alert(1)</script>' +
    '<p>a <a href="javascript:alert(1)">bad</a> <a href="https://ok.test/">ok</a></p>' +
    '<img src="javascript:x"><img src="https://cdn.test/a.png" onerror="x()" width="10">' +
    '<custom-el><span>kept text</span></custom-el><iframe src="https://x"></iframe></section>');
  assert.equal(out.includes('script'), false);
  assert.equal(out.includes('onclick'), false);
  assert.equal(out.includes('onerror'), false);
  assert.equal(out.includes('javascript:'), false);
  assert.equal(out.includes('iframe'), false);
  assert.match(out, /^<div><h2>Hi<\/h2>/);
  assert.match(out, /<a href="https:\/\/ok.test\/">ok<\/a>/);
  assert.match(out, /<img src="https:\/\/cdn.test\/a.png" width="10">/);
  assert.equal((out.match(/<img/g) || []).length, 1, 'img left without a safe src is removed');
  assert.match(out, /kept text/);
});

test('sanitize keeps data:image sources and table spans', () => {
  const out = sanitize('<table><tr><td colspan="2" class="x">a</td></tr></table><img src="data:image/svg+xml;charset=utf-8,%3Csvg%3E"><img src="data:text/html,x">');
  assert.match(out, /<td colspan="2">a<\/td>/);
  assert.match(out, /data:image\/svg\+xml/);
  assert.equal(out.includes('data:text/html'), false);
});

test('header/footer tokens expand text and keep page fields live', () => {
  assert.deepEqual(Doc.splitPageTokens('{title} | {page}/{pages}', META),
    [{ text: 'Fish & "Chips" | ' }, { field: 'PAGE' }, { text: '/' }, { field: 'NUMPAGES' }]);
  const css = Doc.pageCss({ header: '{title}', footer: 'Page {page} of {pages}' }, META);
  assert.match(css, /@top-center \{ content: "Fish & \\"Chips\\""/);
  assert.match(css, /@bottom-center \{ content: "Page " counter\(page\) " of " counter\(pages\)/);
  assert.equal(Doc.pageCss({ header: '', footer: ' ' }, META).includes('@top-center'), false);
});

test('standalone html escapes metadata and includes the meta table', () => {
  const html = Doc.standaloneHtml({ bodyHtml: '<p>Body</p>', meta: META, includeMeta: true, header: '{title}', footer: '' });
  assert.match(html, /<title>Fish &amp; &quot;Chips&quot;<\/title>/);
  assert.match(html, /<meta name="author" content="Ann">/);
  assert.match(html, /<th>Source<\/th><td><a href="https:\/\/example.com\/a">/);
  assert.match(html, /<p>Body<\/p>/);
  const bare = Doc.standaloneHtml({ bodyHtml: '', meta: META, includeMeta: false, header: '', footer: '' });
  assert.equal(bare.includes('castmd-meta"'), false);
});

test('docx: headings, runs, links, lists, code, table spans, images, metadata', () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const entries = build({
    meta: META, includeMeta: true, header: '{title}', footer: 'Page {page} of {pages}',
    images: { 'https://cdn.test/a.png': { bytes: png, ext: 'png', width: 2000, height: 1000 } },
    bodyHtml: sanitize('<h2>Intro</h2><p>Hello <strong>bold</strong> <a href="https://x.test/">link</a> &amp; <code>x&lt;y</code></p>' +
      '<ul><li>one<ul><li>nested</li></ul></li><li><p>two</p></li></ul><ol start="3"><li>three</li></ol>' +
      '<pre>line 1\n  line 2</pre><table><tr><th>A</th><th>B</th></tr><tr><td rowspan="2">r</td><td>1</td></tr><tr><td>2</td></tr></table>' +
      '<p><img src="https://cdn.test/a.png" alt="Chart"> <img src="https://missing.test/b.png" alt="Gone"></p>'),
  });
  const doc = part(entries, 'word/document.xml');
  assert.match(doc, /<w:pStyle w:val="Title"\/><\/w:pPr><w:r><w:t xml:space="preserve">Fish &amp; &quot;Chips&quot;/);
  assert.match(doc, /<w:pStyle w:val="Heading2"\/><\/w:pPr><w:r><w:t xml:space="preserve">Intro</);
  assert.match(doc, /<w:b\/><\/w:rPr><w:t xml:space="preserve">bold</);
  assert.match(doc, /<w:hyperlink r:id="rIdc\d+"><w:r><w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr><w:t xml:space="preserve">link</);
  assert.match(doc, /Consolas"\/><\/w:rPr><w:t xml:space="preserve">x&lt;y</);
  assert.match(doc, /<w:ilvl w:val="1"\/><w:numId w:val="1"\/><\/w:numPr><\/w:pPr><w:r><w:t xml:space="preserve">nested/);
  assert.match(doc, /<w:numId w:val="2"\/><\/w:numPr><\/w:pPr><w:r><w:t xml:space="preserve">three/);
  assert.match(doc, /line 1<\/w:t><\/w:r><w:r><w:br\/><\/w:r><w:r><w:t xml:space="preserve">  line 2/);
  assert.match(doc, /<w:vMerge w:val="restart"\/>/);
  assert.match(doc, /<w:tcPr><w:tcW w:w="2500" w:type="pct"\/><w:vMerge\/><\/w:tcPr>/);
  assert.match(doc, /<wp:extent cx="6264720" cy="3132360"\/>/, 'image scaled to content width, ratio kept');
  assert.match(doc, /\[Image: Gone\]/);
  assert.match(doc, /<w:t xml:space="preserve">Source<\/w:t>/);
  assert.equal((doc.match(/<w:numPr>/g) || []).length, 4, 'one number per item, no empty bullets');

  assert.match(part(entries, 'word/numbering.xml'), /<w:num w:numId="2"><w:abstractNumId w:val="1"\/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"\/>/);
  assert.match(part(entries, 'word/footer1.xml'), /Page <\/w:t><\/w:r><w:fldSimple w:instr=" PAGE ">.*of <\/w:t><\/w:r><w:fldSimple w:instr=" NUMPAGES ">/);
  assert.match(part(entries, 'word/header1.xml'), /Fish &amp; &quot;Chips&quot;/);
  const core = part(entries, 'docProps/core.xml');
  assert.match(core, /<dc:creator>Ann<\/dc:creator>/);
  assert.match(core, /<cp:keywords>food<\/cp:keywords>/);
  assert.match(core, /<dcterms:created xsi:type="dcterms:W3CDTF">2026-11-06T00:00:00Z/);
  const rels = part(entries, 'word/_rels/document.xml.rels');
  assert.match(rels, /Target="media\/image1.png"/);
  assert.match(rels, /Target="https:\/\/x.test\/" TargetMode="External"/);
  assert.equal(part(entries, 'word/media/image1.png'), png);
});

test('docx strips characters XML 1.0 forbids', () => {
  const entries = build({ meta: { title: 'a\u0000b' }, bodyHtml: '<p>c\u0007d</p>', includeMeta: false, header: '', footer: '', images: {} });
  const doc = part(entries, 'word/document.xml');
  assert.match(doc, />ab</);
  assert.match(doc, />cd</);
});
