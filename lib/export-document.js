// Shared document model for the export page: the metadata block, the header and
// footer token expansion, the document CSS and the standalone .html file.
// Pure string building, no DOM, so the same output feeds the live preview, the
// downloaded .html, the print-to-PDF path, and (via metaRows / splitPageTokens)
// the DOCX builder.
//
// meta: { title, url, author, published, captured, siteName, description, tags, lang }
// Header/footer tokens: {title} {url} {date} {site} expand to text; {page} and
// {pages} stay live (CSS counters in print, PAGE/NUMPAGES fields in DOCX).

(function (global) {
  'use strict';

  const DOC_CSS = `
.castmd-doc { max-width: 760px; margin: 0 auto; font: 16px/1.6 Georgia, 'Times New Roman', serif; color: #1d1d1f; }
.castmd-doc h1, .castmd-doc h2, .castmd-doc h3, .castmd-doc h4 { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; line-height: 1.25; margin: 1.4em 0 .5em; break-after: avoid; }
.castmd-doc h1.castmd-title { font-size: 2em; margin-top: 0; }
.castmd-doc img { max-width: 100%; height: auto; break-inside: avoid; }
.castmd-doc figure { margin: 1em 0; break-inside: avoid; }
.castmd-doc figcaption { font-size: .85em; color: #555; }
.castmd-doc pre { background: #f5f5f7; padding: 12px; border-radius: 6px; white-space: pre-wrap; word-break: break-word; font: 13px/1.45 Menlo, Consolas, monospace; break-inside: avoid; }
.castmd-doc code { font-family: Menlo, Consolas, monospace; font-size: .9em; }
.castmd-doc blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #ccc; color: #444; }
.castmd-doc table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: .9em; }
.castmd-doc th, .castmd-doc td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
.castmd-doc th { background: #f5f5f7; }
.castmd-doc tr { break-inside: avoid; }
.castmd-doc table.castmd-meta { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; margin: 0 0 2em; }
.castmd-doc table.castmd-meta th { width: 110px; font-weight: 600; }
.castmd-doc a { color: #3b5bdb; }
`;

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Label/value pairs for the metadata block, empty fields left out.
  function metaRows(meta) {
    return [
      ['Source', meta.url, 'link'], ['Author', meta.author], ['Published', meta.published],
      ['Captured', meta.captured], ['Site', meta.siteName], ['Description', meta.description],
      ['Tags', meta.tags],
    ].filter(([, value]) => value && String(value).trim())
      .map(([label, value, kind]) => ({ label, value: String(value).trim(), link: kind === 'link' }));
  }

  function metaBlockHtml(meta) {
    const rows = metaRows(meta).map(({ label, value, link }) => {
      const cell = link && /^https?:/i.test(value)
        ? `<a href="${escapeHtml(value)}">${escapeHtml(value)}</a>` : escapeHtml(value);
      return `<tr><th>${label}</th><td>${cell}</td></tr>`;
    }).join('');
    return rows ? `<table class="castmd-meta"><tbody>${rows}</tbody></table>` : '';
  }

  // Expands the text tokens, then splits on the live page tokens.
  // Returns [{ text }] / [{ field: 'PAGE' | 'NUMPAGES' }] in order.
  function splitPageTokens(template, meta) {
    const filled = String(template || '')
      .replace(/\{title\}/g, meta.title || '').replace(/\{url\}/g, meta.url || '')
      .replace(/\{date\}/g, meta.captured || '').replace(/\{site\}/g, meta.siteName || '');
    return filled.split(/(\{pages?\})/).filter(Boolean).map(part =>
      part === '{page}' ? { field: 'PAGE' } : part === '{pages}' ? { field: 'NUMPAGES' } : { text: part });
  }

  function cssString(text) {
    return '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"';
  }

  function marginBoxContent(template, meta) {
    return splitPageTokens(template, meta).map(p =>
      p.field === 'PAGE' ? 'counter(page)' : p.field === 'NUMPAGES' ? 'counter(pages)' : cssString(p.text)
    ).join(' ');
  }

  // @page rules for print. Chrome 131+ renders margin boxes; defining them also
  // replaces the browser's own date/URL header and footer.
  // brand: a BrandPreset.resolveBrand() view, or null for the plain layout.
  function pageCss({ header, footer, brand }, meta) {
    if (brand) return global.BrandPreset.pageCss(brand, { header, footer }, meta, marginBoxContent);
    const box = "font: 9pt -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #666;";
    const top = header && header.trim() ? `@top-center { content: ${marginBoxContent(header, meta)}; ${box} }` : '';
    const bottom = footer && footer.trim() ? `@bottom-center { content: ${marginBoxContent(footer, meta)}; ${box} }` : '';
    return `@page { size: A4; margin: 20mm 18mm; ${top} ${bottom} }`;
  }

  // Inner markup of <article class="castmd-doc">: title, metadata, content.
  function articleHtml({ bodyHtml, meta, includeMeta, brand, header }) {
    const title = meta.title ? `<h1 class="castmd-title">${escapeHtml(meta.title)}</h1>` : '';
    const main = title + (includeMeta ? metaBlockHtml(meta) : '') + bodyHtml;
    if (!brand) return main;
    const headerText = splitPageTokens(header, meta).filter(p => p.text).map(p => p.text).join('').trim();
    const bars = global.BrandPreset.barsHtml(brand, headerText, escapeHtml);
    return bars.top + main + bars.bottom;
  }

  // Everything that goes in the <style> of a document: base, brand, print.
  function documentCss({ header, footer, brand }, meta) {
    return DOC_CSS + (brand ? global.BrandPreset.docCss(brand) : '') + '\n' + pageCss({ header, footer, brand }, meta);
  }

  function standaloneHtml({ bodyHtml, meta, includeMeta, header, footer, brand }) {
    const metaTag = (name, value) => value ? `<meta name="${name}" content="${escapeHtml(value)}">\n` : '';
    return `<!doctype html>
<html lang="${escapeHtml(meta.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title || 'Untitled')}</title>
${metaTag('author', meta.author)}${metaTag('description', meta.description)}${metaTag('keywords', meta.tags)}${metaTag('castmd:source', meta.url)}${metaTag('castmd:captured', meta.captured)}<style>
body { margin: 40px 16px; background: #fff; }
@media print { body { margin: 0; } }
${documentCss({ header, footer, brand }, meta)}
</style>
</head>
<body>
<article class="castmd-doc">
${articleHtml({ bodyHtml, meta, includeMeta, brand, header })}
</article>
</body>
</html>
`;
  }

  global.ExportDocument = {
    DOC_CSS, escapeHtml, metaRows, metaBlockHtml, splitPageTokens, pageCss, documentCss, articleHtml, standaloneHtml,
  };
})(window);
