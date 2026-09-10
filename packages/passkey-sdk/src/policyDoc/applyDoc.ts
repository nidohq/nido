/**
 * SPIKE: one-transaction document apply — the SDK half of the smart
 * account's hybrid `apply_doc` entry point (contracts/smart-account/src/
 * doc.rs), sitting NEXT TO `buildDocInstallTxs` (the per-rule multi-tx
 * install path), not replacing it.
 *
 * Where `buildDocInstallTxs` lowers the doc client-side and submits one
 * `add_context_rule` per rule, `buildApplyDocTx` submits the document
 * ITSELF: the contract cross-calls perch's stateless doc-compiler to
 * parse/validate/lower on-chain, installs the whole rule set atomically,
 * stores the canonical `doc_hash`, and emits the full doc JSON as a
 * `DocApplied` event. The bytes submitted here are the CANONICAL JSON, so
 * the emitted event carries the canonical form and a document recovered
 * from event history hashes straight to the stored identity.
 *
 * Deliberate scope cuts, mirrored from the contract:
 * - Capped docs are refused (`DocCapUnsupported` on-chain; refused here
 *   before any network round-trip) — nido lowers caps onto its stock
 *   spending-limit policy, whose address the account cannot derive
 *   in-contract. Capped docs keep the `buildDocInstallTxs` path.
 */

import { Buffer } from 'buffer';
import { Client as SmartAccountClient } from '@nidohq/smart-account';
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
  if (doc.rules.some((r) => r.cap !== undefined)) {
    throw new Error(
      'policyDoc: apply_doc refuses capped docs (the contract cannot resolve the spending-limit policy); use buildDocInstallTxs for this document',
    );
  }

  const canonical = canonicalJson(doc);
  const client = new SmartAccountClient({
    contractId: args.account,
    networkPassphrase,
    rpcUrl: args.rpcUrl,
  });
  const tx = await client.apply_doc({ doc_json: Buffer.from(canonical, 'utf8') });

  return {
    docHash: docHash(doc),
    canonicalJson: canonical,
    operations: extractXdrOperations(tx, 'policy-doc-apply'),
    description: `Apply policy document ${docHash(doc).slice(0, 8)}… (${doc.rules.length} rule${doc.rules.length === 1 ? '' : 's'})`,
  };
}
