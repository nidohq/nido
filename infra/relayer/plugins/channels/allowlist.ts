/**
 * allowlist.ts
 *
 * Host-function allowlist: the security boundary between "anyone can ask the relayer
 * channels path to submit a Soroban invoke" and "only these specific recovery/genesis
 * contract calls ride the channel". The relayer receives a Soroban invoke as a base64
 * `func` (InvokeHostFunction XDR) + `auth`, per
 * `packages/passkey-sdk/src/relayer.ts::submitSorobanTransaction`, which POSTs
 * `{ params: { func, auth, skipWait } }`.
 *
 * SECURITY: always decode the ACTUAL host function XDR to find the invoked contract
 * function name. Never trust a caller-declared/label field for this decision — a
 * malicious caller could set any string there while the encoded HostFunction invokes
 * something else entirely.
 */
import { xdr } from '@stellar/stellar-sdk';
import { pluginError } from '@openzeppelin/relayer-sdk';

/**
 * Contract functions the relayer channels path is allowed to submit.
 *
 * `add_context_rule` is included ONLY for the zero-signer recovery-completion shape:
 * completing a recovery adds a signer via a context rule while the account (by design,
 * mid-recovery) has no active signer able to authorize normally, so this call has to be
 * relayer-submittable too. This is a deliberately broad allow at the function-name
 * level — it is the contract's job to enforce that `add_context_rule` only succeeds in
 * that zero-signer completion state (via its own auth checks), not this list's. If the
 * contract's authorization for `add_context_rule` ever loosens, revisit this entry.
 */
export const ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set([
  'create_account',
  'create_account_v2',
  'insert_for',
  'initiate_recovery',
  'cancel_recovery',
  'burn_nullifier',
  'add_context_rule',
]);

/**
 * Decode an InvokeHostFunction XDR (base64) and return the invoked contract function
 * name, or `null` when it isn't an InvokeContract host function.
 *
 * create-contract / create-contract-v2 / upload-wasm host functions are deliberately
 * NOT client submissions to gate here by name (they're genesis/deploy tooling, not part
 * of the relayer's client-facing recovery path) — returning `null` for them means
 * `isAllowed` treats them as not-allowed, so the relayer rejects them too. If a future
 * flow legitimately needs the relayer to submit one of those host function kinds, it
 * must be handled here explicitly rather than silently falling through.
 */
export function invokedFunctionName(funcXdrBase64: string): string | null {
  let hostFunction: xdr.HostFunction;
  try {
    hostFunction = xdr.HostFunction.fromXDR(funcXdrBase64, 'base64');
  } catch {
    return null;
  }

  if (hostFunction.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) {
    return null;
  }

  const fnName = hostFunction.invokeContract().functionName();
  return typeof fnName === 'string' ? fnName : fnName.toString('utf8');
}

/** True iff the decoded, actual invoked function is in {@link ALLOWED_FUNCTIONS}. */
export function isAllowed(funcXdrBase64: string): boolean {
  const name = invokedFunctionName(funcXdrBase64);
  return name !== null && ALLOWED_FUNCTIONS.has(name);
}

/**
 * Pre-submit gate: throws a clear, structured error when the invoked function is not
 * allowed. Call this before the transaction is simulated/submitted.
 */
export function assertAllowedOrReject(funcXdrBase64: string): void {
  const name = invokedFunctionName(funcXdrBase64);
  if (name !== null && ALLOWED_FUNCTIONS.has(name)) {
    return;
  }

  throw pluginError(
    name === null
      ? 'Relayer channels plugin: submitted host function is not an allowed contract invocation'
      : `Relayer channels plugin: function "${name}" is not in the recovery/genesis allowlist`,
    {
      code: 'FUNCTION_NOT_ALLOWED',
      status: 403,
      details: { function: name },
    },
  );
}
