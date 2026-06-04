import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

// Serves the built examples/status-message-dapp as a standalone dApp origin
// (distinct from the wallet at server.mjs) so the e2e harness can drive the
// example's Nido connect → delegate → in-page-sign flow cross-origin.
const DIST_DIR = new URL('../../examples/status-message-dapp/dist/', import.meta.url).pathname;
const PORT = Number(process.env.E2E_EXAMPLE_PORT || 4400);

const TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  let filePath = join(DIST_DIR, urlPath === '/' ? '/index.html' : urlPath);
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  } catch {
    // SPA fallback: serve the app shell for client-side routes.
    try {
      const content = readFileSync(join(DIST_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }
}).listen(PORT, '0.0.0.0', () => console.log(`example dApp static server on ${PORT}`));
