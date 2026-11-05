// Brand editor dialog: create a preset or edit the selected one without the
// command-line builder. Browse… buttons read the logo (SVG/PNG/JPEG) and the
// heading/body font files (TTF/OTF) into data URLs; color pickers, contact
// fields (label, value, link, footer line) and the default header/footer
// templates complete it. Save runs the same BrandPreset.validateBrand as an
// imported file, then stores the preset; "Export" in the panel shares it.
//
// The font family comes from the font file itself (BrandAssetReaders), because
// Word only uses an embedded font whose name matches the document's.

const BrandEditor = (() => {
  const ROLES = { heading: 'Heading font', body: 'Body font' };
  const SLOTS = { regular: 'Regular', bold: 'Bold' };
  const COLORS = { accent: 'Accent', text: 'Text', muted: 'Muted', tableHeader: 'Table header' };
  const esc = (t) => ExportDocument.escapeHtml(t == null ? '' : t);
  let draft = null, dialog = null, notice = '';

  function open(brand) {
    draft = brand ? JSON.parse(JSON.stringify(brand)) : {
      id: null, name: '', header: '{title}', footer: 'Page {page} of {pages}', logo: null,
      colors: { ...BrandPreset.DEFAULT_COLORS }, fonts: {}, fields: [{ id: null, label: '', value: '', href: '', line: 1 }],
    };
    draft.fonts = draft.fonts || {};
    notice = '';
    dialog = document.getElementById('brandEditor');
    render();
    dialog.showModal();
  }

  function render() {
    const fontRows = Object.entries(ROLES).map(([role, label]) => {
      const f = draft.fonts[role] || { family: '', files: {} };
      const slots = Object.entries(SLOTS).map(([slot, name]) => `<div class="be-slot">${name}:
        <span class="${f.files[slot] ? 'be-ok' : 'bd-muted'}">${f.files[slot] ? 'loaded' : 'none'}</span>
        <label class="be-browse">Browse…<input type="file" accept=".ttf,.otf" data-file="font:${role}:${slot}" hidden></label>
        ${f.files[slot] ? `<button type="button" data-act="clear-font" data-role="${role}" data-slot="${slot}">Clear</button>` : ''}</div>`).join('');
      return `<div class="be-font"><b>${label}</b> <span class="bd-muted">${f.family ? esc(f.family) : 'no file yet'}</span>${slots}</div>`;
    }).join('');

    const fieldRows = draft.fields.map((f, i) => `<tr>
      <td><input type="text" data-path="fields.${i}.label" value="${esc(f.label)}" placeholder="${i ? 'Label (optional)' : 'HQ'}"></td>
      <td><input type="text" data-path="fields.${i}.value" value="${esc(f.value)}" placeholder="85 Tran Thai Tong, Ha Noi"></td>
      <td><input type="text" data-path="fields.${i}.href" value="${esc(f.href)}" placeholder="https://… or mailto:…"></td>
      <td><select data-path="fields.${i}.line">${[1, 2, 3, 4].map(n => `<option${f.line === n ? ' selected' : ''}>${n}</option>`).join('')}</select></td>
      <td><button type="button" data-act="remove-field" data-i="${i}" aria-label="Remove field">×</button></td></tr>`).join('');

    dialog.innerHTML = `
      <header class="bd-head"><h2 id="brandEditorTitle">${draft.id ? 'Edit brand' : 'New brand'}</h2></header>
      <label>Name <input type="text" data-path="name" value="${esc(draft.name)}" placeholder="BiPlus"></label>
      <section><h3>Logo</h3>
        ${draft.logo ? `<img class="bv-logo" src="${esc(draft.logo.src)}" alt=""> <small>${draft.logo.aspect.toFixed(2)} : 1</small>
          <button type="button" data-act="clear-logo">Clear</button>` : '<span class="bd-muted">No logo.</span>'}
        <label class="be-browse">Browse…<input type="file" accept=".svg,.png,.jpg,.jpeg" data-file="logo" hidden></label></section>
      <section><h3>Colors</h3><div class="be-colors">${Object.entries(COLORS).map(([key, label]) =>
        `<label>${label} <input type="color" data-path="colors.${key}" value="${esc(draft.colors[key])}"></label>`).join('')}</div></section>
      <section><h3>Typefaces</h3>${fontRows}</section>
      <section><h3>Contact fields</h3>
        <table class="be-fields"><tr><th>Label</th><th>Value</th><th>Link</th><th>Line</th><th></th></tr>${fieldRows}</table>
        <button type="button" data-act="add-field">+ Add field</button></section>
      <section><h3>Default header and footer</h3>
        <label>Header <input type="text" data-path="header" value="${esc(draft.header)}"></label>
        <label>Footer <input type="text" data-path="footer" value="${esc(draft.footer)}"></label></section>
      <p class="be-notice" role="status">${esc(notice)}</p>
      <footer class="bd-foot"><button type="button" data-act="cancel">Cancel</button>
        <button type="button" data-act="save" class="primary">Save preset</button></footer>`;
  }

  function setPath(path, value) {
    const keys = path.split('.');
    let obj = draft;
    keys.slice(0, -1).forEach(k => { obj = obj[k]; });
    obj[keys[keys.length - 1]] = keys[keys.length - 1] === 'line' ? Number(value) : value;
  }

  async function onFile(input) {
    const file = input.files[0];
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ext = file.name.split('.').pop().toLowerCase();
      if (input.dataset.file === 'logo') {
        const type = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext];
        if (!type) throw new Error('logo must be SVG, PNG or JPEG');
        const src = `data:${type};base64,${toBase64(bytes)}`;
        const aspect = ext === 'svg' ? BrandAssetReaders.svgAspect(new TextDecoder().decode(bytes))
          : ext === 'png' ? BrandAssetReaders.pngAspect(bytes) : await imageAspect(src);
        if (!aspect) throw new Error('could not read the logo size (SVG needs a viewBox)');
        draft.logo = { src, alt: draft.name || file.name, aspect };
        notice = `Logo loaded: ${file.name}`;
      } else {
        const [, role, slot] = input.dataset.file.split(':');
        if (ext !== 'ttf' && ext !== 'otf') throw new Error('fonts must be TTF or OTF (Word cannot embed WOFF)');
        const family = BrandAssetReaders.readFontFamily(bytes);
        if (!family) throw new Error(`${file.name} has no readable family name`);
        const font = draft.fonts[role] || (draft.fonts[role] = { family, files: {} });
        notice = font.family && font.family !== family
          ? `${ROLES[role]} switched from "${font.family}" to "${family}" (read from the file).` : `${ROLES[role]} ${SLOTS[slot]}: ${family}`;
        if (font.family !== family) font.files = {};   // one family per role
        font.family = family;
        font.files[slot] = `data:font/${ext};base64,${toBase64(bytes)}`;
      }
    } catch (e) {
      notice = 'Not loaded: ' + e.message;
    }
    render();
  }

  async function save() {
    const taken = BrandControls.takenIds();
    if (draft.id) taken.delete(draft.id);
    const fieldIds = new Set();
    const raw = {
      castmdBrand: 1, id: draft.id || BrandAssetReaders.slugId(draft.name, taken), name: draft.name.trim(),
      header: draft.header, footer: draft.footer, logo: draft.logo || undefined, colors: draft.colors,
      fonts: Object.fromEntries(Object.entries(draft.fonts).filter(([, f]) => Object.keys(f.files).length)),
      fields: draft.fields.filter(f => f.value.trim()).map(f => {
        const id = f.id && !fieldIds.has(f.id) ? f.id : BrandAssetReaders.slugId(f.label || f.value, fieldIds);
        fieldIds.add(id);
        return { id, label: f.label.trim(), value: f.value.trim(), href: f.href.trim(), line: f.line };
      }),
    };
    if (!Object.keys(raw.fonts).length) delete raw.fonts;
    try {
      await BrandControls.saveBrand(BrandPreset.validateBrand(raw));
      dialog.close();
    } catch (e) {
      notice = e.message.replace(/^brand file: /, 'Cannot save: ');
      render();
    }
  }

  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function imageAspect(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img.naturalHeight ? img.naturalWidth / img.naturalHeight : null);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('brandEditor');
    el.addEventListener('input', (e) => { if (e.target.dataset.path) setPath(e.target.dataset.path, e.target.value); });
    el.addEventListener('change', (e) => {
      if (e.target.dataset.file) onFile(e.target);
      else if (e.target.dataset.path) setPath(e.target.dataset.path, e.target.value);
    });
    el.addEventListener('click', (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (!act) return;
      if (act === 'add-field') { draft.fields.push({ id: null, label: '', value: '', href: '', line: 1 }); render(); }
      if (act === 'remove-field') { draft.fields.splice(Number(e.target.dataset.i), 1); render(); }
      if (act === 'clear-logo') { draft.logo = null; render(); }
      if (act === 'clear-font') { delete draft.fonts[e.target.dataset.role].files[e.target.dataset.slot]; render(); }
      if (act === 'cancel') el.close();
      if (act === 'save') save();
    });
    document.getElementById('newBrandBtn').addEventListener('click', () => open(null));
    document.getElementById('editBrandBtn').addEventListener('click', () => open(BrandControls.selectedRaw()));
  });

  return { open };
})();
