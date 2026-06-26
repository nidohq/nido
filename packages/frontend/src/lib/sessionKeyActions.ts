import { rpc, Contract, nativeToScVal } from '@stellar/stellar-sdk';
import {
  scopedSessionKeyModule, forgetSessionKeyMaterial, loadSessionKeyMaterial,
} from '@nidohq/passkey-sdk';
import { fetchVerifierAddress, simulateView, isRuleNotFound } from './policyChainFetch.js';
import { signAndSubmit } from './primaryPasskeySigner.js';

const RPC_URL = 'https://soroban-testnet.stellar.org';

export async function delegateSessionKey(args: {
  account: string;
  target: string;
  sessionPubkey: Uint8Array;
  /** Number of ledgers from current ledger; null = no expiry. */
  validUntilOffset: number | null;
  label?: string;
}): Promise<void> {
  const server = new rpc.Server(RPC_URL);
  const latest = await server.getLatestLedger();
  const validUntil =
    args.validUntilOffset == null
      ? undefined
      : latest.sequence + args.validUntilOffset;

  const built = await scopedSessionKeyModule.buildInstall({
    account: args.account,
    block: {
      kind: 'scoped-session-key',
      targetContract: args.target,
      sessionPubkey: args.sessionPubkey,
      credentialId: '',
      validUntil,
      label: args.label,
    },
    factoryAddress: '',
    rpcUrl: RPC_URL,
    verifierAddress: () => fetchVerifierAddress(args.account),
  });

  const verifierAddr = await fetchVerifierAddress(args.account);
  await signAndSubmit({
    account: args.account,
    operation: built.operations[0],
    verifierAddress: verifierAddr,
  });
}

/** Revoke a session-key rule, idempotently.
 *
 *  Two failure shapes are treated as (eventual) success rather than surfaced:
 *  - The rule is ALREADY gone on-chain (`ContextRuleNotFound` from the build
 *    or signing simulation): a prior attempt timed out client-side but its tx
 *    landed. Surfacing the raw `Error(Contract, #3000)` would dead-end the
 *    user on a revoke that already happened.
 *  - ANY other failure (confirmation timeout, a racing duplicate failing
 *    on-chain, transient relayer errors) gets a chain re-check: failure is
 *    only reported when the rule verifiably still exists.
 *
 *  Local material cleanup is ownership-checked: with two live rules on the
 *  same target (re-delegation), the single per-target material slot belongs to
 *  the NEWER credential — revoking the stale rule must not wipe it. Pass the
 *  revoked rule's `sessionPubkey` to enable the check.
 */
export async function revokeSessionKey(
  account: string,
  ruleId: number,
  target: string,
  sessionPubkey?: Uint8Array,
): Promise<void> {
  try {
    const built = await scopedSessionKeyModule.buildRevoke({
      account,
      ruleId,
      rpcUrl: RPC_URL,
    });
    const verifierAddr = await fetchVerifierAddress(account);
    await signAndSubmit({
      account,
      operation: built.operations[0],
      verifierAddress: verifierAddr,
    });
  } catch (err) {
    if (isRuleNotFound(err)) {
      // Already revoked — fall through to local cleanup.
    } else if (!(await ruleStillExists(account, ruleId))) {
      // Whatever the error shape (confirmation timeout, a racing duplicate
      // submit failing on-chain, a transient relayer error), the rule is
      // verifiably gone — the revoke happened. Reporting failure here would
      // dead-end the user on a success.
    } else {
      throw err;
    }
  }
  maybeForgetMaterial(account, target, sessionPubkey);
}

/** Check whether a context rule still exists on-chain.
 *  Returns true if the rule exists, false if it is gone.
 *  On transient/unexpected errors returns true (conservative — let the caller
 *  surface the original failure rather than silently swallowing it).
 */
export async function ruleStillExists(account: string, ruleId: number): Promise<boolean> {
  try {
    const server = new rpc.Server(RPC_URL);
    await simulateView(
      server,
      new Contract(account),
      'get_context_rule',
      nativeToScVal(ruleId, { type: 'u32' }),
    );
    return true;
  } catch (err) {
    if (isRuleNotFound(err)) return false;
    // Can't verify either way — let the caller surface the original failure.
    return true;
  }
}

/** Ownership-safe local-material cleanup for a revoked session-key rule.
 *
 *  With two live rules on the same target (re-delegation), the single per-target
 *  material slot belongs to the NEWER credential — revoking the stale rule must
 *  not wipe it. When `pubkeyHex` is provided and a NEWER credential is stored,
 *  cleanup is skipped. Legacy material (pre-publicKey schema) is treated as
 *  unowned and wiped.
 *
 *  Call this from both the pre-flight already-gone branch in SessionKeyCard AND
 *  the /security/?revoked= return handler so cleanup logic lives in one place.
 */
export function forgetRevokedMaterial(
  account: string,
  target: string,
  pubkeyHex?: string,
): void {
  if (target && pubkeyHex) {
    const stored = loadSessionKeyMaterial(account, target);
    // Legacy material (pre-publicKey schema) has no owner to compare — treat
    // it as unowned and wipe it; it predates the flow and is unusable anyway.
    if (stored?.publicKey && stored.publicKey.toLowerCase() !== pubkeyHex.toLowerCase()) return;
  }
  if (target) forgetSessionKeyMaterial(account, target);
}

function maybeForgetMaterial(account: string, target: string, sessionPubkey?: Uint8Array): void {
  const revokedHex = sessionPubkey
    ? Array.from(sessionPubkey, (b) => b.toString(16).padStart(2, '0')).join('')
    : undefined;
  forgetRevokedMaterial(account, target, revokedHex);
}
