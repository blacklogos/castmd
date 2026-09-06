// Reads a downloaded ZIP with the same JSZip build the extension vendors, so
// the assertion path needs no dependency the extension does not already ship.
//
// The package is ESM ("type": "module"), so the UMD file cannot be require()d
// directly — it is evaluated with a CommonJS shim, the same trick tests/setup.js
// uses for the lib/ IIFEs.

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './test-build.js';

const shim = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', fs.readFileSync(path.join(REPO_ROOT, 'vendor/jszip.min.js'), 'utf8'))(shim, shim.exports);
const JSZip = shim.exports;

// Returns { 'Root/Child.md': '…contents…', … }
export async function readZip(zipPath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const out = {};
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    out[name] = await entry.async('string');
  }
  return out;
}
