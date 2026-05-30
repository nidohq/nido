import { hash, xdr, Address } from "@stellar/stellar-sdk";
import { derToCompact } from "./signature.js";
/** Default ledger offset for signature expiration. */
const DEFAULT_EXPIRATION_OFFSET = 10000;
/**
 * Compute the authorization hash for a Soroban auth entry.
 *
 * This hash is what gets signed by the passkey (used as the WebAuthn challenge).
 *
 * @param authEntry - The SorobanAuthorizationEntry from simulation
 * @param networkPassphrase - Stellar network passphrase
 * @param lastLedger - Current ledger sequence number
 * @param expirationLedgerOffset - How many ledgers the signature is valid for (default 100)
 */
export function buildAuthHash(authEntry, networkPassphrase, lastLedger, expirationLedgerOffset = DEFAULT_EXPIRATION_OFFSET) {
    const creds = authEntry.credentials().address();
    const expirationLedger = lastLedger + expirationLedgerOffset;
    // Convert nonce to BigInt to avoid cross-package instanceof issues
    // when the auth entry originates from a different stellar-sdk copy
    const nonce = xdr.Int64.fromString(creds.nonce().toString());
    let entry = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(new xdr.HashIdPreimageSorobanAuthorization({
        networkId: hash(Buffer.from(networkPassphrase, "utf-8")),
        nonce,
        signatureExpirationLedger: expirationLedger,
        invocation: authEntry.rootInvocation(),
    }));
    return hash(entry.toXDR());
}
/**
 * Extract the first Soroban auth entry from a simulation result.
 */
export function getAuthEntry(simulation) {
    const auth = simulation.result?.auth;
    if (!auth || auth.length === 0) {
        throw new Error("No authorization entries in simulation result");
    }
    return auth[0];
}
/**
 * Parse a WebAuthn assertion response into the components needed for Soroban auth.
 *
 * @param assertionResponse - The response from `navigator.credentials.get()`
 */
export function parseAssertionResponse(assertionResponse) {
    return {
        authenticatorData: new Uint8Array(assertionResponse.authenticatorData),
        clientDataJson: new Uint8Array(assertionResponse.clientDataJSON),
        signature: derToCompact(new Uint8Array(assertionResponse.signature)),
    };
}
/**
 * Inject a passkey signature into a transaction's Soroban auth credentials.
 *
 * Constructs the OZ v0.7+ `AuthPayload` struct expected by `do_check_auth`:
 *
 *   AuthPayload {
 *     signers: Map<Signer, Bytes>,    // { External(verifier, pubkey): XDR(WebAuthnSigData) }
 *     context_rule_ids: Vec<u32>,     // which rule authorizes each context
 *   }
 *
 * In Soroban scval encoding, a Rust struct is a `Map` keyed by `Symbol(field_name)`
 * with entries in alphabetical order; an enum variant is a `Vec` with the variant
 * name as the first element followed by its tuple values.
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
export function injectPasskeySignature(transaction, passkeySignature, verifierAddress, publicKey, lastLedger, expirationLedgerOffset = DEFAULT_EXPIRATION_OFFSET, contextRuleIds = [0]) {
    // Mutate via clone-and-replace, not in-place. The canonical
    // `authorizeEntry` helper in stellar-base does the same — and for good
    // reason: through `assembleTransaction(...).build()`, `op.auth[i]` is
    // referenced from BOTH the JS-side parsed Operation and the inner XDR
    // Transaction's serialization buffer, and the two don't reliably stay in
    // sync under in-place mutation. Round-tripping via XDR produces a fresh
    // entry that becomes the new array element — guaranteeing the signed
    // payload reaches the wire.
    const op = transaction.operations[0];
    if (!op.auth || op.auth.length === 0) {
        throw new Error("No authorization entries in transaction");
    }
    const original = op.auth[0];
    const signedEntry = xdr.SorobanAuthorizationEntry.fromXDR(original.toXDR());
    const creds = signedEntry.credentials().address();
    creds.signatureExpirationLedger(lastLedger + expirationLedgerOffset);
    // WebAuthnSigData struct (field names must match the contract type).
    // Soroban struct → ScMap with Symbol keys in alphabetical order.
    const sigDataScVal = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("authenticator_data"),
            val: xdr.ScVal.scvBytes(Buffer.from(passkeySignature.authenticatorData)),
        }),
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("client_data"),
            val: xdr.ScVal.scvBytes(Buffer.from(passkeySignature.clientDataJson)),
        }),
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("signature"),
            val: xdr.ScVal.scvBytes(Buffer.from(passkeySignature.signature)),
        }),
    ]);
    const sigDataBytes = sigDataScVal.toXDR();
    // Signer::External(verifier_address, public_key) enum variant
    // → Vec[Symbol("External"), Address, Bytes]
    const signerScVal = xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol("External"),
        Address.fromString(verifierAddress).toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(publicKey)),
    ]);
    // signers: Map<Signer, Bytes> with our single passkey entry
    const signersMap = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
            key: signerScVal,
            val: xdr.ScVal.scvBytes(sigDataBytes),
        }),
    ]);
    // context_rule_ids: Vec<u32>
    const contextRuleIdsVec = xdr.ScVal.scvVec(contextRuleIds.map((id) => xdr.ScVal.scvU32(id)));
    // AuthPayload struct → ScMap, alphabetical field order
    // (context_rule_ids < signers).
    creds.signature(xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("context_rule_ids"),
            val: contextRuleIdsVec,
        }),
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol("signers"),
            val: signersMap,
        }),
    ]));
    // Replace the original auth entry with the freshly-constructed signed
    // entry. `op.auth` is the same array referenced by the inner XDR
    // transaction's operations (verified empirically: stellar-base's
    // `Operation.fromXDRObject` returns `attrs.auth()` directly, so
    // `op.auth === innerTx.operations()[0].body().invokeHostFunctionOp().auth()`),
    // so swapping the [0] slot here updates what gets serialized.
    op.auth[0] = signedEntry;
}
//# sourceMappingURL=auth.js.map