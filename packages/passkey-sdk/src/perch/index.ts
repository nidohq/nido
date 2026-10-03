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
