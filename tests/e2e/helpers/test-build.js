// Materializes the extension into a temp directory for loading via
// --load-extension. Two reasons not to point Chrome at the repo root:
//
//   1. node_modules/, tests/, plans/ are not part of the shipped artifact.
//   2. Some flows need host permissions that Chrome only grants through an
//      interactive prompt (chrome.permissions.request needs a user gesture and
//      a native bubble, neither of which exists in headless). For those tests
//      the copy's manifest promotes `optional_host_permissions` to
//      `host_permissions`. Nothing else is altered — the code under test is
//      byte-identical to what ships.
//
// tests/e2e/extension-load.e2e.js asserts the shipped manifest still ships the
// permission as optional, so the overlay can never leak into a release.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../../..');

// Everything in the repo that is not part of the extension package.
const NOT_SHIPPED = new Set([
  '.git', '.gitignore', '.wrangler', 'node_modules', 'tests', 'plans', 'docs',
  'package.json', 'package-lock.json', 'index.html', 'privacy.html',
  'CLAUDE.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'README.md', 'PRIVACY.md',
  'dracula.png', '.DS_Store',
]);

export function readShippedManifest() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8'));
}

// Copy the shipped files into a fresh temp dir. Returns { dir, cleanup }.
export function buildTestExtension({ grantAllUrls = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'castmd-ext-'));
  for (const entry of fs.readdirSync(REPO_ROOT)) {
    if (NOT_SHIPPED.has(entry)) continue;
    fs.cpSync(path.join(REPO_ROOT, entry), path.join(dir, entry), { recursive: true });
  }

  if (grantAllUrls) {
    const manifest = readShippedManifest();
    // `<all_urls>` may not be both required and optional — swap, don't add.
    delete manifest.optional_host_permissions;
    manifest.host_permissions = ['<all_urls>'];
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }

  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
