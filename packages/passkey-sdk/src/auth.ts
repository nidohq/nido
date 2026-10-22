import { hash, xdr, rpc, Operation, StrKey } from "@stellar/stellar-sdk";
import { derToCompact } from "./signature.js";
import { ruleIdsXdr, signingDigest } from "@stellar-registry/perch";
import { buildAuthPayloadScVal } from "./multiSigner.js";
import type { SignerSignature } from "./multiSigner.js";
import type { PasskeySignature } from "./types.js";

/** Default ledger offset for signature expiration (~14h). This is the single
 *  source of truth: `buildAuthHash` and BOTH injectors below default to it, and
 *  it is exported so callers (e.g. the frontend's `signatureExpirationOffset`)
 *  pass the SAME value to the hash builder and the injector — a mismatch makes
 *  `__check_auth` recompute a different digest and reject the signature. */
export const DEFAULT_EXPIRATION_OFFSET = 10000;

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
 * @param expirationLedgerOffset - How many ledgers the signature is valid for (default 10000 ≈ 14h)
 */
export function buildAuthHash(
  authEntry: xdr.SorobanAuthorizationEntry,
  networkPassphrase: string,
  lastLedger: number,
  expirationLedgerOffset: number = DEFAULT_EXPIRATION_OFFSET,
): Buffer {
  const expirationLedger = lastLedger + expirationLedgerOffset;
  return buildAuthHashAt(authEntry, networkPassphrase, expirationLedger);
}

/**
 * Like {@link buildAuthHash}, but takes the ABSOLUTE signature-expiration
 * ledger instead of a relative offset.
 *
 * Multi-party flows (recovery completion) require every participant — the
 * originator who stores the parent auth-digest, each friend who signs over it,
 * and the chain that recomputes it from the submitted entry — to feed the
 * IDENTICAL `signatureExpirationLedger` into the preimage. A relative offset
 * resolved against each party's own live `getLatestLedger` diverges; one
 * canonical absolute ledger does not. Use this in those flows.
 */
export function buildAuthHashAt(
  authEntry: xdr.SorobanAuthorizationEntry,
  networkPassphrase: string,
  signatureExpirationLedger: number,
): Buffer {
  const creds = authEntry.credentials().address();
  // Convert nonce to BigInt to avoid cross-package instanceof issues
  // when the auth entry originates from a different stellar-sdk copy
  const nonce = xdr.Int64.fromString(creds.nonce().toString());

  const entry = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(networkPassphrase, "utf-8")),
      nonce,
      signatureExpirationLedger,
      invocation: authEntry.rootInvocation(),
    }),
  );
  return hash(entry.toXDR());
}

/** The external-signer authorization scheme an account reports as its
 *  `capabilities().auth_digest`. `addr_oz_v1` binds the account's own address
 *  into the signed payload (the redeployed accounts); `oz_rule_ids` is the
 *  earlier scheme that omits it (accounts minted before the redeploy). Read it
 *  per account with `authDigestScheme` and pass it to {@link computeAuthDigest}
 *  so each account is signed in its own dialect. */
export type AuthDigestScheme = "addr_oz_v1" | "oz_rule_ids";

/**
 * Compute the OZ v0.7+ auth digest the smart `account`'s `__check_auth` will
 * verify each signer's signature against, in the account's own `scheme`:
 *
 * - `addr_oz_v1` (the redeployed accounts): the account folds its own address
 *   into the host payload before OZ layers the context rule ids on top, so a
 *   signature cannot be replayed on another account that shares an External key
 *   and rule ids (perch-js `signingDigest`):
 *
 *       bound       = sha256(AUTH_ADDR_DOMAIN || account_id || signature_payload)
 *       auth_digest = sha256(bound || context_rule_ids.to_xdr())
 *
 * - `oz_rule_ids` (accounts minted before the redeploy): no address binding —
 *   `auth_digest = sha256(signature_payload || context_rule_ids.to_xdr())`.
 *   perch-js no longer produces it, so it is computed here.
 *
 * Signing in the wrong dialect makes `__check_auth` reject the signature, so a
 * caller must read the account's scheme (`authDigestScheme`) and pass it. The
 * WebAuthn challenge MUST be this digest, not the bare `signature_payload`.
 *
 * `account` is the smart account's C-address (whose `__check_auth` runs).
 * `signaturePayload` is the 32-byte result from `buildAuthHash`.
 * `contextRuleIds` is the same array passed to `injectPasskeySignature`'s
 *   `contextRuleIds` parameter: one selected rule per authorization context.
 *   There is no default; select the rule (perch-js `selectRules`), since ids
 *   move when a document replaces a rule.
 * `scheme` defaults to `addr_oz_v1` (the redeployed accounts); pass the account's
 *   actual scheme for an account minted before the redeploy.
 */
export function computeAuthDigest(
  account: string,
  signaturePayload: Uint8Array,
  contextRuleIds: readonly number[],
  scheme: AuthDigestScheme = "addr_oz_v1",
): Buffer {
  if (!StrKey.isValidContract(account)) {
    throw new Error(`computeAuthDigest: account must be a contract address, got "${account}"`);
  }
  if (scheme === "addr_oz_v1") {
    return Buffer.from(signingDigest(account, signaturePayload, contextRuleIds));
  }
  if (signaturePayload.length !== 32) {
    throw new Error("computeAuthDigest: signature payload must be 32 bytes");
  }
  return hash(Buffer.concat([signaturePayload, ruleIdsXdr(contextRuleIds)]));
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
 * @param expirationLedgerOffset - How many ledgers the signature is valid for
 *                                 (`undefined`: 10000 ≈ 14h)
 * @param contextRuleIds - Context-rule IDs authorizing each auth context (index-aligned),
 *                        as selected for this account (no default: ids move).
 */
export function injectPasskeySignature(
  transaction: { operations: readonly Operation[] },
  passkeySignature: PasskeySignature,
  verifierAddress: string,
  publicKey: Uint8Array,
  lastLedger: number,
  expirationLedgerOffset: number | undefined,
  contextRuleIds: readonly number[],
): void {
  injectSignedAuthPayload(
    transaction,
    [{ kind: "external", verifierAddress, publicKey, passkeySignature }],
    lastLedger,
    expirationLedgerOffset,
    contextRuleIds,
  );
}

/**
 * Inject a (possibly multi-signer) `AuthPayload` into a transaction's first
 * Soroban auth entry. Generalization of {@link injectPasskeySignature} for
 * rules that need SEVERAL signatures in one ceremony — e.g. a policy-less
 * multi-signer default rule, which OZ treats as N-of-N (issue #87), or an
 * M-of-N simple-threshold rule with M > 1.
 *
 * Every `external` signer's `passkeySignature` must be an assertion over the
 * SAME auth digest (`computeAuthDigest(account, signature_payload, contextRuleIds)`),
 * since the contract verifies each map entry against that one digest.
 */
export function injectSignedAuthPayload(
  transaction: { operations: readonly Operation[] },
  signers: readonly SignerSignature[],
  lastLedger: number,
  expirationLedgerOffset: number | undefined,
  contextRuleIds: readonly number[],
): void {
  // Mutate via clone-and-replace, not in-place. The canonical
  // `authorizeEntry` helper in stellar-base does the same — and for good
  // reason: through `assembleTransaction(...).build()`, `op.auth[i]` is
  // referenced from BOTH the JS-side parsed Operation and the inner XDR
  // Transaction's serialization buffer, and the two don't reliably stay in
  // sync under in-place mutation. Round-tripping via XDR produces a fresh
  // entry that becomes the new array element — guaranteeing the signed
  // payload reaches the wire.
  setAuthPayload(
    transaction,
    buildAuthPayloadScVal({ contextRuleIds, signers }),
    lastLedger,
    expirationLedgerOffset,
  );
}

/**
 * Inject a complete `AuthPayload`, as the `ScVal` XDR perch-js's
 * `buildAuthPayload` (or `applyDocument`'s `submit`) produces, into a
 * transaction's first Soroban auth entry, with the expiration its signature
 * payload was computed for.
 */
export function injectAuthPayloadXdr(
  transaction: { operations: readonly Operation[] },
  authPayloadXdr: Uint8Array,
  lastLedger: number,
  expirationLedgerOffset: number | undefined,
): void {
  setAuthPayload(
    transaction,
    xdr.ScVal.fromXDR(Buffer.from(authPayloadXdr)),
    lastLedger,
    expirationLedgerOffset,
  );
}

function setAuthPayload(
  transaction: { operations: readonly Operation[] },
  payload: xdr.ScVal,
  lastLedger: number,
  expirationLedgerOffset: number | undefined,
): void {
  const op = transaction.operations[0] as Operation.InvokeHostFunction;
  if (!op.auth || op.auth.length === 0) {
    throw new Error("No authorization entries in transaction");
  }
  const original = op.auth[0];
  const signedEntry = xdr.SorobanAuthorizationEntry.fromXDR(original.toXDR());
  const creds = signedEntry.credentials().address();

  creds.signatureExpirationLedger(lastLedger + (expirationLedgerOffset ?? DEFAULT_EXPIRATION_OFFSET));
  creds.signature(payload);

  // Replace the original auth entry with the freshly-constructed signed
  // entry. `op.auth` is the same array referenced by the inner XDR
  // transaction's operations (verified empirically: stellar-base's
  // `Operation.fromXDRObject` returns `attrs.auth()` directly, so
  // `op.auth === innerTx.operations()[0].body().invokeHostFunctionOp().auth()`),
  // so swapping the [0] slot here updates what gets serialized.
  (op.auth as xdr.SorobanAuthorizationEntry[])[0] = signedEntry;
}
