// "View style" dialog: the selected brand preset at a glance, with logo, color
// swatches, type specimens in the real brand fonts (Vietnamese sample text,
// since diacritics are where a font most often falls short), contact fields,
// and a miniature page showing the header and footer exactly as exports
// will draw them. Read only; "Edit" hands over to the editor.

const BrandViewer = (() => {
  const SAMPLE_META = { title: 'Báo cáo dự án Q4', url: 'https://example.com/report', captured: '2026-11-06', siteName: 'example.com' };
  const COLOR_NAMES = { accent: 'Accent', text: 'Text', muted: 'Muted', tableHeader: 'Table header' };
  const esc = (t) => ExportDocument.escapeHtml(t);

  function open() {
    const brand = BrandControls.selectedRaw();
    if (!brand) return;
    const view = BrandPreset.resolveBrand(brand, BrandPreset.defaultToggles(brand));   // everything on
    const dialog = document.getElementById('brandViewer');
    const fontFor = (role) => brand.fonts && brand.fonts[role];
    const family = (role) => fontFor(role) ? `'${fontFor(role).family}', sans-serif` : 'Georgia, serif';

    const swatches = Object.entries(brand.colors).map(([key, hex]) =>
      `<div class="bv-swatch"><span style="background:${hex}"></span><b>${COLOR_NAMES[key] || key}</b><code>${hex}</code></div>`).join('');

    const specimen = (role, label) => {
      const f = fontFor(role);
      const slots = f ? Object.keys(f.files).join(', ') : 'not set, falls back to defaults';
      return `<div class="bv-specimen">
        <div class="bv-label">${label}: <b>${f ? esc(f.family) : 'none'}</b> <small>(${esc(slots)})</small></div>
        <div style="font-family:${family(role)};font-size:${role === 'heading' ? 26 : 15}px;font-weight:${role === 'heading' ? 700 : 400}">
          ${role === 'heading' ? 'Tiêu đề thương hiệu' : 'Nội dung văn bản rõ ràng, dễ đọc cho mọi tài liệu.'}</div>
        <div style="font-family:${family(role)};font-size:13px">Aa Bb Cc 0123 · ĂÂĐÊÔƠƯ ăâđêôơư · <b>Đậm 700</b></div>
      </div>`;
    };

    const fields = brand.fields.map(f => `<tr><th>${esc(BrandPreset.fieldName(f))}</th><td>${esc(f.value)}</td>
      <td>${f.href ? esc(f.href) : ''}</td><td>line ${f.line}</td></tr>`).join('');

    const headerText = ExportDocument.splitPageTokens(brand.header || '{title}', SAMPLE_META)
      .map(p => p.text != null ? esc(p.text) : p.field === 'PAGE' ? '1' : '2').join('');
    const footerText = ExportDocument.splitPageTokens(brand.footer || 'Page {page} of {pages}', SAMPLE_META)
      .map(p => p.text != null ? esc(p.text) : p.field === 'PAGE' ? '1' : '2').join('');
    const contact = BrandPreset.contactLines(view).map(parts => `<div>${parts.map(p => esc(p.text)).join(' · ')}</div>`).join('');
    const body = fontFor('body') ? `'${fontFor('body').family}', sans-serif` : 'sans-serif';

    dialog.innerHTML = `
      <style>${BrandPreset.fontFaceCss(view)}</style>
      <header class="bd-head"><h2 id="brandViewerTitle">${esc(brand.name)} style</h2>
        <div><button type="button" data-act="edit">Edit</button> <button type="button" data-act="close">Close</button></div></header>
      <section><h3>Logo</h3>${brand.logo
        ? `<img class="bv-logo" src="${esc(brand.logo.src)}" alt="${esc(brand.logo.alt)}"> <small>${brand.logo.aspect.toFixed(2)} : 1</small>`
        : '<p class="bd-muted">No logo.</p>'}</section>
      <section><h3>Colors</h3><div class="bv-swatches">${swatches}</div></section>
      <section><h3>Typefaces</h3>${specimen('heading', 'Heading')}${specimen('body', 'Body')}</section>
      <section><h3>Contact fields</h3>${fields ? `<table class="bv-fields">${fields}</table>` : '<p class="bd-muted">None.</p>'}</section>
      <section><h3>Header and footer</h3>
        <div class="bv-page" style="font-family:${body}">
          <div class="bv-page-head" style="border-color:${brand.colors.accent}">
            ${brand.logo ? `<img src="${esc(brand.logo.src)}" alt="">` : '<span></span>'}<span style="color:${brand.colors.muted}">${headerText}</span></div>
          <div class="bv-page-body"><div style="font-family:${family('heading')};font-weight:700;font-size:16px">${esc(SAMPLE_META.title)}</div>
            <div class="bv-lines"><i></i><i></i><i></i></div></div>
          <div class="bv-page-foot" style="color:${brand.colors.muted}"><div>${contact}</div><b style="color:${brand.colors.text}">${footerText}</b></div>
        </div></section>`;

    dialog.querySelector('[data-act="close"]').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-act="edit"]').addEventListener('click', () => { dialog.close(); BrandEditor.open(brand); });
    dialog.showModal();
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('viewBrandBtn').addEventListener('click', open);
  });

  return { open };
})();
