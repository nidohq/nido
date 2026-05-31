export declare function saveCredential(contractId: string, credentialId: Uint8Array, publicKey: Uint8Array): void;
export declare function loadCredential(contractId: string): {
    credentialId: Uint8Array;
    publicKey: string;
} | null;
export declare function saveAccount(contractId: string): void;
export declare function loadAccounts(): string[];
export interface PendingAccount {
    contractId: string;
    secretKey: string;
}
export declare function savePendingAccount(contractId: string, secretKey: string): void;
export declare function loadPendingAccounts(): PendingAccount[];
export declare function removePendingAccount(contractId: string): void;
export declare function activateAccount(contractId: string): void;
export declare function saveAccountName(contractId: string, name: string): void;
export declare function loadAccountName(contractId: string): string | null;
export declare function saveFriendNickname(account: string, address: string, nickname: string): void;
export declare function loadFriendNicknames(account: string): Record<string, string>;
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
 * Older session-key entries created before the passkey-backed flow may
 * still have a `privateKey` field — accepted on load for forward compat
 * but never written by current code.
 */
export interface SessionKeyMaterial {
    credentialId: string;
    publicKey: string;
    label?: string;
    /** @deprecated synthetic-key flow only; absent for passkey-backed sessions. */
    privateKey?: Uint8Array;
}
export declare function saveSessionKeyMaterial(account: string, target: string, material: SessionKeyMaterial): void;
export declare function loadSessionKeyMaterial(account: string, target: string): SessionKeyMaterial | null;
export declare function forgetSessionKeyMaterial(account: string, target: string): void;
export declare function saveBlockLabel(account: string, ruleId: number, label: string): void;
export declare function loadBlockLabels(account: string): Record<number, string>;
//# sourceMappingURL=storage.d.ts.map