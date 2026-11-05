// Brand presets for the export page: a company's logo, colors, typefaces and
// contact details (address, web, email) applied to the header, footer and
// typography of HTML, PDF and DOCX exports.
//
// Presets are never bundled with castmd. A brand ships as a
// `.castmd-brand.json` file (built by scripts/build-brand-file.mjs) that the
// user imports once; export.js keeps it in chrome.storage.local. The file is
// untrusted input: validateBrand() accepts only the documented shape, data:
// URLs of the expected media types, hex colors, and plain font family names,
// because these values end up inside CSS and OOXML.
//
// Brand file (castmdBrand: 1):
//   { castmdBrand, id, name, header?, footer?,
//     logo?:   { src: data:image/(svg+xml|png|jpeg), alt, aspect (w/h) },
//     colors?: { accent, text, muted, tableHeader },
//     fonts?:  { heading?, body?: { family, files: { regular, bold?, italic?, boldItalic? } (data:font/ttf|otf) } },
//     fields:  [{ id, label?, value, href?, line (1-4) }] }
// Toggles (per brand, stored by export.js): { logo, fonts, fields: { [id]: bool } }

(function (global) {
  'use strict';

  const HEX = /^#[0-9a-f]{6}$/i;
  // Letters in any script (font names can be Vietnamese), never quotes, ';' or '<'.
  const FAMILY = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} _-]{0,40}$/u;
  const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
  const LOGO_SRC = /^data:image\/(svg\+xml|png|jpeg)(;base64)?,/;
  const FONT_SRC = /^data:font\/(ttf|otf);base64,[A-Za-z0-9+/=]+$/;
  const FONT_SLOTS = ['regular', 'bold', 'italic', 'boldItalic'];
  const DEFAULT_COLORS = { accent: '#EFC427', text: '#1D1D1F', muted: '#6B7280', tableHeader: '#F5F5F7' };
  const LOGO_HEIGHT_PX = 34;
  const MAX_TEXT = 200;

  function text(value, field, required) {
    if (value == null || value === '') {
      if (required) throw new Error(`brand file: ${field} is required`);
      return '';
    }
    if (typeof value !== 'string' || value.length > MAX_TEXT) throw new Error(`brand file: ${field} must be text under ${MAX_TEXT} characters`);
    return value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  }

  function validateBrand(raw) {
    if (!raw || raw.castmdBrand !== 1) throw new Error('Not a castmd brand file (castmdBrand: 1 missing)');
    const id = text(raw.id, 'id', true);
    if (!ID.test(id)) throw new Error('brand file: id must be lowercase letters, digits and hyphens');
    const brand = { castmdBrand: 1, id, name: text(raw.name, 'name', true),
      header: text(raw.header, 'header'), footer: text(raw.footer, 'footer'), colors: { ...DEFAULT_COLORS }, fields: [] };

    if (raw.logo) {
      if (typeof raw.logo.src !== 'string' || !LOGO_SRC.test(raw.logo.src)) throw new Error('brand file: logo.src must be an SVG, PNG or JPEG data URL');
      const aspect = Number(raw.logo.aspect);
      if (!(aspect > 0.1 && aspect < 20)) throw new Error('brand file: logo.aspect must be width / height');
      brand.logo = { src: raw.logo.src, alt: text(raw.logo.alt, 'logo.alt') || brand.name, aspect };
    }
    for (const [key, value] of Object.entries(raw.colors || {})) {
      if (!(key in DEFAULT_COLORS)) continue;
      if (!HEX.test(value)) throw new Error(`brand file: colors.${key} must be #RRGGBB`);
      brand.colors[key] = value;
    }
    if (raw.fonts) {
      brand.fonts = {};
      for (const role of ['heading', 'body']) {
        const font = raw.fonts[role];
        if (!font) continue;
        if (!FAMILY.test(font.family || '')) throw new Error(`brand file: fonts.${role}.family is not a plain font name`);
        const files = {};
        for (const slot of FONT_SLOTS) {
          const src = font.files && font.files[slot];
          if (!src) continue;
          if (!FONT_SRC.test(src)) throw new Error(`brand file: fonts.${role}.files.${slot} must be a TTF/OTF data URL`);
          files[slot] = src;
        }
        if (!files.regular && !files.bold) throw new Error(`brand file: fonts.${role} needs a regular or bold file`);
        brand.fonts[role] = { family: font.family, files };
      }
    }
    const seen = new Set();
    for (const f of raw.fields || []) {
      const fid = text(f.id, 'fields[].id', true);
      if (!ID.test(fid) || seen.has(fid)) throw new Error(`brand file: field id "${fid}" is invalid or repeated`);
      seen.add(fid);
      const href = text(f.href, `fields.${fid}.href`);
      if (href && !/^(https?:|mailto:|tel:)/i.test(href)) throw new Error(`brand file: fields.${fid}.href must be http(s), mailto or tel`);
      const line = Math.min(4, Math.max(1, parseInt(f.line, 10) || 1));
      brand.fields.push({ id: fid, label: text(f.label, `fields.${fid}.label`), value: text(f.value, `fields.${fid}.value`, true), href, line });
    }
    return brand;
  }

  function defaultToggles(brand) {
    const fields = {};
    brand.fields.forEach(f => { fields[f.id] = true; });
    return { logo: !!brand.logo, fonts: !!brand.fonts, fields };
  }

  // The brand as it applies to one export: switched-off parts removed.
  function resolveBrand(brand, toggles) {
    if (!brand) return null;
    const t = toggles || defaultToggles(brand);
    return {
      name: brand.name, colors: brand.colors,
      logo: t.logo !== false ? brand.logo || null : null,
      fonts: t.fonts !== false ? brand.fonts || null : null,
      fields: brand.fields.filter(f => !t.fields || t.fields[f.id] !== false),
    };
  }

  // Footer contact block: fields grouped by line, "label: value" when labelled.
  function contactLines(view) {
    const lines = [];
    view.fields.forEach(f => {
      (lines[f.line - 1] = lines[f.line - 1] || []).push({ text: f.label ? `${f.label}: ${f.value}` : f.value, href: f.href });
    });
    return lines.filter(Boolean);
  }

  function fontStack(view, role) {
    const font = view && view.fonts && view.fonts[role];
    return font ? `'${font.family}', ` : '';
  }

  function fontFaceCss(view) {
    if (!view || !view.fonts) return '';
    const faces = [];
    for (const font of Object.values(view.fonts)) {
      const slots = { regular: [400, 'normal'], bold: [700, 'normal'], italic: [400, 'italic'], boldItalic: [700, 'italic'] };
      for (const [slot, [weight, style]] of Object.entries(slots)) {
        if (font.files[slot]) faces.push(`@font-face { font-family: '${font.family}'; src: url(${font.files[slot]}); font-weight: ${weight}; font-style: ${style}; }`);
      }
    }
    return faces.join('\n');
  }

  // Overrides on top of ExportDocument.DOC_CSS for a branded document.
  function docCss(view) {
    if (!view) return '';
    const c = view.colors;
    const body = fontStack(view, 'body'), heading = fontStack(view, 'heading') || body;
    return `${fontFaceCss(view)}
.castmd-doc { font-family: ${body}Georgia, serif; color: ${c.text}; }
.castmd-doc h1, .castmd-doc h2, .castmd-doc h3, .castmd-doc h4, .castmd-doc h5, .castmd-doc h6 { font-family: ${heading}${body}sans-serif; }
.castmd-doc table.castmd-meta, .castmd-brand-bar { font-family: ${body}sans-serif; }
.castmd-doc h1.castmd-title { border-bottom: 3px solid ${c.accent}; padding-bottom: .25em; }
.castmd-doc th { background: ${c.tableHeader}; }
.castmd-brand-bar { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; font-size: 12px; color: ${c.muted}; }
.castmd-brand-bar.top { border-bottom: 2px solid ${c.accent}; padding-bottom: 10px; margin-bottom: 28px; }
.castmd-brand-bar.bottom { border-top: 2px solid ${c.accent}; padding-top: 10px; margin-top: 40px; align-items: flex-start; }
.castmd-brand-bar img { height: ${LOGO_HEIGHT_PX}px; width: auto; }
.castmd-brand-bar a { color: inherit; }
@media print { .castmd-brand-bar { display: none; } }`;
  }

  // An <img>-safe SVG that draws the logo at a fixed CSS size, because print
  // margin boxes cannot size a content: url() image themselves.
  function sizedLogoUrl(logo, heightPx) {
    const w = Math.round(heightPx * logo.aspect);
    const href = logo.src.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${heightPx}"><image href="${href}" width="${w}" height="${heightPx}"/></svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  // @page margin boxes for a branded print: logo top-left, header template
  // top-right, contact block bottom-left, footer template bottom-right.
  function pageCss(view, { header, footer }, meta, boxContent) {
    const c = view.colors;
    const body = fontStack(view, 'body') + "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
    const rule = `border-bottom: 2px solid ${c.accent}; padding-bottom: 3mm; vertical-align: bottom;`;
    const logo = view.logo ? `url("${sizedLogoUrl(view.logo, LOGO_HEIGHT_PX)}")` : '""';
    const lines = contactLines(view).map(parts => parts.map(p => p.text).join('  \u00b7  '));
    const contact = lines.length ? lines.map(cssString).join(' "\\A" ') : '""';
    return `@page { size: A4; margin: 26mm 18mm 26mm;
  @top-left { content: ${logo}; ${rule} }
  @top-right { content: ${header && header.trim() ? boxContent(header, meta) : '""'}; font: 9pt ${body}; color: ${c.muted}; ${rule} }
  @bottom-left { content: ${contact}; white-space: pre; font: 7.5pt/1.5 ${body}; color: ${c.muted}; vertical-align: top; padding-top: 3mm; }
  @bottom-right { content: ${footer && footer.trim() ? boxContent(footer, meta) : '""'}; font: 600 7.5pt ${body}; color: ${c.text}; vertical-align: top; padding-top: 3mm; }
}`;
  }

  function cssString(value) {
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"';
  }

  // Screen-only bars for the preview and the downloaded .html (print uses the
  // margin boxes instead; the bars are hidden in print).
  function barsHtml(view, headerText, escapeHtml) {
    const logo = view.logo ? `<img src="${escapeHtml(view.logo.src)}" alt="${escapeHtml(view.logo.alt)}">` : '<span></span>';
    const top = `<div class="castmd-brand-bar top">${logo}<span>${escapeHtml(headerText)}</span></div>`;
    const lines = contactLines(view).map(parts => '<div>' + parts.map(p => p.href
      ? `<a href="${escapeHtml(p.href)}">${escapeHtml(p.text)}</a>` : escapeHtml(p.text)).join(' &middot; ') + '</div>').join('');
    const bottom = lines ? `<div class="castmd-brand-bar bottom"><div>${lines}</div></div>` : '';
    return { top, bottom };
  }

  const fieldName = (f) => f.label || f.id.charAt(0).toUpperCase() + f.id.slice(1);
  global.BrandPreset = {
    validateBrand, defaultToggles, resolveBrand, contactLines, fontFaceCss, docCss, pageCss, barsHtml, sizedLogoUrl,
    fieldName, LOGO_HEIGHT_PX, DEFAULT_COLORS,
  };
})(window);
