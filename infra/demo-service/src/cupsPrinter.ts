import { spawn } from "node:child_process";
import type { Printer, PrintJob } from "./printer.js";
import { buildReceiptBytes } from "./escposBytes.js";

/** Prints through a CUPS "raw" queue (`scripts/setup-printer-queue.sh`
 *  registers one) instead of claiming the USB interface directly.
 *
 *  Why: on macOS, the OS's own generic USB-printer-class driver auto-claims
 *  a thermal printer's interface the instant a raw USB client (escposPrinter.ts)
 *  releases it — confirmed by testing both this service's code AND
 *  ../fordefi-waas/client/receipt.ts unmodified, under both Node and Bun, on
 *  this same machine: the first open() per physical connection always
 *  succeeds, every one after fails with "could not open device for exclusive
 *  access", regardless of delay. There's no macOS equivalent of Linux's
 *  detachKernelDriver to reclaim it from userspace. CUPS already owns the
 *  device either way, so printing through it sidesteps the conflict instead
 *  of racing it — this is the macOS-safe default. */
export class CupsPrinter implements Printer {
  constructor(
    private queueName: string,
    private imageWidthPx: number,
  ) {}

  async print(job: PrintJob): Promise<void> {
    const bytes = await buildReceiptBytes(job, this.imageWidthPx);
    await this.sendToQueue(bytes);
    console.log(`[printer] "${job.title}" sent to CUPS queue "${this.queueName}"`);
  }

  private sendToQueue(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const lp = spawn("lp", ["-d", this.queueName, "-o", "raw", "-"]);
      let stderr = "";
      lp.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      lp.on("error", (err) => {
        reject(new Error(`Failed to spawn "lp" (is CUPS installed?): ${err.message}`));
      });
      lp.on("close", (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `lp exited with code ${code} for queue "${this.queueName}": ${stderr.trim() || "(no stderr)"}` +
                ` — run scripts/setup-printer-queue.sh if the queue doesn't exist yet.`,
            ),
          );
      });
      lp.stdin.write(bytes);
      lp.stdin.end();
    });
  }
}
