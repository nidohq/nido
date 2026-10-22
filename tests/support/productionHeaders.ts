import { readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type { BrowserContext } from '@playwright/test';

// Serve the built wallet under real-looking https hosts with the response
// headers production sends: the rules in packages/frontend/public/_headers
// (which the proxy worker mirrors for *.nido.fyi), applied the way Cloudflare
// Pages applies them — every matching rule in order, `! Name` detaching a
// header an earlier rule set.

// `__dirname`, not `import.meta.url`: see auth/bundle.ts.
const DIST_DIR = resolve(__dirname, '../../packages/frontend/dist') + '/';

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

interface Rule {
  pattern: string;
  set: [string, string][];
  detach: string[];
}

function parseHeaders(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), set: [], detach: [] });
      continue;
    }
    const rule = rules[rules.length - 1]!;
    const body = line.trim();
    if (body.startsWith('!')) rule.detach.push(body.slice(1).trim().toLowerCase());
    else {
      const i = body.indexOf(':');
      rule.set.push([body.slice(0, i).trim().toLowerCase(), body.slice(i + 1).trim()]);
    }
  }
  return rules;
}

function matches(pattern: string, path: string): boolean {
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
  return path === pattern;
}

export function productionHeaders(path: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const rule of parseHeaders(readFileSync(join(DIST_DIR, '_headers'), 'utf8'))) {
    if (!matches(rule.pattern, path)) continue;
    for (const name of rule.detach) delete headers[name];
    for (const [name, value] of rule.set) headers[name] = value;
  }
  return headers;
}

/**
 * Route every request in `context`: `https://*.<apex>` and the extra
 * `origins` are served from the built site with production headers (`/__blank`
 * is an empty page there, for tests that need a bare origin); anything else is
 * aborted, so the run never reaches the network.
 */
export async function serveProduction(context: BrowserContext, apex: string, origins: string[] = []) {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const ours =
      (url.protocol === 'https:' && (url.hostname === apex || url.hostname.endsWith(`.${apex}`))) ||
      origins.includes(url.origin);
    if (!ours) return route.abort();
    if (url.pathname === '/__blank') {
      return route.fulfill({
        status: 200,
        headers: { ...productionHeaders(url.pathname), 'content-type': 'text/html' },
        body: '<!doctype html><title>blank</title>',
      });
    }
    let file = join(DIST_DIR, url.pathname);
    if (!extname(file)) file = join(file, 'index.html');
    if (!file.startsWith(DIST_DIR)) return route.fulfill({ status: 404, body: '' });
    let body: Buffer;
    try {
      body = readFileSync(file);
    } catch {
      return route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({
      status: 200,
      headers: {
        ...productionHeaders(url.pathname),
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      },
      body,
    });
  });
}
