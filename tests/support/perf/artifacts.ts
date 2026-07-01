/**
 * Perf artifact I/O: bundle the per-run traces + aggregate + rendered table
 * into one JSON document and write it under `perf-results/` (gitignored). The
 * runner calls these after the perf spec's N runs. `buildArtifact` is pure;
 * `writePerfArtifact` is the only fs touch.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Aggregate, Trace } from './schema';

export interface PerfArtifact {
  generatedAt: string;
  runs: number;
  aggregate: Aggregate;
  traces: Trace[];
  markdown: string;
}

/** Bundle a run set into the artifact shape (pure; timestamp supplied). */
export function buildArtifact(input: {
  traces: Trace[];
  aggregate: Aggregate;
  markdown: string;
  isoTs: string;
}): PerfArtifact {
  return {
    generatedAt: input.isoTs,
    runs: input.traces.length,
    aggregate: input.aggregate,
    traces: input.traces,
    markdown: input.markdown,
  };
}

/**
 * Write the artifact as `<isoTs>-create.json` under `outDir` (created if
 * needed). Colons in the timestamp are flattened to dashes so the filename is
 * safe on every filesystem. Returns the written path.
 */
export function writePerfArtifact(artifact: PerfArtifact, outDir: string, isoTs: string): string {
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${isoTs.replace(/:/g, '-')}-create.json`);
  writeFileSync(file, `${JSON.stringify(artifact, null, 2)}\n`);
  return file;
}
