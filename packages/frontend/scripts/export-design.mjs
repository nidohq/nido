// Export the built Astro site into a folder of self-contained, single-file HTML
// pages — one per route, each with its CSS inlined and all <script> tags removed.
// The result is a static, JS-free snapshot of the whole site's *design*, suitable
// for pasting into a Claude.ai artifact or opening directly in a browser.
//
//   npm run build            # refresh dist/ first
//   node scripts/export-design.mjs
//
// Output: design-export/<name>.html  (+ an index listing)
//
// Caveat: pages whose content is rendered at runtime by JS (account balances,
// activity rows, signing payloads) will show their empty/skeleton/placeholder
// state here — this captures layout + styling, not live data.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, ".."); // packages/frontend
const dist = join(root, "dist");
const outDir = join(root, "design-export");

if (!existsSync(dist)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

// route (as built) -> flat, descriptive export filename
const routes = [
  ["dist/index.html", "index.html", "/"],
  ["dist/account/index.html", "account.html", "/account/"],
  ["dist/account/activity/index.html", "account-activity.html", "/account/activity/"],
  ["dist/connect/index.html", "connect.html", "/connect/"],
  ["dist/new-account/index.html", "new-account.html", "/new-account/"],
  ["dist/security/index.html", "security.html", "/security/"],
  ["dist/security/delegate/index.html", "security-delegate.html", "/security/delegate/"],
  ["dist/security/recover/index.html", "security-recover.html", "/security/recover/"],
  ["dist/sign/index.html", "sign.html", "/sign/"],
  ["dist/status-message/index.html", "status-message.html", "/status-message/"],
];

// map of internal route -> flat filename, for rewriting cross-page links
const linkMap = new Map(routes.map(([, file, route]) => [route, file]));

// Some screens are stateful: their UI lives inside `class="hidden"` mode
// containers that JS un-hides at runtime. For a static design snapshot we reveal
// the primary state per page by id. (Pages not listed render their default
// static markup as-is.)
const reveal = {
  "account.html": ["home-mode"],
};

function exportPage(srcRel, outFile) {
  const srcPath = join(root, srcRel);
  if (!existsSync(srcPath)) {
    console.warn(`skip (missing): ${srcRel}`);
    return false;
  }
  let html = readFileSync(srcPath, "utf8");

  // 1. Inline every referenced /_astro/*.css bundle.
  html = html.replace(
    /<link rel="stylesheet" href="(\/_astro\/[^"]+\.css)">/g,
    (_m, href) => {
      const cssPath = join(dist, href.replace("/_astro/", "_astro/"));
      const css = readFileSync(cssPath, "utf8");
      return `<style>\n${css}\n</style>`;
    },
  );

  // 2. Drop all <script> tags (static design snapshot; also un-hides any
  //    content that JS would otherwise reveal on scroll/interaction).
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<script\b[^>]*\/?>/gi, "");

  // 3. Drop the favicon link (404s when opened standalone).
  html = html.replace(/<link rel="icon"[^>]*>/g, "");

  // 3b. Reveal this page's primary state container(s): strip the `hidden` class
  //     and attribute from the matching element so its design is visible.
  for (const id of reveal[outFile] ?? []) {
    const re = new RegExp(`(<[^>]*\\bid="${id}"[^>]*>)`);
    html = html.replace(re, (tag) =>
      tag
        .replace(/\bclass="([^"]*)"/, (_m, c) =>
          `class="${c.split(/\s+/).filter((x) => x !== "hidden").join(" ")}"`,
        )
        .replace(/\shidden(?=[\s>])/, ""),
    );
  }

  // 4. Rewrite internal navigation links to the flat export filenames so the
  //    pages cross-link when opened locally. Longest routes first so
  //    /security/delegate/ wins over /security/.
  const sorted = [...linkMap.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [route, file] of sorted) {
    if (route === "/") continue; // handled below to avoid clobbering every "/..."
    html = html
      .replaceAll(`href="${route}"`, `href="${file}"`)
      .replaceAll(`href="${route.replace(/\/$/, "")}"`, `href="${file}"`);
  }
  // bare root link -> landing
  html = html.replaceAll('href="/"', 'href="index.html"');

  writeFileSync(join(outDir, outFile), html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log(`  ${outFile.padEnd(26)} ${kb} KB`);
  return true;
}

console.log("Exporting design pages -> design-export/");
let n = 0;
for (const [src, out] of routes) if (exportPage(src, out)) n++;

// A tiny index page linking to each export, for convenient local browsing.
const listItems = routes
  .filter(([src]) => existsSync(join(root, src)))
  .map(([, file, route]) => `    <li><a href="${file}">${file}</a> <code>${route}</code></li>`)
  .join("\n");
writeFileSync(
  join(outDir, "_index.html"),
  `<!doctype html><meta charset="utf-8"><title>Nido design export</title>
<style>body{font:16px/1.6 system-ui;max-width:680px;margin:48px auto;padding:0 20px}code{color:#888}li{margin:6px 0}</style>
<h1>Nido — design export</h1>
<p>${n} self-contained pages. Open any file, or paste one into a Claude.ai artifact.</p>
<ul>\n${listItems}\n</ul>`,
);

console.log(`\nDone: ${n} pages + _index.html in design-export/`);
