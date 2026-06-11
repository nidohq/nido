import { rpc, Contract, nativeToScVal } from '@stellar/stellar-sdk';
import {
  scopedSessionKeyModule, forgetSessionKeyMaterial, loadSessionKeyMaterial,
} from '@g2c/passkey-sdk';
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
 *  - The submit timed out (`WAIT_TIMEOUT` / classic NOT_FOUND polling): the tx
 *    may still land. We re-check the chain and only report failure when the
 *    rule verifiably still exists.
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
    } else if (isConfirmationTimeout(err) && !(await ruleStillExists(account, ruleId))) {
      // Timed out waiting, but the rule is gone: the tx landed after all.
    } else {
      throw err;
    }
  }
  maybeForgetMaterial(account, target, sessionPubkey);
}

/** Submission-timeout shapes from both submit paths: the relayer client's
 *  WAIT_TIMEOUT and the classic path's `Tx <hash> NOT_FOUND` poll giving up. */
function isConfirmationTimeout(err: unknown): boolean {
  const e = err as { name?: string; code?: string; message?: string };
  if (e?.name === 'RelayerError' && e?.code === 'WAIT_TIMEOUT') return true;
  return typeof e?.message === 'string' && /^Tx [0-9a-f]{64} NOT_FOUND$/i.test(e.message);
}

async function ruleStillExists(account: string, ruleId: number): Promise<boolean> {
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

function maybeForgetMaterial(account: string, target: string, sessionPubkey?: Uint8Array): void {
  if (sessionPubkey) {
    const stored = loadSessionKeyMaterial(account, target);
    const revokedHex = Array.from(sessionPubkey, (b) => b.toString(16).padStart(2, '0')).join('');
    if (stored && stored.publicKey.toLowerCase() !== revokedHex) return;
  }
  forgetSessionKeyMaterial(account, target);
}
