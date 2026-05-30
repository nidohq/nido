import { buf2hex, buf2base64url, base64url2buf } from "./encoding.js";

declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

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
  const accounts: string[] = JSON.parse(localStorage.getItem("g2c:accounts") || "[]");
  if (!accounts.includes(contractId)) {
    accounts.push(contractId);
    localStorage.setItem("g2c:accounts", JSON.stringify(accounts));
  }
}

export function loadAccounts(): string[] {
  return JSON.parse(localStorage.getItem("g2c:accounts") || "[]");
}

export interface PendingAccount {
  contractId: string;
  secretKey: string;
}

export function savePendingAccount(contractId: string, secretKey: string): void {
  const pending: PendingAccount[] = JSON.parse(localStorage.getItem("g2c:pending") || "[]");
  if (!pending.some((p) => p.contractId === contractId)) {
    pending.push({ contractId, secretKey });
    localStorage.setItem("g2c:pending", JSON.stringify(pending));
  }
}

export function loadPendingAccounts(): PendingAccount[] {
  return JSON.parse(localStorage.getItem("g2c:pending") || "[]");
}

export function removePendingAccount(contractId: string): void {
  const pending: PendingAccount[] = JSON.parse(localStorage.getItem("g2c:pending") || "[]");
  const filtered = pending.filter((p) => p.contractId !== contractId);
  localStorage.setItem("g2c:pending", JSON.stringify(filtered));
}

export function activateAccount(contractId: string): void {
  removePendingAccount(contractId);
  saveAccount(contractId);
}

export function saveAccountName(contractId: string, name: string): void {
  localStorage.setItem(`g2c:names:${contractId}`, name);
}

export function loadAccountName(contractId: string): string | null {
  return localStorage.getItem(`g2c:names:${contractId}`);
}

// --- Policy storage (Tier C/D from the spec) -------------------------------
//
// Friend nicknames and block labels are pure display overlay; session-key
// material includes the private key (Tier D) and must never leave this
// origin. Keys are namespaced by smart-account address.

const friendsKey = (account: string) => `g2c.${account}.friends`;
const sessionKey = (account: string, target: string) =>
  `g2c.${account}.session-key.${target}`;
const labelsKey = (account: string) => `g2c.${account}.block-labels`;

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

export interface SessionKeyMaterial {
  privateKey: Uint8Array;
  credentialId: string;
  label?: string;
}

export function saveSessionKeyMaterial(
  account: string,
  target: string,
  material: SessionKeyMaterial,
): void {
  const serialized = {
    privateKey: Array.from(material.privateKey),
    credentialId: material.credentialId,
    label: material.label,
  };
  localStorage.setItem(sessionKey(account, target), JSON.stringify(serialized));
}

export function loadSessionKeyMaterial(
  account: string,
  target: string,
): SessionKeyMaterial | null {
  const raw = localStorage.getItem(sessionKey(account, target));
  if (!raw) return null;
  const o = JSON.parse(raw);
  return {
    privateKey: new Uint8Array(o.privateKey),
    credentialId: o.credentialId,
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
