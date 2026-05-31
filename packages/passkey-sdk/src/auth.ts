import { hash, xdr, rpc, Operation, Address } from "@stellar/stellar-sdk";
import { derToCompact } from "./signature.js";
import type { PasskeySignature } from "./types.js";

/** Default ledger offset for signature expiration. */
const DEFAULT_EXPIRATION_OFFSET = 10000;

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
export function buildAuthHash(
  authEntry: xdr.SorobanAuthorizationEntry,
  networkPassphrase: string,
  lastLedger: number,
  expirationLedgerOffset: number = DEFAULT_EXPIRATION_OFFSET,
): Buffer {
  const creds = authEntry.credentials().address();
  const expirationLedger = lastLedger + expirationLedgerOffset;
  // Convert nonce to BigInt to avoid cross-package instanceof issues
  // when the auth entry originates from a different stellar-sdk copy
  const nonce = xdr.Int64.fromString(creds.nonce().toString());

  let entry = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(networkPassphrase, "utf-8")),
      nonce,
      signatureExpirationLedger: expirationLedger,
      invocation: authEntry.rootInvocation(),
    }),
  );
  return hash(entry.toXDR());
}

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
export function computeAuthDigest(
  signaturePayload: Uint8Array,
  contextRuleIds: readonly number[] = [0],
): Buffer {
  // context_rule_ids.to_xdr() in Rust serializes the Vec<u32> as the
  // ScVal::Vec form. The JS equivalent is xdr.ScVal.scvVec([scvU32(...)]).
  const ctxIdsXdr = xdr.ScVal.scvVec(
    contextRuleIds.map((id) => xdr.ScVal.scvU32(id)),
  ).toXDR();
  const preimage = Buffer.concat([Buffer.from(signaturePayload), ctxIdsXdr]);
  return hash(preimage);
}

/**
 * Extract the first Soroban auth entry from a simulation result.
 */
export function getAuthEntry(
  simulation: rpc.Api.SimulateTransactionSuccessResponse,
): xdr.SorobanAuthorizationEntry {
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
export function parseAssertionResponse(assertionResponse: {
  authenticatorData: ArrayBuffer;
  clientDataJSON: ArrayBuffer;
  signature: ArrayBuffer;
}): PasskeySignature {
  return {
    authenticatorData: new Uint8Array(assertionResponse.authenticatorData),
    clientDataJson: new Uint8Array(assertionResponse.clientDataJSON),
    signature: derToCompact(new Uint8Array(assertionResponse.signature)),
  };
}

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
export function injectPasskeySignature(
  transaction: { operations: readonly Operation[] },
  passkeySignature: PasskeySignature,
  verifierAddress: string,
  publicKey: Uint8Array,
  lastLedger: number,
  expirationLedgerOffset: number = DEFAULT_EXPIRATION_OFFSET,
  contextRuleIds: readonly number[] = [0],
): void {
  // Mutate via clone-and-replace, not in-place. The canonical
  // `authorizeEntry` helper in stellar-base does the same — and for good
  // reason: through `assembleTransaction(...).build()`, `op.auth[i]` is
  // referenced from BOTH the JS-side parsed Operation and the inner XDR
  // Transaction's serialization buffer, and the two don't reliably stay in
  // sync under in-place mutation. Round-tripping via XDR produces a fresh
  // entry that becomes the new array element — guaranteeing the signed
  // payload reaches the wire.
  const op = transaction.operations[0] as Operation.InvokeHostFunction;
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

  const contextRuleIdsVec = xdr.ScVal.scvVec(
    contextRuleIds.map((id) => xdr.ScVal.scvU32(id)),
  );
  // ScMap with Symbol keys in alphabetical order (context_rule_ids < signers).
  creds.signature(
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("context_rule_ids"),
        val: contextRuleIdsVec,
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("signers"),
        val: signersMap,
      }),
    ]),
  );

  // Replace the original auth entry with the freshly-constructed signed
  // entry. `op.auth` is the same array referenced by the inner XDR
  // transaction's operations (verified empirically: stellar-base's
  // `Operation.fromXDRObject` returns `attrs.auth()` directly, so
  // `op.auth === innerTx.operations()[0].body().invokeHostFunctionOp().auth()`),
  // so swapping the [0] slot here updates what gets serialized.
  (op.auth as xdr.SorobanAuthorizationEntry[])[0] = signedEntry;
}
