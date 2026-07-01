import { describe, it, expect } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { markName } from './schema';
import { buildTrace, aggregate, toMarkdownTable } from './report';
import { buildArtifact, writePerfArtifact } from './artifacts';

const SCRATCH =
  process.env.CLAUDE_SCRATCH ??
  '/tmp/claude-1001/-home-willem-c-s-nido--claude-worktrees-trim-confirm-copy/27607da4-2157-4ef9-bf5a-5790aae39828/scratchpad';

function sampleTraces() {
  return [1, 2].map((n) =>
    buildTrace({
      runId: `run-${n}`,
      txId: `tx${n}`,
      marks: [
        { name: markName('create-run', 'start'), startTime: 0 },
        { name: markName('create-run', 'end'), startTime: 1000 * n },
      ],
    }),
  );
}

describe('buildArtifact', () => {
  it('captures runs, aggregate, traces, and markdown under a timestamp', () => {
    const traces = sampleTraces();
    const agg = aggregate(traces);
    const art = buildArtifact({
      traces,
      aggregate: agg,
      markdown: toMarkdownTable(agg),
      isoTs: '2026-06-30T00:00:00.000Z',
    });
    expect(art.generatedAt).toBe('2026-06-30T00:00:00.000Z');
    expect(art.runs).toBe(2);
    expect(art.traces).toHaveLength(2);
    expect(art.markdown).toContain('% of total');
  });
});

describe('writePerfArtifact', () => {
  it('writes a JSON file named by the timestamp and reads back', () => {
    const traces = sampleTraces();
    const agg = aggregate(traces);
    const art = buildArtifact({ traces, aggregate: agg, markdown: 'x', isoTs: '2026-06-30T12:34:56.000Z' });
    const outDir = join(SCRATCH, 'perf-artifact-test');
    const file = writePerfArtifact(art, outDir, '2026-06-30T12:34:56.000Z');
    try {
      expect(file).toContain('2026-06-30T12-34-56.000Z-create.json');
      const round = JSON.parse(readFileSync(file, 'utf8'));
      expect(round.runs).toBe(2);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
