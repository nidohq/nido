import { CupsPrinter } from "./cupsPrinter.js";
import { EscposUsbPrinter } from "./escposPrinter.js";
import { FilePrinter, type Printer } from "./printer.js";

/** `PRINTER_DRIVER=cups` (the macOS-safe default once hardware is involved —
 *  see cupsPrinter.ts) prints through a CUPS raw queue; `PRINTER_DRIVER=usb`
 *  claims the USB interface directly (works on platforms where macOS's
 *  exclusive-access gotcha doesn't apply — see escposPrinter.ts); anything
 *  else (including unset, the default) falls back to FilePrinter so local
 *  iteration works without any printer hardware or CUPS queue set up. */
export function createPrinter(outputDir: string): Printer {
  const driver = process.env.PRINTER_DRIVER;

  if (driver === "cups") {
    return new CupsPrinter(
      process.env.PRINTER_QUEUE_NAME ?? "nido-receipt-printer",
      Number(process.env.PRINTER_IMAGE_WIDTH_PX ?? 384),
    );
  }

  if (driver === "usb") {
    return new EscposUsbPrinter(
      Number(process.env.PRINTER_VENDOR_ID ?? "0x0416"),
      Number(process.env.PRINTER_PRODUCT_ID ?? "0x5011"),
      Number(process.env.PRINTER_WARMUP_MS ?? 3000),
      Number(process.env.PRINTER_IMAGE_WIDTH_PX ?? 384),
    );
  }

  return new FilePrinter(outputDir);
}
