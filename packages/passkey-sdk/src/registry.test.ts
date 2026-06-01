import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchRegistryAddress, REGISTRY_FALLBACKS } from './registry.js';

// Valid strkey-encoded contract address (passes checksum validation).
const REGISTERED = 'CCV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XMCW';

describe('fetchRegistryAddress', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns the on-chain address when the registry is reachable', async () => {
    const lookup = vi.fn(async () => REGISTERED);
    const addr = await fetchRegistryAddress('factory', { lookup });
    expect(addr).toBe(REGISTERED);
    expect(lookup).toHaveBeenCalledWith('factory');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to the hardcoded address and warns loudly when the registry throws', async () => {
    const lookup = vi.fn(async () => {
      throw new Error('rpc unreachable');
    });
    const addr = await fetchRegistryAddress('factory', { lookup });
    expect(addr).toBe(REGISTRY_FALLBACKS.factory);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('falls back and warns when the registry returns no mapping', async () => {
    const lookup = vi.fn(async () => null);
    const addr = await fetchRegistryAddress('name-registry', { lookup });
    expect(addr).toBe(REGISTRY_FALLBACKS['name-registry']);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('throws if the registry is unreachable and there is no fallback for the name', async () => {
    const lookup = vi.fn(async () => {
      throw new Error('rpc unreachable');
    });
    await expect(
      fetchRegistryAddress('totally-unknown-name', { lookup }),
    ).rejects.toThrow();
  });

  it('has a fallback for each migrated constant', () => {
    expect(REGISTRY_FALLBACKS.factory).toBeTruthy();
    expect(REGISTRY_FALLBACKS['name-registry']).toBeTruthy();
    expect(REGISTRY_FALLBACKS['status-message']).toBeTruthy();
  });
});
