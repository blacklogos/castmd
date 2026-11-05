// Walks sanitized export HTML (lib/export-sanitize.js output) and emits the
// <w:body> content of a DOCX document.xml: paragraphs, headings, runs with
// formatting, hyperlinks, bullet/numbered lists, code blocks, quotes, tables
// (colspan + rowspan) and inline images.
//
// Inline runs, hyperlinks and the XML escaper live in lib/html-to-docx-inline.js,
// tables in lib/html-to-docx-table.js, images in lib/docx-image-run.js.
// The walker records side effects on `pkg`, which lib/docx-package.js turns
// into package parts: pkg.rels (hyperlinks, images), pkg.media, pkg.orderedLists.

(function (global) {
  'use strict';

  const { BLOCK, xml, inlineItems, gatherInline, prepare, runs } = global.HtmlToDocxInline;
  const HEADING = { h1: 'Heading1', h2: 'Heading2', h3: 'Heading3', h4: 'Heading4', h5: 'Heading5', h6: 'Heading6' };
  // Borders set on the table itself, not only through the TableGrid style:
  // Pages and Quick Look ignore style-level table borders.
  const TABLE_PR = '<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(e => `<w:${e} w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>`).join('') +
    '</w:tblBorders></w:tblPr>';

  // tableHeaderFill: hex fill for <th> cells (brand color), default light gray.
  function createPackageState(images, tableHeaderFill) {
    return { rels: [], media: [], orderedLists: [], images: images || {}, nextId: 1, mediaBySrc: {},
      tableHeaderFill: tableHeaderFill || 'F2F2F4' };
  }

  // ctx: { style, list: { numId, ilvl, used }, inTable }
  function blocks(node, pkg, ctx) {
    let out = '';
    let items = [];
    const flush = () => { out += paragraph(items, pkg, ctx); items = []; };
    for (const child of Array.from(node.childNodes)) {
      const tag = child.nodeType === 1 ? child.tagName.toLowerCase() : '';
      if (!BLOCK.has(tag)) { gatherInline(child, {}, items); continue; }
      flush();
      out += block(child, tag, pkg, ctx);
    }
    flush();
    return out;
  }

  function block(el, tag, pkg, ctx) {
    if (HEADING[tag]) return paragraph(inlineItems(el), pkg, { ...ctx, style: HEADING[tag] });
    if (tag === 'ul' || tag === 'ol') return list(el, tag === 'ol', pkg, ctx);
    if (tag === 'pre') return codeBlock(el.textContent);
    if (tag === 'table') return global.HtmlToDocxTable.table(el, pkg, { blocks, paragraph, inlineItems });
    if (tag === 'hr') return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BBBBBB"/></w:pBdr></w:pPr></w:p>';
    if (tag === 'blockquote') return blocks(el, pkg, { ...ctx, style: 'Quote' });
    if (tag === 'figcaption' || tag === 'caption') return paragraph(inlineItems(el), pkg, { ...ctx, style: 'Caption' });
    if (tag === 'dt') return paragraph(inlineItems(el, { bold: true }), pkg, ctx);
    return blocks(el, pkg, ctx);   // p, div, figure, li, dl, dd, table sections
  }

  function list(el, ordered, pkg, ctx) {
    const ilvl = ctx.list ? Math.min(ctx.list.ilvl + 1, 8) : 0;
    let numId = 1;   // shared bullet numbering
    if (ordered) {
      numId = 2 + pkg.orderedLists.length;   // each <ol> restarts its own count
      pkg.orderedLists.push({ numId, start: parseInt(el.getAttribute('start'), 10) || 1 });
    }
    let out = '';
    for (const li of Array.from(el.children)) {
      if (li.tagName.toLowerCase() !== 'li') { out += block(li, li.tagName.toLowerCase(), pkg, ctx); continue; }
      out += blocks(li, pkg, { ...ctx, style: null, list: { numId, ilvl, used: false } });
    }
    return out;
  }

  function codeBlock(text) {
    const lines = text.replace(/\n$/, '').split('\n');
    const runs = lines.map((line, i) =>
      (i ? '<w:r><w:br/></w:r>' : '') + `<w:r><w:t xml:space="preserve">${xml(line.replace(/\t/g, '    '))}</w:t></w:r>`
    ).join('');
    return `<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>${runs}</w:p>`;
  }

  function paragraph(items, pkg, ctx) {
    items = prepare(items);
    const inList = ctx.list;
    if (!items.length) return '';   // whitespace between blocks; never an empty bullet
    let pPr = ctx.style ? `<w:pStyle w:val="${ctx.style}"/>` : '';
    if (inList && !inList.used) {
      pPr += `<w:numPr><w:ilvl w:val="${inList.ilvl}"/><w:numId w:val="${inList.numId}"/></w:numPr>`;
      inList.used = true;
    } else if (inList) {
      pPr += `<w:ind w:left="${720 * (inList.ilvl + 1)}"/>`;   // later paragraphs of the same item
    }
    return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${runs(items, pkg)}</w:p>`;
  }

  global.HtmlToDocxBody = { createPackageState, blocks, paragraph, xml, TABLE_PR };
})(window);
