// Injected after content.js (same isolated world) by the popup's "Export page"
// action. Defines window.__castmdCapture(), which the popup then calls through
// chrome.scripting.executeScript({ func }) to get a serializable snapshot of the
// page's main content for export.html.
//
// Why this runs on the live page and not on fetched HTML: visibility
// (getComputedStyle), the image the browser actually picked from srcset
// (currentSrc), rendered sizes, inline SVG diagrams and canvas pixels only exist
// here. The snapshot is still untrusted page HTML: export.js sanitizes it again
// with lib/export-sanitize.js before anything is rendered.
(function () {

const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT',
  'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'LINK', 'META', 'VIDEO', 'AUDIO']);
// Presentation properties copied onto SVG nodes so diagrams styled by page CSS
// (d3, chart libs) keep their look once the page stylesheets are gone.
const SVG_STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity',
  'font-family', 'font-size', 'font-weight', 'color'];
const SVG_STYLE_NODE_LIMIT = 3000;
const ICON_MAX_PX = 24;

window.__castmdCapture = function () {
  const { findMainContent, shouldSkipElement, findPageTitle } = window.__castmd;
  const root = findMainContent();
  const title = findPageTitle() || document.title || '';
  const clone = root.cloneNode(true);

  // cloneNode(true) preserves document order, so index i is the same node in both.
  const live = [root, ...root.querySelectorAll('*')];
  const copy = [clone, ...clone.querySelectorAll('*')];
  const dropped = new Set();
  const replacements = [];

  for (let i = 1; i < live.length; i++) {
    const el = live[i];
    if (dropped.has(el.parentElement)) { dropped.add(el); continue; }
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;   // handled with its svg
    if (DROP_TAGS.has(el.tagName) || shouldSkipElement(el)) {
      dropped.add(el); replacements.push([copy[i], null]); continue;
    }
    if (el.tagName === 'IMG') fixImage(el, copy[i]);
    else if (el.tagName === 'A') fixLink(el, copy[i]);
    else if (el.tagName.toLowerCase() === 'svg') {
      dropped.add(el); replacements.push([copy[i], svgToImage(el)]);
    } else if (el.tagName === 'CANVAS') {
      dropped.add(el); replacements.push([copy[i], canvasToImage(el)]);
    }
  }
  for (const [node, replacement] of replacements) {
    if (replacement) node.replaceWith(replacement); else node.remove();
  }

  // The export page prints the title itself; a matching first h1 would repeat it.
  const firstH1 = clone.querySelector('h1');
  if (firstH1 && normalize(firstH1.textContent) === normalize(title)) firstH1.remove();

  return { html: clone.innerHTML, url: location.href, title, meta: readMeta(root) };
};

function fixImage(el, img) {
  let src = el.currentSrc || el.src || '';
  // Lazy loaders park a placeholder in src and the real URL in a data attribute.
  const lazy = el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original');
  const useLazy = lazy && (!src || src.startsWith('data:') || !el.complete || el.naturalWidth <= 1);
  if (useLazy) src = absolute(lazy);
  img.setAttribute('src', src);
  img.removeAttribute('srcset');
  img.removeAttribute('sizes');
  img.removeAttribute('loading');
  // A lazy placeholder's rendered box (often 1x1) says nothing about the real
  // image; leave the size to the image itself.
  if (useLazy) { img.removeAttribute('width'); img.removeAttribute('height'); return; }
  const rect = el.getBoundingClientRect();
  const w = Math.round(rect.width) || el.naturalWidth;
  const h = Math.round(rect.height) || el.naturalHeight;
  if (w && h) { img.setAttribute('width', w); img.setAttribute('height', h); }
}

function fixLink(el, a) {
  if (el.getAttribute('href')) a.setAttribute('href', el.href);
}

function svgToImage(svg) {
  const rect = svg.getBoundingClientRect();
  const w = Math.round(rect.width), h = Math.round(rect.height);
  // Icon-sized or hidden SVGs are UI chrome (anchor links, copy buttons), not diagrams.
  if (!w || !h || (w <= ICON_MAX_PX && h <= ICON_MAX_PX) ||
      (svg.getAttribute('aria-hidden') === 'true' && w <= 48)) return null;

  const copy = svg.cloneNode(true);
  const liveNodes = [svg, ...svg.querySelectorAll('*')];
  const copyNodes = [copy, ...copy.querySelectorAll('*')];
  liveNodes.slice(0, SVG_STYLE_NODE_LIMIT).forEach((node, i) => {
    const cs = getComputedStyle(node);
    const inline = SVG_STYLE_PROPS.map(p => `${p}:${cs.getPropertyValue(p)}`).join(';');
    copyNodes[i].setAttribute('style', inline + ';' + (copyNodes[i].getAttribute('style') || ''));
  });
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', w);
  copy.setAttribute('height', h);
  const xml = new XMLSerializer().serializeToString(copy);
  return makeImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml), w, h, svg.getAttribute('aria-label') || 'Diagram');
}

function canvasToImage(canvas) {
  const rect = canvas.getBoundingClientRect();
  try {
    // Throws on a canvas tainted by cross-origin pixels; that chart is dropped.
    return makeImage(canvas.toDataURL('image/png'), Math.round(rect.width) || canvas.width,
      Math.round(rect.height) || canvas.height, canvas.getAttribute('aria-label') || 'Chart');
  } catch {
    return null;
  }
}

function makeImage(src, w, h, alt) {
  const img = document.createElement('img');
  img.setAttribute('src', src);
  img.setAttribute('width', w);
  img.setAttribute('height', h);
  img.setAttribute('alt', alt);
  return img;
}

function readMeta(root) {
  const meta = (sel) => document.querySelector(sel)?.getAttribute('content')?.trim() || '';
  const time = root.querySelector('time[datetime]')?.getAttribute('datetime') || '';
  return {
    author: meta('meta[name="author"]') || meta('meta[property="article:author"]'),
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    published: meta('meta[property="article:published_time"]') || meta('meta[name="date"]') || time,
    siteName: meta('meta[property="og:site_name"]') || location.hostname,
    keywords: meta('meta[name="keywords"]'),
    lang: document.documentElement.lang || '',
  };
}

function absolute(url) {
  try { return new URL(url, location.href).href; } catch { return ''; }
}

function normalize(text) {
  return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

})();
