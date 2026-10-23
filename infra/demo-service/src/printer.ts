import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PrintJob {
  title: string;
  lines: string[];
  qrDataUrl?: string;
}

export interface Printer {
  print(job: PrintJob): Promise<void>;
}

/** Writes `job` to a timestamped .txt (+ .png for its QR, if any) under
 *  `outputDir`, returning the shared basename. Shared by FilePrinter (which
 *  IS this, standing in for hardware) and PersistingPrinter (which does
 *  this ALONGSIDE a real driver, as an audit trail of the event). */
async function archiveJob(outputDir: string, job: PrintJob): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const slug = job.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const base = `${Date.now()}-${slug}`;

  await writeFile(path.join(outputDir, `${base}.txt`), [job.title, "", ...job.lines].join("\n"), "utf8");

  if (job.qrDataUrl) {
    const base64 = job.qrDataUrl.split(",")[1];
    if (base64) await writeFile(path.join(outputDir, `${base}.png`), Buffer.from(base64, "base64"));
  }

  return base;
}

/** Stands in for the real hardware: archives each job instead of sending it
 *  to a physical printer. The real drivers — `CupsPrinter` (cupsPrinter.ts,
 *  the one to use on macOS) and `EscposUsbPrinter` (escposPrinter.ts) —
 *  implement this same `Printer` interface; `printerFactory.ts` picks
 *  between the three via `PRINTER_DRIVER`, wrapping the real ones in
 *  `PersistingPrinter` below so they archive too. */
export class FilePrinter implements Printer {
  constructor(private outputDir: string) {}

  async print(job: PrintJob): Promise<void> {
    const base = await archiveJob(this.outputDir, job);
    console.log(`[printer] "${job.title}" -> ${base}.txt${job.qrDataUrl ? " + .png" : ""}`);
  }
}

/** Wraps a real hardware driver so every job is archived to disk (same
 *  shape FilePrinter writes) BEFORE it's sent to the printer — an audit
 *  trail of what was actually attempted at the event that doesn't depend on
 *  infra/invite's own record (a job can be acked as "delivered" there and
 *  still have failed physically — see the /codes/:code/requeue-print
 *  backdoor — so the archived file is evidence of what the job WAS, not
 *  just that a poll tick ran). Archive failures are logged, never thrown:
 *  losing the audit copy must not block the actual print. */
export class PersistingPrinter implements Printer {
  constructor(
    private inner: Printer,
    private outputDir: string,
  ) {}

  async print(job: PrintJob): Promise<void> {
    try {
      await archiveJob(this.outputDir, job);
    } catch (err) {
      console.error("[printer] failed to archive job (printing anyway):", err);
    }
    await this.inner.print(job);
  }
}
