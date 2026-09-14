/**
 * The perch PolicyDoc layer: build documents (nido conventions), lower them
 * onto OZ context rules, and decompile chain rules back into a doc view.
 *
 * Re-exports perch's own document surface (schema, canonical JSON + doc_hash,
 * builder, request mapping) so consumers need only `@nidohq/passkey-sdk`.
 * NOT re-exported: the `@stellar-registry/perch-interpreter` bindings client (import it
 * directly to call `get_program`) — the generated package re-exports the
 * whole stellar-sdk, which must not leak through this barrel.
 */

// perch's document surface, verbatim (@stellar-registry/perch from npm).
export {
  ACK_SENTINEL,
  CANON_VERSION,
  PolicyBuilder,
  RuleBuilder,
  addressEq,
  canonicalJson,
  delegated,
  docHash,
  external,
  isSelf,
  parsePolicyDoc,
  parsePolicyDocJson,
  policy,
  requestToPolicyDoc,
  stringIn,
  stringPrefix,
  u32Eq,
} from '@stellar-registry/perch';
export type {
  ArgConstraint,
  ArgPred,
  CapConstraint,
  CapSpec,
  Permission,
  PermissionScope,
  PolicyDoc,
  PolicyRequest,
  Principals,
  Rule,
  Scope,
  SignerDecl,
  SignerSpec,
} from '@stellar-registry/perch';

// Nido's doc layer.
export * from './types.js';
export { buildPolicyDoc, scopedSessionKeyDoc } from './build.js';
export type { NidoSigner, ScopedSessionKeyDocOptions } from './build.js';
export { PROGRAM_VERSION, lowerDoc, signerDeclToChain, validateProgram } from './lower.js';
export type { LowerOptions } from './lower.js';
export { interpreterInstallParamsScVal, spendingLimitInstallParamsScVal } from './params.js';
// SPIKE (doc-only): apply_doc is the sole policy write path — the per-rule
// buildDocInstallTxs route is gone with the account's rule mutators.
export { buildApplyDocTx } from './applyDoc.js';
export type { ApplyDocTx, BuildApplyDocArgs } from './applyDoc.js';
export { DOC_APPLIED_EVENT, readPolicy } from './readPolicy.js';
export type { PolicyReadTier, ReadPolicyInputs, ReadPolicyResult } from './readPolicy.js';
export { decompileRules } from './decompile.js';
export {
  PERCH_STATELESS_REGISTRY_TESTNET,
  PERCH_WASM_HASHES,
  derivePerchContractId,
  perchTestnetAddresses,
} from './deployment.js';
export type { PerchAddresses } from './deployment.js';
