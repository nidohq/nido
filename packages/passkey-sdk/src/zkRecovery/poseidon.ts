//! Client-side Poseidon2 hash, reproducing the exact construction the
//! `zk_recovery` circuit (`circuits/zk_recovery/src/main.nr`) and the
//! contract's host-side recompute (`contracts/zk-recovery/src/hash.rs::p2`)
//! use.
//!
//! `@zkpassport/poseidon2`'s `poseidon2Hash(inputs: bigint[]): bigint` is
//! already arity-generic over its input array length -- there is no
//! separate per-arity entry point to pick, and no adapter is needed beyond
//! reducing inputs mod `r` first (mirroring `hash.rs::p2`'s
//! `x.rem_euclid(&modulus)` per element). Parity with noir-lang `poseidon`
//! v0.2.0 (the circuit's hash) at arities 2, 4, and 15 is verified in
//! `poseidon.test.ts` against `tests/vectors/zk-recovery/vectors.json`
//! (generated from Noir's `Poseidon2::hash`, the source of truth) -- do not
//! trust this module if that test does not pass.
import { poseidon2Hash } from '@zkpassport/poseidon2';
import { FIELD_ORDER, type Fr } from './field.js';

const SUPPORTED_ARITIES = new Set([2, 4, 15]);

/**
 * Poseidon2 over `inputs`, matching `hash.rs::p2`: each input is reduced
 * mod `r` (a no-op for already-canonical SDK-internal inputs, but a real
 * reduction for external/client-supplied ones), then hashed at the arity
 * given by `inputs.length`.
 */
export function p2(inputs: Fr[]): Fr {
  if (!SUPPORTED_ARITIES.has(inputs.length)) {
    throw new Error(
      `p2: unsupported arity ${inputs.length} (supported: ${[...SUPPORTED_ARITIES].join(', ')})`,
    );
  }
  const reduced = inputs.map((x) => ((x % FIELD_ORDER) + FIELD_ORDER) % FIELD_ORDER);
  return poseidon2Hash(reduced);
}
