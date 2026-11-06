// Inline content for lib/html-to-docx-body.js: text, formatting, line breaks,
// hyperlinks and images inside one paragraph, plus the XML escaper and the
// relationship counter both walkers share.
//
// Inline content is gathered as items first and only turned into runs when a
// paragraph is flushed, so leading/trailing whitespace can be trimmed per
// paragraph the way a browser collapses it.

(function (global) {
  'use strict';

  const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre',
    'table', 'figure', 'figcaption', 'hr', 'dl', 'dt', 'dd', 'caption', 'thead', 'tbody', 'tfoot', 'tr']);
  const INVALID_XML = /[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu;

  function xml(text) {
    return String(text).replace(INVALID_XML, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function addRel(pkg, type, target, external) {
    const id = 'rIdc' + pkg.rels.length;
    pkg.rels.push({ id, type, target, external: !!external });
    return id;
  }

  function inlineItems(el, fmt) {
    const items = [];
    for (const child of Array.from(el.childNodes)) gatherInline(child, fmt || {}, items);
    return items;
  }

  function gatherInline(node, fmt, items) {
    if (node.nodeType === 3) {
      const text = node.textContent.replace(/\s+/g, ' ');
      if (text) items.push({ text, fmt });
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') { items.push({ br: true }); return; }
    if (tag === 'img') { items.push({ img: node, fmt }); return; }
    if (BLOCK.has(tag)) { items.push({ text: ' ', fmt }); }   // a block inside a heading or cell
    const next = { ...fmt };
    if (tag === 'strong' || tag === 'b') next.bold = true;
    if (tag === 'em' || tag === 'i' || tag === 'q') next.italic = true;
    if (tag === 'u' || tag === 'ins') next.underline = true;
    if (tag === 's' || tag === 'del') next.strike = true;
    if (tag === 'code' || tag === 'kbd' || tag === 'samp') next.code = true;
    if (tag === 'sup') next.vert = 'superscript';
    if (tag === 'sub') next.vert = 'subscript';
    if (tag === 'mark') next.highlight = true;
    if (tag === 'a' && /^(https?:|mailto:)/i.test(node.getAttribute('href') || '')) next.href = node.getAttribute('href');
    for (const child of Array.from(node.childNodes)) gatherInline(child, next, items);
  }

  // Adjacent text with the same formatting becomes one run (parsers split text
  // nodes at entities and comments).
  function mergeText(items) {
    const out = [];
    for (const it of items) {
      const prev = out[out.length - 1];
      if (prev && prev.text != null && it.text != null && prev.fmt === it.fmt) prev.text += it.text;
      else out.push(it.text != null ? { ...it } : it);
    }
    return out;
  }

  // Collapse whitespace across item boundaries and trim the paragraph ends.
  function trimItems(items) {
    let prevSpace = true;
    for (const it of items) {
      if (it.text == null) { prevSpace = !!it.br; continue; }
      if (prevSpace) it.text = it.text.replace(/^ /, '');
      if (it.text) prevSpace = it.text.endsWith(' ');
    }
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].text == null) break;
      items[i].text = items[i].text.replace(/ $/, '');
      if (items[i].text) break;
    }
    for (let i = items.length - 1; i >= 0; i--) if (items[i].text === '') items.splice(i, 1);
  }

  function runs(items, pkg) {
    let out = '';
    let i = 0;
    while (i < items.length) {
      const href = items[i].fmt && items[i].fmt.href;
      if (!href) { out += run(items[i], pkg); i++; continue; }
      let group = '';
      while (i < items.length && items[i].fmt && items[i].fmt.href === href) { group += run(items[i], pkg, true); i++; }
      const id = addRel(pkg, 'hyperlink', href, true);
      out += `<w:hyperlink r:id="${id}">${group}</w:hyperlink>`;
    }
    return out;
  }

  function run(item, pkg, link) {
    if (item.br) return '<w:r><w:br/></w:r>';
    if (item.img) return global.DocxImageRun.imageRun(item.img, pkg, { xml, addRel });
    const f = item.fmt || {};
    let rPr = link ? '<w:rStyle w:val="Hyperlink"/>' : '';
    if (f.code) rPr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>';
    if (f.bold) rPr += '<w:b/>';
    if (f.italic) rPr += '<w:i/>';
    if (f.strike) rPr += '<w:strike/>';
    if (f.underline && !link) rPr += '<w:u w:val="single"/>';
    if (f.highlight) rPr += '<w:highlight w:val="yellow"/>';
    if (f.vert) rPr += `<w:vertAlign w:val="${f.vert}"/>`;
    return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(item.text)}</w:t></w:r>`;
  }

  // Items ready for runs(): same-format text merged, whitespace collapsed.
  function prepare(items) {
    items = mergeText(items);
    trimItems(items);
    return items;
  }

  global.HtmlToDocxInline = { BLOCK, xml, addRel, inlineItems, gatherInline, prepare, runs };
})(window);
