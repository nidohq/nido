import { describe, it, expect, vi } from 'vitest';
import {
  readSession,
  writeSession,
  clearSession,
  warningsFor,
  isG2cWallet,
  connectWith,
  restoreWith,
  G2C_ID,
  type SessionStorage,
  type KitLike,
  type WalletSession,
} from './walletConnect.js';

/** An in-memory Storage-shaped fake. */
function fakeStorage(initial: Record<string, string> = {}): SessionStorage & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('session store', () => {
  it('round-trips a session through write/read', () => {
    const store = fakeStorage();
    const session: WalletSession = { walletId: 'freighter', walletAddress: 'GABC' };
    writeSession(session, store);
    expect(readSession(store)).toEqual(session);
  });

  it('returns null when nothing is stored', () => {
    expect(readSession(fakeStorage())).toBeNull();
  });

  it('returns null (rather than throwing) on corrupt JSON', () => {
    const store = fakeStorage({ 'g2c:walletSession': '{not json' });
    expect(readSession(store)).toBeNull();
  });

  it('returns null when the stored object is missing required fields', () => {
    const store = fakeStorage({ 'g2c:walletSession': JSON.stringify({ walletId: 'g2c' }) });
    expect(readSession(store)).toBeNull();
  });

  it('clear removes the session', () => {
    const store = fakeStorage();
    writeSession({ walletId: G2C_ID, walletAddress: 'CABC' }, store);
    clearSession(store);
    expect(readSession(store)).toBeNull();
  });

  it('tolerates a null store (SSR / no localStorage)', () => {
    expect(readSession(null)).toBeNull();
    expect(() => writeSession({ walletId: 'g2c', walletAddress: 'C' }, null)).not.toThrow();
    expect(() => clearSession(null)).not.toThrow();
  });
});

describe('warningsFor', () => {
  it('flags g2c as popup-always with a warning', () => {
    const b = warningsFor(G2C_ID);
    expect(b.kind).toBe('popup-always');
    expect(b.warning).toMatch(/popup/i);
  });

  it('is case-insensitive', () => {
    expect(warningsFor('FREIGHTER').kind).toBe('standard');
  });

  it('returns a safe default for unknown wallets', () => {
    const b = warningsFor('totally-unknown');
    expect(b.kind).toBe('standard');
    expect(b.supportsGetNetwork).toBe(false);
  });

  it('returns the default for null/undefined', () => {
    expect(warningsFor(null).kind).toBe('standard');
    expect(warningsFor(undefined).kind).toBe('standard');
  });
});

describe('isG2cWallet', () => {
  it('is true only for the g2c id', () => {
    expect(isG2cWallet(G2C_ID)).toBe(true);
    expect(isG2cWallet('freighter')).toBe(false);
    expect(isG2cWallet(null)).toBe(false);
  });
});

/** A mock kit whose authModal resolves a fixed address + active module id. */
function mockKit(address: string, productId: string): KitLike & { authModal: ReturnType<typeof vi.fn> } {
  let selected = productId;
  return {
    authModal: vi.fn(async () => ({ address })),
    get selectedModule() {
      return { productId: selected };
    },
    setWallet: vi.fn((id: string) => {
      selected = id;
    }),
    disconnect: vi.fn(async () => {}),
    signTransaction: vi.fn(async () => ({ signedTxXdr: 'signed' })),
  };
}

describe('connectWith', () => {
  it('opens the modal, reads the active module, and persists the session', async () => {
    const store = fakeStorage();
    const kit = mockKit('CABCADDRESS', G2C_ID);
    const session = await connectWith(kit, store);
    expect(kit.authModal).toHaveBeenCalledOnce();
    expect(session).toEqual({ walletId: G2C_ID, walletAddress: 'CABCADDRESS' });
    expect(readSession(store)).toEqual(session);
  });

  it('records a non-g2c wallet when one is selected', async () => {
    const store = fakeStorage();
    const kit = mockKit('GCLASSICADDR', 'freighter');
    const session = await connectWith(kit, store);
    expect(session.walletId).toBe('freighter');
    expect(isG2cWallet(session.walletId)).toBe(false);
  });

  it('does not persist when the modal rejects (user cancel)', async () => {
    const store = fakeStorage();
    const kit = mockKit('C', G2C_ID);
    kit.authModal.mockRejectedValueOnce({ code: -1, message: 'The user closed the modal.' });
    await expect(connectWith(kit, store)).rejects.toBeTruthy();
    expect(readSession(store)).toBeNull();
  });
});

describe('restoreWith', () => {
  it('re-selects the stored module and returns the session', () => {
    const store = fakeStorage();
    writeSession({ walletId: G2C_ID, walletAddress: 'CABC' }, store);
    const setWallet = vi.fn();
    const session = restoreWith({ setWallet }, store);
    expect(setWallet).toHaveBeenCalledWith(G2C_ID);
    expect(session).toEqual({ walletId: G2C_ID, walletAddress: 'CABC' });
  });

  it('returns null and clears the session when the module is gone', () => {
    const store = fakeStorage();
    writeSession({ walletId: 'gone', walletAddress: 'CABC' }, store);
    const setWallet = vi.fn(() => {
      throw new Error('not a module');
    });
    expect(restoreWith({ setWallet }, store)).toBeNull();
    expect(readSession(store)).toBeNull();
  });

  it('returns null when there is no stored session', () => {
    expect(restoreWith({ setWallet: vi.fn() }, fakeStorage())).toBeNull();
  });
});
