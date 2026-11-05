// Browser-only image handling for the export page.
//
// embedImages: replaces every http(s) <img src> in the sanitized body with a
//   data: URL so the .html download works offline and the DOCX has bytes to
//   embed. Fetching from an extension page bypasses CORS only with host
//   permission; without it, CDNs that send Access-Control-Allow-Origin still
//   work and the rest stay linked (HTML/PDF still show them online).
// prepareDocxImages: Word reliably renders PNG, JPEG and GIF only, so SVG
//   (captured diagrams), WebP and AVIF are rasterized to PNG through a canvas.

(function (global) {
  'use strict';

  const FETCH_TIMEOUT_MS = 15000;
  const CONCURRENCY = 4;
  const SVG_SCALE = 2;   // rasterize diagrams at 2x so they stay sharp in print
  const NATIVE = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif' };

  async function embedImages(bodyHtml, onProgress) {
    const doc = new DOMParser().parseFromString(bodyHtml, 'text/html');
    const imgs = Array.from(doc.querySelectorAll('img')).filter(img => /^https?:/i.test(img.getAttribute('src')));
    const srcs = [...new Set(imgs.map(img => img.getAttribute('src')))];
    const resolved = {};
    let done = 0;
    await runPool(srcs, async (src) => {
      resolved[src] = await fetchAsDataUrl(src).catch(() => null);
      onProgress && onProgress(++done, srcs.length);
    });
    imgs.forEach(img => { const data = resolved[img.getAttribute('src')]; if (data) img.setAttribute('src', data); });
    const failed = srcs.filter(src => !resolved[src]).length;
    return { html: doc.body.innerHTML, total: srcs.length, failed };
  }

  async function fetchAsDataUrl(src) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(src, { signal: ctrl.signal, credentials: 'omit' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      if (!/^image\//.test(blob.type)) throw new Error('not an image: ' + blob.type);
      return await blobToDataUrl(blob);
    } finally {
      clearTimeout(timer);
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // extraSrcs: images outside the body that the DOCX also needs (brand logo).
  async function prepareDocxImages(bodyHtml, extraSrcs) {
    const doc = new DOMParser().parseFromString(bodyHtml, 'text/html');
    const srcs = [...new Set(Array.from(doc.querySelectorAll('img')).map(img => img.getAttribute('src'))
      .concat(extraSrcs || []).filter(src => /^data:image\//i.test(src)))];
    const images = {};
    await runPool(srcs, async (src) => {
      try { images[src] = await toDocxImage(src); } catch { /* renders as [Image: alt] */ }
    });
    return images;
  }

  async function toDocxImage(dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    const img = await loadImage(dataUrl);
    const width = img.naturalWidth || 800, height = img.naturalHeight || 600;
    const ext = NATIVE[blob.type];
    if (ext) return { bytes: new Uint8Array(await blob.arrayBuffer()), ext, width, height };

    const scale = blob.type === 'image/svg+xml' ? SVG_SCALE : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';   // transparent diagrams read badly on Word's dark mode
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('rasterize failed');
    return { bytes: new Uint8Array(await png.arrayBuffer()), ext: 'png', width, height };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image decode failed'));
      img.src = src;
    });
  }

  async function runPool(items, worker) {
    let next = 0;
    const lanes = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) await worker(items[next++]);
    });
    await Promise.all(lanes);
  }

  global.ExportImages = { embedImages, prepareDocxImages };
})(window);
