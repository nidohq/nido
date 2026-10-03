/**
 * Perch's recovery statement, credentials, and replacement sets
 * (`vendor/perch/docs/recovery/statement.md`) in the SDK's types. The byte
 * layouts are perch-js's (`@stellar-registry/perch`); this module maps the
 * SDK's shapes onto them and adds the canonical replacement order and the
 * configuration hash.
 *
 * The controller builds every statement on chain and guardians sign its
 * digest through the controller's own `submit_guardian`/`approve_change`, so
 * a wallet never needs this to collect guardian evidence. It does need it to
 * prove: the circuit's third public input binds `digest(statement)`, and
 * the wallet computes the proof locally. Parity: `statement.test.ts` asserts
 * Perch's independent vectors (`testdata/recovery/statement-v2.json`) and
 * every statement Nido's integration suites built through the real
 * controller (`crates/integration-tests/fixtures/zk/`).
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { StrKey } from '@stellar/stellar-sdk';
import * as perchjs from '@stellar-registry/perch';

export type Bytes32 = Uint8Array;

export type RecoveryAction = 'lost-key' | 'compromise' | 'cancel' | 'reconfigure' | 'upgrade';

export type StatementSubject =
  | {
      action: 'lost-key' | 'compromise';
      attemptId: bigint;
      sourceDocHash: Bytes32;
      targetDocHash: Bytes32;
      replacementsHash: Bytes32;
    }
  | { action: 'cancel'; attemptId: bigint; attemptStatement: Bytes32 }
  | { action: 'reconfigure'; change: { kind: 'set'; newConfigHash: Bytes32 } | { kind: 'remove' } }
  | { action: 'upgrade'; requestId: bigint; wasmHash: Bytes32 };

/** One `RecoveryStatement`, as the controller's `statement`/`change_statement`
 *  views return it. */
export interface RecoveryStatement {
  networkId: Bytes32;
  /** The recovering account (C-strkey). */
  account: string;
  /** The controller evaluating the evidence (C-strkey). */
  controller: string;
  configEpoch: bigint;
  configHash: Bytes32;
  delayLedgers: number;
  expiryLedgers: number;
  validUntilLedger: number;
  subject: StatementSubject;
}

/** A contract address's 32-byte id. */
export function contractId(address: string): Bytes32 {
  if (!StrKey.isValidContract(address)) throw new Error(`not a contract address: ${address}`);
  return new Uint8Array(StrKey.decodeContract(address));
}

/** `s` in perch-js's shape. */
function toPerch(s: RecoveryStatement): perchjs.RecoveryStatement {
  const sub = s.subject;
  return {
    networkId: s.networkId,
    account: s.account,
    controller: s.controller,
    epoch: s.configEpoch,
    configHash: s.configHash,
    delayLedgers: s.delayLedgers,
    expiryLedgers: s.expiryLedgers,
    validUntilLedger: s.validUntilLedger,
    subject:
      sub.action === 'reconfigure'
        ? { action: 'reconfigure', change: sub.change.kind === 'set' ? { set: sub.change.newConfigHash } : 'remove' }
        : sub,
  };
}

/** The statement's canonical encoding. */
export function encodeStatement(s: RecoveryStatement): Uint8Array {
  return perchjs.encodeStatement(toPerch(s));
}

/** `sha256(encodeStatement(s))`: what guardians sign and the circuit binds. */
export function statementDigest(s: RecoveryStatement): Bytes32 {
  return perchjs.statementDigest(toPerch(s));
}

/** A replacement credential: a delegated address, or a key a verifier checks. */
export type Credential = perchjs.Credential;

export const encodeCredential: (c: Credential) => Uint8Array = perchjs.encodeCredential;

/** `sha256("perch/recovery/credential" || encoding)`. For revocation the key
 *  must be the verifier's canonical key. */
export const credentialFingerprint: (c: Credential) => Bytes32 = perchjs.credentialFingerprint;

export interface ReplacementSet {
  signers: { signerId: string; credential: Credential }[];
  zkEnrollment?: { id: Bytes32; commitment: Bytes32 };
}

const enc = new TextEncoder();

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/** Replacements in the one canonical order the controller accepts: signer
 *  ids strictly ascending by bytes. Refuses duplicates. */
export function sortReplacements(set: ReplacementSet): ReplacementSet {
  const signers = [...set.signers].sort((a, b) =>
    compareBytes(enc.encode(a.signerId), enc.encode(b.signerId)),
  );
  for (let i = 1; i < signers.length; i++) {
    if (signers[i - 1]!.signerId === signers[i]!.signerId) {
      throw new Error(`duplicate replacement for signer "${signers[i]!.signerId}"`);
    }
  }
  return { ...set, signers };
}

/** The encoding; ids must already be in canonical order (`sortReplacements`). */
export const encodeReplacementSet: (set: ReplacementSet) => Uint8Array = perchjs.encodeReplacementSet;

/** `sha256("perch/recovery/replacements" || encoding)`: the attempt's
 *  `replacements_hash`. */
export const replacementSetHash: (set: ReplacementSet) => Bytes32 = perchjs.replacementsHash;

/** `sha256("perch/recovery/config" || canonical JSON of the recovery member)`. */
export function configHashOfCanonical(canonicalRecoveryJson: string): Bytes32 {
  return sha256(enc.encode(`perch/recovery/config${canonicalRecoveryJson}`));
}
