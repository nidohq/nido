/**
 * Doc-only: the ONE apply route — the SDK half of the Perch account's
 * `apply_doc(doc_json, approval_valid_until, expected_revision)`, the
 * account's sole policy write path (vendor/perch/crates/perch-smart-account).
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
 *
 * `expectedRevision` is the account `revision()` the document was prepared
 * at. The account refuses the apply with `StaleRevision` once another apply
 * or an executed upgrade has moved it past that, so a document read and
 * edited at one revision never overwrites a change made since. Omitted, the
 * apply goes over whatever revision is current, as every apply did before
 * the revision existed.
 */

import { Buffer } from 'buffer';
import { Operation, xdr } from '@stellar/stellar-sdk';
import { Client as AccountClient } from '@nidohq/perch-account';
import { canonicalJson, docHash } from '@stellar-registry/perch';
import { docCapProblem, type FlatDocLimits } from './caps.js';
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
  /** See the module docs. Omitted: no revision check. */
  expectedRevision?: bigint;
  /** The account's document limits (its compiler's `limits()`, e.g.
   *  `snapshot.limits`). Given, an over-limit document is refused here with
   *  a readable reason before simulating; the chain refuses it anyway. */
  limits?: FlatDocLimits;
  /** Simulate the transaction while building it (default true). A caller
   *  that simulates the operation itself before signing, as the passkey
   *  signing flow does, passes false and builds without a network call. */
  simulate?: boolean;
}

export interface ApplyDocTx extends TxBuild {
  /** Lowercase-hex canonical `doc_hash` — the identity the contract will
   *  return, store, and emit. */
  docHash: string;
  /** The canonical JSON string submitted as the transaction's `doc_json`
   *  bytes (and therefore carried verbatim in the `DocApplied` event). */
  canonicalJson: string;
}

/** The operations of a transaction built without simulating it: no auth
 *  entries yet, which the signer's own simulation records. */
function unsimulatedOperations(tx: { raw?: { build(): { operations: ReadonlyArray<{ type: string; func?: unknown }> } } }): xdr.Operation[] {
  const ops = tx.raw?.build().operations;
  if (!ops) throw new Error('policy-doc-apply: could not build the apply_doc operation');
  return ops.map((op) => {
    if (op.type !== 'invokeHostFunction' || !op.func) throw new Error(`policy-doc-apply: unexpected op type ${op.type}`);
    return Operation.invokeHostFunction({ func: op.func as xdr.HostFunction, auth: [] });
  });
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
  // Perch's compiler refuses a document without a network binding
  // (`WrongNetwork`), so it could never apply; refuse it here instead.
  if (doc.network === undefined) {
    throw new Error(
      `policyDoc: doc has no network binding; set \`network\` to "${networkPassphrase}" before applying`,
    );
  }
  if (doc.network !== networkPassphrase) {
    throw new Error(
      `policyDoc: doc is bound to network "${doc.network}" but the apply targets "${networkPassphrase}"`,
    );
  }
  // Perch's compiler refuses an over-limit document anyway; say why first.
  const tooLarge = args.limits === undefined ? undefined : docCapProblem(doc, args.limits);
  if (tooLarge !== undefined) throw new Error(tooLarge);
  const canonical = canonicalJson(doc);
  const client = new AccountClient({
    contractId: args.account,
    networkPassphrase,
    rpcUrl: args.rpcUrl,
  });
  const simulate = args.simulate ?? true;
  const tx = await client.apply_doc(
    {
      doc_json: Buffer.from(canonical, 'utf8'),
      approval_valid_until: args.approvalValidUntil ?? 0,
      expected_revision: args.expectedRevision,
    },
    { simulate },
  );

  return {
    docHash: docHash(doc),
    canonicalJson: canonical,
    operations: simulate ? extractXdrOperations(tx, 'policy-doc-apply') : unsimulatedOperations(tx),
    description: `Apply policy document ${docHash(doc).slice(0, 8)}… (${doc.rules.length} rule${doc.rules.length === 1 ? '' : 's'})`,
  };
}
