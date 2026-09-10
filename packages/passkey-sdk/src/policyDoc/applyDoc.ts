/**
 * SPIKE (doc-only): the ONE apply route — the SDK half of the smart
 * account's `apply_doc` entry point (contracts/smart-account/src/doc.rs),
 * the account's sole policy write path.
 *
 * `buildApplyDocTx` submits the document ITSELF: the contract cross-calls
 * perch's stateless doc-compiler to parse/validate/lower on-chain,
 * atomically replaces the whole rule set (recovery rule excepted), stores
 * the canonical `doc_hash` AND the full canonical doc JSON (readable via
 * `get_applied_doc` — the lossless, no-indexer read), and emits the doc
 * JSON as a `DocApplied` event. Capped docs are supported (compiler
 * 0.2.1): the contract attaches its pinned stock spending-limit policy
 * beside the interpreter. The contract REFUSES non-canonical bytes
 * (`DocNotCanonical`); this builder always submits `canonicalJson(doc)`,
 * so stored == emitted == canonical and either copy hashes straight to the
 * stored identity. Anti-brick: the contract refuses documents without a
 * policy-free self-admin rule (`DocAdminLockout`) — build docs with one.
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
