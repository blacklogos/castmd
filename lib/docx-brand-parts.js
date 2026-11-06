// Branded DOCX parts for lib/docx-package.js: header with the logo and the
// header template, footer with the contact block and the footer template, and
// the brand typefaces embedded in the package.
//
// Layout mirrors the print margin boxes (lib/brand-preset.js): logo left and
// text right on one header line over an accent rule; contact lines left and
// page numbers right in the footer. Right-aligned text uses a right tab stop
// at the content width instead of a table, so Word keeps it on one line.
//
// Font embedding follows ECMA-376 Part 1 §17.8: each TTF/OTF is stored as
// word/fonts/fontN.odttf, its first 32 bytes XORed with a per-font GUID key,
// listed in word/fontTable.xml, and enabled by <w:embedTrueTypeFonts/> in
// settings.xml. Readers without UTM Avo or Manrope installed then still see
// the brand typefaces in Word.

(function (global) {
  'use strict';

  const CONTENT_WIDTH_TWIPS = 9866;
  const LOGO_HEIGHT_EMU = 9 * 36000;   // 9 mm
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const SLOT_TAGS = { regular: 'embedRegular', bold: 'embedBold', italic: 'embedItalic', boldItalic: 'embedBoldItalic' };

  const hex = (color) => color.replace('#', '').toUpperCase();
  const tabStop = `<w:tabs><w:tab w:val="right" w:pos="${CONTENT_WIDTH_TWIPS}"/></w:tabs>`;

  function textRuns(parts, xml) {
    return parts.map(p => p.field
      ? `<w:fldSimple w:instr=" ${p.field} "><w:r><w:t>1</w:t></w:r></w:fldSimple>`
      : `<w:r><w:t xml:space="preserve">${xml(p.text)}</w:t></w:r>`).join('');
  }

  // Returns { xml, rels, media } for word/header1.xml. `logo` is the prepared
  // image ({ bytes, ext, width, height }) or null.
  function header(view, templateParts, logo, xml) {
    const rels = [], media = [];
    let logoRun = '';
    if (view.logo && logo) {
      media.push({ path: `word/media/brand-logo.${logo.ext}`, bytes: logo.bytes });
      rels.push(`<Relationship Id="rIdLogo" Type="${REL}/image" Target="media/brand-logo.${logo.ext}"/>`);
      const cx = Math.round(LOGO_HEIGHT_EMU * view.logo.aspect);
      logoRun = global.DocxImageRun.drawingRun('rIdLogo', cx, LOGO_HEIGHT_EMU, 9001, xml(view.logo.alt));
    }
    const pPr = `<w:pPr><w:pStyle w:val="Header"/>${tabStop}<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="4" w:color="${hex(view.colors.accent)}"/></w:pBdr><w:jc w:val="left"/></w:pPr>`;
    return { xml: `<w:p>${pPr}${logoRun}<w:r><w:tab/></w:r>${textRuns(templateParts, xml)}</w:p>`, rels, media };
  }

  function footer(view, templateParts, xml) {
    const lines = global.BrandPreset.contactLines(view).map(parts => parts.map(p => p.text).join('  ·  '));
    if (!lines.length) lines.push('');
    const pPr = `<w:pPr><w:pStyle w:val="Footer"/>${tabStop}<w:jc w:val="left"/></w:pPr>`;
    const rule = `<w:pPr><w:pStyle w:val="Footer"/><w:pBdr><w:top w:val="single" w:sz="6" w:space="4" w:color="${hex(view.colors.accent)}"/></w:pBdr><w:jc w:val="left"/>${tabStop}</w:pPr>`;
    return lines.map((line, i) => `<w:p>${i === 0 ? rule : pPr}<w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r>` +
      (i === 0 ? `<w:r><w:tab/></w:r>${textRuns(templateParts, xml)}` : '') + '</w:p>').join('');
  }

  // ── Embedded fonts ────────────────────────────────────────────────────────

  function dataUrlBytes(dataUrl) {
    const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function newGuid() {
    const b = crypto.getRandomValues(new Uint8Array(16));
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    return `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}}`;
  }

  // XOR the first 32 bytes with the GUID bytes in reverse order. The same call
  // de-obfuscates, which the unit test relies on.
  function obfuscate(bytes, guid) {
    const h = guid.replace(/[{}-]/g, '');
    const key = Array.from({ length: 16 }, (_, i) => parseInt(h.substr(i * 2, 2), 16));
    const out = bytes.slice();
    for (let i = 0; i < Math.min(32, out.length); i++) out[i] ^= key[15 - (i % 16)];
    return out;
  }

  // Returns { fontTable, fontTableRels, files } or null when no fonts.
  function embeddedFonts(view, xml) {
    if (!view.fonts) return null;
    const files = [], rels = [], entries = [];
    const seen = new Set();
    for (const font of Object.values(view.fonts)) {
      if (seen.has(font.family)) continue;
      seen.add(font.family);
      let embeds = '';
      for (const [slot, tag] of Object.entries(SLOT_TAGS)) {
        if (!font.files[slot]) continue;
        const n = files.length + 1, guid = newGuid();
        files.push({ path: `word/fonts/font${n}.odttf`, bytes: obfuscate(dataUrlBytes(font.files[slot]), guid) });
        rels.push(`<Relationship Id="rIdFont${n}" Type="${REL}/font" Target="fonts/font${n}.odttf"/>`);
        embeds += `<w:${tag} r:id="rIdFont${n}" w:fontKey="${guid}"/>`;
      }
      entries.push(`<w:font w:name="${xml(font.family)}"><w:charset w:val="00"/><w:family w:val="auto"/><w:pitch w:val="variable"/>${embeds}</w:font>`);
    }
    return {
      fontTable: '<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
        `xmlns:r="${REL}">${entries.join('')}</w:fonts>`,
      fontTableRels: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels.join('') + '</Relationships>',
      files,
    };
  }

  global.DocxBrandParts = { header, footer, embeddedFonts, textRuns, obfuscate, dataUrlBytes };
})(window);
