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
import { Client as CompilerClient } from '@nidohq/perch-doc-compiler';
import {
  accountReader,
  decodeConfiguration,
  readSnapshot,
  type AccountBindings,
  type AccountConfiguration,
  type AccountReader,
  type CompilerBindings,
  type SignRequest,
  type Snapshot,
  type SnapshotOptions,
} from '@stellar-registry/perch';
import { nativeToScVal, type xdr } from '@stellar/stellar-sdk';
import { extractXdrOperations } from '../assembledTx.js';
import { computeAuthDigest, type AuthDigestScheme } from '../auth.js';
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

const authSchemeCache = new Map<string, Promise<AuthDigestScheme>>();

/**
 * The account's external-signer auth-digest scheme — `capabilities().auth_digest`
 * read back and narrowed to {@link AuthDigestScheme}. Memoized per
 * account+network for the session (the scheme is immutable until the account's
 * wasm is upgraded, and the upgrade panel reloads the page afterward, so a
 * fresh read follows). A signer passes the result to {@link computeAuthDigest}
 * so an account minted before the redeploy keeps signing its `oz_rule_ids`
 * digest while a redeployed account signs `addr_oz_v1`. An unrecognized value
 * is treated as `addr_oz_v1` (the current scheme); a failed read is not cached.
 */
export async function authDigestScheme(args: AccountArgs): Promise<AuthDigestScheme> {
  const key = `${args.networkPassphrase}\u0000${args.account}`;
  let cached = authSchemeCache.get(key);
  if (!cached) {
    cached = client(args)
      .capabilities()
      .then((tx) => (tx.result.auth_digest === 'oz_rule_ids' ? 'oz_rule_ids' : 'addr_oz_v1'));
    cached.catch(() => authSchemeCache.delete(key));
    authSchemeCache.set(key, cached);
  }
  return cached;
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

/** perch-js's {@link AccountReader}, plus the auth-digest scheme the
 *  account's last `capabilities()` read reported (`undefined` before one).
 *
 *  perch-js signs only `addr_oz_v1` and `readSnapshot` refuses any other
 *  scheme, but an account minted before the redeploy reports `oz_rule_ids`,
 *  which Nido signs itself (`computeAuthDigest`). So this reader shows such an
 *  account to perch-js as `addr_oz_v1` and records its real scheme here; a
 *  signer reads `authDigest` and signs in that dialect, never perch-js's
 *  `digest`. Any other scheme reaches perch-js unchanged and is refused. */
export interface PerchAccountReader extends AccountReader {
  readonly authDigest: AuthDigestScheme | undefined;
}

/** perch-js's account reader over the generated clients: the account's
 *  `configuration()`, `revision()`, `document()`, and `capabilities()`
 *  views, and `limits()` of `docCompiler`. `readSnapshot` refuses it with
 *  `CompilerMismatch` unless `docCompiler` is the one the account pins
 *  (`configuration().infra.docCompiler`); {@link openAccountReader} reads
 *  that first. */
export function accountSnapshotReader(args: AccountArgs & { docCompiler: string }): PerchAccountReader {
  const compiler = new CompilerClient({
    contractId: args.docCompiler,
    networkPassphrase: args.networkPassphrase,
    rpcUrl: args.rpcUrl,
  });
  const inner = accountReader(
    args.account,
    client(args) as unknown as AccountBindings,
    compiler as unknown as CompilerBindings,
  );
  let authDigest: AuthDigestScheme | undefined;
  return {
    ...inner,
    get authDigest() {
      return authDigest;
    },
    async capabilities() {
      const read = await inner.capabilities();
      if (read.value.authDigest === 'oz_rule_ids') {
        authDigest = 'oz_rule_ids';
        return { ...read, value: { ...read.value, authDigest: 'addr_oz_v1' } };
      }
      if (read.value.authDigest === 'addr_oz_v1') authDigest = 'addr_oz_v1';
      return read;
    },
  };
}

/** The digest an `applyDocument` sign request's signers sign, in the scheme
 *  `reader` recorded from the snapshot the apply was planned from: perch-js's
 *  `request.digest` is always the `addr_oz_v1` one, which an account minted
 *  before the redeploy does not verify. */
export function signRequestDigest(reader: PerchAccountReader, request: SignRequest): Buffer {
  return computeAuthDigest(
    request.account,
    request.signaturePayload,
    request.selection.ruleIds,
    reader.authDigest,
  );
}

/** The account's `configuration()` view, decoded: its rules, recovery rule,
 *  freeze, pinned infrastructure, and the revision they belong to. */
export async function readConfiguration(args: AccountArgs): Promise<AccountConfiguration> {
  const { result } = await client(args).configuration();
  return decodeConfiguration(result as unknown as Record<string, unknown>);
}

/** {@link accountSnapshotReader} over the compiler the account pins, read
 *  from its own `configuration().infra.docCompiler`. Accounts minted by
 *  different Perch releases pin different compilers, so a reader built from
 *  the deployment's compiler would refuse every account but the newest. */
export async function openAccountReader(args: AccountArgs): Promise<PerchAccountReader> {
  const { infra } = await readConfiguration(args);
  return accountSnapshotReader({ ...args, docCompiler: infra.docCompiler });
}

/** One consistent read of the account (perch-js `readSnapshot`): its rules,
 *  recovery rule, freeze, and document limits at one configuration
 *  revision, and with `{ document: true }` the applied canonical bytes of
 *  that revision. Select rules from it, and name its revision as an
 *  apply's `expected_revision`. `capabilities.authDigest` is the account's
 *  real scheme. */
export async function readAccountSnapshot(args: AccountArgs, options?: SnapshotOptions): Promise<Snapshot> {
  const reader = await openAccountReader(args);
  const snapshot = await readSnapshot(reader, options);
  const authDigest = reader.authDigest ?? snapshot.capabilities.authDigest;
  return { ...snapshot, capabilities: { ...snapshot.capabilities, authDigest } };
}

/** The applied document's canonical JSON and the configuration revision it
 *  belongs to (`document()`, one read); `canonical` is undefined before the
 *  first `apply_doc`. Its sha256 is the account's `applied_doc_hash`. */
export async function readDocument(
  args: AccountArgs,
): Promise<{ revision: bigint; canonical: string | undefined }> {
  const [revision, doc] = (await client(args).document()).result;
  return { revision: BigInt(revision), canonical: doc ? Buffer.from(doc).toString('utf8') : undefined };
}

/** The applied document's canonical JSON, or `undefined` before the first
 *  `apply_doc`. */
export async function readAppliedDoc(args: AccountArgs): Promise<string | undefined> {
  return (await readDocument(args)).canonical;
}

/** The `Protected` freeze mirror, if one is set, from `configuration()`. In
 *  force while the current ledger is below `until`. */
export async function readRecoveryGate(args: AccountArgs): Promise<FreezeGate | undefined> {
  return (await client(args).configuration()).result.gate[0];
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
