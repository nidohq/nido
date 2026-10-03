/**
 * Doc-only: the ONE apply route — the SDK half of the Perch account's
 * `apply_doc(doc_json, approval_valid_until)`, the account's sole policy
 * write path (vendor/perch/crates/perch-smart-account).
 *
 * The account cross-calls Perch's stateless doc compiler to parse, validate,
 * and lower the document on chain, has its recovery controller classify any
 * change to the `recovery` member, atomically replaces the whole rule set
 * (the zero-signer recovery rule included), inserts a new ZK leaf into the
 * pool when the enrollment id changes, and stores the canonical bytes
 * (readable via `applied_doc`). Capped rules get Perch's spending limit
 * beside the interpreter. Anti-brick: the account refuses a document without
 * a policy-free self-admin rule (`AdminLockout`). This builder submits
 * `canonicalJson(doc)`, so the stored copy hashes straight to `docHash`.
 *
 * `approvalValidUntil` is the freshness bound a `Protected` reconfiguration's
 * recorded evidence was given for (`perch.PerchRecovery.approveChange` /
 * `submitZkChange`); 0 otherwise.
 */

import { Buffer } from 'buffer';
import { Client as AccountClient } from '@nidohq/perch-account';
import { canonicalJson, docHash } from '@stellar-registry/perch';
import type { PolicyDoc } from '@stellar-registry/perch';
import { extractXdrOperations } from '../assembledTx.js';
import type { TxBuild } from '../policyBlocks/types.js';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

export interface BuildApplyDocArgs {
  /** The smart account to apply the document to. */
  account: string;
  rpcUrl: string;
  networkPassphrase?: string;
  /** See the module docs. Defaults to 0. */
  approvalValidUntil?: number;
}

export interface ApplyDocTx extends TxBuild {
  /** Lowercase-hex canonical `doc_hash` — the identity the contract will
   *  return, store, and emit. */
  docHash: string;
  /** The canonical JSON string submitted as the transaction's `doc_json`
   *  bytes (and therefore carried verbatim in the `DocApplied` event). */
  canonicalJson: string;
}

/**
 * Build the single `apply_doc` transaction for a document. The returned
 * step's `operations[0]` feeds the existing signing flow
 * (`signAndSubmit({ account, operation })`), like every other `TxBuild`.
 */
export async function buildApplyDocTx(
  doc: PolicyDoc,
  args: BuildApplyDocArgs,
): Promise<ApplyDocTx> {
  const networkPassphrase = args.networkPassphrase ?? TESTNET_PASSPHRASE;
  if (doc.network !== undefined && doc.network !== networkPassphrase) {
    throw new Error(
      `policyDoc: doc is bound to network "${doc.network}" but the apply targets "${networkPassphrase}"`,
    );
  }
  const canonical = canonicalJson(doc);
  const client = new AccountClient({
    contractId: args.account,
    networkPassphrase,
    rpcUrl: args.rpcUrl,
  });
  const tx = await client.apply_doc({
    doc_json: Buffer.from(canonical, 'utf8'),
    approval_valid_until: args.approvalValidUntil ?? 0,
  });

  return {
    docHash: docHash(doc),
    canonicalJson: canonical,
    operations: extractXdrOperations(tx, 'policy-doc-apply'),
    description: `Apply policy document ${docHash(doc).slice(0, 8)}… (${doc.rules.length} rule${doc.rules.length === 1 ? '' : 's'})`,
  };
}
