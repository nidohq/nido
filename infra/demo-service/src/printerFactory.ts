import { EscposUsbPrinter } from "./escposPrinter.js";
import { FilePrinter, type Printer } from "./printer.js";

/** `PRINTER_DRIVER=usb` talks to the real ESC/POS hardware; anything else
 *  (including unset, the default) falls back to FilePrinter so local
 *  iteration works without the printer plugged in. */
export function createPrinter(outputDir: string): Printer {
  if (process.env.PRINTER_DRIVER === "usb") {
    return new EscposUsbPrinter(
      Number(process.env.PRINTER_VENDOR_ID ?? "0x0416"),
      Number(process.env.PRINTER_PRODUCT_ID ?? "0x5011"),
      Number(process.env.PRINTER_WARMUP_MS ?? 3000),
      Number(process.env.PRINTER_IMAGE_WIDTH_PX ?? 384),
    );
  }
  return new FilePrinter(outputDir);
}
