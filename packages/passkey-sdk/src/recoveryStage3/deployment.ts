//! Canonical testnet deploy of the shared Stage 3 recovery stack. Not
//! registry-resolvable yet (`contracts/recovery-controller/src/lib.rs`'s
//! "Known limits" — "No factory/registry wiring"), so callers that need a
//! concrete address (the `multisig-recovery` policy block, `recover-v3`'s
//! manual-input defaults) import this constant instead of each hardcoding
//! their own. See DEPLOYED.md's Stage 3 section for provenance/verification
//! notes (wasm interface checked against `contracts/recovery-controller`
//! and `contracts/recovery-verifier`'s own `stellar contract info
//! interface` output before being recorded here).

/** `contracts/recovery-controller`, testnet. */
export const RECOVERY_CONTROLLER_TESTNET_ID =
  'CDXVWS4FLZKI65NX2CXBUTKEUGSIQN4SMU2OLKSSJNWPT62A4OKFHXDW';

/** `contracts/recovery-verifier`, testnet. Only needed for `ZkOnly`/
 *  `Combined` mode enrollment — `GuardianOnly` (the only mode the
 *  `multisig-recovery` policy block currently drives) never references
 *  this. */
export const RECOVERY_VERIFIER_TESTNET_ID =
  'CCQZ774YVDHRQSXT6KQLTBQ2TAIZYE3XW2Y6MJ7CDZKHTD47CLZUNRCV';
