/**
 * The perch PolicyDoc layer: build documents (nido conventions), lower them
 * onto OZ context rules, and decompile chain rules back into a doc view.
 *
 * Re-exports perch's own document surface (schema, canonical JSON + doc_hash,
 * builder, request mapping) so consumers need only `@nidohq/passkey-sdk`.
 * NOT re-exported: the `@nidohq/perch-interpreter` bindings client (import it
 * directly to call `get_program`) — the generated package re-exports the
 * whole stellar-sdk, which must not leak through this barrel.
 */

// perch's document surface, verbatim (vendored pin — see packages/perch/VENDORED.md).
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
export { buildDocInstallTxs } from './txs.js';
export type { BuildDocInstallArgs } from './txs.js';
export { decompileRules } from './decompile.js';
export {
  PERCH_STATELESS_REGISTRY_TESTNET,
  PERCH_WASM_HASHES,
  derivePerchContractId,
  perchTestnetAddresses,
} from './deployment.js';
export type { PerchAddresses } from './deployment.js';
