// Content script: renders local .md files opened directly in the browser
// (file:///path/to/doc.md) as formatted HTML. Declared in manifest.json for
// file:// URLs; the user must enable "Allow access to file URLs" on the
// extension card in chrome://extensions for it to run.
//
// Chrome displays a plain-text file as a document whose body contains a single
// <pre> with the raw source. We read that text, convert it with
// lib/markdown-to-html.js (loaded before this script), and swap the body.
//
// Declared with "world": "MAIN" (not the default isolated world) so its Save
// button can call showSaveFilePicker() directly — that API is not exposed to
// isolated-world content scripts, and relaying it through the background
// service worker loses the transient user activation the picker requires.
// This file and lib/markdown-to-html.js must stay free of chrome.* API calls;
// adding one here would silently break (MAIN world has no chrome.* access).

(function () {
  'use strict';

  // Guard 1: only file:// URLs with a markdown extension. include_globs in the
  // manifest already filter, but globs are case-sensitive — re-check here.
  if (location.protocol !== 'file:') return;
  if (!/\.(md|markdown|mdown|mkd)$/i.test(location.pathname)) return;

  // Guard 2: only Chrome's plain-text viewer layout (body → single <pre>).
  // If the body is anything else, some other handler already rendered the file.
  const body = document.body;
  if (!body || body.children.length !== 1 || body.children[0].tagName !== 'PRE') return;

  // Guard 3: the renderer lib must have loaded (manifest lists it first, but a
  // failed load shouldn't produce an uncaught TypeError). Any renderer error
  // falls back to Chrome's raw <pre> view rather than breaking the page.
  if (!window.MarkdownToHtml) return;
  const raw = body.children[0].textContent || '';
  let html;
  try {
    html = window.MarkdownToHtml.markdownToHtml(raw);
  } catch (e) {
    return;
  }

  // Title: first H1 text if present, else the filename.
  const h1 = raw.match(/^#\s+(.+?)\s*#*\s*$/m);
  const fileName = decodeURIComponent(location.pathname.split('/').pop() || 'markdown');
  document.title = h1 ? h1[1] : fileName;

  const container = document.createElement('article');
  container.className = 'castmd-viewer';
  container.innerHTML = html;

  // Keep the raw source around, hidden, so "view source" behavior is one
  // toggle away and nothing is destroyed.
  const rawPre = body.children[0];
  rawPre.classList.add('castmd-raw');
  rawPre.hidden = true;

  body.insertBefore(container, rawPre);

  // ── Editor ──────────────────────────────────────────────────────────────
  // Kept for the lifetime of this page load only. Re-picking after a reload is
  // intentional (no IndexedDB persistence; see plan, deliberately deferred).
  let fileHandle = null;

  function makeButton(label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'castmd-btn';
    btn.textContent = label;
    return btn;
  }

  const editor = document.createElement('textarea');
  editor.className = 'castmd-editor';
  editor.spellcheck = false;
  editor.value = raw; // raw source, frontmatter included
  editor.hidden = true;

  const toolbar = document.createElement('div');
  toolbar.className = 'castmd-toolbar';
  const toggleBtn = makeButton('Edit');
  const saveBtn = makeButton('Save');
  saveBtn.hidden = true;
  const status = document.createElement('span');
  status.className = 'castmd-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  toolbar.append(toggleBtn, saveBtn, status);

  function setStatus(text) {
    status.textContent = text;
    if (text) setTimeout(() => { if (status.textContent === text) status.textContent = ''; }, 4000);
  }

  function setEditing(on) {
    editor.hidden = !on;
    container.hidden = on;
    saveBtn.hidden = !on;
    toggleBtn.textContent = on ? 'Preview' : 'Edit';
    if (on) editor.focus();
    else container.innerHTML = window.MarkdownToHtml.markdownToHtml(editor.value);
  }

  toggleBtn.addEventListener('click', () => setEditing(editor.hidden));

  if (!window.showSaveFilePicker) {
    saveBtn.disabled = true;
    saveBtn.title = 'Saving needs a Chromium browser with the File System Access API';
  }

  saveBtn.addEventListener('click', async () => {
    const text = editor.value;
    try {
      // FIRST await must be the picker. Anything awaited before it can burn the
      // transient user activation and make showSaveFilePicker throw SecurityError.
      if (!fileHandle) {
        fileHandle = await window.showSaveFilePicker({ suggestedName: fileName });
      }
      const writable = await fileHandle.createWritable();
      await writable.write(text);
      await writable.close();
      rawPre.textContent = text; // keep the hidden "view source" copy honest
      setStatus('Saved');
    } catch (e) {
      if (e && e.name === 'AbortError') { setStatus(''); return; } // user cancelled
      fileHandle = null; // force a fresh picker next click
      setStatus(`Save failed: ${e.message}`);
    }
  });

  body.insertBefore(toolbar, container);
  body.insertBefore(editor, rawPre);
})();
