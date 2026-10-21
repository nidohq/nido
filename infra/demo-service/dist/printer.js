import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
/** Stands in for the real hardware: writes each job to a timestamped file
 *  under `outputDir` and logs it, instead of sending it to a physical
 *  printer. Swap this for a real driver (ESC/POS receipt printer, a label
 *  printer, whatever ends up at the booth) by implementing the same
 *  `Printer` interface — nothing else in this service needs to change. */
export class FilePrinter {
    outputDir;
    constructor(outputDir) {
        this.outputDir = outputDir;
    }
    async print(job) {
        await mkdir(this.outputDir, { recursive: true });
        const slug = job.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
        const base = `${Date.now()}-${slug}`;
        await writeFile(path.join(this.outputDir, `${base}.txt`), [job.title, "", ...job.lines].join("\n"), "utf8");
        if (job.qrDataUrl) {
            const base64 = job.qrDataUrl.split(",")[1];
            if (base64)
                await writeFile(path.join(this.outputDir, `${base}.png`), Buffer.from(base64, "base64"));
        }
        console.log(`[printer] "${job.title}" -> ${base}.txt${job.qrDataUrl ? " + .png" : ""}`);
    }
}
//# sourceMappingURL=printer.js.map