import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveFriendNickname, loadFriendNicknames,
  saveSessionKeyMaterial, loadSessionKeyMaterial, forgetSessionKeyMaterial,
  saveBlockLabel, loadBlockLabels,
  savePendingAccount, loadPendingAccounts, removePendingAccount, purgeExpiredPendingAccounts,
  moveLegacyNidoKeys, nidoKey, saveAccount, loadAccounts, saveAccountName, setStorageNetwork,
} from './storage.js';

const ACC = 'C' + 'A'.repeat(55); // Just an identifier here — never validated.

class MemStore {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(_i: number) { return null; }
  get length() { return this.m.size; }
}

describe('policy storage', () => {
  beforeEach(() => { (globalThis as any).localStorage = new MemStore(); });

  it('round-trips friend nicknames', () => {
    const addr = 'C' + 'B'.repeat(55);
    saveFriendNickname(ACC, addr, "Alice's iPhone");
    expect(loadFriendNicknames(ACC)).toEqual({ [addr]: "Alice's iPhone" });
  });

  it('round-trips session-key material (no private key persisted)', () => {
    const target = 'C' + 'C'.repeat(55);
    saveSessionKeyMaterial(ACC, target, {
      credentialId: 'cred-1',
      publicKey: '04ab',
      label: 'status-message',
    });
    // Nothing under the session key on disk carries a private key.
    expect(localStorage.getItem(`nido.${ACC}.session-key.${target}`)).not.toContain('privateKey');
    const got = loadSessionKeyMaterial(ACC, target);
    expect(got).toEqual({ credentialId: 'cred-1', publicKey: '04ab', label: 'status-message' });
    forgetSessionKeyMaterial(ACC, target);
    expect(loadSessionKeyMaterial(ACC, target)).toBeNull();
  });

  it('purges a deprecated synthetic privateKey from a stale session entry on load', () => {
    const target = 'C' + 'D'.repeat(55);
    const key = `nido.${ACC}.session-key.${target}`;
    // A pre-existing entry from the old synthetic flow, with a plaintext key.
    localStorage.setItem(key, JSON.stringify({
      credentialId: 'cred-2', publicKey: '04cd', label: 'legacy', privateKey: [1, 2, 3],
    }));
    const got = loadSessionKeyMaterial(ACC, target);
    // The load never hands back the private key...
    expect(got).toEqual({ credentialId: 'cred-2', publicKey: '04cd', label: 'legacy' });
    // ...and scrubs it from storage so it can't be read again.
    expect(localStorage.getItem(key)).not.toContain('privateKey');
  });

  it('round-trips block labels', () => {
    saveBlockLabel(ACC, 7, 'Recovery');
    expect(loadBlockLabels(ACC)).toEqual({ 7: 'Recovery' });
  });

  it('updates pending setup keys and migrates old secret-key rows', () => {
    localStorage.setItem("nido:testnet:pending", JSON.stringify([{ contractId: ACC, secretKey: "SOLD" }]));
    expect(loadPendingAccounts()).toEqual([{ contractId: ACC, secretKey: "SOLD", setupKey: "SOLD" }]);

    savePendingAccount(ACC, "salt-1");
    expect(loadPendingAccounts()).toEqual([{ contractId: ACC, setupKey: "salt-1" }]);
  });

  it('purges a pending salt once the setup window has elapsed', () => {
    savePendingAccount(ACC, 'salt-1');
    // Still inside the 30-minute window: kept.
    expect(purgeExpiredPendingAccounts(Date.now() + 29 * 60 * 1000).map((p) => p.contractId)).toEqual([ACC]);
    // Past the window: purged, and the sidecar timestamp is cleared.
    expect(purgeExpiredPendingAccounts(Date.now() + 31 * 60 * 1000)).toEqual([]);
    expect(loadPendingAccounts()).toEqual([]);
    expect(localStorage.getItem('nido:testnet:pending:ts')).toBe('{}');
  });

  it('eventually expires a legacy pending entry that has no timestamp', () => {
    localStorage.setItem('nido:testnet:pending', JSON.stringify([{ contractId: ACC, setupKey: 'legacy' }]));
    const t0 = 1_000_000;
    // First sight stamps the undated legacy row and keeps it.
    expect(purgeExpiredPendingAccounts(t0).map((p) => p.contractId)).toEqual([ACC]);
    expect(JSON.parse(localStorage.getItem('nido:testnet:pending:ts')!)[ACC]).toBe(t0);
    // 30 minutes after it was first stamped, it is purged.
    expect(purgeExpiredPendingAccounts(t0 + 30 * 60 * 1000 + 1)).toEqual([]);
  });

  it('removePendingAccount clears the sidecar timestamp', () => {
    savePendingAccount(ACC, 'salt-1');
    expect(JSON.parse(localStorage.getItem('nido:testnet:pending:ts')!)[ACC]).toBeTypeOf('number');
    removePendingAccount(ACC);
    expect(loadPendingAccounts()).toEqual([]);
    expect(JSON.parse(localStorage.getItem('nido:testnet:pending:ts')!)[ACC]).toBeUndefined();
  });
});

/** A MemStore whose keys can be enumerated, as the migration needs. */
class ListStore extends MemStore {
  private keys: string[] = [];
  override setItem(k: string, v: string) { if (!this.keys.includes(k)) this.keys.push(k); super.setItem(k, v); }
  override removeItem(k: string) { this.keys = this.keys.filter((x) => x !== k); super.removeItem(k); }
  override key(i: number) { return this.keys[i] ?? null; }
}

describe('network-namespaced keys', () => {
  beforeEach(() => { (globalThis as any).localStorage = new ListStore(); });

  it('keeps account-list state under the testnet namespace', () => {
    saveAccount(ACC);
    saveAccountName(ACC, 'alice');
    expect(localStorage.getItem('nido:testnet:accounts')).toBe(JSON.stringify([ACC]));
    expect(localStorage.getItem(`nido:testnet:names:${ACC}`)).toBe('alice');
    expect(localStorage.getItem('nido:accounts')).toBeNull();
    expect(loadAccounts()).toEqual([ACC]);
  });

  it('builds nido:<network>:<rest>', () => {
    expect(nidoKey('walletSession')).toBe('nido:testnet:walletSession');
  });

  it('refuses to switch networks once keys have been built', () => {
    nidoKey('accounts');
    expect(() => setStorageNetwork('mainnet')).toThrow(/after keys were built/);
    expect(() => setStorageNetwork('testnet')).not.toThrow();
  });
});

describe('moveLegacyNidoKeys', () => {
  it('moves every un-namespaced nido: key to testnet, once', () => {
    const store = new ListStore();
    store.setItem('nido:accounts', '["CA"]');
    store.setItem('nido:names:CA', 'alice');
    store.setItem('nido:walletSession', '{}');
    store.setItem(`passkey:${ACC}:credentialId`, 'cred');
    store.setItem(`nido.${ACC}.friends`, '{}');
    expect(moveLegacyNidoKeys(store)).toBe(3);
    expect(store.getItem('nido:testnet:accounts')).toBe('["CA"]');
    expect(store.getItem('nido:testnet:names:CA')).toBe('alice');
    expect(store.getItem('nido:testnet:walletSession')).toBe('{}');
    expect(store.getItem('nido:accounts')).toBeNull();
    // Per-account keys are already network-unique and stay put.
    expect(store.getItem(`passkey:${ACC}:credentialId`)).toBe('cred');
    expect(store.getItem(`nido.${ACC}.friends`)).toBe('{}');
    expect(moveLegacyNidoKeys(store)).toBe(0);
  });

  it('never overwrites a namespaced key, and keeps the legacy copy', () => {
    const store = new ListStore();
    store.setItem('nido:testnet:accounts', '["NEW"]');
    store.setItem('nido:accounts', '["OLD"]');
    expect(moveLegacyNidoKeys(store)).toBe(0);
    expect(store.getItem('nido:testnet:accounts')).toBe('["NEW"]');
    expect(store.getItem('nido:accounts')).toBe('["OLD"]');
  });

  it('leaves mainnet keys alone', () => {
    const store = new ListStore();
    store.setItem('nido:mainnet:accounts', '["M"]');
    expect(moveLegacyNidoKeys(store)).toBe(0);
    expect(store.getItem('nido:mainnet:accounts')).toBe('["M"]');
  });
});
