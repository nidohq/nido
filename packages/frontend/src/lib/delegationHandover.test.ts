import { describe, it, expect } from 'vitest';
import {
  writePendingDelegation,
  consumePendingDelegation,
  readDelegationReturn,
  type DelegationStorage,
  type PendingDelegation,
} from './delegationHandover.js';

/** An in-memory Storage-shaped fake (mirrors walletConnect.test.ts). */
function fakeStorage(
  initial: Record<string, string> = {},
): DelegationStorage & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('pending delegation', () => {
  it('round-trips account + target + label through write/consume', () => {
    const store = fakeStorage();
    const pending: PendingDelegation = {
      account: 'CACCOUNT',
      target: 'CTARGET',
      label: 'status-message',
    };
    writePendingDelegation(pending, store);
    expect(consumePendingDelegation(store)).toEqual(pending);
  });

  it('consume is single-use: a second consume returns null', () => {
    const store = fakeStorage();
    writePendingDelegation({ account: 'CACC', target: 'CT' }, store);
    expect(consumePendingDelegation(store)).not.toBeNull();
    expect(consumePendingDelegation(store)).toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(consumePendingDelegation(fakeStorage())).toBeNull();
  });

  it('returns null (rather than throwing) on corrupt JSON', () => {
    const store = fakeStorage({ 'nido:pendingDelegation': '{not json' });
    expect(consumePendingDelegation(store)).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    const store = fakeStorage({
      'nido:pendingDelegation': JSON.stringify({ account: 'CACC' }),
    });
    expect(consumePendingDelegation(store)).toBeNull();
  });

  it('tolerates a null store (SSR / no localStorage)', () => {
    expect(() =>
      writePendingDelegation({ account: 'C', target: 'C' }, null),
    ).not.toThrow();
    expect(consumePendingDelegation(null)).toBeNull();
  });
});

describe('readDelegationReturn', () => {
  it('reads ok / cancelled from the search string', () => {
    expect(readDelegationReturn('?delegation=ok')).toBe('ok');
    expect(readDelegationReturn('?delegation=cancelled')).toBe('cancelled');
  });

  it('returns null for absent or unrecognised values', () => {
    expect(readDelegationReturn('')).toBeNull();
    expect(readDelegationReturn('?foo=bar')).toBeNull();
    expect(readDelegationReturn('?delegation=weird')).toBeNull();
  });
});
