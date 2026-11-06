// DOCX tables for lib/html-to-docx-body.js: header rows (repeat on each page),
// header cell shading, colspan (gridSpan) and rowspan (vMerge). A rowspan cell
// opens a vertical merge; the rows it covers get empty continuation cells at
// the same column, which is what Word requires instead of a skipped cell.
// Cell contents go back through the body walker passed in as `api`.

(function (global) {
  'use strict';

  function table(el, pkg, api) {
    const { blocks, paragraph, inlineItems } = api;
    const rows = Array.from(el.querySelectorAll('tr')).filter(tr => tr.closest('table') === el);
    if (!rows.length) return '';
    const caption = Array.from(el.children).find(c => c.tagName.toLowerCase() === 'caption');
    const width = Math.max(...rows.map(tr => cellsOf(tr).reduce((n, c) => n + span(c, 'colspan'), 0)));
    const colW = Math.floor(5000 / width);
    const pending = new Array(width).fill(0);   // rowspan cells still covering a column
    let body = '';
    for (const tr of rows) {
      const cells = cellsOf(tr);
      let col = 0, rowXml = '';
      const emitMerged = () => {
        while (col < width && pending[col] > 0) {
          pending[col]--; col++;
          rowXml += `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="pct"/><w:vMerge/></w:tcPr><w:p/></w:tc>`;
        }
      };
      for (const cell of cells) {
        emitMerged();
        const cs = span(cell, 'colspan'), rs = span(cell, 'rowspan');
        const header = cell.tagName.toLowerCase() === 'th';
        let tcPr = `<w:tcW w:w="${colW * cs}" w:type="pct"/>`;
        if (cs > 1) tcPr += `<w:gridSpan w:val="${cs}"/>`;
        if (rs > 1) { tcPr += '<w:vMerge w:val="restart"/>'; for (let k = 0; k < cs; k++) pending[col + k] = rs - 1; }
        if (header) tcPr += `<w:shd w:val="clear" w:color="auto" w:fill="${pkg.tableHeaderFill}"/>`;
        const content = header ? headerCellBlocks(cell, pkg, api) : blocks(cell, pkg, { inTable: true });
        rowXml += `<w:tc><w:tcPr>${tcPr}</w:tcPr>${content || '<w:p/>'}</w:tc>`;
        col += cs;
      }
      emitMerged();
      const isHeader = cells.length && cells.every(c => c.tagName.toLowerCase() === 'th');
      body += `<w:tr>${isHeader ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${rowXml}</w:tr>`;
    }
    const grid = '<w:tblGrid>' + `<w:gridCol w:w="${Math.floor(9866 / width)}"/>`.repeat(width) + '</w:tblGrid>';
    const tbl = `<w:tbl>${global.HtmlToDocxBody.TABLE_PR}${grid}${body}</w:tbl>`;
    const cap = caption ? paragraph(inlineItems(caption), pkg, { style: 'Caption' }) : '';
    return cap + tbl + '<w:p/>';   // Word needs a paragraph between adjacent tables
  }

  function headerCellBlocks(cell, pkg, { paragraph, inlineItems }) {
    return paragraph(inlineItems(cell, { bold: true }), pkg, {});
  }

  function cellsOf(tr) {
    return Array.from(tr.children).filter(c => /^t[dh]$/i.test(c.tagName));
  }

  function span(cell, attr) {
    return Math.max(1, Math.min(parseInt(cell.getAttribute(attr), 10) || 1, 50));
  }

  global.HtmlToDocxTable = { table };
})(window);
