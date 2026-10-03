/**
 * ZK recovery credentials and proofs for Perch's one ZK backend, on top of
 * `@stellar-registry/perch-zk` (bb.js 0.87.0 + noir_js 1.0.0-beta.9, the
 * toolchain the on-chain verifier targets).
 *
 * Exported from the `@nidohq/passkey-sdk/perch-zk` subpath, not the main
 * entry, because importing it loads Barretenberg's WASM: wallet pages that
 * never prove should not pay for it, and proving belongs in a worker.
 *
 * The secret is the whole credential. A wallet stores it (or derives it)
 * however its backup design says; this module only generates, commits, and
 * proves. Its leaf is public once enrolled (the pool's insertion event
 * reveals it), so the secret must be uniformly random: `newZkCredential`
 * draws 253 random bits.
 */

import {
  commitment,
  evidence,
  init,
  prove,
  randomSecret,
  Tree,
  type CompiledCircuit,
  type ZkEvidence,
} from '@stellar-registry/perch-zk';
import { contractId, statementDigest, type Bytes32, type RecoveryStatement } from './statement.js';

export type { CompiledCircuit, ZkEvidence };

/** A wallet's ZK recovery credential. */
export interface ZkCredential {
  /** The enrollment id the account's document names: 32 random bytes,
   *  never reused by the account. */
  enrollmentId: Bytes32;
  /** The secret behind the enrolled commitment (a canonical field element). */
  secret: Bytes32;
}

/** Load Barretenberg once before committing or proving. */
export async function initZk(): Promise<void> {
  await init();
}

/** A fresh credential: a random enrollment id and a random secret. */
export function newZkCredential(): ZkCredential {
  return {
    enrollmentId: crypto.getRandomValues(new Uint8Array(32)),
    secret: randomSecret(),
  };
}

/** `Poseidon2(DOM_LEAF, secret)`: the document's `commitment`. Needs
 *  {@link initZk}. */
export function zkCommitment(credential: ZkCredential): Bytes32 {
  return commitment(credential.secret);
}

/** Where a credential's leaf sits in the pool (the pool's `enrollment` view). */
export interface LeafPosition {
  treeId: number;
  index: number;
}

export interface ProveArgs {
  /** The release circuit artifact
   *  (`@stellar-registry/perch-zk/artifacts/perch_zk_recovery.json`). */
  circuit: CompiledCircuit;
  /** The statement the controller built (its `statement` or
   *  `change_statement` view), whose digest the proof binds. */
  statement: RecoveryStatement;
  credential: ZkCredential;
  position: LeafPosition;
  /** Every leaf of `position.treeId`, in order, from the pool's `leaves`
   *  pages or its `LeafInserted` events. Nothing here is trusted: a wrong
   *  leaf set yields a root the pool does not know, and the adapter refuses
   *  the proof. */
  leaves: Bytes32[];
  treeDepth?: number;
  threads?: number;
}

/** Prove `statement` with `credential` and return the controller's
 *  `ZkEvidence` fields. Needs {@link initZk}. */
export async function proveStatement(args: ProveArgs): Promise<ZkEvidence> {
  const tree = new Tree(args.leaves, args.treeDepth);
  const proof = await prove(
    args.circuit,
    {
      secret: args.credential.secret,
      accountId: contractId(args.statement.account),
      enrollmentId: args.credential.enrollmentId,
      digest: statementDigest(args.statement),
      leafIndex: BigInt(args.position.index),
      siblings: tree.path(args.position.index),
    },
    { threads: args.threads },
  );
  return evidence(args.position.treeId, proof);
}
