import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const DIST_DIR = new URL('../../packages/frontend/dist/', import.meta.url).pathname;
const PORT = Number(process.env.E2E_PORT || 4399);

const TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  let filePath = join(DIST_DIR, urlPath === '/' ? '/index.html' : urlPath);
  if (!extname(filePath)) filePath = join(filePath, 'index.html');
  // Reject path traversal: this server binds 0.0.0.0 (reachable over Tailscale),
  // so a `..` URL must not escape DIST_DIR and serve arbitrary repo files.
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
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, '0.0.0.0', () => console.log(`e2e static server on ${PORT}`));
