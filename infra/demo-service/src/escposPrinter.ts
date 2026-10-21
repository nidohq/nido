import { usb } from "usb";
import type { Printer, PrintJob } from "./printer.js";
import { buildReceiptBytes } from "./escposBytes.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Talks ESC/POS directly to a USB thermal receipt printer via raw bulk
 *  transfers — the same approach already validated against this hardware in
 *  ../fordefi-waas/client/receipt.ts, not the escpos/node-thermal-printer
 *  libraries (that reference code bypasses them entirely).
 *
 *  macOS-specific gotcha (confirmed, not fixable from here): the OS's own
 *  generic USB-printer-class driver auto-claims the interface the instant
 *  this code releases it — the first open() per physical connection works,
 *  every one after fails with "could not open device for exclusive access",
 *  independent of PaperCut or anything else in userspace, and independent of
 *  how long you wait between attempts. There's no macOS equivalent of
 *  Linux's detachKernelDriver to reclaim it. CupsPrinter (cupsPrinter.ts) is
 *  the macOS-safe default for that reason — this class is kept for other
 *  platforms where that claim doesn't happen.
 *
 *  Unlike the reference code (which logs and returns when the device isn't
 *  found), this throws instead: receiptPoller only acks a pending-print job
 *  AFTER print() resolves (see infra/invite's README on why ack is a
 *  separate call from next), so a silent no-op here would falsely mark a
 *  receipt delivered that never actually printed. */
export class EscposUsbPrinter implements Printer {
  constructor(
    private vendorId: number,
    private productId: number,
    private warmupMs: number,
    private imageWidthPx: number,
  ) {}

  async print(job: PrintJob): Promise<void> {
    if (this.warmupMs > 0) await sleep(this.warmupMs);

    const device = await usb.findDeviceByIds(this.vendorId, this.productId);
    if (!device) {
      throw new Error(
        `ESC/POS printer not found (vendorId=0x${this.vendorId.toString(16)} productId=0x${this.productId.toString(16)})`,
      );
    }

    await device.open();
    try {
      await device.selectConfiguration(1);
      await device.claimInterface(0);
      await device.transferOut(1, await buildReceiptBytes(job, this.imageWidthPx));
    } finally {
      await device.close();
    }

    console.log(`[printer] "${job.title}" sent to ESC/POS printer (raw USB)`);
  }
}
