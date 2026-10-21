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

/** Stands in for the real hardware: writes each job to a timestamped file
 *  under `outputDir` and logs it, instead of sending it to a physical
 *  printer. The real drivers — `CupsPrinter` (cupsPrinter.ts, the one to use
 *  on macOS) and `EscposUsbPrinter` (escposPrinter.ts) — implement this same
 *  `Printer` interface; `printerFactory.ts` picks between the three via
 *  `PRINTER_DRIVER`. */
export class FilePrinter implements Printer {
  constructor(private outputDir: string) {}

  async print(job: PrintJob): Promise<void> {
    await mkdir(this.outputDir, { recursive: true });
    const slug = job.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const base = `${Date.now()}-${slug}`;

    await writeFile(path.join(this.outputDir, `${base}.txt`), [job.title, "", ...job.lines].join("\n"), "utf8");

    if (job.qrDataUrl) {
      const base64 = job.qrDataUrl.split(",")[1];
      if (base64) await writeFile(path.join(this.outputDir, `${base}.png`), Buffer.from(base64, "base64"));
    }

    console.log(`[printer] "${job.title}" -> ${base}.txt${job.qrDataUrl ? " + .png" : ""}`);
  }
}
