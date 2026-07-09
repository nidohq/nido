import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { stageRecovery, readStaged, clearStaged } from './overlay.js';

const ACCOUNT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

class MemStore {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(_i: number) { return null; }
  get length() { return this.m.size; }
}

describe('overlay staging (localStorage present, via a MemStore polyfill)', () => {
  const staged = {
    newPubkey65Hex: '04' + 'ab'.repeat(64),
    initiatedAt: 1_700_000_000,
    executableAfter: 1_700_100_000,
  };

  beforeEach(() => {
    (globalThis as any).localStorage = new MemStore();
  });

  afterEach(() => {
    delete (globalThis as any).localStorage;
  });

  it('round-trips stage -> read -> clear', () => {
    expect(readStaged(ACCOUNT)).toBeNull();
    stageRecovery(ACCOUNT, staged);
    expect(readStaged(ACCOUNT)).toEqual(staged);
    clearStaged(ACCOUNT);
    expect(readStaged(ACCOUNT)).toBeNull();
  });

  it('namespaces by account -- staging one account does not leak to another', () => {
    const OTHER = 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSC4';
    stageRecovery(ACCOUNT, staged);
    expect(readStaged(OTHER)).toBeNull();
  });

  it('does not persist any secret-shaped field (only pubkey hex + timestamps)', () => {
    stageRecovery(ACCOUNT, staged);
    const raw = (globalThis as any).localStorage.getItem(`nido:zkrecovery:${ACCOUNT}`);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    const allowedKeys = new Set(['newPubkey65Hex', 'initiatedAt', 'executableAfter']);
    for (const key of Object.keys(parsed)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
    // No field named/shaped like a secret, mnemonic, seed, or signature.
    const serialized = (raw as string).toLowerCase();
    for (const banned of ['secret', 'mnemonic', 'seed', 'signature', 'privkey', 'private']) {
      expect(serialized.includes(banned)).toBe(false);
    }
  });
});

describe('overlay staging without localStorage (SSR/Node)', () => {
  beforeEach(() => {
    delete (globalThis as any).localStorage;
  });

  it('no-ops safely: stageRecovery/readStaged/clearStaged never throw', () => {
    expect(() =>
      stageRecovery(ACCOUNT, {
        newPubkey65Hex: '04' + 'cd'.repeat(64),
        initiatedAt: 1,
        executableAfter: 2,
      }),
    ).not.toThrow();
    expect(readStaged(ACCOUNT)).toBeNull();
    expect(() => clearStaged(ACCOUNT)).not.toThrow();
  });
});
