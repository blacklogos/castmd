// Static file server for the HTML fixtures. Real http:// origin, because
// content.js is injected into web pages and file:// behaves differently
// (no host permission match for <all_urls> flows, different origin rules).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.resolve(__dirname, '../fixtures');

const TYPES = { '.html': 'text/html', '.md': 'text/markdown', '.css': 'text/css', '.js': 'text/javascript' };

export async function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const file = path.join(FIXTURE_DIR, rel);
    if (!file.startsWith(FIXTURE_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    url: (name) => `http://127.0.0.1:${port}/${name}`,
    close: () => new Promise(r => server.close(r)),
  };
}
