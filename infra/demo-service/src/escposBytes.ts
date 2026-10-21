import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { PrintJob } from "./printer.js";

const ESC = 0x1b;
const GS = 0x1d;
const INIT = [ESC, 0x40];
const ALIGN_LEFT = [ESC, 0x61, 0];
const ALIGN_CENTER = [ESC, 0x61, 1];
const BOLD_ON = [ESC, 0x45, 1];
const BOLD_OFF = [ESC, 0x45, 0];
const CUT = [GS, 0x56, 0];

// Resolved relative to this file's own directory (not process.cwd()), so it
// works identically run from src/ via tsx or from dist/ after a build —
// both sit one level below the package root, where assets/ lives.
const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");
const NIDO_LOGO_PATH = path.join(ASSETS_DIR, "nido-logo.png");
const AHA_LOGO_PATH = path.join(ASSETS_DIR, "aha-logo.png");

// nido-logo.png (512x512 source). An SVG source at this same logical size
// garbled into noise on every attempt, repeatably, regardless of raster byte
// count, threshold, or pacing between writes (all ruled out by direct
// testing) — switching the asset to a rasterized PNG is what actually fixed
// it, so don't swap this back to an SVG without re-testing on real hardware.
const NIDO_LOGO_WIDTH_PX = 200;

// 1-bit threshold for rasterizeImage. Not 128: the Nido SVG's brand colors
// (soft orange/gold rings, a teal dot on a cream background) sit in the
// 139-182 grayscale range — all *above* 128, so a literal "half gray"
// threshold dropped the entire mark and printed nothing. 190 catches those
// without visibly changing already-high-contrast art (QR codes, the Aha
// wordmark) — confirmed by rendering both thresholds for the Aha logo and
// comparing pixel-for-pixel equivalent output.
const THRESHOLD = 190;

/** 1-bit raster bitmap of `buffer` (an image file's bytes, e.g. a decoded QR
 *  PNG), resized to `targetWidth` — same conversion already validated
 *  against this printer in ../fordefi-waas/client/receipt.ts. Flattened onto
 *  white first: a transparent source image otherwise composites to BLACK by
 *  default, printing as solid blobs instead of blank paper. */
async function rasterizeImage(
  buffer: Buffer,
  targetWidth: number,
): Promise<{ bitmap: Uint8Array; widthBytes: number; height: number }> {
  const { data, info } = await sharp(buffer)
    .resize({ width: targetWidth })
    .flatten({ background: "#ffffff" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const widthBytes = Math.ceil(info.width / 8);
  const bitmap = new Uint8Array(widthBytes * info.height);
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] < THRESHOLD) {
        bitmap[y * widthBytes + (x >> 3)] |= 0x80 >> (x % 8);
      }
    }
  }
  return { bitmap, widthBytes, height: info.height };
}

function imageCommand(bitmap: Uint8Array, widthBytes: number, height: number): number[] {
  const xL = widthBytes & 0xff;
  const xH = (widthBytes >> 8) & 0xff;
  const yL = height & 0xff;
  const yH = (height >> 8) & 0xff;
  return [GS, 0x76, 0x30, 0x00, xL, xH, yL, yH, ...bitmap];
}

async function imageCommandFromFile(filePath: string, targetWidth: number): Promise<number[]> {
  const buffer = await readFile(filePath);
  const { bitmap, widthBytes, height } = await rasterizeImage(buffer, targetWidth);
  return imageCommand(bitmap, widthBytes, height);
}

/** The ESC/POS byte stream for a receipt — transport-agnostic (raw USB, a
 *  CUPS raw queue, whatever comes next all just need these bytes). Every
 *  receipt gets the same branding: the Nido mark + "Welcome to Nido!" up
 *  top, then the job's own title/lines/QR, then a "brought to you by" Aha
 *  logo at the bottom. */
export async function buildReceiptBytes(job: PrintJob, imageWidthPx: number): Promise<Uint8Array> {
  const logoWidthPx = Math.round(imageWidthPx * 0.65);

  const bytes: number[] = [...INIT, ...ALIGN_CENTER, ...BOLD_ON];
  bytes.push(...new TextEncoder().encode(job.title + "\n\n"));
  bytes.push(...BOLD_OFF);

  bytes.push(...(await imageCommandFromFile(NIDO_LOGO_PATH, NIDO_LOGO_WIDTH_PX)));
  bytes.push(...new TextEncoder().encode("\nWelcome to Nido!\n\n"));

  bytes.push(...ALIGN_LEFT);
  for (const line of job.lines) {
    bytes.push(...new TextEncoder().encode(line + "\n"));
  }

  const base64 = job.qrDataUrl?.split(",")[1];
  if (base64) {
    const { bitmap, widthBytes, height } = await rasterizeImage(Buffer.from(base64, "base64"), imageWidthPx);
    bytes.push(...ALIGN_CENTER, ...imageCommand(bitmap, widthBytes, height));
  }

  bytes.push(...new TextEncoder().encode("\nBrought to you by\n"));
  bytes.push(...(await imageCommandFromFile(AHA_LOGO_PATH, logoWidthPx)));
  bytes.push(...ALIGN_LEFT);

  bytes.push(...new TextEncoder().encode("\n\n\n"), ...CUT);
  return new Uint8Array(bytes);
}
