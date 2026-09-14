/**
 * Whether the account itself is actually wired to a given recovery
 * controller — a DIFFERENT question from whether that controller has a
 * `RecoveryConfig` stored for the account (`config.ts`/`reads.ts`'s
 * `readRecoveryConfig`).
 *
 * `RecoveryController::enroll` only writes into the CONTROLLER's own
 * storage; it never touches the account. For the controller's
 * `has_pending`/`Policy::enforce` to ever actually run, the ACCOUNT's own
 * `recovery_controller` field (set once at construction, or via
 * `enroll_zk_recovery`) must equal the controller's address — otherwise
 * `enroll` (and every subsequent `begin_attempt`/evidence call) succeeds but
 * is completely inert: real bug caught by a captain live-test on PR 206 (a
 * test account was wired to a DIFFERENT, pre-existing controller; "Enroll"
 * against the Stage 3 controller silently wrote orphaned state nobody would
 * ever cross-call). This module makes that state explicit so the UI can
 * refuse to let a caller walk into it silently.
 *
 * Known limit: this module only handles the FRESH-account case
 * (`recovery_controller() == null` → wire via `enroll_zk_recovery`, a
 * one-shot call). An account already wired to a DIFFERENT controller needs
 * the account's own announce-then-execute rule-removal flow
 * (`initiate_recovery_rule_removal` → wait out the real on-chain delay →
 * `execute_recovery_rule_removal`) before a fresh `enroll_zk_recovery` is
 * even callable — a real, multi-day wall-clock migration this experimental
 * page does not attempt to drive; `checkAccountWiring` reports that case as
 * `'wired-to-different-controller'` so callers can refuse cleanly instead of
 * writing orphaned controller state.
 */
import { Client as SmartAccountClient } from '@nidohq/smart-account';
import { extractXdrOperations } from '../assembledTx.js';
import type { TxBuild } from '../policyBlocks/types.js';

export interface AccountWiringArgs {
  account: string;
  controllerId: string;
  rpcUrl: string;
  networkPassphrase: string;
}

export type AccountWiringStatus =
  | 'wired-to-target'
  | 'unwired'
  | 'wired-to-different-controller';

export interface AccountWiringCheck {
  status: AccountWiringStatus;
  /** The account's CURRENT on-chain `recovery_controller`, if any. */
  currentControllerId: string | null;
}

function client(args: { account: string; rpcUrl: string; networkPassphrase: string }): SmartAccountClient {
  return new SmartAccountClient({
    contractId: args.account,
    networkPassphrase: args.networkPassphrase,
    rpcUrl: args.rpcUrl,
  });
}

/** Reads the account's own `recovery_controller()` view and classifies it
 *  against the target controller — call this BEFORE "Enroll" so the UI can
 *  refuse a no-op enrollment instead of silently accepting it. */
export async function checkAccountWiring(args: AccountWiringArgs): Promise<AccountWiringCheck> {
  const tx = await client(args).recovery_controller();
  const current = tx.result ?? null;
  if (current === null) return { status: 'unwired', currentControllerId: null };
  if (current === args.controllerId) return { status: 'wired-to-target', currentControllerId: current };
  return { status: 'wired-to-different-controller', currentControllerId: current };
}

/** Builds the one-shot `enroll_zk_recovery(controllerId)` transaction that
 *  wires a FRESH account (`recovery_controller() == null`) to
 *  `args.controllerId` — self-authed, same signing flow as `apply_doc`.
 *  Only valid when `checkAccountWiring` reports `'unwired'`; the account
 *  contract itself refuses a second call once any recovery rule exists
 *  (`AlreadyInstalled`/rule-protection), matching Stage 2's
 *  `enroll_zk_recovery_twice_is_rejected` precedent. */
export async function buildWireAccountTx(args: AccountWiringArgs): Promise<TxBuild> {
  const tx = await client(args).enroll_zk_recovery({ recovery_controller: args.controllerId });
  return {
    operations: extractXdrOperations(tx, 'recovery-stage3-wire-account'),
    description: `Wire account to recovery controller ${args.controllerId.slice(0, 8)}…`,
  };
}
