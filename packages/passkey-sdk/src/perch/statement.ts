/**
 * The byte encodings of Perch's recovery statement, credentials, and
 * replacement sets (`vendor/perch/docs/recovery/statement.md`), in
 * TypeScript.
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

export type Bytes32 = Uint8Array;

export type RecoveryAction = 'lost-key' | 'compromise' | 'cancel' | 'reconfigure' | 'upgrade';

const ACTION_BYTE: Record<RecoveryAction, number> = {
  'lost-key': 1,
  compromise: 2,
  cancel: 3,
  reconfigure: 4,
  upgrade: 5,
};

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

const enc = new TextEncoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function u32(v: number): Uint8Array {
  if (!Number.isInteger(v) || v < 0 || v > 0xffff_ffff) throw new Error(`not a u32: ${v}`);
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, v);
  return out;
}

function u64(v: bigint): Uint8Array {
  if (v < 0n || v >= 1n << 64n) throw new Error(`not a u64: ${v}`);
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, v);
  return out;
}

function b32(v: Uint8Array, what: string): Uint8Array {
  if (v.length !== 32) throw new Error(`${what}: expected 32 bytes, got ${v.length}`);
  return v;
}

/** A contract address's 32-byte id. */
export function contractId(address: string): Bytes32 {
  if (!StrKey.isValidContract(address)) throw new Error(`not a contract address: ${address}`);
  return new Uint8Array(StrKey.decodeContract(address));
}

/** An address as `tag || payload` (33 bytes): `0x00` account, `0x01` contract. */
export function taggedAddress(address: string): Uint8Array {
  if (StrKey.isValidEd25519PublicKey(address)) {
    return concat([Uint8Array.of(0), new Uint8Array(StrKey.decodeEd25519PublicKey(address))]);
  }
  return concat([Uint8Array.of(1), contractId(address)]);
}

/** The statement's canonical encoding. */
export function encodeStatement(s: RecoveryStatement): Uint8Array {
  const head = concat([
    enc.encode('perch/recovery/statement'),
    Uint8Array.of(2, ACTION_BYTE[s.subject.action]),
    b32(s.networkId, 'network_id'),
    contractId(s.account),
    contractId(s.controller),
    u64(s.configEpoch),
    b32(s.configHash, 'config_hash'),
    u32(s.delayLedgers),
    u32(s.expiryLedgers),
    u32(s.validUntilLedger),
  ]);
  const sub = s.subject;
  switch (sub.action) {
    case 'lost-key':
    case 'compromise':
      return concat([
        head,
        u64(sub.attemptId),
        b32(sub.sourceDocHash, 'source_doc_hash'),
        b32(sub.targetDocHash, 'target_doc_hash'),
        b32(sub.replacementsHash, 'replacements_hash'),
      ]);
    case 'cancel':
      return concat([head, u64(sub.attemptId), b32(sub.attemptStatement, 'attempt_statement')]);
    case 'reconfigure':
      return sub.change.kind === 'set'
        ? concat([head, Uint8Array.of(1), b32(sub.change.newConfigHash, 'new_config_hash')])
        : concat([head, Uint8Array.of(0), new Uint8Array(32)]);
    case 'upgrade':
      return concat([head, u64(sub.requestId), b32(sub.wasmHash, 'wasm_hash')]);
  }
}

/** `sha256(encodeStatement(s))`: what guardians sign and the circuit binds. */
export function statementDigest(s: RecoveryStatement): Bytes32 {
  return sha256(encodeStatement(s));
}

/** A replacement credential: a delegated address, or a key a verifier checks. */
export type Credential =
  | { kind: 'delegated'; address: string }
  | { kind: 'external'; verifier: string; key: Uint8Array };

export function encodeCredential(c: Credential): Uint8Array {
  return c.kind === 'delegated'
    ? concat([Uint8Array.of(1), taggedAddress(c.address)])
    : concat([Uint8Array.of(2), taggedAddress(c.verifier), u32(c.key.length), c.key]);
}

/** `sha256("perch/recovery/credential" || encoding)`. For revocation the key
 *  must be the verifier's canonical key. */
export function credentialFingerprint(c: Credential): Bytes32 {
  return sha256(concat([enc.encode('perch/recovery/credential'), encodeCredential(c)]));
}

export interface ReplacementSet {
  signers: { signerId: string; credential: Credential }[];
  zkEnrollment?: { id: Bytes32; commitment: Bytes32 };
}

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

export function encodeReplacementSet(set: ReplacementSet): Uint8Array {
  const parts: Uint8Array[] = [u32(set.signers.length)];
  let previous: Uint8Array | undefined;
  for (const { signerId, credential } of set.signers) {
    const id = enc.encode(signerId);
    if (previous !== undefined && compareBytes(previous, id) >= 0) {
      throw new Error('replacement signer ids must be strictly ascending (sortReplacements)');
    }
    previous = id;
    parts.push(u32(id.length), id, encodeCredential(credential));
  }
  parts.push(
    set.zkEnrollment === undefined
      ? Uint8Array.of(0)
      : concat([
          Uint8Array.of(1),
          b32(set.zkEnrollment.id, 'enrollment id'),
          b32(set.zkEnrollment.commitment, 'commitment'),
        ]),
  );
  return concat(parts);
}

/** `sha256("perch/recovery/replacements" || encoding)`: the attempt's
 *  `replacements_hash`. */
export function replacementSetHash(set: ReplacementSet): Bytes32 {
  return sha256(concat([enc.encode('perch/recovery/replacements'), encodeReplacementSet(set)]));
}

/** `sha256("perch/recovery/config" || canonical JSON of the recovery member)`. */
export function configHashOfCanonical(canonicalRecoveryJson: string): Bytes32 {
  return sha256(concat([enc.encode('perch/recovery/config'), enc.encode(canonicalRecoveryJson)]));
}
