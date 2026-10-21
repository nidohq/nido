/**
 * Standalone hardware check for the ESC/POS printer — no HTTP server, no
 * invite service, just: can this machine see the printer on USB, and can it
 * actually print a test receipt?
 *
 * Usage:
 *   npx tsx scripts/test-printer.ts              # list devices, then try the configured/default VID:PID
 *   npx tsx scripts/test-printer.ts --list        # just list connected USB devices and exit
 *   npx tsx scripts/test-printer.ts 0x0416 0x5011 # try a specific VID PID (overrides env/defaults)
 */
import { usb } from "usb";
import { EscposUsbPrinter } from "../src/escposPrinter.js";

function parseId(raw: string): number {
  return raw.startsWith("0x") ? parseInt(raw, 16) : Number(raw);
}

async function listDevices(): Promise<void> {
  const devices = await usb.getDevices();
  if (devices.length === 0) {
    console.log("No USB devices visible to this process at all.");
    return;
  }
  console.log(`${devices.length} USB device(s) found:\n`);
  for (const d of devices) {
    const vid = `0x${d.vendorId.toString(16).padStart(4, "0")}`;
    const pid = `0x${d.productId.toString(16).padStart(4, "0")}`;
    console.log(`  ${vid}:${pid}  ${d.manufacturerName ?? "(unknown manufacturer)"} — ${d.productName ?? "(unknown product)"}`);
  }
  console.log();
}

async function main() {
  const args = process.argv.slice(2);

  await listDevices();
  if (args[0] === "--list") return;

  const vendorId = args[0] ? parseId(args[0]) : Number(process.env.PRINTER_VENDOR_ID ?? "0x0416");
  const productId = args[1] ? parseId(args[1]) : Number(process.env.PRINTER_PRODUCT_ID ?? "0x5011");
  const warmupMs = Number(process.env.PRINTER_WARMUP_MS ?? 3000);
  const imageWidthPx = Number(process.env.PRINTER_IMAGE_WIDTH_PX ?? 384);

  console.log(
    `Trying vendorId=0x${vendorId.toString(16)} productId=0x${productId.toString(16)} ` +
      `(pass different IDs as args, or set PRINTER_VENDOR_ID/PRINTER_PRODUCT_ID, if that's not it)...\n`,
  );

  const printer = new EscposUsbPrinter(vendorId, productId, warmupMs, imageWidthPx);
  await printer.print({
    title: "Printer Test",
    lines: [`This is a test receipt.`, new Date().toISOString()],
  });

  console.log("\nSent to printer — check for physical output.");
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
