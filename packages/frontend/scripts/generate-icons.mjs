#!/usr/bin/env node
// Renders the installed-app icon set (web app manifest + iOS home screen)
// from public/favicon.svg, the Nest Ring mark on its cream tile. The PNGs are
// committed; re-run after changing favicon.svg:
//
//   node scripts/generate-icons.mjs
//
// Two shapes come out of the one mark:
//   - "any": favicon.svg as drawn, rounded tile with transparent corners.
//   - full-bleed: a square cream tile with no transparency. iOS fills
//     transparent pixels with black and applies its own corner mask, and a
//     maskable icon may be cropped to any shape inside the central 80% circle,
//     so both get the full square, with the mark scaled to sit inside that
//     safe zone (the mark's outer ring reaches 49 of 60 units from centre).
//
// sharp comes from astro's optional dependency, already in node_modules.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const favicon = readFileSync(`${PUBLIC}favicon.svg`, "utf8");

const tile = favicon.match(/<rect[^>]*fill="([^"]+)"/)?.[1];
const mark = favicon.match(/<circle[^>]*\/>/g)?.join("\n");
if (!tile || !mark) throw new Error("favicon.svg no longer has the tile <rect> and Nest Ring <circle>s this script reads");

function fullBleed(scale) {
  const offset = 60 * (1 - scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <rect width="120" height="120" fill="${tile}" />
  <g transform="translate(${offset} ${offset}) scale(${scale})">
${mark}
  </g>
</svg>`;
}

const ICONS = [
  { file: "icon-192.png", size: 192, svg: favicon },
  { file: "icon-512.png", size: 512, svg: favicon },
  // 0.8 puts the outer ring at ~39 units: inside the 48-unit safe circle.
  { file: "icon-maskable-512.png", size: 512, svg: fullBleed(0.8) },
  // iOS's corner mask is about favicon.svg's own rx, so the mark keeps its size.
  { file: "apple-touch-icon.png", size: 180, svg: fullBleed(1) },
];

for (const { file, size, svg } of ICONS) {
  await sharp(Buffer.from(svg), { density: (72 * size) / 120 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(`${PUBLIC}${file}`);
  console.log(`public/${file} ${size}x${size}`);
}
