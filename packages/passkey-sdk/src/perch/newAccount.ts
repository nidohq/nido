/**
 * Checking a just-created account before the wallet trusts it.
 *
 * Nido's factory derives an account's address from a one-time setup key and
 * deploys there only the passkey that setup key signed (`perch/setupKey.ts`),
 * so neither the relayer nor anyone else who sees the setup public key can
 * claim the address. Whoever holds the setup SECRET can, though: a thief who
 * reads it from the browser before the passkey exists, or a factory other
 * than the deployment's. A relayer's report that "the transaction succeeded"
 * says nothing about which key was installed, or even which transaction it
 * was.
 *
 * So the wallet reads the account back from RPC and accepts it only in the
 * exact state the user's own `create_account` leaves it in: the deployment's
 * account wasm; configuration revision 0, with no document, no recovery, and
 * no freeze; the deployment's infra pins; and one rule, "admin", scoped to the
 * account, with no expiry and no policies, whose only signer is the user's
 * passkey under the deployment's WebAuthn verifier. Revision 0 matters as much
 * as the key: a claimant can apply a document that names the user's key as
 * admin while keeping authority of its own elsewhere, and only an untouched
 * account rules that out.
 *
 * This detects a claimed address; it cannot prevent one. A claimed address is
 * lost to its user, who has to start again with a new setup key.
 */

import { Buffer } from 'buffer';
import { Client as AccountClient } from '@nidohq/perch-account';
import { decodeConfiguration, type AccountConfiguration } from '@stellar-registry/perch';
import { Address, rpc, xdr } from '@stellar/stellar-sdk';
import type { AccountArgs } from './account.js';
import type { PerchDeployment } from './deployment.js';

/** What the user's own `create_account` would have produced. */
export interface NewAccountExpectation {
  account: string;
  /** The user's passkey, as the factory was given it: the 65-byte
   *  uncompressed SEC1 point. */
  adminKey: Uint8Array;
  deployment: Pick<
    PerchDeployment,
    'accountWasmHash' | 'webauthnVerifier' | 'docCompiler' | 'interpreter' | 'spendingLimit'
  >;
}

/** Why an account is not the one the user's setup creates. */
export type NewAccountProblem =
  /** Nothing is deployed at the address. */
  | 'missing'
  /** The address runs other code than the deployment's account wasm. */
  | 'code'
  /** The account has been reconfigured since it was created. */
  | 'configured'
  /** The account pins other infra than the deployment's. */
  | 'infra'
  /** The rules are not exactly the constructor's admin rule. */
  | 'rules'
  /** The admin passkey is checked by another verifier. */
  | 'verifier'
  /** The admin is another key. */
  | 'key';

export class NewAccountRefused extends Error {
  constructor(readonly problem: NewAccountProblem) {
    super(`new account refused: ${problem}`);
    this.name = 'NewAccountRefused';
  }
}

/** The code an address runs: the sha256 of its wasm (lowercase hex), or
 *  `null` for a built-in contract such as a Stellar Asset Contract. */
export interface AccountCode {
  wasmHash: string | null;
}

/** The code a contract-instance ledger entry names. */
export function accountCodeOf(instance: xdr.LedgerEntryData): AccountCode {
  const executable = instance.contractData().val().instance().executable();
  return executable.switch() === xdr.ContractExecutableType.contractExecutableWasm()
    ? { wasmHash: Buffer.from(executable.wasmHash()).toString('hex') }
    : { wasmHash: null };
}

/** The code deployed at `account`, or `null` when nothing is deployed there. */
export async function readAccountCode(args: AccountArgs): Promise<AccountCode | null> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(args.account).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const { entries } = await new rpc.Server(args.rpcUrl).getLedgerEntries(key);
  return entries.length === 0 ? null : accountCodeOf(entries[0]!.val);
}

/** The account's `configuration()` view, decoded as perch-js decodes it. */
export async function readNewAccountConfiguration(args: AccountArgs): Promise<AccountConfiguration> {
  const client = new AccountClient({
    contractId: args.account,
    networkPassphrase: args.networkPassphrase,
    rpcUrl: args.rpcUrl,
  });
  const tx = await client.configuration();
  return decodeConfiguration(tx.result as unknown as Record<string, unknown>);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Pure: the first way `code` and `configuration` differ from a freshly
 *  created account for `expect`, or `null` when they match exactly. */
export function checkNewAccount(
  expect: NewAccountExpectation,
  code: AccountCode,
  configuration: AccountConfiguration,
): NewAccountProblem | null {
  const { deployment } = expect;
  if (code.wasmHash !== deployment.accountWasmHash) return 'code';

  const c = configuration;
  if (
    c.revision !== 0n ||
    c.docHash !== null ||
    c.recoveryController !== null ||
    c.recoveryRule !== null ||
    c.gate !== null ||
    c.recoveryGeneration !== 0n
  ) {
    return 'configured';
  }
  if (
    c.infra.docCompiler !== deployment.docCompiler ||
    c.infra.interpreter !== deployment.interpreter ||
    c.infra.spendingLimit !== deployment.spendingLimit
  ) {
    return 'infra';
  }

  if (c.rules.length !== 1) return 'rules';
  const admin = c.rules[0]!;
  if (
    admin.recovery ||
    admin.name !== 'admin' ||
    admin.contract !== expect.account ||
    admin.validUntil !== null ||
    admin.policies.length !== 0 ||
    admin.signers.length !== 1
  ) {
    return 'rules';
  }
  const signer = admin.signers[0]!;
  if (signer.kind !== 'external') return 'key';
  if (signer.verifier !== deployment.webauthnVerifier) return 'verifier';
  if (!sameBytes(signer.key, expect.adminKey)) return 'key';
  return null;
}

/** The two reads {@link verifyNewAccount} makes. */
export interface NewAccountReads {
  code(args: AccountArgs): Promise<AccountCode | null>;
  configuration(args: AccountArgs): Promise<AccountConfiguration>;
}

/** The reads over RPC. */
export const rpcNewAccountReads: NewAccountReads = {
  code: readAccountCode,
  configuration: readNewAccountConfiguration,
};

export interface VerifyNewAccountOptions {
  /** Reads of an address that shows no contract yet, for an RPC that lags
   *  the ledger the relayer confirmed (default 1). A mismatch is never
   *  retried. */
  attempts?: number;
  delayMs?: number;
  reads?: NewAccountReads;
}

/**
 * Read `expect.account` from RPC and resolve only if it is exactly the
 * account the user's own `create_account` creates; otherwise reject with
 * {@link NewAccountRefused}. A failed read rejects with the read's own error.
 * Call it before activating, displaying as ready, or funding a new account.
 */
export async function verifyNewAccount(
  args: Omit<AccountArgs, 'account'>,
  expect: NewAccountExpectation,
  options: VerifyNewAccountOptions = {},
): Promise<void> {
  const at = { ...args, account: expect.account };
  const reads = options.reads ?? rpcNewAccountReads;
  const attempts = Math.max(1, options.attempts ?? 1);
  let code: AccountCode | null = null;
  for (let i = 0; i < attempts && code === null; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, options.delayMs ?? 1500));
    code = await reads.code(at);
  }
  if (code === null) throw new NewAccountRefused('missing');
  // Wrong code first: other code may not answer `configuration()` at all.
  if (code.wasmHash !== expect.deployment.accountWasmHash) throw new NewAccountRefused('code');
  const problem = checkNewAccount(expect, code, await reads.configuration(at));
  if (problem) throw new NewAccountRefused(problem);
}
