// Assembles a complete .docx (Office Open XML) package from sanitized export
// HTML. Depends on lib/export-document.js (metadata rows, header/footer tokens)
// and lib/html-to-docx-body.js (the body walker).
//
// DocxPackage.build({ bodyHtml, meta, includeMeta, header, footer, images })
//   images: { [src]: { bytes: Uint8Array, ext: 'png'|'jpeg'|'gif', width, height } }
//           prepared by export.js; an <img> whose src is missing renders as "[Image: alt]".
// Returns [{ path, content }] for ZipBuilder.buildZip.
//
// Metadata lands twice on purpose: as a visible table under the title (when
// includeMeta) and in docProps/core.xml, which Word shows under File > Info.

(function (global) {
  'use strict';

  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const MIME = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif' };

  // brand: a BrandPreset.resolveBrand() view or null. Its logo bytes come from
  // `images` under brand.logo.src, prepared like any other image.
  function build({ bodyHtml, meta, includeMeta, header, footer, images, brand }) {
    const { blocks, paragraph, createPackageState, xml } = global.HtmlToDocxBody;
    const Brand = global.DocxBrandParts;
    const pkg = createPackageState(images, brand ? hexColor(brand.colors.tableHeader) : null);
    const doc = new DOMParser().parseFromString(bodyHtml || '', 'text/html');

    let body = meta.title ? paragraph([{ text: meta.title, fmt: {} }], pkg, { style: 'Title' }) : '';
    if (includeMeta) body += metaTable(meta, pkg, paragraph);
    body += blocks(doc.body, pkg, {});
    body += '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/>' +
      '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1020" w:bottom="1134" w:left="1020" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';

    const headerParts = global.ExportDocument.splitPageTokens(header, meta);
    const footerParts = global.ExportDocument.splitPageTokens(footer, meta);
    const hdr = brand ? Brand.header(brand, headerParts, brand.logo ? (images || {})[brand.logo.src] : null, xml)
      : { xml: plainParagraph('Header', headerParts, xml), rels: [], media: [] };
    const ftr = brand ? Brand.footer(brand, footerParts, xml) : plainParagraph('Footer', footerParts, xml);
    const fonts = brand ? Brand.embeddedFonts(brand, xml) : null;

    const entries = [
      { path: '[Content_Types].xml', content: contentTypes(!!fonts) },
      { path: '_rels/.rels', content: rootRels() },
      { path: 'docProps/core.xml', content: coreProps(meta, xml) },
      { path: 'docProps/app.xml', content: HEAD + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>castmd</Application></Properties>' },
      { path: 'word/document.xml', content: `${HEAD}<w:document ${NS}><w:body>${body}</w:body></w:document>` },
      { path: 'word/styles.xml', content: styles(brand) },
      { path: 'word/numbering.xml', content: numbering(pkg.orderedLists) },
      { path: 'word/header1.xml', content: `${HEAD}<w:hdr ${NS}>${hdr.xml}</w:hdr>` },
      { path: 'word/footer1.xml', content: `${HEAD}<w:ftr ${NS}>${ftr}</w:ftr>` },
      { path: 'word/_rels/document.xml.rels', content: documentRels(pkg.rels, xml, !!fonts) },
    ];
    if (hdr.rels.length) entries.push({ path: 'word/_rels/header1.xml.rels', content: relsXml(hdr.rels.join('')) });
    if (fonts) {
      entries.push({ path: 'word/fontTable.xml', content: HEAD + fonts.fontTable });
      entries.push({ path: 'word/_rels/fontTable.xml.rels', content: HEAD + fonts.fontTableRels });
      entries.push({ path: 'word/settings.xml', content: `${HEAD}<w:settings ${NS}><w:embedTrueTypeFonts/></w:settings>` });
    }
    for (const m of [...pkg.media, ...hdr.media, ...(fonts ? fonts.files : [])]) entries.push({ path: m.path, content: m.bytes });
    return entries;
  }

  function metaTable(meta, pkg, paragraph) {
    const rows = global.ExportDocument.metaRows(meta).map(({ label, value, link }) => {
      const fmt = link && /^https?:/i.test(value) ? { href: value } : {};
      const cell = (w, inner) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="pct"/></w:tcPr>${inner}</w:tc>`;
      return '<w:tr>' + cell(900, paragraph([{ text: label, fmt: { bold: true } }], pkg, { style: 'MetaText' })) +
        cell(4100, paragraph([{ text: value, fmt }], pkg, { style: 'MetaText' })) + '</w:tr>';
    }).join('');
    if (!rows) return '';
    return '<w:tbl>' + global.HtmlToDocxBody.TABLE_PR +
      '<w:tblGrid><w:gridCol w:w="1776"/><w:gridCol w:w="8090"/></w:tblGrid>' + rows + '</w:tbl><w:p/>';
  }

  function hexColor(color) {
    return color.replace('#', '').toUpperCase();
  }

  function plainParagraph(style, parts, xml) {
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${global.DocxBrandParts.textRuns(parts, xml)}</w:p>`;
  }

  function relsXml(inner) {
    return HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + inner + '</Relationships>';
  }

  function contentTypes(withFonts) {
    const defaults = Object.entries(MIME).map(([ext, type]) => `<Default Extension="${ext}" ContentType="${type}"/>`).join('');
    const part = (name, type) => `<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-${type}"/>`;
    return HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' + defaults +
      (withFonts ? '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>' +
        part('word/fontTable.xml', 'officedocument.wordprocessingml.fontTable+xml') +
        part('word/settings.xml', 'officedocument.wordprocessingml.settings+xml') : '') +
      part('word/document.xml', 'officedocument.wordprocessingml.document.main+xml') +
      part('word/styles.xml', 'officedocument.wordprocessingml.styles+xml') +
      part('word/numbering.xml', 'officedocument.wordprocessingml.numbering+xml') +
      part('word/header1.xml', 'officedocument.wordprocessingml.header+xml') +
      part('word/footer1.xml', 'officedocument.wordprocessingml.footer+xml') +
      part('docProps/core.xml', 'package.core-properties+xml') +
      part('docProps/app.xml', 'officedocument.extended-properties+xml') + '</Types>';
  }

  function rootRels() {
    return HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>` +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      `<Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  }

  function documentRels(rels, xml, withFonts) {
    const fixed = [['rIdStyles', 'styles', 'styles.xml'], ['rIdNumbering', 'numbering', 'numbering.xml'],
      ['rIdHeader', 'header', 'header1.xml'], ['rIdFooter', 'footer', 'footer1.xml'],
      ...(withFonts ? [['rIdFontTable', 'fontTable', 'fontTable.xml'], ['rIdSettings', 'settings', 'settings.xml']] : [])]
      .map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('');
    const dynamic = rels.map(r => `<Relationship Id="${r.id}" Type="${REL}/${r.type}" Target="${xml(r.target)}"` +
      (r.external ? ' TargetMode="External"' : '') + '/>').join('');
    return relsXml(fixed + dynamic);
  }

  function coreProps(meta, xml) {
    const el = (tag, value) => value ? `<${tag}>${xml(value)}</${tag}>` : '';
    const created = /^\d{4}-\d{2}-\d{2}/.test(meta.captured || '')
      ? `<dcterms:created xsi:type="dcterms:W3CDTF">${xml(meta.captured.slice(0, 10))}T00:00:00Z</dcterms:created>` : '';
    return HEAD + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      el('dc:title', meta.title) + el('dc:creator', meta.author) + el('dc:description', meta.description) +
      el('cp:keywords', meta.tags) + el('dc:identifier', meta.url) + el('dc:language', meta.lang) + created +
      '</cp:coreProperties>';
  }

  function numbering(orderedLists) {
    const level = (ilvl, fmt, text) =>
      `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/>` +
      `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (ilvl + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
    const bullets = ['•', '◦', '▪'];
    const decimals = ['decimal', 'lowerLetter', 'lowerRoman'];
    let bulletLvls = '', decimalLvls = '';
    for (let i = 0; i < 9; i++) {
      bulletLvls += level(i, 'bullet', bullets[i % 3]);
      decimalLvls += level(i, decimals[i % 3], `%${i + 1}.`);
    }
    const nums = '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' + orderedLists.map(({ numId, start }) =>
      `<w:num w:numId="${numId}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${start}"/></w:lvlOverride></w:num>`).join('');
    return `${HEAD}<w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${bulletLvls}</w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${decimalLvls}</w:abstractNum>${nums}</w:numbering>`;
  }

  // Brand typefaces replace the defaults: body font everywhere, heading font
  // for Title and headings, accent rule under the Title.
  function styles(brand) {
    const fonts = (brand && brand.fonts) || {};
    const rFonts = (family) => `<w:rFonts w:ascii="${family}" w:hAnsi="${family}" w:cs="${family}" w:eastAsia="${family}"/>`;
    const bodyFamily = fonts.body ? fonts.body.family : 'Georgia';
    const sans = rFonts(fonts.heading ? fonts.heading.family : fonts.body ? fonts.body.family : 'Calibri');
    const uiSans = rFonts(fonts.body ? fonts.body.family : 'Calibri');
    const titleRule = brand ? `<w:pBdr><w:bottom w:val="single" w:sz="18" w:space="4" w:color="${hexColor(brand.colors.accent)}"/></w:pBdr>` : '';
    const heading = (n, size) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/>` +
      `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/>` +
      `<w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr>${sans}<w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
    const para = (id, name, pPr, rPr) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>` +
      `<w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr></w:style>`;
    return `${HEAD}<w:styles ${NS}>` +
      `<w:docDefaults><w:rPrDefault><w:rPr>${rFonts(bodyFamily)}<w:sz w:val="22"/></w:rPr></w:rPrDefault>` +
      '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      para('Title', 'Title', `<w:spacing w:after="240"/>${titleRule}`, `${sans}<w:b/><w:sz w:val="48"/>`) +
      [[1, 36], [2, 30], [3, 26], [4, 24], [5, 22], [6, 22]].map(([n, s]) => heading(n, s)).join('') +
      para('Code', 'Code Block', '<w:spacing w:after="160" w:line="240" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="F5F5F7"/>',
        '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="18"/>') +
      para('Quote', 'Quote', '<w:ind w:left="567"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="CCCCCC"/></w:pBdr>', '<w:color w:val="444444"/>') +
      para('Caption', 'caption', '<w:spacing w:after="200"/>', '<w:i/><w:color w:val="555555"/><w:sz w:val="18"/>') +
      para('MetaText', 'Metadata', '<w:spacing w:after="0"/>', `${uiSans}<w:sz w:val="18"/>`) +
      para('Header', 'header', '<w:jc w:val="center"/><w:spacing w:after="0"/>', `${uiSans}<w:color w:val="666666"/><w:sz w:val="18"/>`) +
      para('Footer', 'footer', '<w:jc w:val="center"/><w:spacing w:after="0"/>', `${uiSans}<w:color w:val="666666"/><w:sz w:val="${brand ? 15 : 18}"/>`) +
      '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="3B5BDB"/><w:u w:val="single"/></w:rPr></w:style>' +
      '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>' +
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>`).join('') +
      '</w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
      '</w:styles>';
  }

  global.DocxPackage = { build };
})(window);
