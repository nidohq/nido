import { describe, it, expect } from 'vitest';
import {
  PERF_PREFIX,
  CREATE_PHASES,
  TOTAL_PHASE,
  markName,
  parseMarkName,
  phaseDef,
} from './schema';

describe('perf mark naming', () => {
  it('builds a start/end mark name under the nido:perf namespace', () => {
    expect(markName('factory.simulate', 'start')).toBe('nido:perf:factory.simulate:start');
    expect(markName('factory.simulate', 'end')).toBe('nido:perf:factory.simulate:end');
  });

  it('round-trips a phase name with dots through parse', () => {
    const name = markName('relayer.rpc.submit', 'end');
    expect(parseMarkName(name)).toEqual({ phase: 'relayer.rpc.submit', edge: 'end' });
  });

  it('returns null for names outside the perf namespace', () => {
    expect(parseMarkName('some:other:mark')).toBeNull();
    expect(parseMarkName('nido:perf:phase-without-edge')).toBeNull();
    expect(parseMarkName(`${PERF_PREFIX}:start`)).toBeNull();
  });

  it('rejects a non start/end edge', () => {
    expect(parseMarkName('nido:perf:factory.simulate:middle')).toBeNull();
  });
});

describe('create-run phase taxonomy', () => {
  it('lists create-run first as the wall-clock total', () => {
    expect(CREATE_PHASES[0].key).toBe(TOTAL_PHASE);
    expect(TOTAL_PHASE).toBe('create-run');
  });

  it('tags each phase as browser or relayer', () => {
    for (const p of CREATE_PHASES) {
      expect(['browser', 'relayer']).toContain(p.where);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it('marks the relayer suspects as relayer-side', () => {
    expect(phaseDef('relayer.enforce')?.where).toBe('relayer');
    expect(phaseDef('poll.confirm')?.where).toBe('browser');
  });

  it('has unique phase keys', () => {
    const keys = CREATE_PHASES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
