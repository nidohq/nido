/**
 * The wallet's recovery operations against the chain: reads, and the three
 * ways a recovery transaction gets authorized.
 *
 * - Owner-signed (`submitAsOwner`): the account's own passkey through
 *   `signAndSubmit`, for `apply_doc`, `cancel_recovery`, and upgrades.
 * - Guardian-signed (`submitAsGuardian`): a Nido guardian's passkey through
 *   its `guardian` rule (scoped to the controller), or a classic Stellar
 *   wallet for a `G…` guardian.
 * - Permissionless (`submitOpen`): anyone pays; for opening attempts, ZK
 *   evidence, baselines, and completions.
 */

import { rpc, type xdr } from '@stellar/stellar-sdk';
import { buildApplyDocTx, loadCredential, parsePolicyDocJson, perch, type PolicyDoc } from '@nidohq/passkey-sdk';
import { NETWORK_PASSPHRASE, RPC_URL } from '../network.js';
import { adminBaseline } from '../policy/docDraft.js';
import { fetchVerifierAddress } from '../policyChainFetch.js';
import { getSubmitter, signAndSubmit } from '../primaryPasskeySigner.js';
import { submitGuardianOp, submitPermissionlessOp } from '../recoverySubmit.js';
import { requireDeployment } from './deployment.js';
import { summarizeRecovery, type RecoverySummary } from './model.js';

/** The guardian rule name a guardian's document scopes to the controller. */
export const GUARDIAN_RULE = 'guardian';

export function recoveryClient(): perch.PerchRecovery {
  return new perch.PerchRecovery({ deployment: requireDeployment(), rpcUrl: RPC_URL });
}

export function accountArgs(account: string): perch.AccountArgs {
  return { account, rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE };
}

export interface RecoveryState {
  doc: PolicyDoc | undefined;
  summary: RecoverySummary | undefined;
  gate: perch.ActivityGate | undefined;
  epoch: bigint;
}

/** What the account's applied document says about recovery, and whether an
 *  attempt is authorized right now. */
export async function readRecoveryState(account: string): Promise<RecoveryState> {
  const client = recoveryClient();
  const json = await client.appliedDoc(account);
  const doc = json ? parsePolicyDocJson(json) : undefined;
  const summary = summarizeRecovery(doc);
  const [gate, epoch] = summary
    ? await Promise.all([client.activityGate(account), client.epoch(account)])
    : [undefined, 0n];
  return { doc, summary, gate, epoch };
}

/** The account's applied document, or, before its first `apply_doc`, the
 *  baseline every first apply composes against: this browser's passkey as
 *  the admin. */
export async function currentOrFirstDoc(account: string): Promise<PolicyDoc> {
  const json = await recoveryClient().appliedDoc(account);
  if (json) return parsePolicyDocJson(json);
  const cred = loadCredential(account);
  if (!cred) throw new Error('This browser has no passkey for this Nido.');
  return adminBaseline({ verifier: await fetchVerifierAddress(account), publicKeyHex: cred.publicKey }, NETWORK_PASSPHRASE);
}

export async function latestLedger(): Promise<number> {
  return (await new rpc.Server(RPC_URL).getLatestLedger()).sequence;
}

/** Apply `doc` with the owner's passkey. `approvalValidUntil` is the bound a
 *  `Protected` change's recorded evidence was given for. */
export async function applyDoc(account: string, doc: PolicyDoc, approvalValidUntil = 0): Promise<string> {
  const tx = await buildApplyDocTx(doc, {
    account,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    approvalValidUntil,
  });
  const result = await submitAsOwner(account, tx.operations[0]!);
  return result;
}

export async function submitAsOwner(account: string, operation: xdr.Operation): Promise<string> {
  const result = await signAndSubmit({ account, operation });
  return result.hash;
}

/** A guardian's approval. A Nido guardian signs on its own subdomain with
 *  its passkey through its `guardian` rule; a `G…` guardian signs the whole
 *  transaction with a connected Stellar wallet. */
export async function submitAsGuardian(guardian: string, operation: xdr.Operation): Promise<string> {
  if (guardian.startsWith('G')) {
    return (await submitGuardianOp(operation, guardian)).hash;
  }
  const result = await signAndSubmit({ account: guardian, operation, ruleName: GUARDIAN_RULE });
  return result.hash;
}

/** A permissionless transaction, paid by this browser's submitter. */
export async function submitOpen(operation: xdr.Operation): Promise<{ hash: string; retval?: xdr.ScVal }> {
  await getSubmitter();
  return submitPermissionlessOp(operation);
}

