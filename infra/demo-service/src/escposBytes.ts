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

/** 1-bit raster bitmap of `buffer` (an image file's bytes, e.g. a decoded QR
 *  PNG), resized to `targetWidth` — same conversion already validated
 *  against this printer in ../fordefi-waas/client/receipt.ts. */
async function rasterizeImage(
  buffer: Buffer,
  targetWidth: number,
): Promise<{ bitmap: Uint8Array; widthBytes: number; height: number }> {
  const { data, info } = await sharp(buffer)
    .resize({ width: targetWidth })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const widthBytes = Math.ceil(info.width / 8);
  const bitmap = new Uint8Array(widthBytes * info.height);
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] < 128) {
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

/** The ESC/POS byte stream for a receipt — transport-agnostic (raw USB, a
 *  CUPS raw queue, whatever comes next all just need these bytes). */
export async function buildReceiptBytes(job: PrintJob, imageWidthPx: number): Promise<Uint8Array> {
  const bytes: number[] = [...INIT, ...ALIGN_CENTER, ...BOLD_ON];
  bytes.push(...new TextEncoder().encode(job.title + "\n\n"));
  bytes.push(...BOLD_OFF, ...ALIGN_LEFT);

  for (const line of job.lines) {
    bytes.push(...new TextEncoder().encode(line + "\n"));
  }

  const base64 = job.qrDataUrl?.split(",")[1];
  if (base64) {
    const { bitmap, widthBytes, height } = await rasterizeImage(Buffer.from(base64, "base64"), imageWidthPx);
    bytes.push(...ALIGN_CENTER, ...imageCommand(bitmap, widthBytes, height), ...ALIGN_LEFT);
  }

  bytes.push(...new TextEncoder().encode("\n\n"), ...CUT);
  return new Uint8Array(bytes);
}
