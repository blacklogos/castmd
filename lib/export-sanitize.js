// Allowlist sanitizer for captured page HTML before the export page renders it
// (preview, standalone .html, print-to-PDF) or walks it (DOCX).
//
// The capture comes from an arbitrary web page and is rendered inside an
// extension page, so nothing executable may survive: unknown tags are unwrapped
// (children kept), dangerous ones dropped with their subtree, every attribute
// outside the per-tag allowlist removed, and URLs limited to safe schemes.
// Structural wrappers (section, article, ...) collapse to plain <div> so the
// DOCX walker only has one container type to handle.

(function (global) {
  'use strict';

  const ALLOWED = {
    a: ['href', 'title'], img: ['src', 'alt', 'title', 'width', 'height'],
    td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], ol: ['start'],
  };
  const PLAIN = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'blockquote', 'pre',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'figure', 'figcaption',
    'hr', 'br', 'dl', 'dt', 'dd', 'div', 'strong', 'b', 'em', 'i', 'u', 'code', 'kbd', 'samp',
    'mark', 's', 'del', 'ins', 'sub', 'sup', 'q'];
  PLAIN.forEach(tag => { ALLOWED[tag] = ALLOWED[tag] || []; });

  const TO_DIV = new Set(['section', 'article', 'main', 'header', 'footer', 'aside', 'details',
    'summary', 'center', 'address', 'hgroup']);
  const DROP = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'frame', 'object',
    'embed', 'applet', 'form', 'input', 'button', 'select', 'textarea', 'option', 'link', 'meta',
    'base', 'svg', 'math', 'canvas', 'video', 'audio', 'source', 'track', 'head', 'title', 'dialog']);

  const SAFE_HREF = /^(https?:|mailto:|#)/i;
  const SAFE_SRC = /^(https?:|data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,])/i;

  function sanitize(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    cleanChildren(doc.body, doc);
    return doc.body.innerHTML;
  }

  function cleanChildren(parent, doc) {
    for (const node of Array.from(parent.childNodes)) cleanNode(node, doc);
  }

  function cleanNode(node, doc) {
    if (node.nodeType === 3) return;                 // text
    if (node.nodeType !== 1) { node.remove(); return; } // comments, processing instructions
    const tag = node.tagName.toLowerCase();
    if (DROP.has(tag)) { node.remove(); return; }

    cleanChildren(node, doc);
    if (TO_DIV.has(tag)) { replaceTag(node, 'div', doc); return; }
    if (!ALLOWED[tag]) { unwrap(node); return; }

    const keep = ALLOWED[tag];
    for (const attr of Array.from(node.attributes)) {
      if (keep.indexOf(attr.name.toLowerCase()) === -1) node.removeAttribute(attr.name);
    }
    if (tag === 'a') checkUrl(node, 'href', SAFE_HREF);
    if (tag === 'img') {
      checkUrl(node, 'src', SAFE_SRC);
      if (!node.getAttribute('src')) node.remove();   // nothing left to show
    }
  }

  function checkUrl(el, attr, pattern) {
    const value = (el.getAttribute(attr) || '').trim();
    if (!pattern.test(value)) el.removeAttribute(attr);
  }

  function unwrap(el) {
    while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
    el.remove();
  }

  function replaceTag(el, tag, doc) {
    const div = doc.createElement(tag);
    while (el.firstChild) div.appendChild(el.firstChild);
    el.parentNode.replaceChild(div, el);
  }

  global.ExportSanitize = { sanitize };
})(window);
