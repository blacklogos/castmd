// Content script: renders local .md files opened directly in the browser
// (file:///path/to/doc.md) as formatted HTML. Declared in manifest.json for
// file:// URLs; the user must enable "Allow access to file URLs" on the
// extension card in chrome://extensions for it to run.
//
// Chrome displays a plain-text file as a document whose body contains a single
// <pre> with the raw source. We read that text, convert it with
// lib/markdown-to-html.js (loaded before this script), and swap the body.

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

  const raw = body.children[0].textContent || '';
  const html = window.MarkdownToHtml.markdownToHtml(raw);

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
})();
