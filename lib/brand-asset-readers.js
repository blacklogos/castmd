// Reads what a brand needs from raw logo and font files, for the brand editor
// on the export page and for scripts/build-brand-file.mjs.
//
// readFontFamily: the family name stored in a TTF/OTF `name` table. DOCX
//   embedding depends on it: Word only uses an embedded font when the name in
//   word/fontTable.xml and the run properties equals the font's own family
//   name (nameID 1), so the editor fills the family from the file, not from
//   the file name.
// logoAspect: width / height from an SVG viewBox (or width/height attributes)
//   or a PNG header. Print margin boxes and the DOCX header size the logo from it.

(function (global) {
  'use strict';

  function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
  function u32(b, o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }

  // Returns the family name (nameID 1), preferring Windows/Unicode English.
  function readFontFamily(bytes) {
    if (!bytes || bytes.length < 12) return null;
    const numTables = u16(bytes, 4);
    let nameOffset = -1;
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      if (rec + 16 > bytes.length) return null;
      if (String.fromCharCode(bytes[rec], bytes[rec + 1], bytes[rec + 2], bytes[rec + 3]) === 'name') {
        nameOffset = u32(bytes, rec + 8);
        break;
      }
    }
    if (nameOffset < 0 || nameOffset + 6 > bytes.length) return null;
    const count = u16(bytes, nameOffset + 2);
    const strings = nameOffset + u16(bytes, nameOffset + 4);
    let best = null, bestScore = -1;
    for (let i = 0; i < count; i++) {
      const r = nameOffset + 6 + i * 12;
      if (r + 12 > bytes.length) break;
      const platform = u16(bytes, r), language = u16(bytes, r + 4), nameId = u16(bytes, r + 6);
      if (nameId !== 1) continue;
      const len = u16(bytes, r + 8), off = strings + u16(bytes, r + 10);
      if (off + len > bytes.length) continue;
      let text = '';
      if (platform === 3 || platform === 0) {
        for (let j = 0; j + 1 < len; j += 2) text += String.fromCharCode(u16(bytes, off + j));
      } else if (platform === 1) {
        for (let j = 0; j < len; j++) text += String.fromCharCode(bytes[off + j]);
      } else continue;
      const score = (platform === 3 ? 2 : 1) + (language === 0x409 || language === 0 ? 1 : 0);
      if (score > bestScore && text.trim()) { best = text.trim(); bestScore = score; }
    }
    return best;
  }

  function svgAspect(text) {
    const viewBox = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/.exec(text);
    if (viewBox && Number(viewBox[2]) > 0) return Number(viewBox[1]) / Number(viewBox[2]);
    const w = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)(px)?["']/.exec(text);
    const h = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)(px)?["']/.exec(text);
    return w && h && Number(h[1]) > 0 ? Number(w[1]) / Number(h[1]) : null;
  }

  function pngAspect(bytes) {
    const isPng = bytes.length >= 24 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    return isPng && u32(bytes, 20) > 0 ? u32(bytes, 16) / u32(bytes, 20) : null;
  }

  // Lowercase-hyphen id from a name, unique against `taken`.
  function slugId(text, taken) {
    const base = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'item';
    let id = base, n = 2;
    while (taken && taken.has(id)) id = `${base}-${n++}`;
    return id;
  }

  global.BrandAssetReaders = { readFontFamily, svgAspect, pngAspect, slugId };
})(window);
