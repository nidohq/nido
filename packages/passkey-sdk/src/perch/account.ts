/**
 * The Perch account's controlled capabilities, as transaction builders and
 * reads: execution through the account, full document reads, and the
 * seven-day upgrade path (Perch `docs/recovery/spec.md` §12, §15).
 *
 * Every builder here needs the owner's authorization (the admin rule), so
 * its operations go through the wallet's passkey signing flow. Under
 * `Protected`, scheduling an upgrade additionally needs the recovery
 * condition's recorded approval of `Upgrade { requestId, wasmHash }`
 * (`PerchRecovery.approveChange`/`submitZkChange` with
 * `nextUpgradeRequestId`), fresh until the `approvalValidUntil` passed here.
 */

import { Buffer } from 'buffer';
import { Client as AccountClient } from '@nidohq/perch-account';
import type { FreezeGate, UpgradeRequest } from '@nidohq/perch-account';
import { nativeToScVal, type xdr } from '@stellar/stellar-sdk';
import { extractXdrOperations } from '../assembledTx.js';
import type { TxBuild } from '../policyBlocks/types.js';

export type { FreezeGate, UpgradeRequest };

/** Seven days of ledgers at five seconds: `ACCOUNT_UPGRADE_DELAY_LEDGERS`. */
export const ACCOUNT_UPGRADE_DELAY_LEDGERS = 120_960;

/** The invoker-only hook names an account never signs or executes. */
export const RESERVED_FUNCTIONS = [
  'install',
  'uninstall',
  'enforce',
  'rcv_sync',
  'rcv_cancel',
  'rcv_upgrade',
  'rcv_insert',
  'rcv_gate',
] as const;

export interface AccountArgs {
  account: string;
  rpcUrl: string;
  networkPassphrase: string;
}

function client(args: AccountArgs): AccountClient {
  return new AccountClient({
    contractId: args.account,
    networkPassphrase: args.networkPassphrase,
    rpcUrl: args.rpcUrl,
  });
}

function hex(b: Uint8Array): Buffer {
  return Buffer.from(b);
}

/** Call `fn` on `target` as the account. Refuses reserved hook names here,
 *  before the account would. */
export async function buildExecute(
  args: AccountArgs & { target: string; fn: string; fnArgs: xdr.ScVal[] },
): Promise<TxBuild> {
  if ((RESERVED_FUNCTIONS as readonly string[]).includes(args.fn)) {
    throw new Error(`"${args.fn}" is an invoker-only hook; the account refuses to execute it`);
  }
  const tx = await client(args).execute({
    target: args.target,
    target_fn: args.fn,
    target_args: args.fnArgs,
  });
  return { operations: extractXdrOperations(tx, 'execute'), description: `Call ${args.fn} as the account` };
}

/** The applied document's canonical JSON, or `undefined` before the first
 *  `apply_doc`. Its sha256 is the account's `applied_doc_hash`. */
export async function readAppliedDoc(args: AccountArgs): Promise<string | undefined> {
  const doc = (await client(args).applied_doc()).result;
  return doc ? Buffer.from(doc).toString('utf8') : undefined;
}

/** The `Protected` freeze mirror, if one is set. In force while the current
 *  ledger is below `until`. */
export async function readRecoveryGate(args: AccountArgs): Promise<FreezeGate | undefined> {
  return (await client(args).recovery_gate()).result ?? undefined;
}

export async function readRecoveryController(args: AccountArgs): Promise<string | undefined> {
  return (await client(args).recovery_controller()).result ?? undefined;
}

export async function readPendingUpgrade(args: AccountArgs): Promise<UpgradeRequest | undefined> {
  return (await client(args).pending_upgrade()).result ?? undefined;
}

/** The id the next `schedule_upgrade` assigns: what `Protected` approvers
 *  approve. */
export async function readNextUpgradeRequestId(args: AccountArgs): Promise<bigint> {
  return BigInt((await client(args).next_upgrade_request_id()).result);
}

export async function buildScheduleUpgrade(
  args: AccountArgs & { wasmHash: Uint8Array; approvalValidUntil?: number },
): Promise<TxBuild> {
  const tx = await client(args).schedule_upgrade({
    wasm_hash: hex(args.wasmHash),
    approval_valid_until: args.approvalValidUntil ?? 0,
  });
  return {
    operations: extractXdrOperations(tx, 'schedule_upgrade'),
    description: `Schedule an account upgrade (executable after ${ACCOUNT_UPGRADE_DELAY_LEDGERS} ledgers)`,
  };
}

/** Execute the pending upgrade once its delay has passed. Refused on chain
 *  with `StaleUpgrade` (the request stays) if a reconfiguration, recovery,
 *  or other upgrade made it stale. */
export async function buildExecuteUpgrade(args: AccountArgs & { requestId: bigint }): Promise<TxBuild> {
  const tx = await client(args).execute_upgrade({ request_id: args.requestId });
  return { operations: extractXdrOperations(tx, 'execute_upgrade'), description: 'Execute the scheduled upgrade' };
}

export async function buildCancelUpgrade(args: AccountArgs): Promise<TxBuild> {
  const tx = await client(args).cancel_upgrade();
  return { operations: extractXdrOperations(tx, 'cancel_upgrade'), description: 'Cancel the scheduled upgrade' };
}

/** An `Address` argument for {@link buildExecute}. */
export function addressArg(address: string): xdr.ScVal {
  return nativeToScVal(address, { type: 'address' });
}
