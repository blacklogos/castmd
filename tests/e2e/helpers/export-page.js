// Shared setup for the export e2e files: load the extension, open the fixture
// article, press "Export as HTML, PDF, DOCX" in the popup, and hand back the
// export page once it reports Ready.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildTestExtension } from './test-build.js';
import { launchWithExtension, collectErrors } from './chrome.js';
import { startFixtureServer } from './server.js';

// Runs the tool, not just `which`: a stale Homebrew wrapper can outlive its app.
export const has = (bin, args = ['--version']) => {
  try { execFileSync(bin, args, { stdio: 'ignore', timeout: 30_000 }); return true; } catch (e) {
    // A non-zero exit still proves the binary runs; 126/127/ENOENT mean it does not.
    return e.code !== 'ENOENT' && e.status != null && e.status !== 126 && e.status !== 127;
  }
};

export const waitReady = (page) => page.waitForFunction(
  () => /^Ready\./.test(document.getElementById('status').textContent), { timeout: 30_000, polling: 100 });

// Returns { chrome, server, exportPage, exportErrors, workDir, close }.
export async function openExportPage() {
  const build = buildTestExtension({ grantAllUrls: true });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'castmd-export-e2e-'));
  let chrome, server;
  const close = async () => {
    await server?.close();
    await chrome?.close();
    build.cleanup();
    fs.rmSync(workDir, { recursive: true, force: true });
  };
  try {
    chrome = await launchWithExtension(build.dir);
    server = await startFixtureServer();
    const page = await chrome.browser.newPage();
    await page.goto(server.url('export-article.html'), { waitUntil: 'load' });
    const popup = await chrome.browser.newPage();
    await popup.goto(chrome.popupUrl, { waitUntil: 'load' });
    await page.bringToFront();

    const opened = chrome.browser.waitForTarget(t => t.url().includes('/export.html?id='), { timeout: 20_000 });
    await popup.evaluate(() => document.getElementById('exportBtn').click());
    const exportPage = await (await opened).page();
    const exportErrors = collectErrors(exportPage);
    await waitReady(exportPage);
    return { chrome, server, exportPage, exportErrors, workDir, close };
  } catch (e) {
    await close();
    throw e;
  }
}
