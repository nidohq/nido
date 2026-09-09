// @stellar-registry/perch — TypeScript surface for perch policy documents.
//
// Shipped (this milestone): fail-closed schema mirroring perch-ir, canonical
// JSON + doc_hash byte-identical to the Rust model (parity-tested against the
// shared golden fixtures), and a fluent builder producing validated documents.
//
// Planned (tracking issue #8, gated on perch-compile #7 + the interpreter):
//   - compile() with byte-identical output vs the Rust compiler
//   - applyPlan() with the derived-interpreter-address hard precondition
//   - signing helpers: selectRuleIds, signingDigest, buildAuthPayload, signAuthEntry

export { canonicalJson, docHash, CANON_VERSION } from './canonical.js';
export {
  ACK_SENTINEL,
  policyDocSchema,
  parsePolicyDoc,
  parsePolicyDocJson,
  type PolicyDoc,
  type SignerDecl,
  type Scope,
  type Principals,
  type Rule,
  type ArgConstraint,
  type ArgPred,
  type CapConstraint,
} from './schema.js';
export {
  requestToPolicyDoc,
  type PolicyRequest,
  type Permission,
  type PermissionScope,
} from './request.js';
export {
  policy,
  delegated,
  external,
  isSelf,
  addressEq,
  stringIn,
  stringPrefix,
  u32Eq,
  PolicyBuilder,
  RuleBuilder,
  type SignerSpec,
} from './builder.js';
