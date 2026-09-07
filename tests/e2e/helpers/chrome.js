// Chrome launcher for the e2e suite.
//
// Branded Google Chrome refuses --load-extension / --disable-extensions-except
// ("not allowed in Google Chrome, ignoring"), so the suite runs against Chrome
// for Testing. It is downloaded once into the shared puppeteer cache
// (~/.cache/puppeteer) on first run; set CHROME_PATH to use another binary.
//
// Flags that matter:
//   --disable-extensions-except / --load-extension  load the unpacked build
//   --disable-extensions-file-access-check          equivalent of the user
//       ticking "Allow access to file URLs" — required for the .md viewer
//   ignoreDefaultArgs: ['--disable-extensions']     puppeteer adds it by default

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import puppeteer from 'puppeteer-core';
import { install, computeExecutablePath, detectBrowserPlatform, Browser } from '@puppeteer/browsers';

// Pinned so CI and local runs agree. Bump deliberately.
export const CHROME_BUILD_ID = '152.0.7977.82';

export async function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  const platform = detectBrowserPlatform();
  if (!platform) throw new Error('Unsupported platform for Chrome for Testing');
  const cacheDir = path.join(os.homedir(), '.cache', 'puppeteer');
  const executablePath = computeExecutablePath({
    browser: Browser.CHROME, buildId: CHROME_BUILD_ID, cacheDir, platform,
  });
  if (fs.existsSync(executablePath)) return executablePath;

  process.stderr.write(`e2e: downloading Chrome for Testing ${CHROME_BUILD_ID}…\n`);
  const installed = await install({ browser: Browser.CHROME, buildId: CHROME_BUILD_ID, cacheDir, platform });
  return installed.executablePath;
}

// Launches Chrome with the unpacked extension at `extensionDir`.
// Returns { browser, extensionId, downloadDir, page(), worker(), close() }.
export async function launchWithExtension(extensionDir) {
  const executablePath = await resolveChrome();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'castmd-dl-'));

  const browser = await puppeteer.launch({
    executablePath,
    headless: !process.env.CASTMD_E2E_HEADED,
    ignoreDefaultArgs: ['--disable-extensions'],
    // Explicit, well under node:test's own patience: a stalled launch or a lost
    // browser then fails with a named timeout instead of hanging and taking the
    // rest of the file down with it.
    timeout: 60_000,
    protocolTimeout: 60_000,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--disable-extensions-file-access-check',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,900',
    ],
  });

  browser.on('disconnected', () => {
    process.stderr.write('e2e: browser disconnected — remaining assertions in this file will fail\n');
  });

  const swTarget = await browser.waitForTarget(
    t => t.type() === 'service_worker' && t.url().endsWith('/background.js'),
    { timeout: 30_000 },
  );
  const extensionId = new URL(swTarget.url()).host;

  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true,
  });

  return {
    browser,
    extensionId,
    downloadDir,
    popupUrl: `chrome-extension://${extensionId}/popup.html`,

    // MV3 workers get killed when idle; re-acquire (and wake if needed).
    async worker() {
      let target = browser.targets().find(t => t.type() === 'service_worker' && t.url().endsWith('/background.js'));
      if (!target) {
        // Any message from an extension page restarts the worker.
        const waker = await browser.newPage();
        await waker.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
        await waker.evaluate(() => new Promise(r => chrome.runtime.sendMessage({ action: 'ping' }, () => r(chrome.runtime.lastError?.message))));
        await waker.close();
        target = await browser.waitForTarget(
          t => t.type() === 'service_worker' && t.url().endsWith('/background.js'),
          { timeout: 15_000 },
        );
      }
      return target.worker();
    },

    async close() {
      await browser.close();
      fs.rmSync(downloadDir, { recursive: true, force: true });
    },
  };
}

// Waits for a completed download whose name passes `match`, returns its path.
// Chrome writes `<name>.crdownload` while in flight, so poll for the final name.
export async function waitForDownload(downloadDir, match, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  const test = typeof match === 'function'
    ? match
    : (name) => (match instanceof RegExp ? match.test(name) : name === match);
  while (Date.now() < deadline) {
    const hit = fs.readdirSync(downloadDir).filter(n => !n.endsWith('.crdownload')).find(test);
    if (hit) return path.join(downloadDir, hit);
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`no download matched ${match} in ${downloadDir} (saw: ${fs.readdirSync(downloadDir).join(', ')})`);
}

// Collects page errors and console errors so tests can assert a clean run.
export function collectErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return errors;
}
