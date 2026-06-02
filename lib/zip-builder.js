// Thin wrapper over JSZip used by the Confluence tree-export flow.
// Vendored JSZip (vendor/jszip.min.js) must be loaded before this script.

(function (global) {
  'use strict';

  // Build a ZIP blob from a list of { path, content } entries.
  // path: forward-slash separated, e.g. "Parent/Child.md"
  // content: string or Uint8Array
  async function buildZip(entries) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip is not loaded — check vendor/jszip.min.js is included');
    }
    const zip = new JSZip();
    for (const entry of entries) {
      zip.file(entry.path, entry.content);
    }
    return zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });
  }

  global.ZipBuilder = { buildZip };
})(window);
