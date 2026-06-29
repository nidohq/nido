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
  if (!target) return;
  const stored = loadSessionKeyMaterial(account, target);
  if (pubkeyHex) {
    // Normal path: only wipe when the stored material's owner matches the
    // revoked credential (case-insensitive). A NEWER credential on the same
    // target (re-delegation) must be preserved. Legacy material (pre-publicKey
    // schema) has no owner to compare — treat it as unowned and wipe it.
    if (stored?.publicKey && stored.publicKey.toLowerCase() !== pubkeyHex.toLowerCase()) return;
  } else {
    // F2: pubkey omitted — DON'T blindly wipe. Only clear truly-legacy material
    // (no stored publicKey). Owned (publicKey-bearing) material must never be
    // wiped without a matching pubkey, or a `?revoked=` call lacking `&pubkey=`
    // could destroy a live key's material.
    if (stored?.publicKey) return;
  }
  forgetSessionKeyMaterial(account, target);
}

