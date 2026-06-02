// Test harness: shim browser globals (window, DOMParser, Node) so the IIFE-style
// modules in lib/ can run under Node. Real DOM via linkedom — not a mock.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// lib modules assume a global `window` and DOM constants. Wire those up once.
globalThis.window = globalThis;
globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
globalThis.DOMParser = class DOMParser {
  parseFromString(html /* , mimeType */) {
    const wrapped = `<!doctype html><html><body>${html || ''}</body></html>`;
    return parseHTML(wrapped).document;
  }
};

// Evaluate a lib file (IIFE — attaches to globalThis.window). Use Function ctor
// so the lib's `window` free identifier resolves to globalThis.window.
export function loadLib(relPath) {
  const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function(code).call(globalThis);
}
