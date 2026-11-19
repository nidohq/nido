import { buf2hex, buf2base64url, base64url2buf } from "./encoding.js";

/** The slice of the Web Storage API this module uses. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

declare const localStorage: KeyValueStore;

// --- Network namespace ------------------------------------------------------
//
// Wallet state that is not tied to one account address (the account list,
// pending setups, cached names, the connected wallet, asset caches, ...) lives
// under `nido:<network>:<rest>`, so a mainnet build served from an origin that
// once served testnet never shows testnet state. Per-account keys
// (`passkey:<contract>:*`, `nido.<contract>.*`) need no namespace: a contract
// address already differs between networks.

export type StorageNetwork = "testnet" | "mainnet";

/** Every un-namespaced `nido:*` key was written by a testnet build. */
const LEGACY_NETWORK: StorageNetwork = "testnet";
const NAMESPACED_RE = /^nido:(?:testnet|mainnet):/;

let storageNetwork: StorageNetwork | null = null;
let keyIssued = false;
let legacyMoved = false;

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Choose the network whose namespace {@link nidoKey} builds. Call it before
 * anything reads storage: once a key has been handed out under one network,
 * switching to another throws rather than splitting a page's state in two.
 */
export function setStorageNetwork(network: StorageNetwork): void {
  if (keyIssued && network !== storageNetwork) {
    throw new Error(`storage network set to ${network} after keys were built for ${storageNetwork}`);
  }
  storageNetwork = network;
}

/**
 * Move every legacy `nido:<rest>` key to `nido:testnet:<rest>`. A key whose
 * namespaced copy already exists is left where it is rather than overwrite
 * newer state. Returns how many keys moved. {@link nidoKey} runs this once per
 * page, before the first key it builds, so nothing reads storage unmigrated.
 */
export function moveLegacyNidoKeys(store: KeyValueStore | null = defaultStore()): number {
  if (!store) return 0;
  const legacy: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith("nido:") && !NAMESPACED_RE.test(key)) legacy.push(key);
  }
  let moved = 0;
  for (const key of legacy) {
    const value = store.getItem(key);
    const target = `nido:${LEGACY_NETWORK}:${key.slice("nido:".length)}`;
    if (value === null || store.getItem(target) !== null) continue;
    store.setItem(target, value);
    store.removeItem(key);
    moved++;
  }
  return moved;
}

/**
 * The storage key `nido:<network>:<rest>` for network-scoped wallet state.
 * Throws until {@link setStorageNetwork} has been called: there is no default
 * network, so a page that forgets to say which network it is fails instead of
 * reading or writing another network's state.
 */
export function nidoKey(rest: string): string {
  if (storageNetwork === null) {
    throw new Error("nidoKey: the storage network was never set; call setStorageNetwork first");
  }
  if (!legacyMoved) {
    legacyMoved = true;
    try {
      moveLegacyNidoKeys();
    } catch {
      // Storage that throws on access is unusable either way; the read that
      // follows fails or falls back on its own.
    }
  }
  keyIssued = true;
  return `nido:${storageNetwork}:${rest}`;
}

export function saveCredential(contractId: string, credentialId: Uint8Array, publicKey: Uint8Array): void {
  const prefix = `passkey:${contractId}:`;
  localStorage.setItem(prefix + "credentialId", buf2base64url(credentialId));
  localStorage.setItem(prefix + "publicKey", buf2hex(publicKey));
}

export function loadCredential(contractId: string): { credentialId: Uint8Array; publicKey: string } | null {
  const prefix = `passkey:${contractId}:`;
  const credId = localStorage.getItem(prefix + "credentialId");
  const pubKey = localStorage.getItem(prefix + "publicKey");
  if (credId && pubKey) return { credentialId: base64url2buf(credId), publicKey: pubKey };
  return null;
}

export function saveAccount(contractId: string): void {
  const accounts: string[] = JSON.parse(localStorage.getItem(nidoKey("accounts")) || "[]");
  if (!accounts.includes(contractId)) {
    accounts.push(contractId);
    localStorage.setItem(nidoKey("accounts"), JSON.stringify(accounts));
  }
}

export function loadAccounts(): string[] {
  return JSON.parse(localStorage.getItem(nidoKey("accounts")) || "[]");
}

export interface PendingAccount {
  contractId: string;
  setupKey: string;
  /** @deprecated old onboarding stored a temporary G secret here. */
  secretKey?: string;
}

/** A setup started in this browser that has not finished. `setupKey` is the
 *  setup secret while it is still kept; after {@link PENDING_TTL_MS} only the
 *  address remains. */
export interface UnfinishedAccount {
  contractId: string;
  setupKey?: string;
}

/** A stored pending entry: a secret-less one is a setup whose secret expired. */
type StoredPending = { contractId: string; setupKey?: string; secretKey?: string };

const pendingKey = () => nidoKey("pending");
/** Sidecar map (contractId -> creation epoch ms) recording when each pending
 * setup was started. Kept in its own key, not inside each `PendingAccount`, so
 * the wallet's cross-tab reconciler — which rewrites the pending list from a
 * normalized shape that has no timestamp field — cannot strip it. */
const pendingTsKey = () => nidoKey("pending:ts");
/** Setup window: a pending setup's secret older than this is deleted. Matches
 * the setup-salt cookie's `Max-Age` (1800s). The address stays listed. */
export const PENDING_TTL_MS = 30 * 60 * 1000;

function secretOf(p: StoredPending): string | undefined {
  return p.setupKey || p.secretKey || undefined;
}

function readPending(): StoredPending[] {
  try {
    const raw = JSON.parse(localStorage.getItem(pendingKey()) || "[]");
    return Array.isArray(raw)
      ? (raw as unknown[]).filter(
          (p): p is StoredPending =>
            !!p && typeof p === "object" && typeof (p as StoredPending).contractId === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function readPendingTimestamps(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(pendingTsKey()) || "{}");
    return raw && typeof raw === "object" ? (raw as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/**
 * Delete the setup secret of every pending entry whose setup window has
 * elapsed, keeping its address, so an abandoned setup's secret does not linger
 * in storage while the setup itself stays visible. A legacy entry with no
 * recorded timestamp is stamped on first sight so it, too, eventually expires.
 * Returns every pending entry, with or without its secret.
 */
export function purgeExpiredPendingAccounts(now: number = Date.now()): UnfinishedAccount[] {
  const pending = readPending();
  const ts = readPendingTimestamps();
  const kept: StoredPending[] = [];
  let changed = false;
  for (const p of pending) {
    if (!secretOf(p)) {
      if (p.setupKey !== undefined || p.secretKey !== undefined) changed = true;
      kept.push({ contractId: p.contractId });
      continue;
    }
    let stamp = ts[p.contractId];
    if (typeof stamp !== "number") {
      stamp = now;
      ts[p.contractId] = now;
      changed = true;
    }
    if (now - stamp > PENDING_TTL_MS) {
      kept.push({ contractId: p.contractId });
      changed = true;
    } else {
      kept.push(p);
    }
  }
  // Timestamps belong only to entries that still hold a secret.
  for (const id of Object.keys(ts)) {
    if (!kept.some((p) => p.contractId === id && secretOf(p))) {
      delete ts[id];
      changed = true;
    }
  }
  if (changed) {
    localStorage.setItem(pendingKey(), JSON.stringify(kept));
    localStorage.setItem(pendingTsKey(), JSON.stringify(ts));
  }
  return kept.map((p) => {
    const setupKey = secretOf(p);
    return setupKey ? { contractId: p.contractId, setupKey } : { contractId: p.contractId };
  });
}

export function savePendingAccount(contractId: string, setupKey: string): void {
  const pending = readPending();
  const existing = pending.find((p) => p.contractId === contractId);
  if (existing) {
    existing.setupKey = setupKey;
    delete existing.secretKey;
  } else {
    pending.push({ contractId, setupKey });
  }
  localStorage.setItem(pendingKey(), JSON.stringify(pending));
  const ts = readPendingTimestamps();
  ts[contractId] = Date.now();
  localStorage.setItem(pendingTsKey(), JSON.stringify(ts));
}

/** Pending setups that still hold their setup secret (expired ones excluded). */
export function loadPendingAccounts(): PendingAccount[] {
  return purgeExpiredPendingAccounts().flatMap((p) =>
    p.setupKey ? [{ contractId: p.contractId, setupKey: p.setupKey }] : [],
  );
}

/** Every unfinished setup, including those whose secret has expired. */
export function loadUnfinishedAccounts(): UnfinishedAccount[] {
  return purgeExpiredPendingAccounts();
}

export function removePendingAccount(contractId: string): void {
  const pending = readPending();
  const filtered = pending.filter((p) => p.contractId !== contractId);
  localStorage.setItem(pendingKey(), JSON.stringify(filtered));
  const ts = readPendingTimestamps();
  if (ts[contractId] !== undefined) {
    delete ts[contractId];
    localStorage.setItem(pendingTsKey(), JSON.stringify(ts));
  }
}

export function activateAccount(contractId: string): void {
  removePendingAccount(contractId);
  saveAccount(contractId);
}

export function saveAccountName(contractId: string, name: string): void {
  localStorage.setItem(nidoKey(`names:${contractId}`), name);
}

export function loadAccountName(contractId: string): string | null {
  return localStorage.getItem(nidoKey(`names:${contractId}`));
}

// --- Policy storage (Tier C/D from the spec) -------------------------------
//
// Friend nicknames and block labels are pure display overlay; session-key
// material is passkey-backed (credentialId + public key only — no private key
// on disk; see SessionKeyMaterial). Keys are namespaced by smart-account address.

const friendsKey = (account: string) => `nido.${account}.friends`;
const sessionKey = (account: string, target: string) =>
  `nido.${account}.session-key.${target}`;
const labelsKey = (account: string) => `nido.${account}.block-labels`;

export function saveFriendNickname(
  account: string,
  address: string,
  nickname: string,
): void {
  const existing = loadFriendNicknames(account);
  existing[address] = nickname;
  localStorage.setItem(friendsKey(account), JSON.stringify(existing));
}

export function loadFriendNicknames(account: string): Record<string, string> {
  const raw = localStorage.getItem(friendsKey(account));
  return raw ? JSON.parse(raw) : {};
}

/**
 * Material persisted at the dApp's origin for a delegated session key.
 *
 *  - `credentialId` is the base64url WebAuthn credential id created at
 *    delegation time (`createSessionPasskey`).
 *  - `publicKey` is a hex-encoded 65-byte SEC1 uncompressed P-256 point.
 *    Stored alongside the credentialId because the dApp needs it on each
 *    sign to construct the `External(verifier, pubkey)` signer; the
 *    credential id alone can't yield the pubkey.
 *
 * No private key is stored: sessions are passkey-backed (the private key stays
 * in the authenticator). Old synthetic-flow entries may still carry a plaintext
 * `privateKey` — nothing signs with it any more, so `loadSessionKeyMaterial`
 * PURGES it from storage on load rather than returning it.
 */
export interface SessionKeyMaterial {
  credentialId: string;
  publicKey: string;        // hex, 65 bytes
  label?: string;
}

export function saveSessionKeyMaterial(
  account: string,
  target: string,
  material: SessionKeyMaterial,
): void {
  const serialized: Record<string, unknown> = {
    credentialId: material.credentialId,
    publicKey: material.publicKey,
    label: material.label,
  };
  // Deliberately NO privateKey: a session private key must never touch disk.
  localStorage.setItem(sessionKey(account, target), JSON.stringify(serialized));
}

export function loadSessionKeyMaterial(
  account: string,
  target: string,
): SessionKeyMaterial | null {
  const key = sessionKey(account, target);
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const o = JSON.parse(raw);
  // Purge a deprecated synthetic-flow privateKey: nothing signs with a stored
  // session key any more, so persisted private bytes are dead + sensitive —
  // drop them from storage on first load and never hand them back.
  if (o.privateKey !== undefined) {
    delete o.privateKey;
    localStorage.setItem(key, JSON.stringify(o));
  }
  return {
    credentialId: o.credentialId,
    publicKey: o.publicKey,
    label: o.label,
  };
}

export function forgetSessionKeyMaterial(account: string, target: string): void {
  localStorage.removeItem(sessionKey(account, target));
}

export function saveBlockLabel(account: string, ruleId: number, label: string): void {
  const existing = loadBlockLabels(account);
  existing[ruleId] = label;
  localStorage.setItem(labelsKey(account), JSON.stringify(existing));
}

export function loadBlockLabels(account: string): Record<number, string> {
  const raw = localStorage.getItem(labelsKey(account));
  return raw ? JSON.parse(raw) : {};
}
