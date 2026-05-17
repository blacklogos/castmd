// Current output mode: 'md' or 'json'
let currentMode = 'md';
// Last converted content for preview/re-save
let lastContent = null;
let lastFilename = null;
// Confluence export state (set by detection + preview)
let confluenceInfo = null;          // { origin, tenant, contentType, id }
let confluencePreviewResult = null; // { nodes, truncated, rootTitle }

// Model context limits (tokens) — used for fit display
const MODEL_LIMITS = [
  { name: 'gpt-4',   limit: 8_192 },
  { name: 'gpt-4o',  limit: 128_000 },
  { name: 'claude',  limit: 200_000 },
  { name: 'gemini',  limit: 1_000_000 },
];

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('copyMdBtn').addEventListener('click', handleCopyMd);
  document.getElementById('saveMdBtn').addEventListener('click', handleSaveMd);
  document.getElementById('copyOutlineBtn').addEventListener('click', handleCopyOutline);
  document.getElementById('copyAllTabsBtn').addEventListener('click', handleCopyAllTabs);
  document.getElementById('saveAllTabsBtn').addEventListener('click', handleSaveAllTabs);
  document.getElementById('closePreview').addEventListener('click', closePreview);
  document.getElementById('recopyBtn').addEventListener('click', handleRecopy);
  document.getElementById('resaveBtn').addEventListener('click', handleResave);
  document.getElementById('confluencePreviewBtn').addEventListener('click', handleConfluencePreview);
  document.getElementById('confluenceDownloadBtn').addEventListener('click', handleConfluenceDownload);

  // Mode toggle — also updates button labels to reflect active output mode
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentMode = btn.dataset.mode;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b === btn));
      updateButtonLabels();
    });
  });

  // Reset Confluence preview state when depth changes — old result is stale.
  document.querySelectorAll('input[name="confDepth"]').forEach(r => {
    r.addEventListener('change', resetConfluenceState);
  });

  // Show tab count in badge
  const tabs = await chrome.tabs.query({ currentWindow: true });
  document.getElementById('tabCount').textContent = `${tabs.length} tabs`;
  document.getElementById('tabCount2').textContent = `${tabs.length} tabs`;

  // Detect Confluence Cloud page/folder — surface the export section only when relevant.
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  confluenceInfo = (typeof ConfluenceApi !== 'undefined') ? ConfluenceApi.parseUrl(activeTab && activeTab.url) : null;
  if (confluenceInfo) {
    document.getElementById('confluenceSection').hidden = false;
  }
});

// ── Action handlers ────────────────────────────────────────────────────────

async function handleCopyMd() {
  setStatus('Converting...', 'info');
  try {
    const { response, tab } = await injectAndConvert('convert');
    const output = buildOutput(response.markdown, response.url, response.title);
    await navigator.clipboard.writeText(output);
    lastContent = output;
    lastFilename = slugifyUrl(tab.url) + ({ json: '.json', xml: '.xml' }[currentMode] || '.md');
    const tokens = estimateTokens(output);
    setStatus('Copied', 'success', tokens);
    showModelFit(tokens);
    showPreview(output);
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function handleSaveMd() {
  setStatus('Converting...', 'info');
  try {
    const { response, tab } = await injectAndConvert('convert');
    const output = buildOutput(response.markdown, response.url, response.title);
    lastFilename = slugifyUrl(tab.url) + ({ json: '.json', xml: '.xml' }[currentMode] || '.md');
    lastContent = output;
    downloadText(lastFilename, output);
    const tokens = estimateTokens(output);
    setStatus('Saved', 'success', tokens);
    showModelFit(tokens);
    showPreview(output);
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function handleCopyOutline() {
  setStatus('Extracting...', 'info');
  try {
    const { response } = await injectAndConvert('getOutline');
    await navigator.clipboard.writeText(response.outline);
    lastContent = response.outline;
    setStatus('Copied', 'success');
    showPreview(response.outline);
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function handleCopyAllTabs() {
  setStatus('Requesting permission...', 'info');

  // Request optional host permission for non-active tab injection
  const hasPermission = await new Promise(resolve =>
    chrome.permissions.contains({ origins: ['<all_urls>'] }, resolve)
  );

  if (!hasPermission) {
    const granted = await new Promise(resolve =>
      chrome.permissions.request({ origins: ['<all_urls>'] }, resolve)
    );
    if (!granted) {
      setStatus('Permission denied', 'error');
      return;
    }
  }

  setStatus('Converting tabs...', 'info');
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const results = await Promise.allSettled(tabs.map(async tab => {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        return await chrome.tabs.sendMessage(tab.id, { action: 'getPageMeta' });
      } catch {
        return null;
      }
    }));

    const successes = results
      .filter(r => r.status === 'fulfilled' && r.value?.success)
      .map(r => r.value);

    if (successes.length === 0) {
      setStatus('No tabs could be converted', 'error');
      return;
    }

    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const combined = `# Research Session — ${date}\n\n` +
      successes.map(({ title, url, markdown }) =>
        `## [${title}](${url})\n\n${markdown}\n\n---\n\n`
      ).join('');

    await navigator.clipboard.writeText(combined);
    lastContent = combined;
    lastFilename = `session-${Date.now()}.md`;
    const tokens = estimateTokens(combined);
    setStatus(`Copied ${successes.length} tabs`, 'success', tokens);
    showModelFit(tokens);
    showPreview(combined);
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

// Saves each open tab as a separate file. Uses the current mode's extension
// (.md / .json / .xml). Chrome may prompt to allow multiple downloads.
async function handleSaveAllTabs() {
  setStatus('Requesting permission...', 'info');

  const hasPermission = await new Promise(resolve =>
    chrome.permissions.contains({ origins: ['<all_urls>'] }, resolve)
  );

  if (!hasPermission) {
    const granted = await new Promise(resolve =>
      chrome.permissions.request({ origins: ['<all_urls>'] }, resolve)
    );
    if (!granted) {
      setStatus('Permission denied', 'error');
      return;
    }
  }

  setStatus('Converting tabs...', 'info');
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const results = await Promise.allSettled(tabs.map(async tab => {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        return await chrome.tabs.sendMessage(tab.id, { action: 'getPageMeta' });
      } catch {
        return null;
      }
    }));

    const successes = results
      .filter(r => r.status === 'fulfilled' && r.value?.success)
      .map(r => r.value);

    if (successes.length === 0) {
      setStatus('No tabs could be saved', 'error');
      return;
    }

    const ext = { json: '.json', xml: '.xml' }[currentMode] || '.md';
    const seen = new Map();   // dedupe collisions when slugs match
    successes.forEach((meta, i) => {
      const output = buildOutput(meta.markdown, meta.url, meta.title);
      let name = slugifyUrl(meta.url);
      const count = (seen.get(name) || 0) + 1;
      seen.set(name, count);
      const filename = (count > 1 ? `${name}-${count}` : name) + ext;
      // Stagger downloads — back-to-back blob URLs can drop in Chrome
      setTimeout(() => downloadText(filename, output), i * 120);
    });

    setStatus(`Saving ${successes.length} files`, 'success');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function handleRecopy() {
  const text = document.getElementById('previewText').value;
  await navigator.clipboard.writeText(text);
  setStatus('Re-copied', 'success', estimateTokens(text));
}

async function handleResave() {
  const text = document.getElementById('previewText').value;
  downloadText(lastFilename || 'page.md', text);
  setStatus('Re-saved', 'success');
}

// ── Core helpers ───────────────────────────────────────────────────────────

async function injectAndConvert(action) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  const response = await chrome.tabs.sendMessage(tab.id, { action });
  if (!response?.success) throw new Error(response?.error || 'Conversion failed');
  return { response, tab };
}

function buildOutput(markdown, url, title) {
  if (currentMode === 'json') {
    return JSON.stringify({
      url: url || '', title: title || '', markdown,
      tokens: estimateTokens(markdown), timestamp: new Date().toISOString()
    }, null, 2);
  }
  if (currentMode === 'xml') {
    return `<document>\n<source>${url || ''}</source>\n<document_content>\n${markdown}\n</document_content>\n</document>`;
  }
  return markdown;
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function slugifyUrl(url) {
  try {
    const { pathname, hostname } = new URL(url);
    let slug = pathname.split('/').filter(Boolean).pop() || hostname;
    return decodeURIComponent(slug)
      .toLowerCase()
      .replace(/\.[a-z]{2,4}$/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 35)
      .replace(/-+$/, '') || hostname;
  } catch {
    return 'page';
  }
}

function downloadText(filename, content) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function updateButtonLabels() {
  const labels = {
    md:   { copy: 'Copy as Markdown', save: 'Save as .md',   saveAll: 'Save all tabs as .md'   },
    json: { copy: 'Copy as JSON',     save: 'Save as .json', saveAll: 'Save all tabs as .json' },
    xml:  { copy: 'Copy for Claude',  save: 'Save as .xml',  saveAll: 'Save all tabs as .xml'  },
  };
  const l = labels[currentMode] || labels.md;
  document.getElementById('copyMdLabel').textContent = l.copy;
  document.getElementById('saveMdLabel').textContent = l.save;
  document.getElementById('saveAllTabsLabel').textContent = l.saveAll;
}

// ── UI helpers ─────────────────────────────────────────────────────────────

function setStatus(msg, type, tokens) {
  const row = document.getElementById('statusRow');
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const tokenEl = document.getElementById('tokenCount');

  row.className = `status-row ${type}`;
  dot.style.display = msg ? 'block' : 'none';
  text.textContent = msg;
  tokenEl.textContent = tokens ? `~${tokens.toLocaleString()} tokens` : '';
}

function showModelFit(tokens) {
  const container = document.getElementById('modelFit');
  container.innerHTML = '';

  MODEL_LIMITS.forEach(({ name, limit }) => {
    const chip = document.createElement('span');
    chip.className = `model-chip ${tokens <= limit ? 'fits' : 'over'}`;
    chip.textContent = name;
    container.appendChild(chip);
  });

  container.classList.add('visible');
}

function showPreview(content) {
  document.getElementById('previewText').value = content;
  document.getElementById('previewPanel').classList.add('open');
}

function closePreview() {
  document.getElementById('previewPanel').classList.remove('open');
  document.getElementById('modelFit').classList.remove('visible');
}

// ── Confluence tree export ─────────────────────────────────────────────────

async function handleConfluencePreview() {
  if (!confluenceInfo) return;
  const depth = document.querySelector('input[name="confDepth"]:checked').value;
  setStatus('Checking permission…', 'info');

  const ok = await ensureHostPermission(confluenceInfo.origin);
  if (!ok) { setStatus('Permission denied', 'error'); return; }

  setStatus('Discovering pages…', 'info');
  try {
    const result = await ConfluenceExport.preview(confluenceInfo, depth);

    if (result.truncated) {
      const proceed = confirm(
        `This subtree exceeds ${ConfluenceExport.MAX_PAGES} pages.\n\n` +
        `Only the first ${ConfluenceExport.MAX_PAGES} will be exported. Continue?`
      );
      if (!proceed) { setStatus('Cancelled', 'info'); return; }
    }

    confluencePreviewResult = result;
    const count = Math.min(result.nodes.length, ConfluenceExport.MAX_PAGES);
    const noun = count === 1 ? 'page' : 'pages';
    setStatus(`Found ${count} ${noun}`, 'success');

    const dlBtn = document.getElementById('confluenceDownloadBtn');
    dlBtn.hidden = false;
    document.getElementById('confluenceDownloadLabel').textContent = `Download ZIP (${count} ${noun})`;
  } catch (e) {
    setStatus(`Discovery failed: ${e.message}`, 'error');
  }
}

async function handleConfluenceDownload() {
  if (!confluenceInfo || !confluencePreviewResult) return;
  const { nodes, rootTitle } = confluencePreviewResult;

  const progressEl = document.getElementById('confluenceProgress');
  const barEl = document.getElementById('confluenceProgressBar');
  const txtEl = document.getElementById('confluenceProgressText');
  const warnEl = document.getElementById('confluenceWarn');
  const dlBtn = document.getElementById('confluenceDownloadBtn');

  progressEl.hidden = false;
  warnEl.hidden = false;
  dlBtn.disabled = true;
  barEl.value = 0;
  txtEl.textContent = '0 / ?';
  setStatus('Fetching pages…', 'info');

  try {
    const { blob, filename, skipped } = await ConfluenceExport.exportTree(
      confluenceInfo.origin, rootTitle, nodes,
      (done, total) => {
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        barEl.value = pct;
        txtEl.textContent = `${done} / ${total}`;
      }
    );

    downloadBlob(filename, blob);

    const successCount = Math.min(nodes.length, ConfluenceExport.MAX_PAGES) - skipped.length;
    const msg = skipped.length > 0
      ? `Exported ${successCount} pages (${skipped.length} skipped — see _skipped.txt)`
      : `Exported ${successCount} pages`;
    setStatus(msg, 'success');
  } catch (e) {
    setStatus(`Export failed: ${e.message}`, 'error');
  } finally {
    dlBtn.disabled = false;
    warnEl.hidden = true;
  }
}

function resetConfluenceState() {
  confluencePreviewResult = null;
  document.getElementById('confluenceDownloadBtn').hidden = true;
  document.getElementById('confluenceProgress').hidden = true;
  document.getElementById('confluenceWarn').hidden = true;
}

async function ensureHostPermission(origin) {
  const pattern = origin + '/*';
  const has = await new Promise(r => chrome.permissions.contains({ origins: [pattern] }, r));
  if (has) return true;
  return new Promise(r => chrome.permissions.request({ origins: [pattern] }, r));
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
