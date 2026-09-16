//! Client-side reconstruction of `contracts/recovery-controller/src/zk.rs`'s
//! `compute_doc_auth_hash` — the `nido-recovery-controller` counterpart to
//! `../zkRecovery/authHash.ts::computeAuthHash`. Deliberately a SEPARATE
//! function (not a variant of the M1 one): this module's circuit
//! (`circuits/zk_recovery_doc/src/main.nr`) binds a DIFFERENT field list into
//! the same `auth_hash` slot (`doc_hash_hi/lo`, `cfg_version`,
//! `baseline_hi/lo` instead of M1's raw P-256 pubkey fields) — see
//! `zk.rs`'s module doc comment for why the Rust side duplicates rather than
//! shares the M1 hash module. This module mirrors that choice: it reuses the
//! Merkle/field/Poseidon2 primitives from `../zkRecovery/` (leaf wrap,
//! nullifier, tree, domain constants — ALL unaffected by the field-swap, per
//! `circuits/zk_recovery_doc/Prover.toml`'s doc comment: "root/nullifier/
//! secret/leaf-tree witness are IDENTICAL to the M1 lifecycle fixture"), but
//! defines its own `auth_hash` formula rather than editing
//! `zkRecovery/authHash.ts::computeAuthHash` in place.
//!
//! Parity gate: `docAuthHash.test.ts` reproduces
//! `contracts/recovery-controller/src/zk.rs`'s pinned
//! `compute_doc_auth_hash_matches_fixture` test byte-for-byte. A mismatch
//! there is a HARD STOP — it means a real `bb prove` proof's public input
//! will never match what the contract recomputes on-chain.
import { sha256 } from '@noble/hashes/sha2.js';
import { DOM_AUTH, fieldToBytes32, split16, u256FromU64, type Fr } from '../zkRecovery/field.js';
import { p2 } from '../zkRecovery/poseidon.js';

const encoder = new TextEncoder();

/** Numeric action codes baked into the circuit's `auth_hash`, matching
 *  `contracts/recovery-controller/src/zk.rs`'s `ACTION_LOST_KEY` /
 *  `ACTION_COMPROMISE` / `ACTION_CANCEL` constants exactly. Distinct
 *  numbering namespace from M1's `1|2|3` action codes in `authHash.ts` —
 *  these two circuits/contracts are unrelated protocol versions that only
 *  happen to reuse the digit 1-3, so do not assume cross-compatibility. */
export const ACTION_LOST_KEY = 1;
export const ACTION_COMPROMISE = 2;
export const ACTION_CANCEL = 3;
export type DocAuthAction = typeof ACTION_LOST_KEY | typeof ACTION_COMPROMISE | typeof ACTION_CANCEL;

/** `computeDocAuthHash` parameters — one recovery-controller evidence
 *  submission's full committed context (`ProposalCommitment`), matching
 *  `zk.rs::compute_doc_auth_hash`'s argument list 1:1. */
export interface DocAuthHashParams {
  action: DocAuthAction;
  /** The recovering smart account's raw 32-byte contract id
   *  (`StrKey.decodeContract(account)`). */
  accountId32: Uint8Array;
  /** Raw network passphrase string (sha256'd internally, matching
   *  `RecoveryConfig.network_passphrase`'s on-chain convention). */
  networkPassphrase: string;
  /** The `nido-recovery-controller` instance's raw 32-byte contract id. */
  controllerId32: Uint8Array;
  /** 32-byte target document canonical hash (`docHash(doc)` from
   *  `@stellar-registry/perch`, hex-decoded). */
  targetDocHash32: Uint8Array;
  /** `RecoveryConfig.version` at enrollment time (always `1` today — no
   *  `reconfigure` entry point exists, see the crate's "Known limits"). */
  configVersion: number;
  /** `config.baseline_doc_hash` for a `Compromise`/cancel-of-compromise
   *  attempt, or the captured live-doc snapshot hash for `LostKey`. */
  baselineOrSourceId32: Uint8Array;
  /** The attempt's id (`ProposalCommitment.attempt_id`) — occupies the
   *  circuit's `nonce` slot. */
  attemptId: bigint | number;
  /** `config.delay_secs`, truncated to u32 exactly like `zk.rs::verify`
   *  does (`u32::try_from(delay_secs).unwrap_or(u32::MAX)`). */
  timelockSecs: number;
}

/**
 * `auth_hash = P2_15(DOM_AUTH, action, acct_hi, acct_lo, npass_hi, npass_lo,
 * ctrl_hi, ctrl_lo, doc_hash_hi, doc_hash_lo, cfg_version, baseline_hi,
 * baseline_lo, attempt_id, timelock_secs)` — field order is EXACT and
 * load-bearing, copied verbatim from `zk.rs::compute_doc_auth_hash`. A
 * reordering silently produces a different (wrong) field element that still
 * "looks like" a valid `Fr`, surfacing only as an on-chain verification
 * failure, never a type error.
 */
export function computeDocAuthHash(p: DocAuthHashParams): Fr {
  const actionF = u256FromU64(p.action);
  const [acctHi, acctLo] = split16(p.accountId32);

  const npassHash = sha256(encoder.encode(p.networkPassphrase));
  const [npassHi, npassLo] = split16(npassHash);

  const [ctrlHi, ctrlLo] = split16(p.controllerId32);
  const [docHashHi, docHashLo] = split16(p.targetDocHash32);
  const cfgVersionF = u256FromU64(p.configVersion);
  const [baselineHi, baselineLo] = split16(p.baselineOrSourceId32);

  const attemptIdF = u256FromU64(p.attemptId);
  const timelockF = u256FromU64(p.timelockSecs);

  return p2([
    DOM_AUTH,
    actionF,
    acctHi,
    acctLo,
    npassHi,
    npassLo,
    ctrlHi,
    ctrlLo,
    docHashHi,
    docHashLo,
    cfgVersionF,
    baselineHi,
    baselineLo,
    attemptIdF,
    timelockF,
  ]);
}

/**
 * `root(32) || nullifier(32) || auth_hash(32)` — the circuit's public-input
 * wire order (`circuits/zk_recovery_doc/src/main.nr`'s `pub` parameters),
 * identical wire format to M1's `assemble_public_inputs` in
 * `contracts/zk-recovery/src/hash.rs` (the verifier contract is
 * circuit-shape-agnostic; this format is determined by the CIRCUIT's
 * parameter order, not by any contract). Matches
 * `zk.rs::assemble_public_inputs`.
 */
export function assembleDocPublicInputs(root: Fr, nullifier: Fr, authHash: Fr): Uint8Array {
  const out = new Uint8Array(96);
  out.set(fieldToBytes32(root), 0);
  out.set(fieldToBytes32(nullifier), 32);
  out.set(fieldToBytes32(authHash), 64);
  return out;
}
