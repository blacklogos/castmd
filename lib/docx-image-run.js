// Inline DOCX image runs for lib/html-to-docx-body.js. Bytes come from
// pkg.images (prepared by lib/export-images.js); each distinct src is stored
// once under word/media/. Size follows the <img> width/height (CSS px), scaled
// down to the A4 content width with the aspect ratio kept. An image without
// bytes renders as "[Image: alt]" so nothing disappears silently.

(function (global) {
  'use strict';

  const CONTENT_WIDTH_EMU = 6264720;   // A4 width minus 18mm margins
  const EMU_PER_PX = 9525;

  function imageRun(img, pkg, { xml, addRel }) {
    const src = img.getAttribute('src');
    const data = pkg.images[src];
    const alt = img.getAttribute('alt') || '';
    if (!data) return `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${xml(`[Image${alt ? ': ' + alt : ''}]`)}</w:t></w:r>`;

    let rid = pkg.mediaBySrc[src];
    if (!rid) {
      const name = `media/image${pkg.media.length + 1}.${data.ext}`;
      pkg.media.push({ path: 'word/' + name, bytes: data.bytes, ext: data.ext });
      rid = pkg.mediaBySrc[src] = addRel(pkg, 'image', name);
    }
    const wAttr = parseInt(img.getAttribute('width'), 10), hAttr = parseInt(img.getAttribute('height'), 10);
    let w = wAttr || data.width, h = (wAttr && hAttr) ? hAttr : Math.round((data.height / data.width) * w);
    let cx = w * EMU_PER_PX, cy = h * EMU_PER_PX;
    if (cx > CONTENT_WIDTH_EMU) { cy = Math.round(cy * CONTENT_WIDTH_EMU / cx); cx = CONTENT_WIDTH_EMU; }
    return drawingRun(rid, cx, cy, pkg.nextId++, xml(alt));
  }

  // A <w:r> holding one inline picture. Also used for the logo in the DOCX
  // header (lib/docx-brand-parts.js), whose relationship lives in the header part.
  function drawingRun(rid, cx, cy, id, altXml) {
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:docPr id="${id}" name="Image ${id}" descr="${altXml}"/>` +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      `<pic:nvPicPr><pic:cNvPr id="${id}" name="Image ${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }

  global.DocxImageRun = { imageRun, drawingRun };
})(window);
