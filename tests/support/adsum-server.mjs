import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

// Serves the built examples/adsum as a standalone dApp origin (its own port,
// distinct from both the wallet server.mjs and the status-message-dapp
// example-server.mjs) so the fast-lane e2e suite
// (tests/e2e/ui/adsum.spec.ts) can navigate its routes directly against a
// chain-mocked RPC (tests/support/adsumChainMock.ts) — no wallet ceremony
// needed for any of that suite's four read-only-view tests.
const DIST_DIR = new URL('../../examples/adsum/dist/', import.meta.url).pathname;
const PORT = Number(process.env.E2E_ADSUM_PORT || 4401);

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
    // SPA fallback: serve the app shell for client-side routes (e.g.
    // /petition/0, /vouch?for=..., /claim?k=...).
    try {
      const content = readFileSync(join(DIST_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }
}).listen(PORT, '0.0.0.0', () => console.log(`adsum dApp static server on ${PORT}`));
