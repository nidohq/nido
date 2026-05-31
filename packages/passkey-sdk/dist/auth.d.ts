import { xdr, rpc, Operation } from "@stellar/stellar-sdk";
import type { PasskeySignature } from "./types.js";
/**
 * Compute the Soroban signature_payload — sha256 of the HashIdPreimage that
 * binds the auth invocation, nonce, expiration ledger, and network. This is
 * what the host hands to `__check_auth` as the first argument.
 *
 * NOTE: in OZ v0.7+ smart accounts the *signed* digest is one step further —
 * see `computeAuthDigest`. The WebAuthn ceremony should sign that, not this.
 *
 * @param authEntry - The SorobanAuthorizationEntry from simulation
 * @param networkPassphrase - Stellar network passphrase
 * @param lastLedger - Current ledger sequence number
 * @param expirationLedgerOffset - How many ledgers the signature is valid for (default 100)
 */
export declare function buildAuthHash(authEntry: xdr.SorobanAuthorizationEntry, networkPassphrase: string, lastLedger: number, expirationLedgerOffset?: number): Buffer;
/**
 * Compute the OZ v0.7+ auth digest the smart account's `do_check_auth` will
 * verify each signer's signature against:
 *
 *     auth_digest = sha256(signature_payload || context_rule_ids.to_xdr())
 *
 * This binds the signed message to the specific context rule the caller is
 * invoking, preventing rule-substitution replay. The WebAuthn challenge MUST
 * be this digest, not the bare `signature_payload`.
 *
 * `signature_payload` is the 32-byte result from `buildAuthHash`.
 * `contextRuleIds` is the same array passed to `injectPasskeySignature`'s
 *   `contextRuleIds` parameter; default `[0]` (the Default rule).
 *
 * Matches `compute_auth_digest` in `crates/integration-tests/src/lib.rs`.
 */
export declare function computeAuthDigest(signaturePayload: Uint8Array, contextRuleIds?: readonly number[]): Buffer;
/**
 * Extract the first Soroban auth entry from a simulation result.
 */
export declare function getAuthEntry(simulation: rpc.Api.SimulateTransactionSuccessResponse): xdr.SorobanAuthorizationEntry;
/**
 * Parse a WebAuthn assertion response into the components needed for Soroban auth.
 *
 * @param assertionResponse - The response from `navigator.credentials.get()`
 */
export declare function parseAssertionResponse(assertionResponse: {
    authenticatorData: ArrayBuffer;
    clientDataJSON: ArrayBuffer;
    signature: ArrayBuffer;
}): PasskeySignature;
/**
 * Inject a passkey signature into a transaction's Soroban auth credentials.
 *
 * Emits the OZ v0.7+ `AuthPayload { signers, context_rule_ids }` struct.
 * Pre-v0.7 contracts (raw `Signatures(Map<Signer, Bytes>)` tuple struct,
 * signing the raw signature_payload with no rule-id binding) are not
 * supported — they need to be migrated to a v0.7 factory + account.
 *
 * @param transaction - The assembled transaction from simulation
 * @param passkeySignature - Parsed passkey signature components
 * @param verifierAddress - Address of the WebAuthn verifier contract
 * @param publicKey - 65-byte uncompressed P-256 public key
 * @param lastLedger - Current ledger sequence number
 * @param expirationLedgerOffset - How many ledgers the signature is valid for (default 100)
 * @param contextRuleIds - Context-rule IDs authorizing each auth context (index-aligned).
 *                        Defaults to `[0]` — the Default rule that ships with every
 *                        smart account and authorizes self-modification.
 */
export declare function injectPasskeySignature(transaction: {
    operations: readonly Operation[];
}, passkeySignature: PasskeySignature, verifierAddress: string, publicKey: Uint8Array, lastLedger: number, expirationLedgerOffset?: number, contextRuleIds?: readonly number[]): void;
//# sourceMappingURL=auth.d.ts.map