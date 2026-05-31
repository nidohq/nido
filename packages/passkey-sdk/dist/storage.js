import { buf2hex, buf2base64url, base64url2buf } from "./encoding.js";
export function saveCredential(contractId, credentialId, publicKey) {
    const prefix = `passkey:${contractId}:`;
    localStorage.setItem(prefix + "credentialId", buf2base64url(credentialId));
    localStorage.setItem(prefix + "publicKey", buf2hex(publicKey));
}
export function loadCredential(contractId) {
    const prefix = `passkey:${contractId}:`;
    const credId = localStorage.getItem(prefix + "credentialId");
    const pubKey = localStorage.getItem(prefix + "publicKey");
    if (credId && pubKey)
        return { credentialId: base64url2buf(credId), publicKey: pubKey };
    return null;
}
export function saveAccount(contractId) {
    const accounts = JSON.parse(localStorage.getItem("g2c:accounts") || "[]");
    if (!accounts.includes(contractId)) {
        accounts.push(contractId);
        localStorage.setItem("g2c:accounts", JSON.stringify(accounts));
    }
}
export function loadAccounts() {
    return JSON.parse(localStorage.getItem("g2c:accounts") || "[]");
}
export function savePendingAccount(contractId, secretKey) {
    const pending = JSON.parse(localStorage.getItem("g2c:pending") || "[]");
    if (!pending.some((p) => p.contractId === contractId)) {
        pending.push({ contractId, secretKey });
        localStorage.setItem("g2c:pending", JSON.stringify(pending));
    }
}
export function loadPendingAccounts() {
    return JSON.parse(localStorage.getItem("g2c:pending") || "[]");
}
export function removePendingAccount(contractId) {
    const pending = JSON.parse(localStorage.getItem("g2c:pending") || "[]");
    const filtered = pending.filter((p) => p.contractId !== contractId);
    localStorage.setItem("g2c:pending", JSON.stringify(filtered));
}
export function activateAccount(contractId) {
    removePendingAccount(contractId);
    saveAccount(contractId);
}
export function saveAccountName(contractId, name) {
    localStorage.setItem(`g2c:names:${contractId}`, name);
}
export function loadAccountName(contractId) {
    return localStorage.getItem(`g2c:names:${contractId}`);
}
// --- Policy storage (Tier C/D from the spec) -------------------------------
//
// Friend nicknames and block labels are pure display overlay; session-key
// material includes the private key (Tier D) and must never leave this
// origin. Keys are namespaced by smart-account address.
const friendsKey = (account) => `g2c.${account}.friends`;
const sessionKey = (account, target) => `g2c.${account}.session-key.${target}`;
const labelsKey = (account) => `g2c.${account}.block-labels`;
export function saveFriendNickname(account, address, nickname) {
    const existing = loadFriendNicknames(account);
    existing[address] = nickname;
    localStorage.setItem(friendsKey(account), JSON.stringify(existing));
}
export function loadFriendNicknames(account) {
    const raw = localStorage.getItem(friendsKey(account));
    return raw ? JSON.parse(raw) : {};
}
export function saveSessionKeyMaterial(account, target, material) {
    const serialized = {
        credentialId: material.credentialId,
        publicKey: material.publicKey,
        label: material.label,
    };
    if (material.privateKey) {
        serialized.privateKey = Array.from(material.privateKey);
    }
    localStorage.setItem(sessionKey(account, target), JSON.stringify(serialized));
}
export function loadSessionKeyMaterial(account, target) {
    const raw = localStorage.getItem(sessionKey(account, target));
    if (!raw)
        return null;
    const o = JSON.parse(raw);
    return {
        credentialId: o.credentialId,
        publicKey: o.publicKey,
        label: o.label,
        ...(o.privateKey ? { privateKey: new Uint8Array(o.privateKey) } : {}),
    };
}
export function forgetSessionKeyMaterial(account, target) {
    localStorage.removeItem(sessionKey(account, target));
}
export function saveBlockLabel(account, ruleId, label) {
    const existing = loadBlockLabels(account);
    existing[ruleId] = label;
    localStorage.setItem(labelsKey(account), JSON.stringify(existing));
}
export function loadBlockLabels(account) {
    const raw = localStorage.getItem(labelsKey(account));
    return raw ? JSON.parse(raw) : {};
}
//# sourceMappingURL=storage.js.map