// Brand preset controls on the export page: pick a preset, import a
// .castmd-brand.json file, remove one, and switch its parts on or off
// (logo, typefaces, each contact field).
//
// Imported presets and the on/off choices persist in chrome.storage.local, so a
// BiPlus user imports the file once and every later export starts branded.
// Nothing here is bundled with castmd: the preset list starts empty.

const BrandControls = (() => {
  const STORE_KEY = 'brandPresets';   // { brands: {id: brand}, selected: id, toggles: {id: toggles} }
  let state = { brands: {}, selected: '', toggles: {} };
  let onChange = () => {};
  const $ = (id) => document.getElementById(id);

  async function init(changed) {
    onChange = changed;
    const stored = (await chrome.storage.local.get(STORE_KEY))[STORE_KEY];
    if (stored) state = { brands: stored.brands || {}, selected: stored.selected || '', toggles: stored.toggles || {} };
    if (!state.brands[state.selected]) state.selected = '';

    $('brandSelect').addEventListener('change', (e) => select(e.target.value, true));
    $('importBrandBtn').addEventListener('click', () => $('brandFile').click());
    $('brandFile').addEventListener('change', importFile);
    $('removeBrandBtn').addEventListener('click', removeSelected);
    $('exportBrandBtn').addEventListener('click', exportSelected);
    paint();
  }

  // The stored (unresolved) preset that is selected, for the editor and viewer.
  function selectedRaw() {
    return state.brands[state.selected] || null;
  }

  function takenIds() {
    return new Set(Object.keys(state.brands));
  }

  // Saves a validated brand from the editor. Toggles of fields that still
  // exist are kept; new fields start switched on.
  async function saveBrand(brand) {
    const old = state.toggles[brand.id];
    const fresh = BrandPreset.defaultToggles(brand);
    if (old) {
      fresh.logo = old.logo !== false;
      fresh.fonts = old.fonts !== false;
      for (const id of Object.keys(fresh.fields)) if (old.fields && old.fields[id] === false) fresh.fields[id] = false;
    }
    state.brands[brand.id] = brand;
    state.toggles[brand.id] = fresh;
    await select(brand.id, true);
  }

  // Downloads the selected preset as a .castmd-brand.json to share.
  function exportSelected() {
    const brand = selectedRaw();
    if (!brand) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(brand)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${brand.id}.castmd-brand.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // The resolved brand for rendering, or null.
  function current() {
    const brand = state.brands[state.selected];
    return brand ? BrandPreset.resolveBrand(brand, state.toggles[brand.id]) : null;
  }

  // The selected preset's own header/footer templates, if it has them.
  function templates() {
    const brand = state.brands[state.selected];
    return brand ? { header: brand.header, footer: brand.footer } : null;
  }

  async function select(id, applyTemplates) {
    state.selected = state.brands[id] ? id : '';
    await save();
    paint();
    onChange({ applyTemplates });
  }

  async function importFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const brand = BrandPreset.validateBrand(JSON.parse(await file.text()));
      state.brands[brand.id] = brand;
      state.toggles[brand.id] = BrandPreset.defaultToggles(brand);
      await select(brand.id, true);
      onChange({ message: `Imported brand preset "${brand.name}".` });
    } catch (err) {
      onChange({ error: `Brand file rejected: ${err.message}` });
    }
  }

  async function removeSelected() {
    const id = state.selected;
    delete state.brands[id];
    delete state.toggles[id];
    await select('', true);
  }

  async function save() {
    try {
      await chrome.storage.local.set({ [STORE_KEY]: state });
    } catch (err) {
      onChange({ error: 'Could not save brand presets: ' + err.message });
    }
  }

  function paint() {
    const sel = $('brandSelect');
    sel.replaceChildren(new Option('None', ''), ...Object.values(state.brands).map(b => new Option(b.name, b.id)));
    sel.value = state.selected;
    const brand = state.brands[state.selected];
    ['removeBrandBtn', 'editBrandBtn', 'viewBrandBtn', 'exportBrandBtn'].forEach(b => { $(b).hidden = !brand; });
    const box = $('brandToggles');
    box.hidden = !brand;
    box.replaceChildren();
    if (!brand) return;

    const t = state.toggles[brand.id] || (state.toggles[brand.id] = BrandPreset.defaultToggles(brand));
    const add = (text, detail, checked, set) => {
      const label = document.createElement('label');
      label.className = 'check';
      const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked });
      input.addEventListener('change', async () => { set(input.checked); await save(); onChange({}); });
      label.append(input, ' ' + text);
      if (detail) { const small = document.createElement('small'); small.textContent = ' ' + detail; label.append(small); }
      box.append(label);
    };
    if (brand.logo) add('Logo', '', t.logo !== false, v => { t.logo = v; });
    if (brand.fonts) add('Brand typefaces', Object.values(brand.fonts).map(f => f.family).join(' + '), t.fonts !== false, v => { t.fonts = v; });
    brand.fields.forEach(f => add(BrandPreset.fieldName(f), f.value, t.fields[f.id] !== false, v => { t.fields[f.id] = v; }));
  }

  return { init, current, templates, selectedRaw, takenIds, saveBrand };
})();
