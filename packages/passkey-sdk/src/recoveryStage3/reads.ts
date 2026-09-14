//! Thin read wrappers around the generated `@nidohq/recovery-controller`
//! bindings' view functions — mirrors the established pattern (e.g.
//! `packages/frontend/src/lib/policyChainFetch.ts::fetchSpendingLimit`):
//! `await client.method({...})` simulates and decodes via `.result`, no
//! signing, no submission.
import { Buffer } from 'buffer';
import { Client as RecoveryControllerClient, type Attempt, type RecoveryConfig } from '@nidohq/recovery-controller';

export interface RecoveryReadArgs {
  controllerId: string;
  account: string;
  networkPassphrase: string;
  rpcUrl: string;
}

function client(args: RecoveryReadArgs): RecoveryControllerClient {
  return new RecoveryControllerClient({
    contractId: args.controllerId,
    networkPassphrase: args.networkPassphrase,
    rpcUrl: args.rpcUrl,
  });
}

/** `null` for an unenrolled account (the contract's own `config` view
 *  returns `Option<RecoveryConfig>::None`, not an error). */
export async function readRecoveryConfig(args: RecoveryReadArgs): Promise<RecoveryConfig | null> {
  const tx = await client(args).config({ account: args.account });
  return tx.result ?? null;
}

/** `null` when the account has never called `begin_attempt`, or its only
 *  attempt is terminal and has been superseded. */
export async function readAttempt(args: RecoveryReadArgs): Promise<Attempt | null> {
  const tx = await client(args).get_attempt({ account: args.account });
  return tx.result ?? null;
}

/** Mirrors the account's own `guard_no_pending` cross-call — governed by
 *  `config.pending_activity_policy` (`Freeze` blocks while a live attempt
 *  exists; `Continue` never blocks). `false` for an unenrolled account. */
export async function readHasPending(args: RecoveryReadArgs): Promise<boolean> {
  const tx = await client(args).has_pending({ account: args.account });
  return tx.result;
}

/** Lowercase-hex `sha256(xdr(RecoveryConfig))` — follow-up.md §5.5's
 *  reviewable configuration commitment, computed on-chain
 *  (`RecoveryController::config_hash`). `null` for an unenrolled account.
 *  See `accountWiring.ts`'s module doc comment for why this is NOT the same
 *  as the account's `applied_doc_hash` — recovery configuration cannot be
 *  embedded in the account's own Perch policy document today (a deployed,
 *  pinned external dependency's limit, not a gap in this contract). */
export async function readConfigHash(args: RecoveryReadArgs): Promise<string | null> {
  const tx = await client(args).config_hash({ account: args.account });
  return tx.result ? Buffer.from(tx.result).toString('hex') : null;
}
