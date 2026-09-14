//! Canonical testnet deploy of the shared Stage 3 recovery stack. Not
//! registry-resolvable yet (`contracts/recovery-controller/src/lib.rs`'s
//! "Known limits" — "No factory/registry wiring"), so callers that need a
//! concrete address (the `multisig-recovery` policy block, `recover-v3`'s
//! manual-input defaults) import this constant instead of each hardcoding
//! their own. See DEPLOYED.md's Stage 3 section for provenance/verification
//! notes (wasm interface checked against `contracts/recovery-controller`
//! and `contracts/recovery-verifier`'s own `stellar contract info
//! interface` output before being recorded here).

/** `contracts/recovery-controller`, testnet — v2 (adds `reconfigure`/
 *  `config_hash`, captain live-fail #3 fix). This controller is
 *  constructorless with no upgrade/admin entry point at all (by design —
 *  see the crate doc comment), so adding `reconfigure` to the source could
 *  not update the already-deployed v1 instance in place; v2 is a genuinely
 *  new, separately-deployed address. "Explicit upgrade = a new immutable
 *  artifact, not a rewrite" — the same philosophy the crate doc comment
 *  already documented for `contracts/recovery-verifier`, exercised here
 *  for the first time on the controller itself.
 *
 *  Superseded: `CDXVWS4FLZKI65NX2CXBUTKEUGSIQN4SMU2OLKSSJNWPT62A4OKFHXDW`
 *  (v1 — no `reconfigure`/`config_hash`). NOT orphan-free: this repo's own
 *  `security-recovery-install.testnet.spec.ts` probe enrolled
 *  `CCVXSIAVMOI4APBONN6CDHBONC7CYOJUM7VGVGCG7CJXRIIQCZN3M222` against v1
 *  (confirmed via `config()` still returning a real `RecoveryConfig` at
 *  v1's address after this switch) — a throwaway probe account, not a real
 *  user's, so left orphaned deliberately rather than migrated. */
export const RECOVERY_CONTROLLER_TESTNET_ID =
  'CBYSWPHNWAHYUBZO5TBTO5MCW2ZC45F2C3L4JSUZXYQFNMHTOBOCCHZU';

/** `contracts/recovery-verifier`, testnet. Only needed for `ZkOnly`/
 *  `Combined` mode enrollment — `GuardianOnly` (the only mode the
 *  `multisig-recovery` policy block currently drives) never references
 *  this. */
export const RECOVERY_VERIFIER_TESTNET_ID =
  'CCQZ774YVDHRQSXT6KQLTBQ2TAIZYE3XW2Y6MJ7CDZKHTD47CLZUNRCV';
