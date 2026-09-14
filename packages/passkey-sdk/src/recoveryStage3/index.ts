//! Stage 3 recovery SDK — plain, experimental TypeScript helpers for
//! `contracts/recovery-controller` (guardian-only / ZK-only / combined-mode
//! recovery against one proposal-commitment model, completing via the
//! account's existing `apply_doc`). See
//! `contracts/recovery-controller/src/lib.rs`'s crate doc comment for the
//! authoritative architecture summary and "Known limits" — this module does
//! not re-litigate those; it just wraps the generated bindings.
//!
//! Sibling to `../policyDoc/` (the doc-layer SDK) and `../zkRecovery/` (the
//! M1/M2 raw-signer-rotation ZK recovery SDK, an UNRELATED, earlier
//! protocol version this module deliberately does not touch or extend).
export {
  buildRecoveryConfig,
  buildEnroll,
} from './config.js';
export type { BuildEnrollArgs } from './config.js';

export {
  buildLostKeyTargetDoc,
  buildCompromiseTargetDoc,
  targetDocHash,
  credentialIdForSigner,
  diffPolicyDocs,
  TargetDocError,
} from './targetDoc.js';
export type { PolicyDocDiff, RuleDiffEntry, SignerDiffEntry } from './targetDoc.js';

export { buildBeginAttempt } from './attempt.js';
export type { BuildBeginAttemptArgs } from './attempt.js';

export {
  buildSubmitGuardianApproval,
  buildSubmitGuardianCancel,
  buildSubmitZkProof,
  buildSubmitZkCancel,
} from './evidence.js';
export type { GuardianEvidenceArgs, ZkEvidenceArgs } from './evidence.js';

export { readRecoveryConfig, readAttempt, readHasPending, readConfigHash } from './reads.js';
export type { RecoveryReadArgs } from './reads.js';

export { checkAccountWiring, buildWireAccountTx } from './accountWiring.js';
export type { AccountWiringArgs, AccountWiringStatus, AccountWiringCheck } from './accountWiring.js';

export { RECOVERY_CONTROLLER_TESTNET_ID, RECOVERY_VERIFIER_TESTNET_ID } from './deployment.js';

export {
  computeDocAuthHash,
  assembleDocPublicInputs,
  ACTION_LOST_KEY,
  ACTION_COMPROMISE,
  ACTION_CANCEL,
} from './docAuthHash.js';
export type { DocAuthHashParams, DocAuthAction } from './docAuthHash.js';

export { toBytes32, toBytesN, toBytes } from './bytes.js';

export type {
  RecoveryConfig,
  RecoveryConfigInput,
  RecoveryActionScVal,
  Attempt,
  AttemptState,
  AuthModeInput,
  ProfileInput,
  PendingActivityPolicyInput,
  RecoveryActionInput,
  CredentialReplacement,
} from './types.js';
