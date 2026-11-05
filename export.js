// Export page controller. The popup stores a page capture (export-capture.js)
// in chrome.storage.session under `export:<id>` and opens export.html?id=<id>.
// Here it is sanitized, its images embedded, and the user edits metadata and
// header/footer before downloading .html, printing to PDF, or downloading .docx.

const FIELDS = ['title', 'url', 'author', 'published', 'captured', 'siteName', 'description', 'tags'];
const FIELD_IDS = { title: 'fTitle', url: 'fUrl', author: 'fAuthor', published: 'fPublished', captured: 'fCaptured',
  siteName: 'fSite', description: 'fDescription', tags: 'fTags' };
const DEFAULT_HEADER = '{title}';
const DEFAULT_FOOTER = '{site}  ·  Page {page} of {pages}';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

let capturedHtml = '';   // sanitized body, images not yet embedded
let bodyHtml = '';       // sanitized body with every reachable image as a data: URL
let lang = '';

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const id = new URLSearchParams(location.search).get('id');
  const key = 'export:' + id;
  const stored = id ? await chrome.storage.session.get(key) : {};
  const capture = stored[key];
  if (!capture) {
    setStatus('Nothing to export. Open a page and use "Export page" in the castmd popup.', true);
    return;
  }

  const meta = capture.meta || {};
  lang = meta.lang || '';
  setFields({
    title: capture.title, url: capture.url, author: meta.author, published: meta.published,
    captured: localDate(), siteName: meta.siteName,
    description: meta.description, tags: meta.keywords,
  });
  $('fHeader').value = DEFAULT_HEADER;
  $('fFooter').value = DEFAULT_FOOTER;
  document.title = `Export: ${capture.title || 'page'}`;

  capturedHtml = bodyHtml = ExportSanitize.sanitize(capture.html);
  await BrandControls.init(brandChanged);
  applyBrandTemplates();
  render();

  document.querySelectorAll('input, textarea').forEach(el => el.addEventListener('input', render));
  $('htmlBtn').addEventListener('click', downloadHtml);
  $('pdfBtn').addEventListener('click', () => window.print());
  $('docxBtn').addEventListener('click', downloadDocx);
  $('allowImagesBtn').addEventListener('click', allowImagesAndRetry);

  await embed();
  ['htmlBtn', 'pdfBtn', 'docxBtn'].forEach(b => { $(b).disabled = false; });
}

// ── State ──────────────────────────────────────────────────────────────────

function setFields(values) {
  FIELDS.forEach(f => { $(FIELD_IDS[f]).value = values[f] || ''; });
}

function readMeta() {
  const meta = { lang };
  FIELDS.forEach(f => { meta[f] = $(FIELD_IDS[f]).value.trim(); });
  return meta;
}

function options() {
  return { meta: readMeta(), includeMeta: $('fIncludeMeta').checked, header: $('fHeader').value,
    footer: $('fFooter').value, brand: BrandControls.current() };
}

function render() {
  const opts = options();
  $('doc').innerHTML = ExportDocument.articleHtml({ bodyHtml, ...opts });
  $('docStyle').textContent = ExportDocument.documentCss(opts, opts.meta);
}

// Picking a preset swaps in its header/footer templates (the user can still
// edit them); "None" restores the plain defaults.
function applyBrandTemplates() {
  const t = BrandControls.templates();
  $('fHeader').value = (t && t.header) || DEFAULT_HEADER;
  $('fFooter').value = (t && t.footer) || DEFAULT_FOOTER;
}

function brandChanged({ applyTemplates, message, error }) {
  if (applyTemplates) applyBrandTemplates();
  render();
  if (error) setStatus(error, true);
  else if (message) setStatus(message);
}

// ── Images ─────────────────────────────────────────────────────────────────

async function embed() {
  const result = await ExportImages.embedImages(capturedHtml, (done, total) =>
    setStatus(`Embedding images ${done}/${total}…`));
  bodyHtml = result.html;
  render();
  const notice = $('imageNotice');
  if (result.failed) {
    $('imageNoticeText').textContent = `${result.failed} of ${result.total} images could not be downloaded. ` +
      'They stay linked in HTML and PDF, and show as a placeholder in DOCX.';
    notice.hidden = false;
  } else {
    notice.hidden = true;
  }
  setStatus(result.total ? `Ready. ${result.total - result.failed} of ${result.total} images embedded.` : 'Ready.');
}

// Host access lets the extension read image bytes that the page's CDN does
// not serve with CORS headers. Requested here, with the reason on screen,
// instead of up front in the popup.
async function allowImagesAndRetry() {
  const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
  if (!granted) { setStatus('Image access not granted.', true); return; }
  await embed();
}

// ── Downloads ──────────────────────────────────────────────────────────────

function downloadHtml() {
  const opts = options();
  const html = ExportDocument.standaloneHtml({ bodyHtml, ...opts });
  download(new Blob([html], { type: 'text/html' }), fileName(opts.meta, 'html'));
  setStatus('Saved .html');
}

async function downloadDocx() {
  const btn = $('docxBtn');
  btn.disabled = true;
  setStatus('Building .docx…');
  try {
    const opts = options();
    const images = await ExportImages.prepareDocxImages(bodyHtml, opts.brand && opts.brand.logo ? [opts.brand.logo.src] : []);
    const entries = DocxPackage.build({ bodyHtml, images, ...opts });
    const zip = await ZipBuilder.buildZip(entries);
    download(new Blob([zip], { type: DOCX_MIME }), fileName(opts.meta, 'docx'));
    setStatus('Saved .docx');
  } catch (e) {
    setStatus('DOCX export failed: ' + e.message, true);
  } finally {
    btn.disabled = false;
  }
}

// YYYY-MM-DD in the user's timezone (toISOString would give the UTC date).
function localDate() {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(n => String(n).padStart(2, '0')).join('-');
}

function fileName(meta, ext) {
  return HtmlToMarkdown.sanitizeTitle(meta.title || 'page') + '.' + ext;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setStatus(text, isError) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}
