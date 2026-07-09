//! Public surface of the ZK-recovery SDK module. Re-exports everything a
//! consumer needs across the full lifecycle: field/hash primitives (parity
//! gated against `tests/vectors/zk-recovery/vectors.json`), secret
//! derivation (M1/M2), the depth-24 Merkle tree, enrollment/auth-hash
//! commitments, the recovery transaction builders, trust-free pool sync,
//! and the advisory client-side overlay. Nothing internal (e.g.
//! `poseidon.ts`'s arity validation set, `derivation.ts`'s
//! `contractIdBytes`) is re-exported here -- only each module's already-
//! `export`ed public API.
export * from './field.js';
export * from './poseidon.js';
export * from './derivation.js';
export * from './merkle.js';
export * from './authHash.js';
export * from './enrollment.js';
export * from './recovery.js';
export * from './poolSync.js';
export * from './overlay.js';
