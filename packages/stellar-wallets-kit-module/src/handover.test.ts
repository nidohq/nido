import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseConnectReturn,
  parseSignReturn,
  loadCachedAddress,
  saveCachedAddress,
  clearCachedAddress,
} from './handover.js';

const C = 'CCV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XMCW';

class MemStore {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(_i: number) { return null; }
  get length() { return this.m.size; }
}

describe('parseConnectReturn', () => {
  it('extracts a valid g2c_address', () => {
    const qs = `?g2c_address=${C}`;
    expect(parseConnectReturn(qs)).toEqual({ status: 'ok', address: C });
  });
  it('uppercases the address it returns', () => {
    const qs = `?g2c_address=${C.toLowerCase()}`;
    expect(parseConnectReturn(qs)).toEqual({ status: 'ok', address: C });
  });
  it('reports cancellation', () => {
    expect(parseConnectReturn('?g2c_connect=cancelled')).toEqual({ status: 'cancelled' });
  });
  it('rejects a malformed address', () => {
    expect(parseConnectReturn('?g2c_address=nope')).toEqual({ status: 'error', error: expect.any(String) });
  });
  it('returns null when no relevant params are present', () => {
    expect(parseConnectReturn('?foo=bar')).toBeNull();
  });
});

describe('parseSignReturn', () => {
  it('extracts a signed tx XDR', () => {
    expect(parseSignReturn('?g2c_signed=AAAA&kind=tx')).toEqual({
      status: 'ok', kind: 'tx', result: 'AAAA',
    });
  });
  it('extracts a signed message', () => {
    expect(parseSignReturn('?g2c_signed=ZZZ&kind=message')).toEqual({
      status: 'ok', kind: 'message', result: 'ZZZ',
    });
  });
  it('reports cancellation', () => {
    expect(parseSignReturn('?g2c_sign=cancelled')).toEqual({ status: 'cancelled' });
  });
  it('reports an error message', () => {
    expect(parseSignReturn('?g2c_sign=error&g2c_error=boom')).toEqual({ status: 'error', error: 'boom' });
  });
  it('returns null when no relevant params are present', () => {
    expect(parseSignReturn('?foo=bar')).toBeNull();
  });
});

describe('address cache (per dApp origin)', () => {
  beforeEach(() => { (globalThis as any).localStorage = new MemStore(); });

  it('round-trips a cached address', () => {
    saveCachedAddress(C);
    expect(loadCachedAddress()).toBe(C);
  });
  it('returns null when nothing cached', () => {
    expect(loadCachedAddress()).toBeNull();
  });
  it('rejects saving a malformed address', () => {
    expect(() => saveCachedAddress('nope')).toThrow();
  });
  it('clears the cache', () => {
    saveCachedAddress(C);
    clearCachedAddress();
    expect(loadCachedAddress()).toBeNull();
  });
});
