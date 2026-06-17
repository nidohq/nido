import { describe, it, expect, vi } from 'vitest';
import {
  readSession,
  writeSession,
  clearSession,
  warningsFor,
  isNidoWallet,
  connectWith,
  restoreWith,
  deriveBase,
  NIDO_ID,
  type SessionStorage,
  type KitLike,
  type WalletSession,
} from './walletConnect.js';

describe('deriveBase', () => {
  const loc = (hostname: string, protocol = 'https:', port = '') => ({ hostname, protocol, port });

  it('preserves the preview suffix so ceremony origins stay on the preview', () => {
    // The bug: a naive last-two-labels split collapsed every preview host to the
    // production apex, breaking WebAuthn rpId matching for preview dApps.
    expect(deriveBase(loc('status-message--100.nido.fyi'))).toBe('https://100.nido.fyi');
    expect(deriveBase(loc('100.nido.fyi'))).toBe('https://100.nido.fyi');
    expect(deriveBase(loc('pr-100.nido.fyi'))).toBe('https://100.nido.fyi');
  });

  it('resolves production subdomains and the bare apex to the production apex', () => {
    expect(deriveBase(loc('status-message.nido.fyi'))).toBe('https://nido.fyi');
    expect(deriveBase(loc('nido.fyi'))).toBe('https://nido.fyi');
  });

  it('keeps the scheme and port for localhost dev', () => {
    expect(deriveBase(loc('status-message.localhost', 'http:', '4321'))).toBe('http://localhost:4321');
    expect(deriveBase(loc('localhost', 'http:', '4321'))).toBe('http://localhost:4321');
  });
});

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
    const store = fakeStorage({ 'nido:walletSession': '{not json' });
    expect(readSession(store)).toBeNull();
  });

  it('returns null when the stored object is missing required fields', () => {
    const store = fakeStorage({ 'nido:walletSession': JSON.stringify({ walletId: 'g2c' }) });
    expect(readSession(store)).toBeNull();
  });

  it('normalizes the legacy stored Nido wallet id', () => {
    const store = fakeStorage({
      'nido:walletSession': JSON.stringify({ walletId: 'g2c', walletAddress: 'CABC' }),
    });
    expect(readSession(store)).toEqual({ walletId: NIDO_ID, walletAddress: 'CABC' });
  });

  it('clear removes the session', () => {
    const store = fakeStorage();
    writeSession({ walletId: NIDO_ID, walletAddress: 'CABC' }, store);
    clearSession(store);
    expect(readSession(store)).toBeNull();
  });

  it('tolerates a null store (SSR / no localStorage)', () => {
    expect(readSession(null)).toBeNull();
    expect(() => writeSession({ walletId: NIDO_ID, walletAddress: 'C' }, null)).not.toThrow();
    expect(() => clearSession(null)).not.toThrow();
  });
});

describe('warningsFor', () => {
  it('flags Nido as popup-always with a warning', () => {
    const b = warningsFor(NIDO_ID);
    expect(b.kind).toBe('popup-always');
    expect(b.warning).toMatch(/popup/i);
  });

  it('normalizes the legacy Nido wallet id', () => {
    expect(warningsFor('g2c').kind).toBe('popup-always');
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

describe('isNidoWallet', () => {
  it('is true for the current and legacy Nido ids', () => {
    expect(isNidoWallet(NIDO_ID)).toBe(true);
    expect(isNidoWallet('g2c')).toBe(true);
    expect(isNidoWallet('freighter')).toBe(false);
    expect(isNidoWallet(null)).toBe(false);
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
    const kit = mockKit('CABCADDRESS', NIDO_ID);
    const session = await connectWith(kit, store);
    expect(kit.authModal).toHaveBeenCalledOnce();
    expect(session).toEqual({ walletId: NIDO_ID, walletAddress: 'CABCADDRESS' });
    expect(readSession(store)).toEqual(session);
  });

  it('records a non-Nido wallet when one is selected', async () => {
    const store = fakeStorage();
    const kit = mockKit('GCLASSICADDR', 'freighter');
    const session = await connectWith(kit, store);
    expect(session.walletId).toBe('freighter');
    expect(isNidoWallet(session.walletId)).toBe(false);
  });

  it('does not persist when the modal rejects (user cancel)', async () => {
    const store = fakeStorage();
    const kit = mockKit('C', NIDO_ID);
    kit.authModal.mockRejectedValueOnce({ code: -1, message: 'The user closed the modal.' });
    await expect(connectWith(kit, store)).rejects.toBeTruthy();
    expect(readSession(store)).toBeNull();
  });
});

describe('restoreWith', () => {
  it('re-selects the stored module and returns the session', () => {
    const store = fakeStorage();
    writeSession({ walletId: NIDO_ID, walletAddress: 'CABC' }, store);
    const setWallet = vi.fn();
    const session = restoreWith({ setWallet }, store);
    expect(setWallet).toHaveBeenCalledWith(NIDO_ID);
    expect(session).toEqual({ walletId: NIDO_ID, walletAddress: 'CABC' });
  });

  it('re-selects Nido for a legacy stored wallet id', () => {
    const store = fakeStorage({
      'nido:walletSession': JSON.stringify({ walletId: 'g2c', walletAddress: 'CABC' }),
    });
    const setWallet = vi.fn();
    const session = restoreWith({ setWallet }, store);
    expect(setWallet).toHaveBeenCalledWith(NIDO_ID);
    expect(session).toEqual({ walletId: NIDO_ID, walletAddress: 'CABC' });
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
