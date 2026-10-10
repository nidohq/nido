/**
 * Nido on the Perch stack (stellar-registry/perch epic #99): the account's
 * capabilities, recovery as a document change, the controller's operations,
 * and the statement encodings proofs bind. ZK proving lives in the
 * `@nidohq/passkey-sdk/perch-zk` subpath (it loads Barretenberg).
 */

export * from './deployment.js';
export * from './statement.js';
export * from './doc.js';
export * from './recovery.js';
export * from './account.js';
export type { ZkEvidence, ZkCredential } from './zk.js';

// perch-js's consumer interface (stellar-registry/perch#108): revision-
// consistent reads, rule selection, the apply lifecycle, and its typed
// errors, so the wallet reaches them through the SDK.
export {
  AccountFrozen,
  applyDocument,
  assertRevision,
  buildAuthPayload,
  checkLimits,
  InconsistentRead,
  oneTransactionBackend,
  OverLimits,
  PerchError,
  readSnapshot,
  resolveRule,
  RuleNotFound,
  selectRecoveryRule,
  selectRules,
  signingDigest,
  StaleRevision,
  StaleSelection,
  type AccountConfiguration,
  type AccountReader,
  type ApplyBackend,
  type ApplyCallbacks,
  type ApplyDocTransport,
  type ApplyEvent,
  type ApplyResult,
  type FlatDocLimits,
  type InstalledRule,
  type PreparedStep,
  type RuleRef,
  type RuleSelection,
  type SignerKey,
  type Snapshot,
} from '@stellar-registry/perch';
