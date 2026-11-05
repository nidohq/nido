import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}





/**
 * The shared infra contracts this account pins at build time.
 */
export interface InfraPins {
  doc_compiler: string;
  interpreter: string;
  spending_limit: string;
}


/**
 * The `Protected` freeze: while `ledger < until`, the account authorizes
 * only `attempt_id`'s completion.
 */
export interface FreezeGate {
  /**
 * The authorized attempt.
 */
attempt_id: u64;
  /**
 * The authorized attempt's `expires_at`.
 */
until: u32;
}



/**
 * A scoped document as applied.
 */
export interface ScopeRecord {
  /**
 * Its canonical `doc_hash`.
 */
doc_hash: Buffer;
  /**
 * The scope generation it was applied under; wiped once
 * `scope_generation` moves past it.
 */
gen: u64;
  /**
 * Every context rule it installed, with its id.
 */
rules: Array<InstalledRule>;
}


/**
 * A scoped document as the account stores it: [`ScopeRecord`]'s fields,
 * with each rule's record holding its stored rule, the scope's position in
 * the scope index, the document's signer ids in declaration order, and
 * each signer's `verifier-name` (empty where it has none; the list empty
 * when no signer has one), which with the records give back its canonical
 * text.
 */
export interface StoredScope {
  doc_hash: Buffer;
  gen: u64;
  pos: u32;
  rules: Array<RuleRecord>;
  signer_ids: Array<string>;
  verifier_names: Array<string>;
}





/**
 * Why `__check_auth` refused before evaluating any rule.
 */
export const PerchAuthError = {
  /**
   * A context names an invoker-only hook (spec §15): these are reachable only from the account's own flows, never by signature.
   */
  1: {message:"ReservedFunction"},
  /**
   * A `Protected` recovery attempt is authorized: the account authorizes nothing but that attempt's completion (spec §9).
   */
  2: {message:"AccountFrozen"},
  /**
   * A selected rule belongs to a scoped document a recovery completion wiped: the generation its stored rule carries is not the account's (spec §7.6).
   */
  3: {message:"StaleScope"},
  /**
   * A selected scoped rule's context calls the recovery controller or the ZK adapter or pool of the applied recovery member, any of which may have been adopted after the scope was applied (spec §7.6).
   */
  4: {message:"ScopeEscalation"},
  /**
   * rule-eval refuses the authorization, or it chooses the recovery rule outside a completion (`gate`).
   */
  5: {message:"RuleEvalRefused"}
}





/**
 * Everything the account's entry points can refuse. Compiler and controller failures flatten in via `#[from_contract_client]`, converted by `??`.
 */
export const PerchAccountError = {
  /**
   * The document keeps no constraint-free, never-expiring self-admin rule with a signer (anti-brick).
   */
  1: {message:"AdminLockout"},
  /**
   * The document names a revoked credential.
   */
  2: {message:"RevokedCredential"},
  /**
   * The document reuses a ZK enrollment id this account enrolled before.
   */
  3: {message:"EnrollmentReused"},
  /**
   * The document changes the ZK factor without a new enrollment id.
   */
  4: {message:"ZkFactorChangedInPlace"},
  /**
   * `execute` was asked to call an invoker-only hook.
   */
  5: {message:"ReservedFunction"},
  /**
   * The account has no adopted recovery controller.
   */
  6: {message:"RecoveryNotEnrolled"},
  /**
   * No upgrade is scheduled.
   */
  7: {message:"NoPendingUpgrade"},
  /**
   * The request id is not the pending upgrade's.
   */
  8: {message:"UpgradeRequestMismatch"},
  /**
   * The upgrade delay has not elapsed.
   */
  9: {message:"UpgradeNotReady"},
  /**
   * A ledger computation overflowed `u32`.
   */
  10: {message:"TimingOverflow"},
  /**
   * A completion returned a credential that cannot be fingerprinted.
   */
  11: {message:"InvalidCredential"},
  /**
   * The recovery generation moved since scheduling; the request can never execute.
   */
  12: {message:"StaleUpgrade"},
  /**
   * The submitted document bytes are not UTF-8.
   */
  13: {message:"Compiler_DocNotUtf8"},
  /**
   * The document failed fail-closed parsing (unknown field, bad shape, unsupported version, duplicate key, …).
   */
  14: {message:"Compiler_DocParse"},
  /**
   * The document failed semantic validation (dangling signer ref, malformed address or key, ambiguous empty list, …) or names its verifiers as the compiler does not take.
   */
  15: {message:"Compiler_DocInvalid"},
  /**
   * The document names no network, or a network that is not this chain.
   */
  16: {message:"Compiler_WrongNetwork"},
  /**
   * The document cannot be lowered to rules: a rule with self-authenticating principals, or too many constraints.
   */
  17: {message:"Compiler_DocCompile"},
  /**
   * The document exceeds a cap on signers, rules, bytes, or name length.
   */
  18: {message:"Compiler_DocTooLarge"},
  /**
   * A signer's external `key` is not its verifier-canonical form.
   */
  19: {message:"Compiler_KeyNotCanonicalizable"},
  /**
   * `derive_target`: the current document enrolls no recovery.
   */
  20: {message:"Compiler_NotEnrolled"},
  /**
   * `derive_target`: the replacement set breaks spec §7.3 rules 1-3, or the action is not a recovery attempt.
   */
  21: {message:"Compiler_ReplacementRefused"},
  /**
   * `derive_target`: the ZK enrollment is missing, unexpected, or reuses the enrolled id.
   */
  22: {message:"Compiler_ZkEnrollmentMismatch"},
  /**
   * `derive_target`: the target has no constraint-free self-admin rule with a signer (the anti-brick check).
   */
  23: {message:"Compiler_AdminLockout"},
  /**
   * No configuration is enrolled for this account at this controller.
   */
  24: {message:"Recovery_NotEnrolled"},
  /**
   * An attempt is authorized and live, which blocks begin, policy changes, and upgrades.
   */
  25: {message:"Recovery_AttemptAuthorized"},
  /**
   * No attempt with this id exists for the account.
   */
  26: {message:"Recovery_NoSuchAttempt"},
  /**
   * The attempt is terminal, expired, from an older epoch, or invalidated by a sibling's authorization.
   */
  27: {message:"Recovery_AttemptNotLive"},
  /**
   * Initiation evidence for an attempt that is no longer collecting.
   */
  28: {message:"Recovery_AttemptNotCollecting"},
  /**
   * Completion before `executable_after`.
   */
  29: {message:"Recovery_NotExecutableYet"},
  /**
   * The completion context, or the compiled document hash, does not match the authorized attempt's target.
   */
  30: {message:"Recovery_WrongTarget"},
  /**
   * The address is not an enrolled guardian.
   */
  31: {message:"Recovery_NotAGuardian"},
  /**
   * This guardian or factor already counted for this statement.
   */
  32: {message:"Recovery_AlreadyCounted"},
  /**
   * The enrolled mode has no guardian factor.
   */
  33: {message:"Recovery_ModeHasNoGuardians"},
  /**
   * The enrolled mode has no ZK factor.
   */
  34: {message:"Recovery_ModeHasNoZk"},
  /**
   * The adapter refused the proof (its `ZkAdapterError` says why).
   */
  35: {message:"Recovery_ZkEvidenceRejected"},
  /**
   * The proof's nullifier is spent.
   */
  36: {message:"Recovery_NullifierSpent"},
  /**
   * The statement's freshness bound has passed or reaches too far.
   */
  37: {message:"Recovery_EvidenceExpired"},
  /**
   * The statement cannot be encoded (a non-contract account or controller).
   */
  38: {message:"Recovery_InvalidStatement"},
  /**
   * Recorded approvals do not satisfy the enrolled condition for this reconfiguration or upgrade.
   */
  39: {message:"Recovery_ConditionNotMet"},
  /**
   * The account's `max-cancels` is used up.
   */
  40: {message:"Recovery_MaxCancelsReached"},
  /**
   * Owner cancellation is only available under `Loss`.
   */
  41: {message:"Recovery_OwnerCancelRefused"},
  /**
   * The replacement set breaks a §7.3 rule, or derivation refused it.
   */
  42: {message:"Recovery_InvalidReplacements"},
  /**
   * The target or a replacement contains a revoked credential.
   */
  43: {message:"Recovery_CredentialRevoked"},
  /**
   * The ZK enrollment id was enrolled for this account before.
   */
  44: {message:"Recovery_EnrollmentIdReused"},
  /**
   * Compromise recovery with no baseline enrolled.
   */
  45: {message:"Recovery_NoBaseline"},
  /**
   * Compromise recovery before the baseline's content was published.
   */
  46: {message:"Recovery_BaselineNotPublished"},
  /**
   * The published document does not hash to the enrolled baseline.
   */
  47: {message:"Recovery_BaselineMismatch"},
  /**
   * The adapter's circuit id or tree depth does not match the enrolled factor and pool.
   */
  48: {message:"Recovery_ZkWiringMismatch"},
  /**
   * The ZK factor changed without a new enrollment id.
   */
  49: {message:"Recovery_ZkFactorChangedInPlace"},
  /**
   * The configuration is malformed.
   */
  50: {message:"Recovery_InvalidConfiguration"},
  /**
   * An upgrade request recorded under an older epoch.
   */
  51: {message:"Recovery_StaleUpgrade"},
  /**
   * A ledger-sequence computation overflowed `u32`.
   */
  52: {message:"Recovery_LedgerOverflow"},
  /**
   * A hook was called for a recovery rule of the wrong shape.
   */
  53: {message:"Recovery_MalformedContextRule"},
  /**
   * The target keeps a credential the replacement set replaces.
   */
  54: {message:"Recovery_ReplacedCredentialRetained"},
  /**
   * The account is not at `apply_doc`'s `expected_revision`.
   */
  55: {message:"StaleRevision"},
  /**
   * A completed recovery would overflow the scope generation.
   */
  56: {message:"GenerationExhausted"},
  /**
   * A scoped document has a `recovery` member, a self-admin rule, or a rule on the account or its recovery contracts.
   */
  57: {message:"ScopeEscalation"},
  /**
   * No scoped document has this scope id.
   */
  58: {message:"UnknownScope"},
  /**
   * `gc_scope` was given a live scope; `remove_scope` removes it.
   */
  59: {message:"ScopeLive"},
  /**
   * The document names a credential from a scope a recovery has wiped.
   */
  60: {message:"WipedCredential"},
  /**
   * The compiled document's model is missing, duplicated, unreadable, or does not match its rules.
   */
  61: {message:"ModelInvalid"},
  /**
   * A rule other than the recovery rule asks for no signer (INV-1).
   */
  62: {message:"UnguardedRule"},
  /**
   * A scoped document is not in normal form, or has a rule already expired.
   */
  63: {message:"NotNormalForm"},
  /**
   * A constructor admin signer's verifier is not one `perch/verifiers` deployed.
   */
  64: {message:"UnverifiedVerifier"},
  /**
   * Cross-contract call aborted
   */
  0: {message:"Aborted"},
  /**
   * Unknown error from cross-contract call
   */
  2147483647: {message:"UnknownError"}
}



/**
 * Constants of this wasm a wallet checks before building for the account.
 */
export interface AccountCapabilities {
  /**
 * `one_tx` (admin document) and `scoped_v1` (scoped documents).
 */
apply_modes: Array<string>;
  /**
 * What signers sign: `addr_oz_v1`, bound to the account's address.
 */
auth_digest: string;
  /**
 * How `doc_hash` is computed: `canon_v1`.
 */
doc_identity: string;
  /**
 * The interface version.
 */
interface_version: u32;
  /**
 * The `AccountConfiguration` layout version.
 */
snapshot_version: u32;
}


/**
 * What rule selection and signing need for the admin document, read at one
 * ledger.
 */
export interface AccountConfiguration {
  /**
 * The applied document's `doc_hash`, if any.
 */
doc_hash: Option<Buffer>;
  /**
 * The `Protected` freeze: zero or one entries.
 */
gate: Array<FreezeGate>;
  /**
 * The shared infra the account pins.
 */
infra: InfraPins;
  /**
 * The adopted recovery controller, if any.
 */
recovery_controller: Option<string>;
  /**
 * The recovery generation.
 */
recovery_generation: u64;
  /**
 * The recovery rule's id, if installed.
 */
recovery_rule: Option<u32>;
  /**
 * The revision every other field belongs to.
 */
revision: u64;
  /**
 * Every installed admin context rule, with its id.
 */
rules: Array<InstalledRule>;
}


/**
 * One installed rule as the account stores it: its id, name and policies,
 * and the rule-eval rule that decides what it allows.
 */
export interface RuleRecord {
  id: u32;
  name: string;
  policies: Array<InstalledPolicy>;
  rule: StoredRule;
}


/**
 * What an `apply_doc` changed in the rule set, counted as it is done.
 * Rule changes publish no event of their own, so this, carried by
 * `DocApplied`, is the one record of the change an indexer gets (with the
 * applied document itself, `applied_doc`). A rule installed again under a
 * new id counts as removed and added; signers and policies count only for
 * rules edited in place.
 */
export interface DeltaSummary {
  policies_added: u32;
  policies_removed: u32;
  rules_added: u32;
  rules_edited: u32;
  rules_removed: u32;
  signers_added: u32;
  signers_removed: u32;
}


/**
 * One context rule as the account installed it.
 */
export interface InstalledRule {
  /**
 * The contract the rule authorizes calls to.
 */
context_type: ContextRuleType;
  /**
 * The rule id.
 */
id: u32;
  /**
 * The rule's name.
 */
name: string;
  /**
 * The policies attached to the rule.
 */
policies: Array<InstalledPolicy>;
  /**
 * Whether this is the zero-signer recovery rule.
 */
recovery: boolean;
  /**
 * The rule's signers.
 */
signers: Array<Signer>;
  /**
 * The inclusive last valid ledger, if bounded.
 */
valid_until: Option<u32>;
}


/**
 * One policy attached to an installed rule.
 */
export interface InstalledPolicy {
  /**
 * `sha256` of the install parameters' XDR.
 */
params: Buffer;
  /**
 * The policy contract.
 */
policy: string;
}

/**
 * The document caps a compiler enforces, as [`PerchDocCompiler::limits`]
 * returns them. Versioned: a later budget (a complexity-weighted one, say)
 * is a new variant, which a consumer that does not know it refuses rather
 * than misreads.
 */
export type DocLimits = {tag: "V1", values: readonly [FlatDocLimits]};

/**
 * Where a compiled rule applies. `SelfAdmin` is account-agnostic: the
 * applying account resolves it to its own address.
 */
export type RuleScope = {tag: "SelfAdmin", values: void} | {tag: "Contract", values: readonly [string]};


/**
 * A compiled document: its canonical identity and the rules it becomes.
 */
export interface CompiledDoc {
  /**
 * The canonical bytes `doc_hash` is the hash of. The account stores
 * them so anyone, including the recovery controller, can read back the
 * full applied document.
 */
canonical: Buffer;
  /**
 * `sha256(canonical bytes)` — the hash the reviewer approved. Formatting
 * of the submitted JSON is irrelevant: a pretty-printed file and its
 * minified twin compile to the same hash.
 */
doc_hash: Buffer;
  /**
 * The fingerprint (`perch_recovery_interface::credential::Credential::
 * fingerprint`) of every declared signer's credential, with external
 * keys canonicalized by their verifier. What revocation compares
 * (spec §8).
 */
fingerprints: Array<Buffer>;
  /**
 * The document as rule-core's lowering reads it (`rule_eval::Doc`, in
 * host types): one entry. A `Vec` for the same reason as `recovery`.
 * The applying account lowers it with `rule_eval::lower` and stores the
 * result as its installed rules; `model.rules[i]` is `rules[i]`'s
 * document rule.
 */
model: Array<CompiledModel>;
  /**
 * Whether the document is in normal form as far as its text shows
 * (`perch_ir::normal_form`): then the rules an account stores for it,
 * with its signer ids and [`Self::verifier_names`], give back its
 * canonical text. An account refuses a scoped document that is not.
 */
normal_form: boolean;
  /**
 * The compiled `recovery` member: zero or one entries (a `Vec` because
 * `#[contracttype]` has no conversion for an `Option` of a custom struct;
 * `Option<u32>` on [`CompiledRule::valid_until`] works because `u32` is
 * a host type). Present ⇒ the document enrolls account recovery, and the
 * applier syncs this configuration to the controller instance it names
 * (`docs/recovery/`).
 */
recovery: Array<CompiledRecoveryConfig>;
  /**
 * One compiled rule per document rule, in the submitted order.
 */
rules: Array<CompiledRule>;
  /**
 * Every verifier the document names by contract id alone, once each, in
 * declaration order: what a wallet warns about ("it can approve anything
 * this rule allows"). Always empty for an admin document, which may name
 * none.
 */
unverified: Array<string>;
  /**
 * One entry per declared signer, in declaration order: the
 * `verifier-name` its verifier was resolved from, or empty for a
 * delegated signer and a verifier named by contract id alone.
 */
verifier_names: Array<string>;
}


/**
 * One rule, compiled to the shapes OZ's `add_context_rule` takes: its
 * name, resolved scope, its principals' OZ `Signer`s in the order the
 * document names them, and its last ledger. OZ's context rule is the
 * registry of the rule's id and signers; what the rule allows is its
 * document rule in [`CompiledDoc::model`], at the same index, as rule-eval
 * lowers it.
 */
export interface CompiledRule {
  /**
 * The rule's name in the document. The account matches installed rules
 * by name and scope.
 */
name: string;
  scope: RuleScope;
  /**
 * The rule's signers, with external keys as declared (already
 * verifier-canonical).
 */
signers: Array<Signer>;
  /**
 * The last ledger the rule authorizes, if bounded: OZ's inclusive
 * `valid_until`, one below the document's `not-after-ledger`.
 */
valid_until: Option<u32>;
}


/**
 * What `derive_target` returns: the recovery target the controller binds
 * into an attempt's statement (spec §7.1).
 */
export interface DerivedTarget {
  /**
 * The target's canonical bytes: exactly what the completing `apply_doc`
 * must submit.
 */
canonical: Buffer;
  /**
 * The target's recovery `config_hash` (the current one, or the current
 * one with the declared ZK rotation).
 */
config_hash: Buffer;
  /**
 * `sha256` of `canonical`: the target's `doc_hash`.
 */
doc_hash: Buffer;
  /**
 * Fingerprints of every credential in the target (spec §7.3 rule 7).
 */
fingerprints: Array<Buffer>;
  /**
 * The credentials occupying the replaced signer slots in the source:
 * the applied document's for lost-key, the baseline's for compromise.
 * External keys are canonicalized by their verifier, so a credential's
 * `fingerprint` is the one revocation compares. The controller records
 * them at T1 and the completion revokes them (spec §8).
 */
replaced: Array<Credential>;
}


/**
 * Flat per-document caps: [`MAX_DOC_SIGNERS`], [`MAX_DOC_RULES`],
 * [`MAX_DOC_CANONICAL_BYTES`], [`MAX_RULE_NAME_BYTES`].
 */
export interface FlatDocLimits {
  max_canonical_bytes: u32;
  max_rule_name_bytes: u32;
  max_rules: u32;
  max_signers: u32;
}

/**
 * Everything `compile_doc` can refuse. (`#[scerr]` assigns sequential codes
 * from 1, in variant order.)
 */
export const DocCompilerError = {
  /**
   * The submitted document bytes are not UTF-8.
   */
  1: {message:"DocNotUtf8"},
  /**
   * The document failed fail-closed parsing (unknown field, bad shape, unsupported version, duplicate key, …).
   */
  2: {message:"DocParse"},
  /**
   * The document failed semantic validation (dangling signer ref, malformed address or key, ambiguous empty list, …) or names its verifiers as the compiler does not take.
   */
  3: {message:"DocInvalid"},
  /**
   * The document names no network, or a network that is not this chain.
   */
  4: {message:"WrongNetwork"},
  /**
   * The document cannot be lowered to rules: a rule with self-authenticating principals, or too many constraints.
   */
  5: {message:"DocCompile"},
  /**
   * The document exceeds a cap on signers, rules, bytes, or name length.
   */
  6: {message:"DocTooLarge"},
  /**
   * A signer's external `key` is not its verifier-canonical form.
   */
  7: {message:"KeyNotCanonicalizable"},
  /**
   * `derive_target`: the current document enrolls no recovery.
   */
  8: {message:"NotEnrolled"},
  /**
   * `derive_target`: the replacement set breaks spec §7.3 rules 1-3, or the action is not a recovery attempt.
   */
  9: {message:"ReplacementRefused"},
  /**
   * `derive_target`: the ZK enrollment is missing, unexpected, or reuses the enrolled id.
   */
  10: {message:"ZkEnrollmentMismatch"},
  /**
   * `derive_target`: the target has no constraint-free self-admin rule with a signer (the anti-brick check).
   */
  11: {message:"AdminLockout"}
}


/**
 * The canonical form and fragment hashes a compiler produces, as
 * [`PerchDocCompiler::capabilities`] returns them.
 */
export interface CompilerCapabilities {
  /**
 * The CANON version `doc_hash` is `sha256` of (`CANONICAL.md`).
 */
canon_version: u32;
  /**
 * The domain tag of a recovery member's `config_hash` (spec §3.2).
 */
config_hash_tag: string;
  /**
 * The domain tag of a rule's `rule_hash` (spec §3.2).
 */
rule_hash_tag: string;
}


/**
 * `rule_eval::ZkFactor`.
 */
export interface ModelZk {
  adapter: string;
  pool: string;
}


/**
 * `rule_eval::ArgConstraint`.
 */
export interface ModelArg {
  index: u32;
  pred: ModelPred;
}


/**
 * `rule_eval::DocCap`.
 */
export interface ModelCap {
  limit: i128;
  period_ledgers: u32;
}

/**
 * `rule_eval::Pred`.
 */
export type ModelPred = {tag: "IsSelf", values: void} | {tag: "AddressEq", values: readonly [string]} | {tag: "StringIn", values: readonly [Array<string>]} | {tag: "StringPrefix", values: readonly [string]} | {tag: "U32Eq", values: readonly [u32]};


/**
 * `rule_eval::DocRule`.
 */
export interface ModelRule {
  args: Option<Array<ModelArg>>;
  /**
 * Zero or one entries: `#[contracttype]` has no `Option` of a
 * `#[contracttype]` struct.
 */
cap: Array<ModelCap>;
  functions: Option<Array<string>>;
  not_after_ledger: Option<u32>;
  principals: ModelPrincipals;
  scope: ModelScope;
}

/**
 * `rule_eval::Scope`.
 */
export type ModelScope = {tag: "Contract", values: readonly [string]} | {tag: "SelfAdmin", values: void};


/**
 * `rule_eval::SignerDecl`.
 */
export interface ModelSigner {
  id: string;
  signer: Signer;
}


/**
 * `rule_eval::Doc`.
 */
export interface CompiledModel {
  /**
 * Zero or one entries.
 */
recovery: Array<ModelRecovery>;
  rules: Array<ModelRule>;
  signers: Array<ModelSigner>;
}


/**
 * `rule_eval::Recovery`.
 */
export interface ModelRecovery {
  controller: string;
  /**
 * Zero or one entries.
 */
zk: Array<ModelZk>;
}

/**
 * `rule_eval::Principals`: signer ids.
 */
export type ModelPrincipals = {tag: "All", values: readonly [Array<string>]} | {tag: "Threshold", values: readonly [Array<string>, u32]};


/**
 * `rule_eval::Cap`.
 */
export interface StoredCap {
  amount_arg: u32;
  limit: i128;
  period: u32;
}

/**
 * `rule_eval::Val`.
 */
export type StoredVal = {tag: "I128", values: readonly [i128]} | {tag: "U64", values: readonly [u64]} | {tag: "Bool", values: readonly [boolean]} | {tag: "Bytes", values: readonly [Buffer]} | {tag: "Address", values: readonly [string]} | {tag: "Symbol", values: readonly [string]} | {tag: "String", values: readonly [string]} | {tag: "Other", values: readonly [Buffer]};

/**
 * `rule_eval::Cond`.
 */
export type StoredCond = {tag: "ArgEq", values: readonly [u32, StoredVal]} | {tag: "ArgI128AtMost", values: readonly [u32, i128]} | {tag: "ArgIn", values: readonly [u32, Array<StoredVal>]} | {tag: "ArgStrPrefix", values: readonly [u32, string]};


/**
 * `rule_eval::Rule`.
 */
export interface StoredRule {
  /**
 * Zero or one entries: `#[contracttype]` has no `Option` of a
 * `#[contracttype]` struct.
 */
cap: Array<StoredCap>;
  conds: Array<StoredCond>;
  contract: string;
  functions: StoredFunctions;
  generation: Option<u64>;
  signers: Array<Signer>;
  threshold: u32;
  valid_until: Option<u32>;
}


/**
 * `rule_eval::SpendEntry`.
 */
export interface StoredEntry {
  amount: i128;
  ledger: u32;
}


/**
 * `rule_eval::SpendRecord`.
 */
export interface StoredRecord {
  history: Array<StoredEntry>;
  total: i128;
}

/**
 * `rule_eval::Functions`.
 */
export type StoredFunctions = {tag: "AnyExcept", values: readonly [Array<string>]} | {tag: "Only", values: readonly [Array<string>]};


/**
 * What a completion hands back to the account.
 */
export interface Completion {
  /**
 * The attempt that completed.
 */
attempt_id: u64;
  /**
 * The credentials that occupied the replaced signer slots **in the
 * attempt's source document**, as derived at T1: the applied document
 * for lost-key, the baseline for compromise. The account fingerprints
 * them over canonical keys and revokes them together with every
 * credential the completion removed from its current document. Without
 * these, a baseline credential replaced by a compromise recovery, and
 * already absent from the current document, would stay unrevoked and
 * could be restored by a later recovery from the same baseline.
 */
replaced: Array<Credential>;
}

/**
 * What `rcv_sync` did, so the account knows which of its own effects to
 * apply (spec §10).
 */
export type SyncOutcome = {tag: "Unchanged", values: void} | {tag: "Enrolled", values: void} | {tag: "Reconfigured", values: void} | {tag: "Removed", values: void} | {tag: "Completed", values: readonly [Completion]};

/**
 * Which phase of an account upgrade `rcv_upgrade` is checking (spec §12).
 */
export type UpgradeStep = {tag: "Schedule", values: readonly [UpgradeSubject, u32]} | {tag: "Execute", values: readonly [u64]};


/**
 * The account's recovery rule, as the hooks that serve it are told of it
 * (spec §10): `rcv_install` when the account installs the rule, and
 * `rcv_complete` for each context a completion selects it for. A
 * controller serves only a rule that requires no signer and authorizes
 * calls on the account alone, and refuses any other with
 * `MalformedContextRule`.
 */
export interface RecoveryRule {
  /**
 * The contract the rule authorizes calls on, when it is scoped to one
 * contract's calls; `None` for any other scope.
 */
contract: Option<string>;
  /**
 * How many signers the rule requires.
 */
signers: u32;
}

/**
 * Everything a recovery controller can refuse. Codes are sequential from 1
 * in declaration order and are wire format: append new variants at the
 * end, never reorder.
 */
export const RecoveryError = {
  /**
   * No configuration is enrolled for this account at this controller.
   */
  1: {message:"NotEnrolled"},
  /**
   * An attempt is authorized and live, which blocks begin, policy changes, and upgrades.
   */
  2: {message:"AttemptAuthorized"},
  /**
   * No attempt with this id exists for the account.
   */
  3: {message:"NoSuchAttempt"},
  /**
   * The attempt is terminal, expired, from an older epoch, or invalidated by a sibling's authorization.
   */
  4: {message:"AttemptNotLive"},
  /**
   * Initiation evidence for an attempt that is no longer collecting.
   */
  5: {message:"AttemptNotCollecting"},
  /**
   * Completion before `executable_after`.
   */
  6: {message:"NotExecutableYet"},
  /**
   * The completion context, or the compiled document hash, does not match the authorized attempt's target.
   */
  7: {message:"WrongTarget"},
  /**
   * The address is not an enrolled guardian.
   */
  8: {message:"NotAGuardian"},
  /**
   * This guardian or factor already counted for this statement.
   */
  9: {message:"AlreadyCounted"},
  /**
   * The enrolled mode has no guardian factor.
   */
  10: {message:"ModeHasNoGuardians"},
  /**
   * The enrolled mode has no ZK factor.
   */
  11: {message:"ModeHasNoZk"},
  /**
   * The adapter refused the proof (its `ZkAdapterError` says why).
   */
  12: {message:"ZkEvidenceRejected"},
  /**
   * The proof's nullifier is spent.
   */
  13: {message:"NullifierSpent"},
  /**
   * The statement's freshness bound has passed or reaches too far.
   */
  14: {message:"EvidenceExpired"},
  /**
   * The statement cannot be encoded (a non-contract account or controller).
   */
  15: {message:"InvalidStatement"},
  /**
   * Recorded approvals do not satisfy the enrolled condition for this reconfiguration or upgrade.
   */
  16: {message:"ConditionNotMet"},
  /**
   * The account's `max-cancels` is used up.
   */
  17: {message:"MaxCancelsReached"},
  /**
   * Owner cancellation is only available under `Loss`.
   */
  18: {message:"OwnerCancelRefused"},
  /**
   * The replacement set breaks a §7.3 rule, or derivation refused it.
   */
  19: {message:"InvalidReplacements"},
  /**
   * The target or a replacement contains a revoked credential.
   */
  20: {message:"CredentialRevoked"},
  /**
   * The ZK enrollment id was enrolled for this account before.
   */
  21: {message:"EnrollmentIdReused"},
  /**
   * Compromise recovery with no baseline enrolled.
   */
  22: {message:"NoBaseline"},
  /**
   * Compromise recovery before the baseline's content was published.
   */
  23: {message:"BaselineNotPublished"},
  /**
   * The published document does not hash to the enrolled baseline.
   */
  24: {message:"BaselineMismatch"},
  /**
   * The adapter's circuit id or tree depth does not match the enrolled factor and pool.
   */
  25: {message:"ZkWiringMismatch"},
  /**
   * The ZK factor changed without a new enrollment id.
   */
  26: {message:"ZkFactorChangedInPlace"},
  /**
   * The configuration is malformed.
   */
  27: {message:"InvalidConfiguration"},
  /**
   * An upgrade request recorded under an older epoch.
   */
  28: {message:"StaleUpgrade"},
  /**
   * A ledger-sequence computation overflowed `u32`.
   */
  29: {message:"LedgerOverflow"},
  /**
   * A hook was called for a recovery rule of the wrong shape.
   */
  30: {message:"MalformedContextRule"},
  /**
   * The target keeps a credential the replacement set replaces.
   */
  31: {message:"ReplacedCredentialRetained"}
}

/**
 * A signer credential, shaped like OZ `stellar_accounts::smart_account::Signer`.
 */
export type Credential = {tag: "Delegated", values: readonly [string]} | {tag: "External", values: readonly [string, Buffer]};


/**
 * One designated signer slot and the credential that replaces whatever
 * that slot holds in the source document.
 */
export interface Replacement {
  /**
 * The credential the target document gives that signer id.
 */
credential: Credential;
  /**
 * A document signer id listed in the enrolled `recovery.replaceable`.
 */
signer_id: string;
}


/**
 * A ZK enrollment a recovery completion installs.
 * 
 * The commitment is bound here, not only the id: completion runs under the
 * zero-signer recovery rule, so nothing signs its arguments, and a
 * commitment supplied only at completion could be swapped by whoever
 * submits the completing transaction first — handing them the account's
 * next ZK factor.
 */
export interface ZkEnrollment {
  /**
 * The new leaf's inner commitment, `Poseidon2(DOM_LEAF, secret)`.
 * Derivation writes `id` and `commitment` into the target document's
 * recovery section, so the target hash binds them, and the completing
 * `apply_doc` inserts the leaf from the compiled target, never from a
 * call argument.
 */
commitment: Buffer;
  /**
 * The new enrollment id. Must never have been enrolled for this
 * account before.
 */
id: Buffer;
}


/**
 * Everything a `LostKey`/`Compromise` attempt changes about the source
 * document. See `docs/recovery/spec.md` §7.
 */
export interface ReplacementSet {
  /**
 * Signer replacements in strictly ascending `signer_id` byte order
 * (sorted, no duplicates) — the one canonical order.
 */
signers: Array<Replacement>;
  /**
 * The fresh ZK enrollment the completion installs, required exactly
 * when the enrolled mode has a ZK factor (a ZK-evidenced completion
 * consumes the enrolled credential, so it must install a fresh one).
 * Empty or one entry — a `Vec` because `#[contracttype]` cannot derive
 * `Option<CustomStruct>`.
 */
zk_enrollment: Array<ZkEnrollment>;
}


/**
 * Which enrolled ZK factor a statement is checked against. The controller
 * builds this from its stored configuration — never from caller input.
 */
export interface ZkBinding {
  /**
 * The circuit identity the enrolling document named. The adapter
 * refuses any binding whose `circuit_id` is not its own.
 */
circuit_id: Buffer;
  /**
 * The enrolled credential's id, bound into its leaf and its nullifier.
 * A leaf enrolled under any other id — including the account's own
 * earlier enrollments — cannot satisfy a proof for this binding.
 */
enrollment_id: Buffer;
  /**
 * The enrolled membership pool. Roots are accepted only from this pool.
 */
pool: string;
}


/**
 * One ZK proof as submitted.
 */
export interface ZkEvidence {
  /**
 * The credential's nullifier (the circuit's second public input).
 */
nullifier: Buffer;
  /**
 * The serialized proof.
 */
proof: Buffer;
  /**
 * The root the proof was generated against; must be acceptable to the
 * enrolled pool for `tree_id`.
 */
root: Buffer;
  /**
 * The pool tree the proof's Merkle path is in.
 */
tree_id: u32;
}

/**
 * Everything [`ZkAdapterInterface::verify`] can refuse. Each is a refusal
 * of this evidence only; none is a statement about the account.
 */
export const ZkAdapterError = {
  /**
   * The binding names a circuit this adapter does not verify.
   */
  1: {message:"CircuitMismatch"},
  /**
   * The statement cannot be projected (its account or controller is not a contract address).
   */
  2: {message:"InvalidStatement"},
  /**
   * The root or nullifier is not a canonical field element.
   */
  3: {message:"NonCanonicalField"},
  /**
   * The enrolled pool does not accept `(tree_id, root)`.
   */
  4: {message:"UnknownRoot"},
  /**
   * The enrolled pool could not be called.
   */
  5: {message:"PoolUnavailable"},
  /**
   * The proof is not the length/shape the circuit produces.
   */
  6: {message:"MalformedProof"},
  /**
   * The verifier rejected the proof.
   */
  7: {message:"ProofRejected"},
  /**
   * The verifier could not be called or failed to parse its own key.
   */
  8: {message:"VerifierUnavailable"}
}

/**
 * A backend verifier's refusals. Same names, order, and codes (1, 2, 3)
 * as Nido's constructorless `nido-recovery-verifier`, so either can sit
 * behind an adapter unchanged.
 */
export const ProofVerifierError = {
  /**
   * The verification key could not be parsed.
   */
  1: {message:"VkParseError"},
  /**
   * The proof could not be parsed (for example, it has the wrong length).
   */
  2: {message:"ProofParseError"},
  /**
   * The proof does not verify against the public inputs.
   */
  3: {message:"VerificationFailed"}
}

/**
 * Who may change the recovery configuration, and whether an authorized
 * attempt freezes ordinary activity (spec §2, §9).
 */
export type RecoveryProfile = {tag: "Loss", values: void} | {tag: "Protected", values: void};


/**
 * The ZK factor (spec §3.1, §3.4).
 */
export interface CompiledZkFactor {
  /**
 * The constructorless ZK adapter the controller calls.
 */
adapter: string;
  /**
 * `sha256` of the adapter's verification key; must equal the adapter's
 * `circuit_id()`.
 */
circuit_id: Buffer;
  /**
 * The current credential's inner commitment, `Poseidon2(DOM_LEAF,
 * secret)`, from which the account inserts the leaf.
 */
commitment: Buffer;
  /**
 * The current credential's id, bound into its leaf and nullifier.
 */
enrollment_id: Buffer;
  /**
 * The membership pool roots are accepted from.
 */
pool: string;
}


/**
 * The guardian factor.
 */
export interface CompiledGuardianSet {
  /**
 * Guardian addresses (`G...` or `C...`), never the account itself.
 */
guardians: Array<string>;
  /**
 * `1 <= quorum <= guardians.len()`.
 */
quorum: u32;
}

/**
 * Which factors a statement needs.
 */
export type CompiledRecoveryMode = {tag: "GuardianOnly", values: readonly [CompiledGuardianSet]} | {tag: "ZkOnly", values: readonly [CompiledZkFactor]} | {tag: "Combined", values: readonly [CompiledGuardianSet, CompiledZkFactor]};


/**
 * A compiled `recovery` member.
 */
export interface CompiledRecoveryConfig {
  /**
 * The enrolled baseline's canonical document hash, if compromise
 * recovery is enrolled.
 */
baseline: Option<Buffer>;
  /**
 * [`config_hash`] of the canonical JSON of the recovery member, computed
 * by the doc compiler (spec §3.2). Configuration
 * identity: two compiled configurations with the same `config_hash` are
 * the same configuration.
 */
config_hash: Buffer;
  /**
 * The adopted controller instance.
 */
controller: string;
  /**
 * Ledgers from an attempt's authorization until it can complete.
 */
delay_ledgers: u32;
  /**
 * The evidence window of a collecting attempt and the completion
 * window of an authorized one, in ledgers.
 */
expiry_ledgers: u32;
  /**
 * Lifetime cap on evidence-based cancellations of authorized attempts.
 */
max_cancels: u32;
  /**
 * The factors evidence must satisfy.
 */
mode: CompiledRecoveryMode;
  /**
 * Who may change the configuration, and whether an authorized attempt
 * freezes the account.
 */
profile: RecoveryProfile;
  /**
 * Signer ids (not credential fingerprints) a recovery may replace, so
 * rotating a key does not change the configuration (#92).
 */
replaceable: Array<string>;
}


/**
 * A pending account upgrade.
 */
export interface UpgradeRequest {
  /**
 * The adopted controller's epoch when scheduled, if any.
 */
controller_epoch: Option<u64>;
  /**
 * The first ledger at which the request may execute.
 */
executable_at: u32;
  /**
 * The account's recovery generation when the request was scheduled.
 */
generation: u64;
  /**
 * Per-account, never reused.
 */
request_id: u64;
  /**
 * The exact Wasm the account will run.
 */
wasm_hash: Buffer;
}

/**
 * What a `Reconfigure` statement changes the enrolled configuration to.
 */
export type ConfigChange = {tag: "Remove", values: void} | {tag: "Set", values: readonly [Buffer]};


/**
 * The subject of a `Cancel` statement.
 */
export interface CancelSubject {
  /**
 * The attempt being cancelled.
 */
attempt_id: u64;
  /**
 * That attempt's own initiation statement digest, so cancellation
 * evidence names exactly one proposal, not just an id.
 */
attempt_statement: Buffer;
}


/**
 * The enrolled configuration a statement is evaluated against.
 */
export interface ConfigBinding {
  /**
 * `sha256("perch/recovery/config" || canonical JSON of the enrolled
 * document's recovery member)`, as [`crate::config::config_hash`]
 * computes it (`docs/recovery/spec.md` §3.2). Binds the whole
 * configuration: profile, mode, guardians, quorum, ZK adapter, circuit
 * id, pool, enrollment id and commitment, controller, baseline,
 * replaceable signer ids, and timing.
 */
config_hash: Buffer;
  /**
 * The controller's per-account configuration epoch. It increments on
 * every enrollment, reconfiguration, removal, completed recovery, and
 * executed account upgrade, so evidence produced under one epoch is
 * dead under every later one.
 */
epoch: u64;
}


/**
 * The subject of a `LostKey` or `Compromise` attempt.
 */
export interface AttemptSubject {
  /**
 * The controller-assigned, per-account, never-reused attempt id.
 */
attempt_id: u64;
  /**
 * [`crate::credential::ReplacementSet::hash`] of the declared
 * replacements.
 */
replacements_hash: Buffer;
  /**
 * `LostKey`: the canonical hash of the account's applied document when
 * the attempt began (the agreed snapshot). `Compromise`: the enrolled
 * baseline's canonical hash.
 */
source_doc_hash: Buffer;
  /**
 * The canonical hash of the target document, derived on-chain from
 * the source and the replacement set — never caller-chosen.
 */
target_doc_hash: Buffer;
}

/**
 * The action domain a statement authorizes. Evidence for one action never
 * satisfies another: the action code is the encoding's 26th byte and selects
 * the subject layout, so two statements that differ only in action have
 * different digests (and different encoded lengths for most pairs).
 * 
 * The numeric codes are part of the wire format.
 */
export enum RecoveryAction {
  LostKey = 1,
  Compromise = 2,
  Cancel = 3,
  Reconfigure = 4,
  Upgrade = 5,
}

/**
 * Everything encoding a statement or its parts can refuse.
 */
export const StatementError = {
  /**
   * `account` is not a contract (`C...`) address.
   */
  1: {message:"AccountNotContract"},
  /**
   * `controller` is not a contract (`C...`) address.
   */
  2: {message:"ControllerNotContract"},
  /**
   * A credential names an address shape the recovery stack does not accept (muxed, claimable-balance, liquidity-pool, ...).
   */
  3: {message:"UnsupportedAddress"},
  /**
   * A replacement set's signer ids are not strictly ascending (sorted, no duplicates), so it has no single canonical encoding.
   */
  4: {message:"ReplacementsNotCanonical"},
  /**
   * A replacement set replaces nothing.
   */
  5: {message:"EmptyReplacements"},
  /**
   * The current ledger is past the statement's `valid_until_ledger`.
   */
  6: {message:"EvidenceExpired"},
  /**
   * A provider-chosen `valid_until_ledger` reaches further past the current ledger than the enrolled `expiry_ledgers` allows.
   */
  7: {message:"EvidenceWindowTooLong"}
}


/**
 * The subject of an `Upgrade` statement.
 */
export interface UpgradeSubject {
  /**
 * The account's per-account, never-reused upgrade request id.
 */
request_id: u64;
  /**
 * The exact Wasm hash the account would run after the upgrade.
 */
wasm_hash: Buffer;
}


/**
 * Timing terms, all in ledger-sequence units.
 */
export interface StatementTiming {
  /**
 * The enrolled `delay-ledgers`: ledgers between an attempt becoming
 * authorized and becoming completable.
 */
delay_ledgers: u32;
  /**
 * The enrolled `expiry-ledgers`: the evidence window for a collecting
 * attempt, the completion window for an authorized one, and the upper
 * bound on how far ahead a provider-chosen `valid_until_ledger` may
 * reach.
 */
expiry_ledgers: u32;
  /**
 * The last ledger sequence (inclusive) at which this evidence may be
 * accepted. The controller fixes it for attempt-bound actions:
 * `LostKey`/`Compromise` use the attempt's evidence deadline, and
 * `Cancel` the last ledger the attempt could possibly be live, so
 * approvals collected over several transactions all sign one
 * statement. For `Reconfigure`/`Upgrade` the evidence provider chooses
 * it, within `expiry_ledgers` of submission.
 */
valid_until_ledger: u32;
}

/**
 * The action-specific part of a statement. The variant determines
 * [`RecoveryStatement::action`]; there is no separate action field that
 * could disagree with it.
 */
export type StatementSubject = {tag: "LostKey", values: readonly [AttemptSubject]} | {tag: "Compromise", values: readonly [AttemptSubject]} | {tag: "Cancel", values: readonly [CancelSubject]} | {tag: "Reconfigure", values: readonly [ConfigChange]} | {tag: "Upgrade", values: readonly [UpgradeSubject]};


/**
 * The one recovery statement. See the module docs.
 */
export interface RecoveryStatement {
  /**
 * The recovering account. Must be a contract address.
 */
account: string;
  /**
 * The enrolled configuration and epoch the evidence is for.
 */
config: ConfigBinding;
  /**
 * The controller instance evaluating the evidence (for `Reconfigure`,
 * the currently adopted one, even when the change adopts another).
 * Must be a contract address.
 */
controller: string;
  /**
 * The network id (`sha256` of the network passphrase), as
 * `Env::ledger().network_id()` returns it.
 */
network_id: Buffer;
  /**
 * What the evidence approves.
 */
subject: StatementSubject;
  /**
 * The enrolled timing terms and the evidence's freshness bound.
 */
timing: StatementTiming;
}

/**
 * Represents different types of signers in the smart account system.
 */
export type Signer = {tag: "Delegated", values: readonly [string]} | {tag: "External", values: readonly [string, Buffer]};


/**
 * The authorization payload passed to `__check_auth`, bundling cryptographic
 * proofs with context rule selection.
 * 
 * This struct carries two distinct pieces of information that are both
 * required for authorization but cannot be derived from each other:
 * 
 * - `signers` maps each [`Signer`] to its raw signature bytes, providing
 * cryptographic proof that the signer actually signed the transaction
 * payload. A context rule stores which signer *identities* are authorized
 * (via `signer_ids`), but the rule does not contain the signatures
 * themselves — those must be supplied here.
 * 
 * - `context_rule_ids` tells the system which rule to validate for each auth
 * context. Because multiple rules can exist for the same context type, the
 * caller must explicitly select one per context rather than relying on
 * auto-discovery. Each entry is aligned by index with the `auth_contexts`
 * passed to `__check_auth`.
 * 
 * The length of `context_rule_ids` must equal the number of auth contexts;
 * a mismatch is rejected with
 * [`SmartAccountError::ContextRuleIdsLen
 */
export interface AuthPayload {
  /**
 * Per-context rule IDs, aligned by index with `auth_contexts`.
 */
context_rule_ids: Array<u32>;
  /**
 * Signature data mapped to each signer.
 */
signers: Map<Signer, Buffer>;
}


/**
 * A complete context rule defining authorization requirements.
 */
export interface ContextRule {
  /**
 * The type of context this rule applies to.
 */
context_type: ContextRuleType;
  /**
 * Unique identifier for the context rule.
 */
id: u32;
  /**
 * Human-readable name for the context rule.
 */
name: string;
  /**
 * List of policy contracts that must be satisfied.
 */
policies: Array<string>;
  /**
 * Global registry IDs for each policy, positionally aligned with
 * `policies`.
 */
policy_ids: Array<u32>;
  /**
 * Global registry IDs for each signer, positionally aligned with
 * `signers`.
 */
signer_ids: Array<u32>;
  /**
 * List of signers authorized by this rule.
 */
signers: Array<Signer>;
  /**
 * Optional expiration ledger sequence for the rule.
 */
valid_until: Option<u32>;
}

/**
 * Types of contexts that can be authorized by smart account rules.
 */
export type ContextRuleType = {tag: "Default", values: void} | {tag: "CallContract", values: readonly [string]} | {tag: "CreateContract", values: readonly [Buffer]} | {tag: "CreateContractExternalRef", values: readonly [string, string]};

/**
 * Error codes for smart account operations.
 */
export const SmartAccountError = {
  /**
   * The specified context rule does not exist.
   */
  3000: {message:"ContextRuleNotFound"},
  /**
   * The provided context cannot be validated against any rule.
   */
  3002: {message:"UnvalidatedContext"},
  /**
   * External signature verification failed.
   */
  3003: {message:"ExternalVerificationFailed"},
  /**
   * context_rule_ids length does not match auth_contexts length.
   */
  3014: {message:"ContextRuleIdsLengthMismatch"},
  /**
   * A signer in `AuthPayload` is not part of any selected context rule.
   */
  3016: {message:"UnauthorizedSigner"}
}

/**
 * Contract executable used for creating a new contract and used in
 * `CreateContractHostFnContext`.
 */
export type ContractExecutable = {tag: "Wasm", values: readonly [Buffer]} | {tag: "ExternalRef", values: readonly [ContractExecutableRef]};


/**
 * Executable referenced via a persistent storage entry owned by a contract,
 * either this contract or another contract.
 * 
 * The persistent storage entry owned by the `owner` has the `tag` as its key.
 */
export interface ContractExecutableRef {
  owner: string;
  tag: string;
}

/**
 * Context of a single authorized call performed by an address.
 * 
 * Custom account contracts that implement `__check_auth` special function
 * receive a list of `Context` values corresponding to all the calls that
 * need to be authorized.
 */
export type Context = {tag: "Contract", values: readonly [ContractContext]} | {tag: "CreateContractHostFn", values: readonly [CreateContractHostFnContext]} | {tag: "CreateContractWithCtorHostFn", values: readonly [CreateContractWithConstructorHostFnContext]};


/**
 * Authorization context of a single contract call.
 * 
 * This struct corresponds to a `require_auth_for_args` call for an address
 * from `contract` function with `fn_name` name and `args` arguments.
 */
export interface ContractContext {
  args: Array<any>;
  contract: string;
  fn_name: string;
}


/**
 * Value of contract node in InvokerContractAuthEntry tree.
 */
export interface SubContractInvocation {
  context: ContractContext;
  sub_invocations: Array<InvokerContractAuthEntry>;
}

/**
 * A node in the tree of authorizations performed on behalf of the current
 * contract as invoker of the contracts deeper in the call stack.
 * 
 * This is used as an argument of `authorize_as_current_contract` host function.
 * 
 * This tree corresponds `require_auth[_for_args]` calls on behalf of the
 * current contract.
 */
export type InvokerContractAuthEntry = {tag: "Contract", values: readonly [SubContractInvocation]} | {tag: "CreateContractHostFn", values: readonly [CreateContractHostFnContext]} | {tag: "CreateContractWithCtorHostFn", values: readonly [CreateContractWithConstructorHostFnContext]};


/**
 * Authorization context for `create_contract` host function that creates a
 * new contract on behalf of authorizer address.
 */
export interface CreateContractHostFnContext {
  executable: ContractExecutable;
  salt: Buffer;
}


/**
 * Authorization context for `create_contract` host function that creates a
 * new contract on behalf of authorizer address.
 * This is the same as `CreateContractHostFnContext`, but also has
 * contract constructor arguments.
 */
export interface CreateContractWithConstructorHostFnContext {
  constructor_args: Array<any>;
  executable: ContractExecutable;
  salt: Buffer;
}

export type Executable = {tag: "Wasm", values: readonly [Buffer]} | {tag: "StellarAsset", values: void} | {tag: "Account", values: void};

export interface Client {
  /**
   * Construct and simulate a infra transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Every shared contract this account pins at build time.
   */
  infra: (options?: MethodOptions) => Promise<AssembledTransaction<InfraPins>>

  /**
   * Construct and simulate a renew transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend the account's instance, document, and the named revoked and
   * enrolled entries to the maximum TTL. Permissionless.
   */
  renew: ({fingerprints, enrollment_ids}: {fingerprints: Array<Buffer>, enrollment_ids: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a scope transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The scoped document under `scope` as applied, if any.
   */
  scope: ({scope}: {scope: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<ScopeRecord>>>

  /**
   * Construct and simulate a scopes transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The scope ids at index positions `start..start + count`, wiped ones
   * included.
   */
  scopes: ({start, count}: {start: u32, count: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<u32>>>

  /**
   * Construct and simulate a execute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Call `target_fn` on `target` as this account. Owner authorization;
   * refuses invoker-only hooks.
   */
  execute: ({target, target_fn, target_args}: {target: string, target_fn: string, target_args: Array<any>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<any>>>

  /**
   * Construct and simulate a document transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The applied admin document's canonical bytes, with the revision they
   * belong to.
   */
  document: (options?: MethodOptions) => Promise<AssembledTransaction<readonly [u64, Option<Buffer>]>>

  /**
   * Construct and simulate a gc_scope transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove a scoped document a recovery wiped, and its rules.
   * Permissionless.
   */
  gc_scope: ({scope}: {scope: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a rcv_gate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Invoker-only: the adopted controller sets (`frozen_until > 0`) or clears
   * (`0`) the `Protected` freeze.
   */
  rcv_gate: ({attempt_id, frozen_until}: {attempt_id: u64, frozen_until: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a revision transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The configuration revision: advanced by every `apply_doc` and executed
   * upgrade; never repeats.
   */
  revision: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a rule_set transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The rule-eval rules `__check_auth` evaluates, aligned with
   * `installed_rules`.
   */
  rule_set: (options?: MethodOptions) => Promise<AssembledTransaction<Array<StoredRule>>>

  /**
   * Construct and simulate a apply_doc transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Apply the admin document and return its `doc_hash`. Owner
   * authorization, or the recovery rule for a completion. Refuses
   * `StaleRevision` unless the account is at `expected_revision`, if given.
   * `approval_valid_until` bounds a `Protected` reconfiguration's approvals.
   */
  apply_doc: ({doc_json, approval_valid_until, expected_revision}: {doc_json: Buffer, approval_valid_until: u32, expected_revision: Option<u64>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a is_revoked transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Whether a credential fingerprint is permanently revoked.
   */
  is_revoked: ({fingerprint}: {fingerprint: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a applied_doc transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The applied admin document's canonical bytes, if any.
   */
  applied_doc: (options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a apply_scope transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Apply a scoped document under `scope` and return its `doc_hash`. Owner
   * authorization.
   */
  apply_scope: ({scope, doc_json}: {scope: u32, doc_json: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a scope_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * How many scope ids have a record, wiped ones included.
   */
  scope_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a capabilities transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Constants of this wasm: interface and snapshot versions, digest schemes,
   * and apply modes.
   */
  capabilities: (options?: MethodOptions) => Promise<AssembledTransaction<AccountCapabilities>>

  /**
   * Construct and simulate a doc_compiler transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The doc compiler this account pins at build time.
   */
  doc_compiler: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a remove_scope transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove the scoped document under `scope` and its rules. Owner
   * authorization.
   */
  remove_scope: ({scope}: {scope: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a configuration transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The admin document's configuration, read at one ledger.
   */
  configuration: (options?: MethodOptions) => Promise<AssembledTransaction<AccountConfiguration>>

  /**
   * Construct and simulate a recovery_gate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The `Protected` freeze, if set; in force while the ledger is below
   * `until`.
   */
  recovery_gate: (options?: MethodOptions) => Promise<AssembledTransaction<Option<FreezeGate>>>

  /**
   * Construct and simulate a cancel_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Cancel the pending upgrade. Owner authorization.
   */
  cancel_upgrade: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a is_enrolled_id transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Whether this account ever enrolled a ZK enrollment id.
   */
  is_enrolled_id: ({enrollment_id}: {enrollment_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a scope_rule_set transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The rule-eval rules of the scoped document under `scope`, aligned with
   * its record's rules.
   */
  scope_rule_set: ({scope}: {scope: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<StoredRule>>>

  /**
   * Construct and simulate a cancel_recovery transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * A `Loss` owner's cancellation of a recovery attempt.
   */
  cancel_recovery: ({attempt_id}: {attempt_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a execute_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Execute the pending upgrade once its delay has passed. Owner
   * authorization. Refuses `StaleUpgrade` if the recovery generation moved
   * since scheduling.
   */
  execute_upgrade: ({request_id}: {request_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a installed_rules transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Every context rule the admin document installed, with its id.
   */
  installed_rules: (options?: MethodOptions) => Promise<AssembledTransaction<Array<InstalledRule>>>

  /**
   * Construct and simulate a pending_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The scheduled upgrade, if any.
   */
  pending_upgrade: (options?: MethodOptions) => Promise<AssembledTransaction<Option<UpgradeRequest>>>

  /**
   * Construct and simulate a applied_doc_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The applied admin document's canonical `doc_hash`, if any.
   */
  applied_doc_hash: (options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a get_context_rule transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The context rule with this id; panics if there is none.
   */
  get_context_rule: ({context_rule_id}: {context_rule_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<ContextRule>>

  /**
   * Construct and simulate a schedule_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Schedule an upgrade to `wasm_hash` after the upgrade delay, replacing
   * any pending one, and return its id. Owner authorization; under
   * `Protected`, also approvals fresh until `approval_valid_until`.
   */
  schedule_upgrade: ({wasm_hash, approval_valid_until}: {wasm_hash: Buffer, approval_valid_until: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a scope_generation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The scope generation: advanced only by completed recoveries. A scope
   * applied under another is wiped.
   */
  scope_generation: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a scope_signer_ids transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The signer ids of the scoped document under `scope`, in declaration
   * order, if any: with its rules, they give back its canonical text.
   */
  scope_signer_ids: ({scope}: {scope: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Array<string>>>>

  /**
   * Construct and simulate a recovery_controller transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The adopted recovery controller, if any.
   */
  recovery_controller: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a recovery_generation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The account's recovery generation.
   */
  recovery_generation: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a scope_verifier_names transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Each signer's `verifier-name` in the scoped document under `scope`,
   * aligned with `scope_signer_ids`, if any: empty where a signer has
   * none, and no entries when no signer has one.
   */
  scope_verifier_names: ({scope}: {scope: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Array<string>>>>

  /**
   * Construct and simulate a credential_generation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The last scope generation a scoped document named this credential under,
   * if any.
   */
  credential_generation: ({fingerprint}: {fingerprint: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<u64>>>

  /**
   * Construct and simulate a get_context_rules_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The count of context rules, scoped and expired ones included.
   */
  get_context_rules_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a next_upgrade_request_id transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The id the next `schedule_upgrade` assigns.
   */
  next_upgrade_request_id: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin_signers}: {admin_signers: Array<Signer>},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin_signers}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAADZFdmVyeSBzaGFyZWQgY29udHJhY3QgdGhpcyBhY2NvdW50IHBpbnMgYXQgYnVpbGQgdGltZS4AAAAAAAVpbmZyYQAAAAAAAAAAAAABAAAH0AAAAAlJbmZyYVBpbnMAAAA=",
        "AAAAAAAAAHdFeHRlbmQgdGhlIGFjY291bnQncyBpbnN0YW5jZSwgZG9jdW1lbnQsIGFuZCB0aGUgbmFtZWQgcmV2b2tlZCBhbmQKZW5yb2xsZWQgZW50cmllcyB0byB0aGUgbWF4aW11bSBUVEwuIFBlcm1pc3Npb25sZXNzLgAAAAAFcmVuZXcAAAAAAAACAAAAAAAAAAxmaW5nZXJwcmludHMAAAPqAAAD7gAAACAAAAAAAAAADmVucm9sbG1lbnRfaWRzAAAAAAPqAAAD7gAAACAAAAAA",
        "AAAAAAAAADVUaGUgc2NvcGVkIGRvY3VtZW50IHVuZGVyIGBzY29wZWAgYXMgYXBwbGllZCwgaWYgYW55LgAAAAAAAAVzY29wZQAAAAAAAAEAAAAAAAAABXNjb3BlAAAAAAAABAAAAAEAAAPoAAAH0AAAAAtTY29wZVJlY29yZAA=",
        "AAAAAAAAAE1UaGUgc2NvcGUgaWRzIGF0IGluZGV4IHBvc2l0aW9ucyBgc3RhcnQuLnN0YXJ0ICsgY291bnRgLCB3aXBlZCBvbmVzCmluY2x1ZGVkLgAAAAAAAAZzY29wZXMAAAAAAAIAAAAAAAAABXN0YXJ0AAAAAAAABAAAAAAAAAAFY291bnQAAAAAAAAEAAAAAQAAA+oAAAAE",
        "AAAAAAAAAF5DYWxsIGB0YXJnZXRfZm5gIG9uIGB0YXJnZXRgIGFzIHRoaXMgYWNjb3VudC4gT3duZXIgYXV0aG9yaXphdGlvbjsKcmVmdXNlcyBpbnZva2VyLW9ubHkgaG9va3MuAAAAAAAHZXhlY3V0ZQAAAAADAAAAAAAAAAZ0YXJnZXQAAAAAABMAAAAAAAAACXRhcmdldF9mbgAAAAAAABEAAAAAAAAAC3RhcmdldF9hcmdzAAAAA+oAAAAAAAAAAQAAA+kAAAAAAAAH0AAAABFQZXJjaEFjY291bnRFcnJvcgAAAA==",
        "AAAAAAAAAE9UaGUgYXBwbGllZCBhZG1pbiBkb2N1bWVudCdzIGNhbm9uaWNhbCBieXRlcywgd2l0aCB0aGUgcmV2aXNpb24gdGhleQpiZWxvbmcgdG8uAAAAAAhkb2N1bWVudAAAAAAAAAABAAAD7QAAAAIAAAAGAAAD6AAAAA4=",
        "AAAAAAAAAElSZW1vdmUgYSBzY29wZWQgZG9jdW1lbnQgYSByZWNvdmVyeSB3aXBlZCwgYW5kIGl0cyBydWxlcy4KUGVybWlzc2lvbmxlc3MuAAAAAAAACGdjX3Njb3BlAAAAAQAAAAAAAAAFc2NvcGUAAAAAAAAEAAAAAQAAA+kAAAACAAAH0AAAABFQZXJjaEFjY291bnRFcnJvcgAAAA==",
        "AAAAAAAAAGZJbnZva2VyLW9ubHk6IHRoZSBhZG9wdGVkIGNvbnRyb2xsZXIgc2V0cyAoYGZyb3plbl91bnRpbCA+IDBgKSBvciBjbGVhcnMKKGAwYCkgdGhlIGBQcm90ZWN0ZWRgIGZyZWV6ZS4AAAAAAAhyY3ZfZ2F0ZQAAAAIAAAAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAAAAAAAADGZyb3plbl91bnRpbAAAAAQAAAABAAAD6QAAAAIAAAfQAAAAEVBlcmNoQWNjb3VudEVycm9yAAAA",
        "AAAAAAAAAF5UaGUgY29uZmlndXJhdGlvbiByZXZpc2lvbjogYWR2YW5jZWQgYnkgZXZlcnkgYGFwcGx5X2RvY2AgYW5kIGV4ZWN1dGVkCnVwZ3JhZGU7IG5ldmVyIHJlcGVhdHMuAAAAAAAIcmV2aXNpb24AAAAAAAAAAQAAAAY=",
        "AAAAAAAAAE1UaGUgcnVsZS1ldmFsIHJ1bGVzIGBfX2NoZWNrX2F1dGhgIGV2YWx1YXRlcywgYWxpZ25lZCB3aXRoCmBpbnN0YWxsZWRfcnVsZXNgLgAAAAAAAAhydWxlX3NldAAAAAAAAAABAAAD6gAAB9AAAAAKU3RvcmVkUnVsZQAA",
        "AAAAAAAAAQhBcHBseSB0aGUgYWRtaW4gZG9jdW1lbnQgYW5kIHJldHVybiBpdHMgYGRvY19oYXNoYC4gT3duZXIKYXV0aG9yaXphdGlvbiwgb3IgdGhlIHJlY292ZXJ5IHJ1bGUgZm9yIGEgY29tcGxldGlvbi4gUmVmdXNlcwpgU3RhbGVSZXZpc2lvbmAgdW5sZXNzIHRoZSBhY2NvdW50IGlzIGF0IGBleHBlY3RlZF9yZXZpc2lvbmAsIGlmIGdpdmVuLgpgYXBwcm92YWxfdmFsaWRfdW50aWxgIGJvdW5kcyBhIGBQcm90ZWN0ZWRgIHJlY29uZmlndXJhdGlvbidzIGFwcHJvdmFscy4AAAAJYXBwbHlfZG9jAAAAAAAAAwAAAAAAAAAIZG9jX2pzb24AAAAOAAAAAAAAABRhcHByb3ZhbF92YWxpZF91bnRpbAAAAAQAAAAAAAAAEWV4cGVjdGVkX3JldmlzaW9uAAAAAAAD6AAAAAYAAAABAAAD6QAAA+4AAAAgAAAH0AAAABFQZXJjaEFjY291bnRFcnJvcgAAAA==",
        "AAAAAAAAADhXaGV0aGVyIGEgY3JlZGVudGlhbCBmaW5nZXJwcmludCBpcyBwZXJtYW5lbnRseSByZXZva2VkLgAAAAppc19yZXZva2VkAAAAAAABAAAAAAAAAAtmaW5nZXJwcmludAAAAAPuAAAAIAAAAAEAAAAB",
        "AAAAAAAAADVUaGUgYXBwbGllZCBhZG1pbiBkb2N1bWVudCdzIGNhbm9uaWNhbCBieXRlcywgaWYgYW55LgAAAAAAAAthcHBsaWVkX2RvYwAAAAAAAAAAAQAAA+gAAAAO",
        "AAAAAAAAAFVBcHBseSBhIHNjb3BlZCBkb2N1bWVudCB1bmRlciBgc2NvcGVgIGFuZCByZXR1cm4gaXRzIGBkb2NfaGFzaGAuIE93bmVyCmF1dGhvcml6YXRpb24uAAAAAAAAC2FwcGx5X3Njb3BlAAAAAAIAAAAAAAAABXNjb3BlAAAAAAAABAAAAAAAAAAIZG9jX2pzb24AAAAOAAAAAQAAA+kAAAPuAAAAIAAAB9AAAAARUGVyY2hBY2NvdW50RXJyb3IAAAA=",
        "AAAAAAAAADZIb3cgbWFueSBzY29wZSBpZHMgaGF2ZSBhIHJlY29yZCwgd2lwZWQgb25lcyBpbmNsdWRlZC4AAAAAAAtzY29wZV9jb3VudAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAADdEZWNpZGUgd2hldGhlciB0aGlzIGFjY291bnQgYXV0aG9yaXplcyBgYXV0aF9jb250ZXh0c2AuAAAAAAxfX2NoZWNrX2F1dGgAAAADAAAAAAAAABFzaWduYXR1cmVfcGF5bG9hZAAAAAAAA+4AAAAgAAAAAAAAAApzaWduYXR1cmVzAAAAAAfQAAAAC0F1dGhQYXlsb2FkAAAAAAAAAAANYXV0aF9jb250ZXh0cwAAAAAAA+oAAAfQAAAAB0NvbnRleHQAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAFlDb25zdGFudHMgb2YgdGhpcyB3YXNtOiBpbnRlcmZhY2UgYW5kIHNuYXBzaG90IHZlcnNpb25zLCBkaWdlc3Qgc2NoZW1lcywKYW5kIGFwcGx5IG1vZGVzLgAAAAAAAAxjYXBhYmlsaXRpZXMAAAAAAAAAAQAAB9AAAAATQWNjb3VudENhcGFiaWxpdGllcwA=",
        "AAAAAAAAADFUaGUgZG9jIGNvbXBpbGVyIHRoaXMgYWNjb3VudCBwaW5zIGF0IGJ1aWxkIHRpbWUuAAAAAAAADGRvY19jb21waWxlcgAAAAAAAAABAAAAEw==",
        "AAAAAAAAAExSZW1vdmUgdGhlIHNjb3BlZCBkb2N1bWVudCB1bmRlciBgc2NvcGVgIGFuZCBpdHMgcnVsZXMuIE93bmVyCmF1dGhvcml6YXRpb24uAAAADHJlbW92ZV9zY29wZQAAAAEAAAAAAAAABXNjb3BlAAAAAAAABAAAAAEAAAPpAAAAAgAAB9AAAAARUGVyY2hBY2NvdW50RXJyb3IAAAA=",
        "AAAAAAAAAFpJbnN0YWxsIHJ1bGUgMCwgYGFkbWluYDogYSBzZWxmLWFkbWluIHJ1bGUgZm9yIGBhZG1pbl9zaWduZXJzYCwgd2l0aApmdWxsIG93bmVyIGF1dGhvcml0eS4AAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAAAQAAAAAAAAANYWRtaW5fc2lnbmVycwAAAAAAA+oAAAfQAAAABlNpZ25lcgAAAAAAAA==",
        "AAAAAAAAADdUaGUgYWRtaW4gZG9jdW1lbnQncyBjb25maWd1cmF0aW9uLCByZWFkIGF0IG9uZSBsZWRnZXIuAAAAAA1jb25maWd1cmF0aW9uAAAAAAAAAAAAAAEAAAfQAAAAFEFjY291bnRDb25maWd1cmF0aW9u",
        "AAAAAAAAAEtUaGUgYFByb3RlY3RlZGAgZnJlZXplLCBpZiBzZXQ7IGluIGZvcmNlIHdoaWxlIHRoZSBsZWRnZXIgaXMgYmVsb3cKYHVudGlsYC4AAAAADXJlY292ZXJ5X2dhdGUAAAAAAAAAAAAAAQAAA+gAAAfQAAAACkZyZWV6ZUdhdGUAAA==",
        "AAAAAAAAADBDYW5jZWwgdGhlIHBlbmRpbmcgdXBncmFkZS4gT3duZXIgYXV0aG9yaXphdGlvbi4AAAAOY2FuY2VsX3VwZ3JhZGUAAAAAAAAAAAABAAAD6QAAAAIAAAfQAAAAEVBlcmNoQWNjb3VudEVycm9yAAAA",
        "AAAAAAAAADZXaGV0aGVyIHRoaXMgYWNjb3VudCBldmVyIGVucm9sbGVkIGEgWksgZW5yb2xsbWVudCBpZC4AAAAAAA5pc19lbnJvbGxlZF9pZAAAAAAAAQAAAAAAAAANZW5yb2xsbWVudF9pZAAAAAAAA+4AAAAgAAAAAQAAAAE=",
        "AAAAAAAAAFpUaGUgcnVsZS1ldmFsIHJ1bGVzIG9mIHRoZSBzY29wZWQgZG9jdW1lbnQgdW5kZXIgYHNjb3BlYCwgYWxpZ25lZCB3aXRoCml0cyByZWNvcmQncyBydWxlcy4AAAAAAA5zY29wZV9ydWxlX3NldAAAAAAAAQAAAAAAAAAFc2NvcGUAAAAAAAAEAAAAAQAAA+oAAAfQAAAAClN0b3JlZFJ1bGUAAA==",
        "AAAAAAAAADRBIGBMb3NzYCBvd25lcidzIGNhbmNlbGxhdGlvbiBvZiBhIHJlY292ZXJ5IGF0dGVtcHQuAAAAD2NhbmNlbF9yZWNvdmVyeQAAAAABAAAAAAAAAAphdHRlbXB0X2lkAAAAAAAGAAAAAQAAA+kAAAACAAAH0AAAABFQZXJjaEFjY291bnRFcnJvcgAAAA==",
        "AAAAAAAAAJVFeGVjdXRlIHRoZSBwZW5kaW5nIHVwZ3JhZGUgb25jZSBpdHMgZGVsYXkgaGFzIHBhc3NlZC4gT3duZXIKYXV0aG9yaXphdGlvbi4gUmVmdXNlcyBgU3RhbGVVcGdyYWRlYCBpZiB0aGUgcmVjb3ZlcnkgZ2VuZXJhdGlvbiBtb3ZlZApzaW5jZSBzY2hlZHVsaW5nLgAAAAAAAA9leGVjdXRlX3VwZ3JhZGUAAAAAAQAAAAAAAAAKcmVxdWVzdF9pZAAAAAAABgAAAAEAAAPpAAAAAgAAB9AAAAARUGVyY2hBY2NvdW50RXJyb3IAAAA=",
        "AAAAAAAAAD1FdmVyeSBjb250ZXh0IHJ1bGUgdGhlIGFkbWluIGRvY3VtZW50IGluc3RhbGxlZCwgd2l0aCBpdHMgaWQuAAAAAAAAD2luc3RhbGxlZF9ydWxlcwAAAAAAAAAAAQAAA+oAAAfQAAAADUluc3RhbGxlZFJ1bGUAAAA=",
        "AAAAAAAAAB5UaGUgc2NoZWR1bGVkIHVwZ3JhZGUsIGlmIGFueS4AAAAAAA9wZW5kaW5nX3VwZ3JhZGUAAAAAAAAAAAEAAAPoAAAH0AAAAA5VcGdyYWRlUmVxdWVzdAAA",
        "AAAAAAAAADpUaGUgYXBwbGllZCBhZG1pbiBkb2N1bWVudCdzIGNhbm9uaWNhbCBgZG9jX2hhc2hgLCBpZiBhbnkuAAAAAAAQYXBwbGllZF9kb2NfaGFzaAAAAAAAAAABAAAD6AAAA+4AAAAg",
        "AAAAAAAAADdUaGUgY29udGV4dCBydWxlIHdpdGggdGhpcyBpZDsgcGFuaWNzIGlmIHRoZXJlIGlzIG5vbmUuAAAAABBnZXRfY29udGV4dF9ydWxlAAAAAQAAAAAAAAAPY29udGV4dF9ydWxlX2lkAAAAAAQAAAABAAAH0AAAAAtDb250ZXh0UnVsZQA=",
        "AAAAAAAAAMRTY2hlZHVsZSBhbiB1cGdyYWRlIHRvIGB3YXNtX2hhc2hgIGFmdGVyIHRoZSB1cGdyYWRlIGRlbGF5LCByZXBsYWNpbmcKYW55IHBlbmRpbmcgb25lLCBhbmQgcmV0dXJuIGl0cyBpZC4gT3duZXIgYXV0aG9yaXphdGlvbjsgdW5kZXIKYFByb3RlY3RlZGAsIGFsc28gYXBwcm92YWxzIGZyZXNoIHVudGlsIGBhcHByb3ZhbF92YWxpZF91bnRpbGAuAAAAEHNjaGVkdWxlX3VwZ3JhZGUAAAACAAAAAAAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAAUYXBwcm92YWxfdmFsaWRfdW50aWwAAAAEAAAAAQAAA+kAAAAGAAAH0AAAABFQZXJjaEFjY291bnRFcnJvcgAAAA==",
        "AAAAAAAAAGRUaGUgc2NvcGUgZ2VuZXJhdGlvbjogYWR2YW5jZWQgb25seSBieSBjb21wbGV0ZWQgcmVjb3Zlcmllcy4gQSBzY29wZQphcHBsaWVkIHVuZGVyIGFub3RoZXIgaXMgd2lwZWQuAAAAEHNjb3BlX2dlbmVyYXRpb24AAAAAAAAAAQAAAAY=",
        "AAAAAAAAAIVUaGUgc2lnbmVyIGlkcyBvZiB0aGUgc2NvcGVkIGRvY3VtZW50IHVuZGVyIGBzY29wZWAsIGluIGRlY2xhcmF0aW9uCm9yZGVyLCBpZiBhbnk6IHdpdGggaXRzIHJ1bGVzLCB0aGV5IGdpdmUgYmFjayBpdHMgY2Fub25pY2FsIHRleHQuAAAAAAAAEHNjb3BlX3NpZ25lcl9pZHMAAAABAAAAAAAAAAVzY29wZQAAAAAAAAQAAAABAAAD6AAAA+oAAAAQ",
        "AAAAAAAAAChUaGUgYWRvcHRlZCByZWNvdmVyeSBjb250cm9sbGVyLCBpZiBhbnkuAAAAE3JlY292ZXJ5X2NvbnRyb2xsZXIAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAACJUaGUgYWNjb3VudCdzIHJlY292ZXJ5IGdlbmVyYXRpb24uAAAAAAATcmVjb3ZlcnlfZ2VuZXJhdGlvbgAAAAAAAAAAAQAAAAY=",
        "AAAAAAAAALJFYWNoIHNpZ25lcidzIGB2ZXJpZmllci1uYW1lYCBpbiB0aGUgc2NvcGVkIGRvY3VtZW50IHVuZGVyIGBzY29wZWAsCmFsaWduZWQgd2l0aCBgc2NvcGVfc2lnbmVyX2lkc2AsIGlmIGFueTogZW1wdHkgd2hlcmUgYSBzaWduZXIgaGFzCm5vbmUsIGFuZCBubyBlbnRyaWVzIHdoZW4gbm8gc2lnbmVyIGhhcyBvbmUuAAAAAAAUc2NvcGVfdmVyaWZpZXJfbmFtZXMAAAABAAAAAAAAAAVzY29wZQAAAAAAAAQAAAABAAAD6AAAA+oAAAAQ",
        "AAAAAAAAAFBUaGUgbGFzdCBzY29wZSBnZW5lcmF0aW9uIGEgc2NvcGVkIGRvY3VtZW50IG5hbWVkIHRoaXMgY3JlZGVudGlhbCB1bmRlciwKaWYgYW55LgAAABVjcmVkZW50aWFsX2dlbmVyYXRpb24AAAAAAAABAAAAAAAAAAtmaW5nZXJwcmludAAAAAPuAAAAIAAAAAEAAAPoAAAABg==",
        "AAAAAAAAAD1UaGUgY291bnQgb2YgY29udGV4dCBydWxlcywgc2NvcGVkIGFuZCBleHBpcmVkIG9uZXMgaW5jbHVkZWQuAAAAAAAAF2dldF9jb250ZXh0X3J1bGVzX2NvdW50AAAAAAAAAAABAAAABA==",
        "AAAAAAAAACtUaGUgaWQgdGhlIG5leHQgYHNjaGVkdWxlX3VwZ3JhZGVgIGFzc2lnbnMuAAAAABduZXh0X3VwZ3JhZGVfcmVxdWVzdF9pZAAAAAAAAAAAAQAAAAY=",
        "AAAAAQAAADtUaGUgc2hhcmVkIGluZnJhIGNvbnRyYWN0cyB0aGlzIGFjY291bnQgcGlucyBhdCBidWlsZCB0aW1lLgAAAAAAAAAACUluZnJhUGlucwAAAAAAAAMAAAAAAAAADGRvY19jb21waWxlcgAAABMAAAAAAAAAC2ludGVycHJldGVyAAAAABMAAAAAAAAADnNwZW5kaW5nX2xpbWl0AAAAAAAT",
        "AAAAAQAAAGZUaGUgYFByb3RlY3RlZGAgZnJlZXplOiB3aGlsZSBgbGVkZ2VyIDwgdW50aWxgLCB0aGUgYWNjb3VudCBhdXRob3JpemVzCm9ubHkgYGF0dGVtcHRfaWRgJ3MgY29tcGxldGlvbi4AAAAAAAAAAAAKRnJlZXplR2F0ZQAAAAAAAgAAABdUaGUgYXV0aG9yaXplZCBhdHRlbXB0LgAAAAAKYXR0ZW1wdF9pZAAAAAAABgAAACZUaGUgYXV0aG9yaXplZCBhdHRlbXB0J3MgYGV4cGlyZXNfYXRgLgAAAAAABXVudGlsAAAAAAAABA==",
        "AAAABQAAAGxFbWl0dGVkIGFmdGVyIHRoZSBhZG1pbiBkb2N1bWVudCBpcyBhcHBsaWVkOiBpdHMgYGRvY19oYXNoYCwgdGhlIHJldmlzaW9uLAphbmQgd2hhdCBjaGFuZ2VkIGluIHRoZSBydWxlIHNldC4AAAAAAAAACkRvY0FwcGxpZWQAAAAAAAEAAAALZG9jX2FwcGxpZWQAAAAACQAAAAAAAAAIZG9jX2hhc2gAAAPuAAAAIAAAAAEAAAAAAAAACHJldmlzaW9uAAAABgAAAAAAAAAAAAAAC3J1bGVzX2FkZGVkAAAAAAQAAAAAAAAAAAAAAA1ydWxlc19yZW1vdmVkAAAAAAAABAAAAAAAAAAAAAAADHJ1bGVzX2VkaXRlZAAAAAQAAAAAAAAAAAAAAA1zaWduZXJzX2FkZGVkAAAAAAAABAAAAAAAAAAAAAAAD3NpZ25lcnNfcmVtb3ZlZAAAAAAEAAAAAAAAAAAAAAAOcG9saWNpZXNfYWRkZWQAAAAAAAQAAAAAAAAAAAAAABBwb2xpY2llc19yZW1vdmVkAAAABAAAAAAAAAAC",
        "AAAAAQAAAB1BIHNjb3BlZCBkb2N1bWVudCBhcyBhcHBsaWVkLgAAAAAAAAAAAAALU2NvcGVSZWNvcmQAAAAAAwAAABlJdHMgY2Fub25pY2FsIGBkb2NfaGFzaGAuAAAAAAAACGRvY19oYXNoAAAD7gAAACAAAABXVGhlIHNjb3BlIGdlbmVyYXRpb24gaXQgd2FzIGFwcGxpZWQgdW5kZXI7IHdpcGVkIG9uY2UKYHNjb3BlX2dlbmVyYXRpb25gIG1vdmVzIHBhc3QgaXQuAAAAAANnZW4AAAAABgAAAC1FdmVyeSBjb250ZXh0IHJ1bGUgaXQgaW5zdGFsbGVkLCB3aXRoIGl0cyBpZC4AAAAAAAAFcnVsZXMAAAAAAAPqAAAH0AAAAA1JbnN0YWxsZWRSdWxlAAAA",
        "AAAAAQAAAWhBIHNjb3BlZCBkb2N1bWVudCBhcyB0aGUgYWNjb3VudCBzdG9yZXMgaXQ6IFtgU2NvcGVSZWNvcmRgXSdzIGZpZWxkcywKd2l0aCBlYWNoIHJ1bGUncyByZWNvcmQgaG9sZGluZyBpdHMgc3RvcmVkIHJ1bGUsIHRoZSBzY29wZSdzIHBvc2l0aW9uIGluCnRoZSBzY29wZSBpbmRleCwgdGhlIGRvY3VtZW50J3Mgc2lnbmVyIGlkcyBpbiBkZWNsYXJhdGlvbiBvcmRlciwgYW5kCmVhY2ggc2lnbmVyJ3MgYHZlcmlmaWVyLW5hbWVgIChlbXB0eSB3aGVyZSBpdCBoYXMgbm9uZTsgdGhlIGxpc3QgZW1wdHkKd2hlbiBubyBzaWduZXIgaGFzIG9uZSksIHdoaWNoIHdpdGggdGhlIHJlY29yZHMgZ2l2ZSBiYWNrIGl0cyBjYW5vbmljYWwKdGV4dC4AAAAAAAAAC1N0b3JlZFNjb3BlAAAAAAYAAAAAAAAACGRvY19oYXNoAAAD7gAAACAAAAAAAAAAA2dlbgAAAAAGAAAAAAAAAANwb3MAAAAABAAAAAAAAAAFcnVsZXMAAAAAAAPqAAAH0AAAAApSdWxlUmVjb3JkAAAAAAAAAAAACnNpZ25lcl9pZHMAAAAAA+oAAAAQAAAAAAAAAA52ZXJpZmllcl9uYW1lcwAAAAAD6gAAABA=",
        "AAAABQAAAElFbWl0dGVkIHdoZW4gYSBjb21wbGV0ZWQgcmVjb3ZlcnkgYWR2YW5jZXMgdGhlIHNjb3BlIGdlbmVyYXRpb24gdG8gYGdlbmAuAAAAAAAAAAAAAAtTY29wZXNXaXBlZAAAAAABAAAADHNjb3Blc193aXBlZAAAAAEAAAAAAAAAA2dlbgAAAAAGAAAAAAAAAAI=",
        "AAAABQAAAHZFbWl0dGVkIGFmdGVyIGEgc2NvcGVkIGRvY3VtZW50IGlzIGFwcGxpZWQ6IGl0cyBzY29wZSwgYGRvY19oYXNoYCwgc2NvcGUKZ2VuZXJhdGlvbiwgYW5kIHdoYXQgY2hhbmdlZCBpbiBpdHMgcnVsZSBzZXQuAAAAAAAAAAAADFNjb3BlQXBwbGllZAAAAAEAAAANc2NvcGVfYXBwbGllZAAAAAAAAAoAAAAAAAAABXNjb3BlAAAAAAAABAAAAAEAAAAAAAAACGRvY19oYXNoAAAD7gAAACAAAAAAAAAAAAAAAANnZW4AAAAABgAAAAAAAAAAAAAAC3J1bGVzX2FkZGVkAAAAAAQAAAAAAAAAAAAAAA1ydWxlc19yZW1vdmVkAAAAAAAABAAAAAAAAAAAAAAADHJ1bGVzX2VkaXRlZAAAAAQAAAAAAAAAAAAAAA1zaWduZXJzX2FkZGVkAAAAAAAABAAAAAAAAAAAAAAAD3NpZ25lcnNfcmVtb3ZlZAAAAAAEAAAAAAAAAAAAAAAOcG9saWNpZXNfYWRkZWQAAAAAAAQAAAAAAAAAAAAAABBwb2xpY2llc19yZW1vdmVkAAAABAAAAAAAAAAC",
        "AAAABQAAADlFbWl0dGVkIHdoZW4gYSBzY29wZWQgZG9jdW1lbnQgYW5kIGl0cyBydWxlcyBhcmUgcmVtb3ZlZC4AAAAAAAAAAAAADFNjb3BlUmVtb3ZlZAAAAAEAAAANc2NvcGVfcmVtb3ZlZAAAAAAAAAMAAAAAAAAABXNjb3BlAAAAAAAABAAAAAEAAAAqVGhlIHNjb3BlIGdlbmVyYXRpb24gaXQgd2FzIGFwcGxpZWQgdW5kZXIuAAAAAAADZ2VuAAAAAAYAAAAAAAAAAAAAAA1ydWxlc19yZW1vdmVkAAAAAAAABAAAAAAAAAAC",
        "AAAABQAAAERFbWl0dGVkIHdoZW4gdGhlIGNvbnRyb2xsZXIgc2V0cyAoYHVudGlsID4gMGApIG9yIGNsZWFycyB0aGUgZnJlZXplLgAAAAAAAAANRnJlZXplQ2hhbmdlZAAAAAAAAAEAAAAOZnJlZXplX2NoYW5nZWQAAAAAAAIAAAAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAAAAAAAAAAAAAAV1bnRpbAAAAAAAAAQAAAAAAAAAAg==",
        "AAAABAAAADZXaHkgYF9fY2hlY2tfYXV0aGAgcmVmdXNlZCBiZWZvcmUgZXZhbHVhdGluZyBhbnkgcnVsZS4AAAAAAAAAAAAOUGVyY2hBdXRoRXJyb3IAAAAAAAUAAAB8QSBjb250ZXh0IG5hbWVzIGFuIGludm9rZXItb25seSBob29rIChzcGVjIMKnMTUpOiB0aGVzZSBhcmUgcmVhY2hhYmxlIG9ubHkgZnJvbSB0aGUgYWNjb3VudCdzIG93biBmbG93cywgbmV2ZXIgYnkgc2lnbmF0dXJlLgAAABBSZXNlcnZlZEZ1bmN0aW9uAAAAAQAAAHZBIGBQcm90ZWN0ZWRgIHJlY292ZXJ5IGF0dGVtcHQgaXMgYXV0aG9yaXplZDogdGhlIGFjY291bnQgYXV0aG9yaXplcyBub3RoaW5nIGJ1dCB0aGF0IGF0dGVtcHQncyBjb21wbGV0aW9uIChzcGVjIMKnOSkuAAAAAAANQWNjb3VudEZyb3plbgAAAAAAAAIAAACTQSBzZWxlY3RlZCBydWxlIGJlbG9uZ3MgdG8gYSBzY29wZWQgZG9jdW1lbnQgYSByZWNvdmVyeSBjb21wbGV0aW9uIHdpcGVkOiB0aGUgZ2VuZXJhdGlvbiBpdHMgc3RvcmVkIHJ1bGUgY2FycmllcyBpcyBub3QgdGhlIGFjY291bnQncyAoc3BlYyDCpzcuNikuAAAAAApTdGFsZVNjb3BlAAAAAAADAAAAxUEgc2VsZWN0ZWQgc2NvcGVkIHJ1bGUncyBjb250ZXh0IGNhbGxzIHRoZSByZWNvdmVyeSBjb250cm9sbGVyIG9yIHRoZSBaSyBhZGFwdGVyIG9yIHBvb2wgb2YgdGhlIGFwcGxpZWQgcmVjb3ZlcnkgbWVtYmVyLCBhbnkgb2Ygd2hpY2ggbWF5IGhhdmUgYmVlbiBhZG9wdGVkIGFmdGVyIHRoZSBzY29wZSB3YXMgYXBwbGllZCAoc3BlYyDCpzcuNikuAAAAAAAAD1Njb3BlRXNjYWxhdGlvbgAAAAAEAAAAY3J1bGUtZXZhbCByZWZ1c2VzIHRoZSBhdXRob3JpemF0aW9uLCBvciBpdCBjaG9vc2VzIHRoZSByZWNvdmVyeSBydWxlIG91dHNpZGUgYSBjb21wbGV0aW9uIChgZ2F0ZWApLgAAAAAPUnVsZUV2YWxSZWZ1c2VkAAAAAAU=",
        "AAAABQAAACxFbWl0dGVkIHdoZW4gYSBzY2hlZHVsZWQgdXBncmFkZSBpcyBkcm9wcGVkLgAAAAAAAAAOVXBncmFkZURyb3BwZWQAAAAAAAEAAAAPdXBncmFkZV9kcm9wcGVkAAAAAAEAAAAAAAAACnJlcXVlc3RfaWQAAAAAAAYAAAABAAAAAg==",
        "AAAABQAAACFFbWl0dGVkIHdoZW4gYW4gdXBncmFkZSBleGVjdXRlcy4AAAAAAAAAAAAAD1VwZ3JhZGVFeGVjdXRlZAAAAAABAAAAEHVwZ3JhZGVfZXhlY3V0ZWQAAAACAAAAAAAAAApyZXF1ZXN0X2lkAAAAAAAGAAAAAQAAAAAAAAAJd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAAAAAAAg==",
        "AAAABQAAACtFdmVudCBlbWl0dGVkIHdoZW4gYSBjb250ZXh0IHJ1bGUgaXMgYWRkZWQuAAAAAAAAAAAQQ29udGV4dFJ1bGVBZGRlZAAAAAEAAAASY29udGV4dF9ydWxlX2FkZGVkAAAAAAAGAAAAAAAAAA9jb250ZXh0X3J1bGVfaWQAAAAABAAAAAEAAAAAAAAABG5hbWUAAAAQAAAAAAAAAAAAAAAMY29udGV4dF90eXBlAAAH0AAAAA9Db250ZXh0UnVsZVR5cGUAAAAAAAAAAAAAAAALdmFsaWRfdW50aWwAAAAD6AAAAAQAAAAAAAAAAAAAAApzaWduZXJfaWRzAAAAAAPqAAAABAAAAAAAAAAAAAAACnBvbGljeV9pZHMAAAAAA+oAAAAEAAAAAAAAAAI=",
        "AAAABQAAACVFbWl0dGVkIHdoZW4gYW4gdXBncmFkZSBpcyBzY2hlZHVsZWQuAAAAAAAAAAAAABBVcGdyYWRlU2NoZWR1bGVkAAAAAQAAABF1cGdyYWRlX3NjaGVkdWxlZAAAAAAAAAMAAAAAAAAACnJlcXVlc3RfaWQAAAAAAAYAAAABAAAAAAAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAAgVGhlIGZpcnN0IGxlZGdlciBpdCBtYXkgZXhlY3V0ZS4AAAANZXhlY3V0YWJsZV9hdAAAAAAAAAQAAAAAAAAAAg==",
        "AAAABAAAAI9FdmVyeXRoaW5nIHRoZSBhY2NvdW50J3MgZW50cnkgcG9pbnRzIGNhbiByZWZ1c2UuIENvbXBpbGVyIGFuZCBjb250cm9sbGVyIGZhaWx1cmVzIGZsYXR0ZW4gaW4gdmlhIGAjW2Zyb21fY29udHJhY3RfY2xpZW50XWAsIGNvbnZlcnRlZCBieSBgPz9gLgAAAAAAAAAAEVBlcmNoQWNjb3VudEVycm9yAAAAAAAAQgAAAGFUaGUgZG9jdW1lbnQga2VlcHMgbm8gY29uc3RyYWludC1mcmVlLCBuZXZlci1leHBpcmluZyBzZWxmLWFkbWluIHJ1bGUgd2l0aCBhIHNpZ25lciAoYW50aS1icmljaykuAAAAAAAADEFkbWluTG9ja291dAAAAAEAAAAoVGhlIGRvY3VtZW50IG5hbWVzIGEgcmV2b2tlZCBjcmVkZW50aWFsLgAAABFSZXZva2VkQ3JlZGVudGlhbAAAAAAAAAIAAABEVGhlIGRvY3VtZW50IHJldXNlcyBhIFpLIGVucm9sbG1lbnQgaWQgdGhpcyBhY2NvdW50IGVucm9sbGVkIGJlZm9yZS4AAAAQRW5yb2xsbWVudFJldXNlZAAAAAMAAAA/VGhlIGRvY3VtZW50IGNoYW5nZXMgdGhlIFpLIGZhY3RvciB3aXRob3V0IGEgbmV3IGVucm9sbG1lbnQgaWQuAAAAABZaa0ZhY3RvckNoYW5nZWRJblBsYWNlAAAAAAAEAAAAMWBleGVjdXRlYCB3YXMgYXNrZWQgdG8gY2FsbCBhbiBpbnZva2VyLW9ubHkgaG9vay4AAAAAAAAQUmVzZXJ2ZWRGdW5jdGlvbgAAAAUAAAAvVGhlIGFjY291bnQgaGFzIG5vIGFkb3B0ZWQgcmVjb3ZlcnkgY29udHJvbGxlci4AAAAAE1JlY292ZXJ5Tm90RW5yb2xsZWQAAAAABgAAABhObyB1cGdyYWRlIGlzIHNjaGVkdWxlZC4AAAAQTm9QZW5kaW5nVXBncmFkZQAAAAcAAAAsVGhlIHJlcXVlc3QgaWQgaXMgbm90IHRoZSBwZW5kaW5nIHVwZ3JhZGUncy4AAAAWVXBncmFkZVJlcXVlc3RNaXNtYXRjaAAAAAAACAAAACJUaGUgdXBncmFkZSBkZWxheSBoYXMgbm90IGVsYXBzZWQuAAAAAAAPVXBncmFkZU5vdFJlYWR5AAAAAAkAAAAmQSBsZWRnZXIgY29tcHV0YXRpb24gb3ZlcmZsb3dlZCBgdTMyYC4AAAAAAA5UaW1pbmdPdmVyZmxvdwAAAAAACgAAAEBBIGNvbXBsZXRpb24gcmV0dXJuZWQgYSBjcmVkZW50aWFsIHRoYXQgY2Fubm90IGJlIGZpbmdlcnByaW50ZWQuAAAAEUludmFsaWRDcmVkZW50aWFsAAAAAAAACwAAAE5UaGUgcmVjb3ZlcnkgZ2VuZXJhdGlvbiBtb3ZlZCBzaW5jZSBzY2hlZHVsaW5nOyB0aGUgcmVxdWVzdCBjYW4gbmV2ZXIgZXhlY3V0ZS4AAAAAAAxTdGFsZVVwZ3JhZGUAAAAMAAAAK1RoZSBzdWJtaXR0ZWQgZG9jdW1lbnQgYnl0ZXMgYXJlIG5vdCBVVEYtOC4AAAAAE0NvbXBpbGVyX0RvY05vdFV0ZjgAAAAADQAAAGxUaGUgZG9jdW1lbnQgZmFpbGVkIGZhaWwtY2xvc2VkIHBhcnNpbmcgKHVua25vd24gZmllbGQsIGJhZCBzaGFwZSwgdW5zdXBwb3J0ZWQgdmVyc2lvbiwgZHVwbGljYXRlIGtleSwg4oCmKS4AAAARQ29tcGlsZXJfRG9jUGFyc2UAAAAAAAAOAAAAqFRoZSBkb2N1bWVudCBmYWlsZWQgc2VtYW50aWMgdmFsaWRhdGlvbiAoZGFuZ2xpbmcgc2lnbmVyIHJlZiwgbWFsZm9ybWVkIGFkZHJlc3Mgb3Iga2V5LCBhbWJpZ3VvdXMgZW1wdHkgbGlzdCwg4oCmKSBvciBuYW1lcyBpdHMgdmVyaWZpZXJzIGFzIHRoZSBjb21waWxlciBkb2VzIG5vdCB0YWtlLgAAABNDb21waWxlcl9Eb2NJbnZhbGlkAAAAAA8AAABDVGhlIGRvY3VtZW50IG5hbWVzIG5vIG5ldHdvcmssIG9yIGEgbmV0d29yayB0aGF0IGlzIG5vdCB0aGlzIGNoYWluLgAAAAAVQ29tcGlsZXJfV3JvbmdOZXR3b3JrAAAAAAAAEAAAAG1UaGUgZG9jdW1lbnQgY2Fubm90IGJlIGxvd2VyZWQgdG8gcnVsZXM6IGEgcnVsZSB3aXRoIHNlbGYtYXV0aGVudGljYXRpbmcgcHJpbmNpcGFscywgb3IgdG9vIG1hbnkgY29uc3RyYWludHMuAAAAAAAAE0NvbXBpbGVyX0RvY0NvbXBpbGUAAAAAEQAAAERUaGUgZG9jdW1lbnQgZXhjZWVkcyBhIGNhcCBvbiBzaWduZXJzLCBydWxlcywgYnl0ZXMsIG9yIG5hbWUgbGVuZ3RoLgAAABRDb21waWxlcl9Eb2NUb29MYXJnZQAAABIAAAA9QSBzaWduZXIncyBleHRlcm5hbCBga2V5YCBpcyBub3QgaXRzIHZlcmlmaWVyLWNhbm9uaWNhbCBmb3JtLgAAAAAAAB5Db21waWxlcl9LZXlOb3RDYW5vbmljYWxpemFibGUAAAAAABMAAAA6YGRlcml2ZV90YXJnZXRgOiB0aGUgY3VycmVudCBkb2N1bWVudCBlbnJvbGxzIG5vIHJlY292ZXJ5LgAAAAAAFENvbXBpbGVyX05vdEVucm9sbGVkAAAAFAAAAGpgZGVyaXZlX3RhcmdldGA6IHRoZSByZXBsYWNlbWVudCBzZXQgYnJlYWtzIHNwZWMgwqc3LjMgcnVsZXMgMS0zLCBvciB0aGUgYWN0aW9uIGlzIG5vdCBhIHJlY292ZXJ5IGF0dGVtcHQuAAAAAAAbQ29tcGlsZXJfUmVwbGFjZW1lbnRSZWZ1c2VkAAAAABUAAABVYGRlcml2ZV90YXJnZXRgOiB0aGUgWksgZW5yb2xsbWVudCBpcyBtaXNzaW5nLCB1bmV4cGVjdGVkLCBvciByZXVzZXMgdGhlIGVucm9sbGVkIGlkLgAAAAAAAB1Db21waWxlcl9aa0Vucm9sbG1lbnRNaXNtYXRjaAAAAAAAABYAAABoYGRlcml2ZV90YXJnZXRgOiB0aGUgdGFyZ2V0IGhhcyBubyBjb25zdHJhaW50LWZyZWUgc2VsZi1hZG1pbiBydWxlIHdpdGggYSBzaWduZXIgKHRoZSBhbnRpLWJyaWNrIGNoZWNrKS4AAAAVQ29tcGlsZXJfQWRtaW5Mb2Nrb3V0AAAAAAAAFwAAAEFObyBjb25maWd1cmF0aW9uIGlzIGVucm9sbGVkIGZvciB0aGlzIGFjY291bnQgYXQgdGhpcyBjb250cm9sbGVyLgAAAAAAABRSZWNvdmVyeV9Ob3RFbnJvbGxlZAAAABgAAABUQW4gYXR0ZW1wdCBpcyBhdXRob3JpemVkIGFuZCBsaXZlLCB3aGljaCBibG9ja3MgYmVnaW4sIHBvbGljeSBjaGFuZ2VzLCBhbmQgdXBncmFkZXMuAAAAGlJlY292ZXJ5X0F0dGVtcHRBdXRob3JpemVkAAAAAAAZAAAAL05vIGF0dGVtcHQgd2l0aCB0aGlzIGlkIGV4aXN0cyBmb3IgdGhlIGFjY291bnQuAAAAABZSZWNvdmVyeV9Ob1N1Y2hBdHRlbXB0AAAAAAAaAAAAY1RoZSBhdHRlbXB0IGlzIHRlcm1pbmFsLCBleHBpcmVkLCBmcm9tIGFuIG9sZGVyIGVwb2NoLCBvciBpbnZhbGlkYXRlZCBieSBhIHNpYmxpbmcncyBhdXRob3JpemF0aW9uLgAAAAAXUmVjb3ZlcnlfQXR0ZW1wdE5vdExpdmUAAAAAGwAAAEBJbml0aWF0aW9uIGV2aWRlbmNlIGZvciBhbiBhdHRlbXB0IHRoYXQgaXMgbm8gbG9uZ2VyIGNvbGxlY3RpbmcuAAAAHVJlY292ZXJ5X0F0dGVtcHROb3RDb2xsZWN0aW5nAAAAAAAAHAAAACVDb21wbGV0aW9uIGJlZm9yZSBgZXhlY3V0YWJsZV9hZnRlcmAuAAAAAAAAGVJlY292ZXJ5X05vdEV4ZWN1dGFibGVZZXQAAAAAAAAdAAAAZlRoZSBjb21wbGV0aW9uIGNvbnRleHQsIG9yIHRoZSBjb21waWxlZCBkb2N1bWVudCBoYXNoLCBkb2VzIG5vdCBtYXRjaCB0aGUgYXV0aG9yaXplZCBhdHRlbXB0J3MgdGFyZ2V0LgAAAAAAFFJlY292ZXJ5X1dyb25nVGFyZ2V0AAAAHgAAAChUaGUgYWRkcmVzcyBpcyBub3QgYW4gZW5yb2xsZWQgZ3VhcmRpYW4uAAAAFVJlY292ZXJ5X05vdEFHdWFyZGlhbgAAAAAAAB8AAAA7VGhpcyBndWFyZGlhbiBvciBmYWN0b3IgYWxyZWFkeSBjb3VudGVkIGZvciB0aGlzIHN0YXRlbWVudC4AAAAAF1JlY292ZXJ5X0FscmVhZHlDb3VudGVkAAAAACAAAAApVGhlIGVucm9sbGVkIG1vZGUgaGFzIG5vIGd1YXJkaWFuIGZhY3Rvci4AAAAAAAAbUmVjb3ZlcnlfTW9kZUhhc05vR3VhcmRpYW5zAAAAACEAAAAjVGhlIGVucm9sbGVkIG1vZGUgaGFzIG5vIFpLIGZhY3Rvci4AAAAAFFJlY292ZXJ5X01vZGVIYXNOb1prAAAAIgAAAD5UaGUgYWRhcHRlciByZWZ1c2VkIHRoZSBwcm9vZiAoaXRzIGBaa0FkYXB0ZXJFcnJvcmAgc2F5cyB3aHkpLgAAAAAAG1JlY292ZXJ5X1prRXZpZGVuY2VSZWplY3RlZAAAAAAjAAAAH1RoZSBwcm9vZidzIG51bGxpZmllciBpcyBzcGVudC4AAAAAF1JlY292ZXJ5X051bGxpZmllclNwZW50AAAAACQAAAA+VGhlIHN0YXRlbWVudCdzIGZyZXNobmVzcyBib3VuZCBoYXMgcGFzc2VkIG9yIHJlYWNoZXMgdG9vIGZhci4AAAAAABhSZWNvdmVyeV9FdmlkZW5jZUV4cGlyZWQAAAAlAAAAR1RoZSBzdGF0ZW1lbnQgY2Fubm90IGJlIGVuY29kZWQgKGEgbm9uLWNvbnRyYWN0IGFjY291bnQgb3IgY29udHJvbGxlcikuAAAAABlSZWNvdmVyeV9JbnZhbGlkU3RhdGVtZW50AAAAAAAAJgAAAF1SZWNvcmRlZCBhcHByb3ZhbHMgZG8gbm90IHNhdGlzZnkgdGhlIGVucm9sbGVkIGNvbmRpdGlvbiBmb3IgdGhpcyByZWNvbmZpZ3VyYXRpb24gb3IgdXBncmFkZS4AAAAAAAAYUmVjb3ZlcnlfQ29uZGl0aW9uTm90TWV0AAAAJwAAACdUaGUgYWNjb3VudCdzIGBtYXgtY2FuY2Vsc2AgaXMgdXNlZCB1cC4AAAAAGlJlY292ZXJ5X01heENhbmNlbHNSZWFjaGVkAAAAAAAoAAAAMk93bmVyIGNhbmNlbGxhdGlvbiBpcyBvbmx5IGF2YWlsYWJsZSB1bmRlciBgTG9zc2AuAAAAAAAbUmVjb3ZlcnlfT3duZXJDYW5jZWxSZWZ1c2VkAAAAACkAAABCVGhlIHJlcGxhY2VtZW50IHNldCBicmVha3MgYSDCpzcuMyBydWxlLCBvciBkZXJpdmF0aW9uIHJlZnVzZWQgaXQuAAAAAAAcUmVjb3ZlcnlfSW52YWxpZFJlcGxhY2VtZW50cwAAACoAAAA6VGhlIHRhcmdldCBvciBhIHJlcGxhY2VtZW50IGNvbnRhaW5zIGEgcmV2b2tlZCBjcmVkZW50aWFsLgAAAAAAGlJlY292ZXJ5X0NyZWRlbnRpYWxSZXZva2VkAAAAAAArAAAAOlRoZSBaSyBlbnJvbGxtZW50IGlkIHdhcyBlbnJvbGxlZCBmb3IgdGhpcyBhY2NvdW50IGJlZm9yZS4AAAAAABtSZWNvdmVyeV9FbnJvbGxtZW50SWRSZXVzZWQAAAAALAAAAC5Db21wcm9taXNlIHJlY292ZXJ5IHdpdGggbm8gYmFzZWxpbmUgZW5yb2xsZWQuAAAAAAATUmVjb3ZlcnlfTm9CYXNlbGluZQAAAAAtAAAAQENvbXByb21pc2UgcmVjb3ZlcnkgYmVmb3JlIHRoZSBiYXNlbGluZSdzIGNvbnRlbnQgd2FzIHB1Ymxpc2hlZC4AAAAdUmVjb3ZlcnlfQmFzZWxpbmVOb3RQdWJsaXNoZWQAAAAAAAAuAAAAPlRoZSBwdWJsaXNoZWQgZG9jdW1lbnQgZG9lcyBub3QgaGFzaCB0byB0aGUgZW5yb2xsZWQgYmFzZWxpbmUuAAAAAAAZUmVjb3ZlcnlfQmFzZWxpbmVNaXNtYXRjaAAAAAAAAC8AAABTVGhlIGFkYXB0ZXIncyBjaXJjdWl0IGlkIG9yIHRyZWUgZGVwdGggZG9lcyBub3QgbWF0Y2ggdGhlIGVucm9sbGVkIGZhY3RvciBhbmQgcG9vbC4AAAAAGVJlY292ZXJ5X1prV2lyaW5nTWlzbWF0Y2gAAAAAAAAwAAAAMlRoZSBaSyBmYWN0b3IgY2hhbmdlZCB3aXRob3V0IGEgbmV3IGVucm9sbG1lbnQgaWQuAAAAAAAfUmVjb3ZlcnlfWmtGYWN0b3JDaGFuZ2VkSW5QbGFjZQAAAAAxAAAAH1RoZSBjb25maWd1cmF0aW9uIGlzIG1hbGZvcm1lZC4AAAAAHVJlY292ZXJ5X0ludmFsaWRDb25maWd1cmF0aW9uAAAAAAAAMgAAADFBbiB1cGdyYWRlIHJlcXVlc3QgcmVjb3JkZWQgdW5kZXIgYW4gb2xkZXIgZXBvY2guAAAAAAAAFVJlY292ZXJ5X1N0YWxlVXBncmFkZQAAAAAAADMAAAAvQSBsZWRnZXItc2VxdWVuY2UgY29tcHV0YXRpb24gb3ZlcmZsb3dlZCBgdTMyYC4AAAAAF1JlY292ZXJ5X0xlZGdlck92ZXJmbG93AAAAADQAAAA5QSBob29rIHdhcyBjYWxsZWQgZm9yIGEgcmVjb3ZlcnkgcnVsZSBvZiB0aGUgd3Jvbmcgc2hhcGUuAAAAAAAAHVJlY292ZXJ5X01hbGZvcm1lZENvbnRleHRSdWxlAAAAAAAANQAAADtUaGUgdGFyZ2V0IGtlZXBzIGEgY3JlZGVudGlhbCB0aGUgcmVwbGFjZW1lbnQgc2V0IHJlcGxhY2VzLgAAAAAjUmVjb3ZlcnlfUmVwbGFjZWRDcmVkZW50aWFsUmV0YWluZWQAAAAANgAAADhUaGUgYWNjb3VudCBpcyBub3QgYXQgYGFwcGx5X2RvY2AncyBgZXhwZWN0ZWRfcmV2aXNpb25gLgAAAA1TdGFsZVJldmlzaW9uAAAAAAAANwAAADlBIGNvbXBsZXRlZCByZWNvdmVyeSB3b3VsZCBvdmVyZmxvdyB0aGUgc2NvcGUgZ2VuZXJhdGlvbi4AAAAAAAATR2VuZXJhdGlvbkV4aGF1c3RlZAAAAAA4AAAAcUEgc2NvcGVkIGRvY3VtZW50IGhhcyBhIGByZWNvdmVyeWAgbWVtYmVyLCBhIHNlbGYtYWRtaW4gcnVsZSwgb3IgYSBydWxlIG9uIHRoZSBhY2NvdW50IG9yIGl0cyByZWNvdmVyeSBjb250cmFjdHMuAAAAAAAAD1Njb3BlRXNjYWxhdGlvbgAAAAA5AAAAJU5vIHNjb3BlZCBkb2N1bWVudCBoYXMgdGhpcyBzY29wZSBpZC4AAAAAAAAMVW5rbm93blNjb3BlAAAAOgAAAD1gZ2Nfc2NvcGVgIHdhcyBnaXZlbiBhIGxpdmUgc2NvcGU7IGByZW1vdmVfc2NvcGVgIHJlbW92ZXMgaXQuAAAAAAAACVNjb3BlTGl2ZQAAAAAAADsAAABCVGhlIGRvY3VtZW50IG5hbWVzIGEgY3JlZGVudGlhbCBmcm9tIGEgc2NvcGUgYSByZWNvdmVyeSBoYXMgd2lwZWQuAAAAAAAPV2lwZWRDcmVkZW50aWFsAAAAADwAAABeVGhlIGNvbXBpbGVkIGRvY3VtZW50J3MgbW9kZWwgaXMgbWlzc2luZywgZHVwbGljYXRlZCwgdW5yZWFkYWJsZSwgb3IgZG9lcyBub3QgbWF0Y2ggaXRzIHJ1bGVzLgAAAAAADE1vZGVsSW52YWxpZAAAAD0AAAA/QSBydWxlIG90aGVyIHRoYW4gdGhlIHJlY292ZXJ5IHJ1bGUgYXNrcyBmb3Igbm8gc2lnbmVyIChJTlYtMSkuAAAAAA1Vbmd1YXJkZWRSdWxlAAAAAAAAPgAAAEdBIHNjb3BlZCBkb2N1bWVudCBpcyBub3QgaW4gbm9ybWFsIGZvcm0sIG9yIGhhcyBhIHJ1bGUgYWxyZWFkeSBleHBpcmVkLgAAAAANTm90Tm9ybWFsRm9ybQAAAAAAAD8AAABMQSBjb25zdHJ1Y3RvciBhZG1pbiBzaWduZXIncyB2ZXJpZmllciBpcyBub3Qgb25lIGBwZXJjaC92ZXJpZmllcnNgIGRlcGxveWVkLgAAABJVbnZlcmlmaWVkVmVyaWZpZXIAAAAAAEAAAAAbQ3Jvc3MtY29udHJhY3QgY2FsbCBhYm9ydGVkAAAAAAdBYm9ydGVkAAAAAAAAAAAmVW5rbm93biBlcnJvciBmcm9tIGNyb3NzLWNvbnRyYWN0IGNhbGwAAAAAAAxVbmtub3duRXJyb3J/////",
        "AAAABQAAADhFbWl0dGVkIHdoZW4gYSByZWNvdmVyeSBjb21wbGV0aW9uIHJldm9rZXMgYSBjcmVkZW50aWFsLgAAAAAAAAARQ3JlZGVudGlhbFJldm9rZWQAAAAAAAABAAAAEmNyZWRlbnRpYWxfcmV2b2tlZAAAAAAAAQAAAAAAAAALZmluZ2VycHJpbnQAAAAD7gAAACAAAAABAAAAAg==",
        "AAAAAQAAAEdDb25zdGFudHMgb2YgdGhpcyB3YXNtIGEgd2FsbGV0IGNoZWNrcyBiZWZvcmUgYnVpbGRpbmcgZm9yIHRoZSBhY2NvdW50LgAAAAAAAAAAE0FjY291bnRDYXBhYmlsaXRpZXMAAAAABQAAAD1gb25lX3R4YCAoYWRtaW4gZG9jdW1lbnQpIGFuZCBgc2NvcGVkX3YxYCAoc2NvcGVkIGRvY3VtZW50cykuAAAAAAAAC2FwcGx5X21vZGVzAAAAA+oAAAARAAAAQFdoYXQgc2lnbmVycyBzaWduOiBgYWRkcl9vel92MWAsIGJvdW5kIHRvIHRoZSBhY2NvdW50J3MgYWRkcmVzcy4AAAALYXV0aF9kaWdlc3QAAAAAEQAAACdIb3cgYGRvY19oYXNoYCBpcyBjb21wdXRlZDogYGNhbm9uX3YxYC4AAAAADGRvY19pZGVudGl0eQAAABEAAAAWVGhlIGludGVyZmFjZSB2ZXJzaW9uLgAAAAAAEWludGVyZmFjZV92ZXJzaW9uAAAAAAAABAAAACpUaGUgYEFjY291bnRDb25maWd1cmF0aW9uYCBsYXlvdXQgdmVyc2lvbi4AAAAAABBzbmFwc2hvdF92ZXJzaW9uAAAABA==",
        "AAAAAQAAAFBXaGF0IHJ1bGUgc2VsZWN0aW9uIGFuZCBzaWduaW5nIG5lZWQgZm9yIHRoZSBhZG1pbiBkb2N1bWVudCwgcmVhZCBhdCBvbmUKbGVkZ2VyLgAAAAAAAAAUQWNjb3VudENvbmZpZ3VyYXRpb24AAAAIAAAAKlRoZSBhcHBsaWVkIGRvY3VtZW50J3MgYGRvY19oYXNoYCwgaWYgYW55LgAAAAAACGRvY19oYXNoAAAD6AAAA+4AAAAgAAAALFRoZSBgUHJvdGVjdGVkYCBmcmVlemU6IHplcm8gb3Igb25lIGVudHJpZXMuAAAABGdhdGUAAAPqAAAH0AAAAApGcmVlemVHYXRlAAAAAAAiVGhlIHNoYXJlZCBpbmZyYSB0aGUgYWNjb3VudCBwaW5zLgAAAAAABWluZnJhAAAAAAAH0AAAAAlJbmZyYVBpbnMAAAAAAAAoVGhlIGFkb3B0ZWQgcmVjb3ZlcnkgY29udHJvbGxlciwgaWYgYW55LgAAABNyZWNvdmVyeV9jb250cm9sbGVyAAAAA+gAAAATAAAAGFRoZSByZWNvdmVyeSBnZW5lcmF0aW9uLgAAABNyZWNvdmVyeV9nZW5lcmF0aW9uAAAAAAYAAAAlVGhlIHJlY292ZXJ5IHJ1bGUncyBpZCwgaWYgaW5zdGFsbGVkLgAAAAAAAA1yZWNvdmVyeV9ydWxlAAAAAAAD6AAAAAQAAAAqVGhlIHJldmlzaW9uIGV2ZXJ5IG90aGVyIGZpZWxkIGJlbG9uZ3MgdG8uAAAAAAAIcmV2aXNpb24AAAAGAAAAMEV2ZXJ5IGluc3RhbGxlZCBhZG1pbiBjb250ZXh0IHJ1bGUsIHdpdGggaXRzIGlkLgAAAAVydWxlcwAAAAAAA+oAAAfQAAAADUluc3RhbGxlZFJ1bGUAAAA=",
        "AAAAAQAAAHtPbmUgaW5zdGFsbGVkIHJ1bGUgYXMgdGhlIGFjY291bnQgc3RvcmVzIGl0OiBpdHMgaWQsIG5hbWUgYW5kIHBvbGljaWVzLAphbmQgdGhlIHJ1bGUtZXZhbCBydWxlIHRoYXQgZGVjaWRlcyB3aGF0IGl0IGFsbG93cy4AAAAAAAAAAApSdWxlUmVjb3JkAAAAAAAEAAAAAAAAAAJpZAAAAAAABAAAAAAAAAAEbmFtZQAAABAAAAAAAAAACHBvbGljaWVzAAAD6gAAB9AAAAAPSW5zdGFsbGVkUG9saWN5AAAAAAAAAAAEcnVsZQAAB9AAAAAKU3RvcmVkUnVsZQAA",
        "AAAAAQAAAXJXaGF0IGFuIGBhcHBseV9kb2NgIGNoYW5nZWQgaW4gdGhlIHJ1bGUgc2V0LCBjb3VudGVkIGFzIGl0IGlzIGRvbmUuClJ1bGUgY2hhbmdlcyBwdWJsaXNoIG5vIGV2ZW50IG9mIHRoZWlyIG93biwgc28gdGhpcywgY2FycmllZCBieQpgRG9jQXBwbGllZGAsIGlzIHRoZSBvbmUgcmVjb3JkIG9mIHRoZSBjaGFuZ2UgYW4gaW5kZXhlciBnZXRzICh3aXRoIHRoZQphcHBsaWVkIGRvY3VtZW50IGl0c2VsZiwgYGFwcGxpZWRfZG9jYCkuIEEgcnVsZSBpbnN0YWxsZWQgYWdhaW4gdW5kZXIgYQpuZXcgaWQgY291bnRzIGFzIHJlbW92ZWQgYW5kIGFkZGVkOyBzaWduZXJzIGFuZCBwb2xpY2llcyBjb3VudCBvbmx5IGZvcgpydWxlcyBlZGl0ZWQgaW4gcGxhY2UuAAAAAAAAAAAADERlbHRhU3VtbWFyeQAAAAcAAAAAAAAADnBvbGljaWVzX2FkZGVkAAAAAAAEAAAAAAAAABBwb2xpY2llc19yZW1vdmVkAAAABAAAAAAAAAALcnVsZXNfYWRkZWQAAAAABAAAAAAAAAAMcnVsZXNfZWRpdGVkAAAABAAAAAAAAAANcnVsZXNfcmVtb3ZlZAAAAAAAAAQAAAAAAAAADXNpZ25lcnNfYWRkZWQAAAAAAAAEAAAAAAAAAA9zaWduZXJzX3JlbW92ZWQAAAAABA==",
        "AAAAAQAAAC1PbmUgY29udGV4dCBydWxlIGFzIHRoZSBhY2NvdW50IGluc3RhbGxlZCBpdC4AAAAAAAAAAAAADUluc3RhbGxlZFJ1bGUAAAAAAAAHAAAAKlRoZSBjb250cmFjdCB0aGUgcnVsZSBhdXRob3JpemVzIGNhbGxzIHRvLgAAAAAADGNvbnRleHRfdHlwZQAAB9AAAAAPQ29udGV4dFJ1bGVUeXBlAAAAAAxUaGUgcnVsZSBpZC4AAAACaWQAAAAAAAQAAAAQVGhlIHJ1bGUncyBuYW1lLgAAAARuYW1lAAAAEAAAACJUaGUgcG9saWNpZXMgYXR0YWNoZWQgdG8gdGhlIHJ1bGUuAAAAAAAIcG9saWNpZXMAAAPqAAAH0AAAAA9JbnN0YWxsZWRQb2xpY3kAAAAALldoZXRoZXIgdGhpcyBpcyB0aGUgemVyby1zaWduZXIgcmVjb3ZlcnkgcnVsZS4AAAAAAAhyZWNvdmVyeQAAAAEAAAATVGhlIHJ1bGUncyBzaWduZXJzLgAAAAAHc2lnbmVycwAAAAPqAAAH0AAAAAZTaWduZXIAAAAAACxUaGUgaW5jbHVzaXZlIGxhc3QgdmFsaWQgbGVkZ2VyLCBpZiBib3VuZGVkLgAAAAt2YWxpZF91bnRpbAAAAAPoAAAABA==",
        "AAAAAQAAAClPbmUgcG9saWN5IGF0dGFjaGVkIHRvIGFuIGluc3RhbGxlZCBydWxlLgAAAAAAAAAAAAAPSW5zdGFsbGVkUG9saWN5AAAAAAIAAAAoYHNoYTI1NmAgb2YgdGhlIGluc3RhbGwgcGFyYW1ldGVycycgWERSLgAAAAZwYXJhbXMAAAAAA+4AAAAgAAAAFFRoZSBwb2xpY3kgY29udHJhY3QuAAAABnBvbGljeQAAAAAAEw==",
        "AAAAAgAAAOZUaGUgZG9jdW1lbnQgY2FwcyBhIGNvbXBpbGVyIGVuZm9yY2VzLCBhcyBbYFBlcmNoRG9jQ29tcGlsZXI6OmxpbWl0c2BdCnJldHVybnMgdGhlbS4gVmVyc2lvbmVkOiBhIGxhdGVyIGJ1ZGdldCAoYSBjb21wbGV4aXR5LXdlaWdodGVkIG9uZSwgc2F5KQppcyBhIG5ldyB2YXJpYW50LCB3aGljaCBhIGNvbnN1bWVyIHRoYXQgZG9lcyBub3Qga25vdyBpdCByZWZ1c2VzIHJhdGhlcgp0aGFuIG1pc3JlYWRzLgAAAAAAAAAAAAlEb2NMaW1pdHMAAAAAAAABAAAAAQAAAAAAAAACVjEAAAAAAAEAAAfQAAAADUZsYXREb2NMaW1pdHMAAAA=",
        "AAAAAgAAAHRXaGVyZSBhIGNvbXBpbGVkIHJ1bGUgYXBwbGllcy4gYFNlbGZBZG1pbmAgaXMgYWNjb3VudC1hZ25vc3RpYzogdGhlCmFwcGx5aW5nIGFjY291bnQgcmVzb2x2ZXMgaXQgdG8gaXRzIG93biBhZGRyZXNzLgAAAAAAAAAJUnVsZVNjb3BlAAAAAAAAAgAAAAAAAAA8Q2FsbHMgdG8gdGhlIGFwcGx5aW5nIGFjY291bnQgaXRzZWxmIChgQ2FsbENvbnRyYWN0KHNlbGYpYCkuAAAACVNlbGZBZG1pbgAAAAAAAAEAAAAXQ2FsbHMgdG8gdGhpcyBjb250cmFjdC4AAAAACENvbnRyYWN0AAAAAQAAABM=",
        "AAAAAQAAAEVBIGNvbXBpbGVkIGRvY3VtZW50OiBpdHMgY2Fub25pY2FsIGlkZW50aXR5IGFuZCB0aGUgcnVsZXMgaXQgYmVjb21lcy4AAAAAAAAAAAAAC0NvbXBpbGVkRG9jAAAAAAkAAACdVGhlIGNhbm9uaWNhbCBieXRlcyBgZG9jX2hhc2hgIGlzIHRoZSBoYXNoIG9mLiBUaGUgYWNjb3VudCBzdG9yZXMKdGhlbSBzbyBhbnlvbmUsIGluY2x1ZGluZyB0aGUgcmVjb3ZlcnkgY29udHJvbGxlciwgY2FuIHJlYWQgYmFjayB0aGUKZnVsbCBhcHBsaWVkIGRvY3VtZW50LgAAAAAAAAljYW5vbmljYWwAAAAAAAAOAAAAs2BzaGEyNTYoY2Fub25pY2FsIGJ5dGVzKWAg4oCUIHRoZSBoYXNoIHRoZSByZXZpZXdlciBhcHByb3ZlZC4gRm9ybWF0dGluZwpvZiB0aGUgc3VibWl0dGVkIEpTT04gaXMgaXJyZWxldmFudDogYSBwcmV0dHktcHJpbnRlZCBmaWxlIGFuZCBpdHMKbWluaWZpZWQgdHdpbiBjb21waWxlIHRvIHRoZSBzYW1lIGhhc2guAAAAAAhkb2NfaGFzaAAAA+4AAAAgAAAA0lRoZSBmaW5nZXJwcmludCAoYHBlcmNoX3JlY292ZXJ5X2ludGVyZmFjZTo6Y3JlZGVudGlhbDo6Q3JlZGVudGlhbDo6CmZpbmdlcnByaW50YCkgb2YgZXZlcnkgZGVjbGFyZWQgc2lnbmVyJ3MgY3JlZGVudGlhbCwgd2l0aCBleHRlcm5hbAprZXlzIGNhbm9uaWNhbGl6ZWQgYnkgdGhlaXIgdmVyaWZpZXIuIFdoYXQgcmV2b2NhdGlvbiBjb21wYXJlcwooc3BlYyDCpzgpLgAAAAAADGZpbmdlcnByaW50cwAAA+oAAAPuAAAAIAAAARtUaGUgZG9jdW1lbnQgYXMgcnVsZS1jb3JlJ3MgbG93ZXJpbmcgcmVhZHMgaXQgKGBydWxlX2V2YWw6OkRvY2AsIGluCmhvc3QgdHlwZXMpOiBvbmUgZW50cnkuIEEgYFZlY2AgZm9yIHRoZSBzYW1lIHJlYXNvbiBhcyBgcmVjb3ZlcnlgLgpUaGUgYXBwbHlpbmcgYWNjb3VudCBsb3dlcnMgaXQgd2l0aCBgcnVsZV9ldmFsOjpsb3dlcmAgYW5kIHN0b3JlcyB0aGUKcmVzdWx0IGFzIGl0cyBpbnN0YWxsZWQgcnVsZXM7IGBtb2RlbC5ydWxlc1tpXWAgaXMgYHJ1bGVzW2ldYCdzCmRvY3VtZW50IHJ1bGUuAAAAAAVtb2RlbAAAAAAAA+oAAAfQAAAADUNvbXBpbGVkTW9kZWwAAAAAAAEFV2hldGhlciB0aGUgZG9jdW1lbnQgaXMgaW4gbm9ybWFsIGZvcm0gYXMgZmFyIGFzIGl0cyB0ZXh0IHNob3dzCihgcGVyY2hfaXI6Om5vcm1hbF9mb3JtYCk6IHRoZW4gdGhlIHJ1bGVzIGFuIGFjY291bnQgc3RvcmVzIGZvciBpdCwKd2l0aCBpdHMgc2lnbmVyIGlkcyBhbmQgW2BTZWxmOjp2ZXJpZmllcl9uYW1lc2BdLCBnaXZlIGJhY2sgaXRzCmNhbm9uaWNhbCB0ZXh0LiBBbiBhY2NvdW50IHJlZnVzZXMgYSBzY29wZWQgZG9jdW1lbnQgdGhhdCBpcyBub3QuAAAAAAAAC25vcm1hbF9mb3JtAAAAAAEAAAF0VGhlIGNvbXBpbGVkIGByZWNvdmVyeWAgbWVtYmVyOiB6ZXJvIG9yIG9uZSBlbnRyaWVzIChhIGBWZWNgIGJlY2F1c2UKYCNbY29udHJhY3R0eXBlXWAgaGFzIG5vIGNvbnZlcnNpb24gZm9yIGFuIGBPcHRpb25gIG9mIGEgY3VzdG9tIHN0cnVjdDsKYE9wdGlvbjx1MzI+YCBvbiBbYENvbXBpbGVkUnVsZTo6dmFsaWRfdW50aWxgXSB3b3JrcyBiZWNhdXNlIGB1MzJgIGlzCmEgaG9zdCB0eXBlKS4gUHJlc2VudCDih5IgdGhlIGRvY3VtZW50IGVucm9sbHMgYWNjb3VudCByZWNvdmVyeSwgYW5kIHRoZQphcHBsaWVyIHN5bmNzIHRoaXMgY29uZmlndXJhdGlvbiB0byB0aGUgY29udHJvbGxlciBpbnN0YW5jZSBpdCBuYW1lcwooYGRvY3MvcmVjb3ZlcnkvYCkuAAAACHJlY292ZXJ5AAAD6gAAB9AAAAAWQ29tcGlsZWRSZWNvdmVyeUNvbmZpZwAAAAAAPE9uZSBjb21waWxlZCBydWxlIHBlciBkb2N1bWVudCBydWxlLCBpbiB0aGUgc3VibWl0dGVkIG9yZGVyLgAAAAVydWxlcwAAAAAAA+oAAAfQAAAADENvbXBpbGVkUnVsZQAAANlFdmVyeSB2ZXJpZmllciB0aGUgZG9jdW1lbnQgbmFtZXMgYnkgY29udHJhY3QgaWQgYWxvbmUsIG9uY2UgZWFjaCwgaW4KZGVjbGFyYXRpb24gb3JkZXI6IHdoYXQgYSB3YWxsZXQgd2FybnMgYWJvdXQgKCJpdCBjYW4gYXBwcm92ZSBhbnl0aGluZwp0aGlzIHJ1bGUgYWxsb3dzIikuIEFsd2F5cyBlbXB0eSBmb3IgYW4gYWRtaW4gZG9jdW1lbnQsIHdoaWNoIG1heSBuYW1lCm5vbmUuAAAAAAAACnVudmVyaWZpZWQAAAAAA+oAAAATAAAAs09uZSBlbnRyeSBwZXIgZGVjbGFyZWQgc2lnbmVyLCBpbiBkZWNsYXJhdGlvbiBvcmRlcjogdGhlCmB2ZXJpZmllci1uYW1lYCBpdHMgdmVyaWZpZXIgd2FzIHJlc29sdmVkIGZyb20sIG9yIGVtcHR5IGZvciBhCmRlbGVnYXRlZCBzaWduZXIgYW5kIGEgdmVyaWZpZXIgbmFtZWQgYnkgY29udHJhY3QgaWQgYWxvbmUuAAAAAA52ZXJpZmllcl9uYW1lcwAAAAAD6gAAABA=",
        "AAAAAQAAAWFPbmUgcnVsZSwgY29tcGlsZWQgdG8gdGhlIHNoYXBlcyBPWidzIGBhZGRfY29udGV4dF9ydWxlYCB0YWtlczogaXRzCm5hbWUsIHJlc29sdmVkIHNjb3BlLCBpdHMgcHJpbmNpcGFscycgT1ogYFNpZ25lcmBzIGluIHRoZSBvcmRlciB0aGUKZG9jdW1lbnQgbmFtZXMgdGhlbSwgYW5kIGl0cyBsYXN0IGxlZGdlci4gT1oncyBjb250ZXh0IHJ1bGUgaXMgdGhlCnJlZ2lzdHJ5IG9mIHRoZSBydWxlJ3MgaWQgYW5kIHNpZ25lcnM7IHdoYXQgdGhlIHJ1bGUgYWxsb3dzIGlzIGl0cwpkb2N1bWVudCBydWxlIGluIFtgQ29tcGlsZWREb2M6Om1vZGVsYF0sIGF0IHRoZSBzYW1lIGluZGV4LCBhcyBydWxlLWV2YWwKbG93ZXJzIGl0LgAAAAAAAAAAAAAMQ29tcGlsZWRSdWxlAAAABAAAAFdUaGUgcnVsZSdzIG5hbWUgaW4gdGhlIGRvY3VtZW50LiBUaGUgYWNjb3VudCBtYXRjaGVzIGluc3RhbGxlZCBydWxlcwpieSBuYW1lIGFuZCBzY29wZS4AAAAABG5hbWUAAAAQAAAAAAAAAAVzY29wZQAAAAAAB9AAAAAJUnVsZVNjb3BlAAAAAAAAUFRoZSBydWxlJ3Mgc2lnbmVycywgd2l0aCBleHRlcm5hbCBrZXlzIGFzIGRlY2xhcmVkIChhbHJlYWR5CnZlcmlmaWVyLWNhbm9uaWNhbCkuAAAAB3NpZ25lcnMAAAAD6gAAB9AAAAAGU2lnbmVyAAAAAAB7VGhlIGxhc3QgbGVkZ2VyIHRoZSBydWxlIGF1dGhvcml6ZXMsIGlmIGJvdW5kZWQ6IE9aJ3MgaW5jbHVzaXZlCmB2YWxpZF91bnRpbGAsIG9uZSBiZWxvdyB0aGUgZG9jdW1lbnQncyBgbm90LWFmdGVyLWxlZGdlcmAuAAAAAAt2YWxpZF91bnRpbAAAAAPoAAAABA==",
        "AAAAAQAAAHBXaGF0IGBkZXJpdmVfdGFyZ2V0YCByZXR1cm5zOiB0aGUgcmVjb3ZlcnkgdGFyZ2V0IHRoZSBjb250cm9sbGVyIGJpbmRzCmludG8gYW4gYXR0ZW1wdCdzIHN0YXRlbWVudCAoc3BlYyDCpzcuMSkuAAAAAAAAAA1EZXJpdmVkVGFyZ2V0AAAAAAAABQAAAFJUaGUgdGFyZ2V0J3MgY2Fub25pY2FsIGJ5dGVzOiBleGFjdGx5IHdoYXQgdGhlIGNvbXBsZXRpbmcgYGFwcGx5X2RvY2AKbXVzdCBzdWJtaXQuAAAAAAAJY2Fub25pY2FsAAAAAAAADgAAAGhUaGUgdGFyZ2V0J3MgcmVjb3ZlcnkgYGNvbmZpZ19oYXNoYCAodGhlIGN1cnJlbnQgb25lLCBvciB0aGUgY3VycmVudApvbmUgd2l0aCB0aGUgZGVjbGFyZWQgWksgcm90YXRpb24pLgAAAAtjb25maWdfaGFzaAAAAAPuAAAAIAAAADFgc2hhMjU2YCBvZiBgY2Fub25pY2FsYDogdGhlIHRhcmdldCdzIGBkb2NfaGFzaGAuAAAAAAAACGRvY19oYXNoAAAD7gAAACAAAABDRmluZ2VycHJpbnRzIG9mIGV2ZXJ5IGNyZWRlbnRpYWwgaW4gdGhlIHRhcmdldCAoc3BlYyDCpzcuMyBydWxlIDcpLgAAAAAMZmluZ2VycHJpbnRzAAAD6gAAA+4AAAAgAAABR1RoZSBjcmVkZW50aWFscyBvY2N1cHlpbmcgdGhlIHJlcGxhY2VkIHNpZ25lciBzbG90cyBpbiB0aGUgc291cmNlOgp0aGUgYXBwbGllZCBkb2N1bWVudCdzIGZvciBsb3N0LWtleSwgdGhlIGJhc2VsaW5lJ3MgZm9yIGNvbXByb21pc2UuCkV4dGVybmFsIGtleXMgYXJlIGNhbm9uaWNhbGl6ZWQgYnkgdGhlaXIgdmVyaWZpZXIsIHNvIGEgY3JlZGVudGlhbCdzCmBmaW5nZXJwcmludGAgaXMgdGhlIG9uZSByZXZvY2F0aW9uIGNvbXBhcmVzLiBUaGUgY29udHJvbGxlciByZWNvcmRzCnRoZW0gYXQgVDEgYW5kIHRoZSBjb21wbGV0aW9uIHJldm9rZXMgdGhlbSAoc3BlYyDCpzgpLgAAAAAIcmVwbGFjZWQAAAPqAAAH0AAAAApDcmVkZW50aWFsAAA=",
        "AAAAAQAAAHVGbGF0IHBlci1kb2N1bWVudCBjYXBzOiBbYE1BWF9ET0NfU0lHTkVSU2BdLCBbYE1BWF9ET0NfUlVMRVNgXSwKW2BNQVhfRE9DX0NBTk9OSUNBTF9CWVRFU2BdLCBbYE1BWF9SVUxFX05BTUVfQllURVNgXS4AAAAAAAAAAAAADUZsYXREb2NMaW1pdHMAAAAAAAAEAAAAAAAAABNtYXhfY2Fub25pY2FsX2J5dGVzAAAAAAQAAAAAAAAAE21heF9ydWxlX25hbWVfYnl0ZXMAAAAABAAAAAAAAAAJbWF4X3J1bGVzAAAAAAAABAAAAAAAAAALbWF4X3NpZ25lcnMAAAAABA==",
        "AAAABAAAAGRFdmVyeXRoaW5nIGBjb21waWxlX2RvY2AgY2FuIHJlZnVzZS4gKGAjW3NjZXJyXWAgYXNzaWducyBzZXF1ZW50aWFsIGNvZGVzCmZyb20gMSwgaW4gdmFyaWFudCBvcmRlci4pAAAAAAAAABBEb2NDb21waWxlckVycm9yAAAACwAAACtUaGUgc3VibWl0dGVkIGRvY3VtZW50IGJ5dGVzIGFyZSBub3QgVVRGLTguAAAAAApEb2NOb3RVdGY4AAAAAAABAAAAbFRoZSBkb2N1bWVudCBmYWlsZWQgZmFpbC1jbG9zZWQgcGFyc2luZyAodW5rbm93biBmaWVsZCwgYmFkIHNoYXBlLCB1bnN1cHBvcnRlZCB2ZXJzaW9uLCBkdXBsaWNhdGUga2V5LCDigKYpLgAAAAhEb2NQYXJzZQAAAAIAAACoVGhlIGRvY3VtZW50IGZhaWxlZCBzZW1hbnRpYyB2YWxpZGF0aW9uIChkYW5nbGluZyBzaWduZXIgcmVmLCBtYWxmb3JtZWQgYWRkcmVzcyBvciBrZXksIGFtYmlndW91cyBlbXB0eSBsaXN0LCDigKYpIG9yIG5hbWVzIGl0cyB2ZXJpZmllcnMgYXMgdGhlIGNvbXBpbGVyIGRvZXMgbm90IHRha2UuAAAACkRvY0ludmFsaWQAAAAAAAMAAABDVGhlIGRvY3VtZW50IG5hbWVzIG5vIG5ldHdvcmssIG9yIGEgbmV0d29yayB0aGF0IGlzIG5vdCB0aGlzIGNoYWluLgAAAAAMV3JvbmdOZXR3b3JrAAAABAAAAG1UaGUgZG9jdW1lbnQgY2Fubm90IGJlIGxvd2VyZWQgdG8gcnVsZXM6IGEgcnVsZSB3aXRoIHNlbGYtYXV0aGVudGljYXRpbmcgcHJpbmNpcGFscywgb3IgdG9vIG1hbnkgY29uc3RyYWludHMuAAAAAAAACkRvY0NvbXBpbGUAAAAAAAUAAABEVGhlIGRvY3VtZW50IGV4Y2VlZHMgYSBjYXAgb24gc2lnbmVycywgcnVsZXMsIGJ5dGVzLCBvciBuYW1lIGxlbmd0aC4AAAALRG9jVG9vTGFyZ2UAAAAABgAAAD1BIHNpZ25lcidzIGV4dGVybmFsIGBrZXlgIGlzIG5vdCBpdHMgdmVyaWZpZXItY2Fub25pY2FsIGZvcm0uAAAAAAAAFUtleU5vdENhbm9uaWNhbGl6YWJsZQAAAAAAAAcAAAA6YGRlcml2ZV90YXJnZXRgOiB0aGUgY3VycmVudCBkb2N1bWVudCBlbnJvbGxzIG5vIHJlY292ZXJ5LgAAAAAAC05vdEVucm9sbGVkAAAAAAgAAABqYGRlcml2ZV90YXJnZXRgOiB0aGUgcmVwbGFjZW1lbnQgc2V0IGJyZWFrcyBzcGVjIMKnNy4zIHJ1bGVzIDEtMywgb3IgdGhlIGFjdGlvbiBpcyBub3QgYSByZWNvdmVyeSBhdHRlbXB0LgAAAAAAElJlcGxhY2VtZW50UmVmdXNlZAAAAAAACQAAAFVgZGVyaXZlX3RhcmdldGA6IHRoZSBaSyBlbnJvbGxtZW50IGlzIG1pc3NpbmcsIHVuZXhwZWN0ZWQsIG9yIHJldXNlcyB0aGUgZW5yb2xsZWQgaWQuAAAAAAAAFFprRW5yb2xsbWVudE1pc21hdGNoAAAACgAAAGhgZGVyaXZlX3RhcmdldGA6IHRoZSB0YXJnZXQgaGFzIG5vIGNvbnN0cmFpbnQtZnJlZSBzZWxmLWFkbWluIHJ1bGUgd2l0aCBhIHNpZ25lciAodGhlIGFudGktYnJpY2sgY2hlY2spLgAAAAxBZG1pbkxvY2tvdXQAAAAL",
        "AAAAAQAAAG9UaGUgY2Fub25pY2FsIGZvcm0gYW5kIGZyYWdtZW50IGhhc2hlcyBhIGNvbXBpbGVyIHByb2R1Y2VzLCBhcwpbYFBlcmNoRG9jQ29tcGlsZXI6OmNhcGFiaWxpdGllc2BdIHJldHVybnMgdGhlbS4AAAAAAAAAABRDb21waWxlckNhcGFiaWxpdGllcwAAAAMAAAA9VGhlIENBTk9OIHZlcnNpb24gYGRvY19oYXNoYCBpcyBgc2hhMjU2YCBvZiAoYENBTk9OSUNBTC5tZGApLgAAAAAAAA1jYW5vbl92ZXJzaW9uAAAAAAAABAAAAEFUaGUgZG9tYWluIHRhZyBvZiBhIHJlY292ZXJ5IG1lbWJlcidzIGBjb25maWdfaGFzaGAgKHNwZWMgwqczLjIpLgAAAAAAAA9jb25maWdfaGFzaF90YWcAAAAAEAAAADRUaGUgZG9tYWluIHRhZyBvZiBhIHJ1bGUncyBgcnVsZV9oYXNoYCAoc3BlYyDCpzMuMikuAAAADXJ1bGVfaGFzaF90YWcAAAAAAAAQ",
        "AAAAAQAAABZgcnVsZV9ldmFsOjpaa0ZhY3RvcmAuAAAAAAAAAAAAB01vZGVsWmsAAAAAAgAAAAAAAAAHYWRhcHRlcgAAAAATAAAAAAAAAARwb29sAAAAEw==",
        "AAAAAQAAABtgcnVsZV9ldmFsOjpBcmdDb25zdHJhaW50YC4AAAAAAAAAAAhNb2RlbEFyZwAAAAIAAAAAAAAABWluZGV4AAAAAAAABAAAAAAAAAAEcHJlZAAAB9AAAAAJTW9kZWxQcmVkAAAA",
        "AAAAAQAAABRgcnVsZV9ldmFsOjpEb2NDYXBgLgAAAAAAAAAITW9kZWxDYXAAAAACAAAAAAAAAAVsaW1pdAAAAAAAAAsAAAAAAAAADnBlcmlvZF9sZWRnZXJzAAAAAAAE",
        "AAAAAgAAABJgcnVsZV9ldmFsOjpQcmVkYC4AAAAAAAAAAAAJTW9kZWxQcmVkAAAAAAAABQAAAAAAAAAAAAAABklzU2VsZgAAAAAAAQAAAAAAAAAJQWRkcmVzc0VxAAAAAAAAAQAAABMAAAABAAAAAAAAAAhTdHJpbmdJbgAAAAEAAAPqAAAAEAAAAAEAAAAAAAAADFN0cmluZ1ByZWZpeAAAAAEAAAAQAAAAAQAAAAAAAAAFVTMyRXEAAAAAAAABAAAABA==",
        "AAAAAQAAABVgcnVsZV9ldmFsOjpEb2NSdWxlYC4AAAAAAAAAAAAACU1vZGVsUnVsZQAAAAAAAAYAAAAAAAAABGFyZ3MAAAPoAAAD6gAAB9AAAAAITW9kZWxBcmcAAABVWmVybyBvciBvbmUgZW50cmllczogYCNbY29udHJhY3R0eXBlXWAgaGFzIG5vIGBPcHRpb25gIG9mIGEKYCNbY29udHJhY3R0eXBlXWAgc3RydWN0LgAAAAAAAANjYXAAAAAD6gAAB9AAAAAITW9kZWxDYXAAAAAAAAAACWZ1bmN0aW9ucwAAAAAAA+gAAAPqAAAAEQAAAAAAAAAQbm90X2FmdGVyX2xlZGdlcgAAA+gAAAAEAAAAAAAAAApwcmluY2lwYWxzAAAAAAfQAAAAD01vZGVsUHJpbmNpcGFscwAAAAAAAAAABXNjb3BlAAAAAAAH0AAAAApNb2RlbFNjb3BlAAA=",
        "AAAAAgAAABNgcnVsZV9ldmFsOjpTY29wZWAuAAAAAAAAAAAKTW9kZWxTY29wZQAAAAAAAgAAAAEAAAAAAAAACENvbnRyYWN0AAAAAQAAABMAAAAAAAAAAAAAAAlTZWxmQWRtaW4AAAA=",
        "AAAAAQAAABhgcnVsZV9ldmFsOjpTaWduZXJEZWNsYC4AAAAAAAAAC01vZGVsU2lnbmVyAAAAAAIAAAAAAAAAAmlkAAAAAAAQAAAAAAAAAAZzaWduZXIAAAAAB9AAAAAGU2lnbmVyAAA=",
        "AAAAAQAAABFgcnVsZV9ldmFsOjpEb2NgLgAAAAAAAAAAAAANQ29tcGlsZWRNb2RlbAAAAAAAAAMAAAAUWmVybyBvciBvbmUgZW50cmllcy4AAAAIcmVjb3ZlcnkAAAPqAAAH0AAAAA1Nb2RlbFJlY292ZXJ5AAAAAAAAAAAAAAVydWxlcwAAAAAAA+oAAAfQAAAACU1vZGVsUnVsZQAAAAAAAAAAAAAHc2lnbmVycwAAAAPqAAAH0AAAAAtNb2RlbFNpZ25lcgA=",
        "AAAAAQAAABZgcnVsZV9ldmFsOjpSZWNvdmVyeWAuAAAAAAAAAAAADU1vZGVsUmVjb3ZlcnkAAAAAAAACAAAAAAAAAApjb250cm9sbGVyAAAAAAATAAAAFFplcm8gb3Igb25lIGVudHJpZXMuAAAAAnprAAAAAAPqAAAH0AAAAAdNb2RlbFprAA==",
        "AAAAAgAAACRgcnVsZV9ldmFsOjpQcmluY2lwYWxzYDogc2lnbmVyIGlkcy4AAAAAAAAAD01vZGVsUHJpbmNpcGFscwAAAAACAAAAAQAAAAAAAAADQWxsAAAAAAEAAAPqAAAAEAAAAAEAAAAAAAAACVRocmVzaG9sZAAAAAAAAAIAAAPqAAAAEAAAAAQ=",
        "AAAAAQAAABFgcnVsZV9ldmFsOjpDYXBgLgAAAAAAAAAAAAAJU3RvcmVkQ2FwAAAAAAAAAwAAAAAAAAAKYW1vdW50X2FyZwAAAAAABAAAAAAAAAAFbGltaXQAAAAAAAALAAAAAAAAAAZwZXJpb2QAAAAAAAQ=",
        "AAAAAgAAABFgcnVsZV9ldmFsOjpWYWxgLgAAAAAAAAAAAAAJU3RvcmVkVmFsAAAAAAAACAAAAAEAAAAAAAAABEkxMjgAAAABAAAACwAAAAEAAAAAAAAAA1U2NAAAAAABAAAABgAAAAEAAAAAAAAABEJvb2wAAAABAAAAAQAAAAEAAAAAAAAABUJ5dGVzAAAAAAAAAQAAAA4AAAABAAAAAAAAAAdBZGRyZXNzAAAAAAEAAAATAAAAAQAAAAAAAAAGU3ltYm9sAAAAAAABAAAAEQAAAAEAAAAAAAAABlN0cmluZwAAAAAAAQAAABAAAAABAAAALEFueSBvdGhlciBhcmd1bWVudCwgYXMgaXRzIGZ1bGwgYFNjVmFsYCBYRFIuAAAABU90aGVyAAAAAAAAAQAAAA4=",
        "AAAAAgAAABJgcnVsZV9ldmFsOjpDb25kYC4AAAAAAAAAAAAKU3RvcmVkQ29uZAAAAAAABAAAAAEAAAAAAAAABUFyZ0VxAAAAAAAAAgAAAAQAAAfQAAAACVN0b3JlZFZhbAAAAAAAAAEAAAAAAAAADUFyZ0kxMjhBdE1vc3QAAAAAAAACAAAABAAAAAsAAAABAAAAAAAAAAVBcmdJbgAAAAAAAAIAAAAEAAAD6gAAB9AAAAAJU3RvcmVkVmFsAAAAAAAAAQAAAAAAAAAMQXJnU3RyUHJlZml4AAAAAgAAAAQAAAAQ",
        "AAAAAQAAABJgcnVsZV9ldmFsOjpSdWxlYC4AAAAAAAAAAAAKU3RvcmVkUnVsZQAAAAAACAAAAFVaZXJvIG9yIG9uZSBlbnRyaWVzOiBgI1tjb250cmFjdHR5cGVdYCBoYXMgbm8gYE9wdGlvbmAgb2YgYQpgI1tjb250cmFjdHR5cGVdYCBzdHJ1Y3QuAAAAAAAAA2NhcAAAAAPqAAAH0AAAAAlTdG9yZWRDYXAAAAAAAAAAAAAABWNvbmRzAAAAAAAD6gAAB9AAAAAKU3RvcmVkQ29uZAAAAAAAAAAAAAhjb250cmFjdAAAABMAAAAAAAAACWZ1bmN0aW9ucwAAAAAAB9AAAAAPU3RvcmVkRnVuY3Rpb25zAAAAAAAAAAAKZ2VuZXJhdGlvbgAAAAAD6AAAAAYAAAAAAAAAB3NpZ25lcnMAAAAD6gAAB9AAAAAGU2lnbmVyAAAAAAAAAAAACXRocmVzaG9sZAAAAAAAAAQAAAAAAAAAC3ZhbGlkX3VudGlsAAAAA+gAAAAE",
        "AAAAAQAAABhgcnVsZV9ldmFsOjpTcGVuZEVudHJ5YC4AAAAAAAAAC1N0b3JlZEVudHJ5AAAAAAIAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAGbGVkZ2VyAAAAAAAE",
        "AAAAAQAAABlgcnVsZV9ldmFsOjpTcGVuZFJlY29yZGAuAAAAAAAAAAAAAAxTdG9yZWRSZWNvcmQAAAACAAAAAAAAAAdoaXN0b3J5AAAAA+oAAAfQAAAAC1N0b3JlZEVudHJ5AAAAAAAAAAAFdG90YWwAAAAAAAAL",
        "AAAAAgAAABdgcnVsZV9ldmFsOjpGdW5jdGlvbnNgLgAAAAAAAAAAD1N0b3JlZEZ1bmN0aW9ucwAAAAACAAAAAQAAAAAAAAAJQW55RXhjZXB0AAAAAAAAAQAAA+oAAAARAAAAAQAAAAAAAAAET25seQAAAAEAAAPqAAAAEQ==",
        "AAAAAQAAACxXaGF0IGEgY29tcGxldGlvbiBoYW5kcyBiYWNrIHRvIHRoZSBhY2NvdW50LgAAAAAAAAAKQ29tcGxldGlvbgAAAAAAAgAAABtUaGUgYXR0ZW1wdCB0aGF0IGNvbXBsZXRlZC4AAAAACmF0dGVtcHRfaWQAAAAAAAYAAAIQVGhlIGNyZWRlbnRpYWxzIHRoYXQgb2NjdXBpZWQgdGhlIHJlcGxhY2VkIHNpZ25lciBzbG90cyAqKmluIHRoZQphdHRlbXB0J3Mgc291cmNlIGRvY3VtZW50KiosIGFzIGRlcml2ZWQgYXQgVDE6IHRoZSBhcHBsaWVkIGRvY3VtZW50CmZvciBsb3N0LWtleSwgdGhlIGJhc2VsaW5lIGZvciBjb21wcm9taXNlLiBUaGUgYWNjb3VudCBmaW5nZXJwcmludHMKdGhlbSBvdmVyIGNhbm9uaWNhbCBrZXlzIGFuZCByZXZva2VzIHRoZW0gdG9nZXRoZXIgd2l0aCBldmVyeQpjcmVkZW50aWFsIHRoZSBjb21wbGV0aW9uIHJlbW92ZWQgZnJvbSBpdHMgY3VycmVudCBkb2N1bWVudC4gV2l0aG91dAp0aGVzZSwgYSBiYXNlbGluZSBjcmVkZW50aWFsIHJlcGxhY2VkIGJ5IGEgY29tcHJvbWlzZSByZWNvdmVyeSwgYW5kCmFscmVhZHkgYWJzZW50IGZyb20gdGhlIGN1cnJlbnQgZG9jdW1lbnQsIHdvdWxkIHN0YXkgdW5yZXZva2VkIGFuZApjb3VsZCBiZSByZXN0b3JlZCBieSBhIGxhdGVyIHJlY292ZXJ5IGZyb20gdGhlIHNhbWUgYmFzZWxpbmUuAAAACHJlcGxhY2VkAAAD6gAAB9AAAAAKQ3JlZGVudGlhbAAA",
        "AAAAAgAAAFhXaGF0IGByY3Zfc3luY2AgZGlkLCBzbyB0aGUgYWNjb3VudCBrbm93cyB3aGljaCBvZiBpdHMgb3duIGVmZmVjdHMgdG8KYXBwbHkgKHNwZWMgwqcxMCkuAAAAAAAAAAtTeW5jT3V0Y29tZQAAAAAFAAAAAAAAAB9Ob3RoaW5nIGFib3V0IHJlY292ZXJ5IGNoYW5nZWQuAAAAAAlVbmNoYW5nZWQAAAAAAAAAAAAAMEEgY29uZmlndXJhdGlvbiB3YXMgZW5yb2xsZWQgYXQgdGhpcyBjb250cm9sbGVyLgAAAAhFbnJvbGxlZAAAAAAAAAAoVGhlIGVucm9sbGVkIGNvbmZpZ3VyYXRpb24gd2FzIHJlcGxhY2VkLgAAAAxSZWNvbmZpZ3VyZWQAAAAAAAAAdVRoZSBjb25maWd1cmF0aW9uIHdhcyByZW1vdmVkIGZyb20gdGhpcyBjb250cm9sbGVyIChyZWNvdmVyeQpyZW1vdmVkLCBvciB0aGUgYWNjb3VudCBzd2l0Y2hlZCB0byBhbm90aGVyIGNvbnRyb2xsZXIpLgAAAAAAAAdSZW1vdmVkAAAAAAEAAAFzVGhlIGF1dGhvcml6ZWQgYXR0ZW1wdCBjb21wbGV0ZWQgaW4gdGhpcyBpbnZvY2F0aW9uLiBUaGUgYWNjb3VudAppbnNlcnRzIHRoZSBuZXcgbGVhZiBpZiB0aGUgZW5yb2xsbWVudCBpZCBjaGFuZ2VkLCByZWNvcmRzIHRoZQplbnJvbGxtZW50IGlkLCByZXZva2VzIFtgQ29tcGxldGlvbjo6cmVwbGFjZWRgXSB0b2dldGhlciB3aXRoIGV2ZXJ5CmNyZWRlbnRpYWwgdGhlIGNvbXBsZXRpb24gcmVtb3ZlZCBmcm9tIGl0cyBjdXJyZW50IGRvY3VtZW50IChzcGVjIMKnODsKYGNyZWRlbnRpYWw6OnJldm9jYXRpb25zYCBjb21wdXRlcyB0aGUgdW5pb24pLCBjbGVhcnMKaXRzIHBlbmRpbmcgdXBncmFkZSwgYW5kIGNsZWFycyBpdHMgZnJlZXplIG1pcnJvci4AAAAACUNvbXBsZXRlZAAAAAAAAAEAAAfQAAAACkNvbXBsZXRpb24AAA==",
        "AAAAAgAAAEhXaGljaCBwaGFzZSBvZiBhbiBhY2NvdW50IHVwZ3JhZGUgYHJjdl91cGdyYWRlYCBpcyBjaGVja2luZyAoc3BlYyDCpzEyKS4AAAAAAAAAC1VwZ3JhZGVTdGVwAAAAAAIAAAABAAAAlWBzY2hlZHVsZV91cGdyYWRlYDogcmVmdXNlIGR1cmluZyBhbiBhdXRob3JpemVkIHdpbmRvdzsgdW5kZXIKYFByb3RlY3RlZGAsIHJlcXVpcmUgcmVjb3JkZWQgYXBwcm92YWxzIG9mIHRoaXMgc3ViamVjdCB2YWxpZCB0aHJvdWdoCnRoZSBnaXZlbiBsZWRnZXIuAAAAAAAACFNjaGVkdWxlAAAAAgAAB9AAAAAOVXBncmFkZVN1YmplY3QAAAAAAAQAAAABAAAAhWBleGVjdXRlX3VwZ3JhZGVgIG9mIGEgcmVxdWVzdCByZWNvcmRlZCBhdCB0aGlzIGVwb2NoOiByZWZ1c2UgZHVyaW5nCmFuIGF1dGhvcml6ZWQgd2luZG93IG9yIGlmIHRoZSBlcG9jaCBtb3ZlZCwgdGhlbiBidW1wIHRoZSBlcG9jaC4AAAAAAAAHRXhlY3V0ZQAAAAABAAAABg==",
        "AAAAAQAAAVxUaGUgYWNjb3VudCdzIHJlY292ZXJ5IHJ1bGUsIGFzIHRoZSBob29rcyB0aGF0IHNlcnZlIGl0IGFyZSB0b2xkIG9mIGl0CihzcGVjIMKnMTApOiBgcmN2X2luc3RhbGxgIHdoZW4gdGhlIGFjY291bnQgaW5zdGFsbHMgdGhlIHJ1bGUsIGFuZApgcmN2X2NvbXBsZXRlYCBmb3IgZWFjaCBjb250ZXh0IGEgY29tcGxldGlvbiBzZWxlY3RzIGl0IGZvci4gQQpjb250cm9sbGVyIHNlcnZlcyBvbmx5IGEgcnVsZSB0aGF0IHJlcXVpcmVzIG5vIHNpZ25lciBhbmQgYXV0aG9yaXplcwpjYWxscyBvbiB0aGUgYWNjb3VudCBhbG9uZSwgYW5kIHJlZnVzZXMgYW55IG90aGVyIHdpdGgKYE1hbGZvcm1lZENvbnRleHRSdWxlYC4AAAAAAAAADFJlY292ZXJ5UnVsZQAAAAIAAABxVGhlIGNvbnRyYWN0IHRoZSBydWxlIGF1dGhvcml6ZXMgY2FsbHMgb24sIHdoZW4gaXQgaXMgc2NvcGVkIHRvIG9uZQpjb250cmFjdCdzIGNhbGxzOyBgTm9uZWAgZm9yIGFueSBvdGhlciBzY29wZS4AAAAAAAAIY29udHJhY3QAAAPoAAAAEwAAACNIb3cgbWFueSBzaWduZXJzIHRoZSBydWxlIHJlcXVpcmVzLgAAAAAHc2lnbmVycwAAAAAE",
        "AAAABAAAAKFFdmVyeXRoaW5nIGEgcmVjb3ZlcnkgY29udHJvbGxlciBjYW4gcmVmdXNlLiBDb2RlcyBhcmUgc2VxdWVudGlhbCBmcm9tIDEKaW4gZGVjbGFyYXRpb24gb3JkZXIgYW5kIGFyZSB3aXJlIGZvcm1hdDogYXBwZW5kIG5ldyB2YXJpYW50cyBhdCB0aGUKZW5kLCBuZXZlciByZW9yZGVyLgAAAAAAAAAAAAANUmVjb3ZlcnlFcnJvcgAAAAAAAB8AAABBTm8gY29uZmlndXJhdGlvbiBpcyBlbnJvbGxlZCBmb3IgdGhpcyBhY2NvdW50IGF0IHRoaXMgY29udHJvbGxlci4AAAAAAAALTm90RW5yb2xsZWQAAAAAAQAAAFRBbiBhdHRlbXB0IGlzIGF1dGhvcml6ZWQgYW5kIGxpdmUsIHdoaWNoIGJsb2NrcyBiZWdpbiwgcG9saWN5IGNoYW5nZXMsIGFuZCB1cGdyYWRlcy4AAAARQXR0ZW1wdEF1dGhvcml6ZWQAAAAAAAACAAAAL05vIGF0dGVtcHQgd2l0aCB0aGlzIGlkIGV4aXN0cyBmb3IgdGhlIGFjY291bnQuAAAAAA1Ob1N1Y2hBdHRlbXB0AAAAAAAAAwAAAGNUaGUgYXR0ZW1wdCBpcyB0ZXJtaW5hbCwgZXhwaXJlZCwgZnJvbSBhbiBvbGRlciBlcG9jaCwgb3IgaW52YWxpZGF0ZWQgYnkgYSBzaWJsaW5nJ3MgYXV0aG9yaXphdGlvbi4AAAAADkF0dGVtcHROb3RMaXZlAAAAAAAEAAAAQEluaXRpYXRpb24gZXZpZGVuY2UgZm9yIGFuIGF0dGVtcHQgdGhhdCBpcyBubyBsb25nZXIgY29sbGVjdGluZy4AAAAUQXR0ZW1wdE5vdENvbGxlY3RpbmcAAAAFAAAAJUNvbXBsZXRpb24gYmVmb3JlIGBleGVjdXRhYmxlX2FmdGVyYC4AAAAAAAAQTm90RXhlY3V0YWJsZVlldAAAAAYAAABmVGhlIGNvbXBsZXRpb24gY29udGV4dCwgb3IgdGhlIGNvbXBpbGVkIGRvY3VtZW50IGhhc2gsIGRvZXMgbm90IG1hdGNoIHRoZSBhdXRob3JpemVkIGF0dGVtcHQncyB0YXJnZXQuAAAAAAALV3JvbmdUYXJnZXQAAAAABwAAAChUaGUgYWRkcmVzcyBpcyBub3QgYW4gZW5yb2xsZWQgZ3VhcmRpYW4uAAAADE5vdEFHdWFyZGlhbgAAAAgAAAA7VGhpcyBndWFyZGlhbiBvciBmYWN0b3IgYWxyZWFkeSBjb3VudGVkIGZvciB0aGlzIHN0YXRlbWVudC4AAAAADkFscmVhZHlDb3VudGVkAAAAAAAJAAAAKVRoZSBlbnJvbGxlZCBtb2RlIGhhcyBubyBndWFyZGlhbiBmYWN0b3IuAAAAAAAAEk1vZGVIYXNOb0d1YXJkaWFucwAAAAAACgAAACNUaGUgZW5yb2xsZWQgbW9kZSBoYXMgbm8gWksgZmFjdG9yLgAAAAALTW9kZUhhc05vWmsAAAAACwAAAD5UaGUgYWRhcHRlciByZWZ1c2VkIHRoZSBwcm9vZiAoaXRzIGBaa0FkYXB0ZXJFcnJvcmAgc2F5cyB3aHkpLgAAAAAAElprRXZpZGVuY2VSZWplY3RlZAAAAAAADAAAAB9UaGUgcHJvb2YncyBudWxsaWZpZXIgaXMgc3BlbnQuAAAAAA5OdWxsaWZpZXJTcGVudAAAAAAADQAAAD5UaGUgc3RhdGVtZW50J3MgZnJlc2huZXNzIGJvdW5kIGhhcyBwYXNzZWQgb3IgcmVhY2hlcyB0b28gZmFyLgAAAAAAD0V2aWRlbmNlRXhwaXJlZAAAAAAOAAAAR1RoZSBzdGF0ZW1lbnQgY2Fubm90IGJlIGVuY29kZWQgKGEgbm9uLWNvbnRyYWN0IGFjY291bnQgb3IgY29udHJvbGxlcikuAAAAABBJbnZhbGlkU3RhdGVtZW50AAAADwAAAF1SZWNvcmRlZCBhcHByb3ZhbHMgZG8gbm90IHNhdGlzZnkgdGhlIGVucm9sbGVkIGNvbmRpdGlvbiBmb3IgdGhpcyByZWNvbmZpZ3VyYXRpb24gb3IgdXBncmFkZS4AAAAAAAAPQ29uZGl0aW9uTm90TWV0AAAAABAAAAAnVGhlIGFjY291bnQncyBgbWF4LWNhbmNlbHNgIGlzIHVzZWQgdXAuAAAAABFNYXhDYW5jZWxzUmVhY2hlZAAAAAAAABEAAAAyT3duZXIgY2FuY2VsbGF0aW9uIGlzIG9ubHkgYXZhaWxhYmxlIHVuZGVyIGBMb3NzYC4AAAAAABJPd25lckNhbmNlbFJlZnVzZWQAAAAAABIAAABCVGhlIHJlcGxhY2VtZW50IHNldCBicmVha3MgYSDCpzcuMyBydWxlLCBvciBkZXJpdmF0aW9uIHJlZnVzZWQgaXQuAAAAAAATSW52YWxpZFJlcGxhY2VtZW50cwAAAAATAAAAOlRoZSB0YXJnZXQgb3IgYSByZXBsYWNlbWVudCBjb250YWlucyBhIHJldm9rZWQgY3JlZGVudGlhbC4AAAAAABFDcmVkZW50aWFsUmV2b2tlZAAAAAAAABQAAAA6VGhlIFpLIGVucm9sbG1lbnQgaWQgd2FzIGVucm9sbGVkIGZvciB0aGlzIGFjY291bnQgYmVmb3JlLgAAAAAAEkVucm9sbG1lbnRJZFJldXNlZAAAAAAAFQAAAC5Db21wcm9taXNlIHJlY292ZXJ5IHdpdGggbm8gYmFzZWxpbmUgZW5yb2xsZWQuAAAAAAAKTm9CYXNlbGluZQAAAAAAFgAAAEBDb21wcm9taXNlIHJlY292ZXJ5IGJlZm9yZSB0aGUgYmFzZWxpbmUncyBjb250ZW50IHdhcyBwdWJsaXNoZWQuAAAAFEJhc2VsaW5lTm90UHVibGlzaGVkAAAAFwAAAD5UaGUgcHVibGlzaGVkIGRvY3VtZW50IGRvZXMgbm90IGhhc2ggdG8gdGhlIGVucm9sbGVkIGJhc2VsaW5lLgAAAAAAEEJhc2VsaW5lTWlzbWF0Y2gAAAAYAAAAU1RoZSBhZGFwdGVyJ3MgY2lyY3VpdCBpZCBvciB0cmVlIGRlcHRoIGRvZXMgbm90IG1hdGNoIHRoZSBlbnJvbGxlZCBmYWN0b3IgYW5kIHBvb2wuAAAAABBaa1dpcmluZ01pc21hdGNoAAAAGQAAADJUaGUgWksgZmFjdG9yIGNoYW5nZWQgd2l0aG91dCBhIG5ldyBlbnJvbGxtZW50IGlkLgAAAAAAFlprRmFjdG9yQ2hhbmdlZEluUGxhY2UAAAAAABoAAAAfVGhlIGNvbmZpZ3VyYXRpb24gaXMgbWFsZm9ybWVkLgAAAAAUSW52YWxpZENvbmZpZ3VyYXRpb24AAAAbAAAAMUFuIHVwZ3JhZGUgcmVxdWVzdCByZWNvcmRlZCB1bmRlciBhbiBvbGRlciBlcG9jaC4AAAAAAAAMU3RhbGVVcGdyYWRlAAAAHAAAAC9BIGxlZGdlci1zZXF1ZW5jZSBjb21wdXRhdGlvbiBvdmVyZmxvd2VkIGB1MzJgLgAAAAAOTGVkZ2VyT3ZlcmZsb3cAAAAAAB0AAAA5QSBob29rIHdhcyBjYWxsZWQgZm9yIGEgcmVjb3ZlcnkgcnVsZSBvZiB0aGUgd3Jvbmcgc2hhcGUuAAAAAAAAFE1hbGZvcm1lZENvbnRleHRSdWxlAAAAHgAAADtUaGUgdGFyZ2V0IGtlZXBzIGEgY3JlZGVudGlhbCB0aGUgcmVwbGFjZW1lbnQgc2V0IHJlcGxhY2VzLgAAAAAaUmVwbGFjZWRDcmVkZW50aWFsUmV0YWluZWQAAAAAAB8=",
        "AAAAAgAAAE5BIHNpZ25lciBjcmVkZW50aWFsLCBzaGFwZWQgbGlrZSBPWiBgc3RlbGxhcl9hY2NvdW50czo6c21hcnRfYWNjb3VudDo6U2lnbmVyYC4AAAAAAAAAAAAKQ3JlZGVudGlhbAAAAAAAAgAAAAEAAABsYFNpZ25lcjo6RGVsZWdhdGVkKGFkZHJlc3MpYDogYSBgRy4uLmAgb3IgYEMuLi5gIGFkZHJlc3MgdGhhdAphdXRoZW50aWNhdGVzIHRocm91Z2ggQ0FQLTAwNzEgZGVsZWdhdGVkIGF1dGguAAAACURlbGVnYXRlZAAAAAAAAAEAAAATAAAAAQAAAEhgU2lnbmVyOjpFeHRlcm5hbCh2ZXJpZmllciwga2V5KWA6IGEga2V5IGNoZWNrZWQgYnkgYSB2ZXJpZmllcgpjb250cmFjdC4AAAAIRXh0ZXJuYWwAAAACAAAAEwAAAA4=",
        "AAAAAQAAAGxPbmUgZGVzaWduYXRlZCBzaWduZXIgc2xvdCBhbmQgdGhlIGNyZWRlbnRpYWwgdGhhdCByZXBsYWNlcyB3aGF0ZXZlcgp0aGF0IHNsb3QgaG9sZHMgaW4gdGhlIHNvdXJjZSBkb2N1bWVudC4AAAAAAAAAC1JlcGxhY2VtZW50AAAAAAIAAAA4VGhlIGNyZWRlbnRpYWwgdGhlIHRhcmdldCBkb2N1bWVudCBnaXZlcyB0aGF0IHNpZ25lciBpZC4AAAAKY3JlZGVudGlhbAAAAAAH0AAAAApDcmVkZW50aWFsAAAAAABDQSBkb2N1bWVudCBzaWduZXIgaWQgbGlzdGVkIGluIHRoZSBlbnJvbGxlZCBgcmVjb3ZlcnkucmVwbGFjZWFibGVgLgAAAAAJc2lnbmVyX2lkAAAAAAAAEA==",
        "AAAAAQAAAVVBIFpLIGVucm9sbG1lbnQgYSByZWNvdmVyeSBjb21wbGV0aW9uIGluc3RhbGxzLgoKVGhlIGNvbW1pdG1lbnQgaXMgYm91bmQgaGVyZSwgbm90IG9ubHkgdGhlIGlkOiBjb21wbGV0aW9uIHJ1bnMgdW5kZXIgdGhlCnplcm8tc2lnbmVyIHJlY292ZXJ5IHJ1bGUsIHNvIG5vdGhpbmcgc2lnbnMgaXRzIGFyZ3VtZW50cywgYW5kIGEKY29tbWl0bWVudCBzdXBwbGllZCBvbmx5IGF0IGNvbXBsZXRpb24gY291bGQgYmUgc3dhcHBlZCBieSB3aG9ldmVyCnN1Ym1pdHMgdGhlIGNvbXBsZXRpbmcgdHJhbnNhY3Rpb24gZmlyc3Qg4oCUIGhhbmRpbmcgdGhlbSB0aGUgYWNjb3VudCdzCm5leHQgWksgZmFjdG9yLgAAAAAAAAAAAAAMWmtFbnJvbGxtZW50AAAAAgAAARlUaGUgbmV3IGxlYWYncyBpbm5lciBjb21taXRtZW50LCBgUG9zZWlkb24yKERPTV9MRUFGLCBzZWNyZXQpYC4KRGVyaXZhdGlvbiB3cml0ZXMgYGlkYCBhbmQgYGNvbW1pdG1lbnRgIGludG8gdGhlIHRhcmdldCBkb2N1bWVudCdzCnJlY292ZXJ5IHNlY3Rpb24sIHNvIHRoZSB0YXJnZXQgaGFzaCBiaW5kcyB0aGVtLCBhbmQgdGhlIGNvbXBsZXRpbmcKYGFwcGx5X2RvY2AgaW5zZXJ0cyB0aGUgbGVhZiBmcm9tIHRoZSBjb21waWxlZCB0YXJnZXQsIG5ldmVyIGZyb20gYQpjYWxsIGFyZ3VtZW50LgAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAE1UaGUgbmV3IGVucm9sbG1lbnQgaWQuIE11c3QgbmV2ZXIgaGF2ZSBiZWVuIGVucm9sbGVkIGZvciB0aGlzCmFjY291bnQgYmVmb3JlLgAAAAAAAAJpZAAAAAAD7gAAACA=",
        "AAAAAQAAAG9FdmVyeXRoaW5nIGEgYExvc3RLZXlgL2BDb21wcm9taXNlYCBhdHRlbXB0IGNoYW5nZXMgYWJvdXQgdGhlIHNvdXJjZQpkb2N1bWVudC4gU2VlIGBkb2NzL3JlY292ZXJ5L3NwZWMubWRgIMKnNy4AAAAAAAAAAA5SZXBsYWNlbWVudFNldAAAAAAAAgAAAHVTaWduZXIgcmVwbGFjZW1lbnRzIGluIHN0cmljdGx5IGFzY2VuZGluZyBgc2lnbmVyX2lkYCBieXRlIG9yZGVyCihzb3J0ZWQsIG5vIGR1cGxpY2F0ZXMpIOKAlCB0aGUgb25lIGNhbm9uaWNhbCBvcmRlci4AAAAAAAAHc2lnbmVycwAAAAPqAAAH0AAAAAtSZXBsYWNlbWVudAAAAAElVGhlIGZyZXNoIFpLIGVucm9sbG1lbnQgdGhlIGNvbXBsZXRpb24gaW5zdGFsbHMsIHJlcXVpcmVkIGV4YWN0bHkKd2hlbiB0aGUgZW5yb2xsZWQgbW9kZSBoYXMgYSBaSyBmYWN0b3IgKGEgWkstZXZpZGVuY2VkIGNvbXBsZXRpb24KY29uc3VtZXMgdGhlIGVucm9sbGVkIGNyZWRlbnRpYWwsIHNvIGl0IG11c3QgaW5zdGFsbCBhIGZyZXNoIG9uZSkuCkVtcHR5IG9yIG9uZSBlbnRyeSDigJQgYSBgVmVjYCBiZWNhdXNlIGAjW2NvbnRyYWN0dHlwZV1gIGNhbm5vdCBkZXJpdmUKYE9wdGlvbjxDdXN0b21TdHJ1Y3Q+YC4AAAAAAAANemtfZW5yb2xsbWVudAAAAAAAA+oAAAfQAAAADFprRW5yb2xsbWVudA==",
        "AAAAAQAAAI5XaGljaCBlbnJvbGxlZCBaSyBmYWN0b3IgYSBzdGF0ZW1lbnQgaXMgY2hlY2tlZCBhZ2FpbnN0LiBUaGUgY29udHJvbGxlcgpidWlsZHMgdGhpcyBmcm9tIGl0cyBzdG9yZWQgY29uZmlndXJhdGlvbiDigJQgbmV2ZXIgZnJvbSBjYWxsZXIgaW5wdXQuAAAAAAAAAAAACVprQmluZGluZwAAAAAAAAMAAAB1VGhlIGNpcmN1aXQgaWRlbnRpdHkgdGhlIGVucm9sbGluZyBkb2N1bWVudCBuYW1lZC4gVGhlIGFkYXB0ZXIKcmVmdXNlcyBhbnkgYmluZGluZyB3aG9zZSBgY2lyY3VpdF9pZGAgaXMgbm90IGl0cyBvd24uAAAAAAAACmNpcmN1aXRfaWQAAAAAA+4AAAAgAAAAyFRoZSBlbnJvbGxlZCBjcmVkZW50aWFsJ3MgaWQsIGJvdW5kIGludG8gaXRzIGxlYWYgYW5kIGl0cyBudWxsaWZpZXIuCkEgbGVhZiBlbnJvbGxlZCB1bmRlciBhbnkgb3RoZXIgaWQg4oCUIGluY2x1ZGluZyB0aGUgYWNjb3VudCdzIG93bgplYXJsaWVyIGVucm9sbG1lbnRzIOKAlCBjYW5ub3Qgc2F0aXNmeSBhIHByb29mIGZvciB0aGlzIGJpbmRpbmcuAAAADWVucm9sbG1lbnRfaWQAAAAAAAPuAAAAIAAAAEVUaGUgZW5yb2xsZWQgbWVtYmVyc2hpcCBwb29sLiBSb290cyBhcmUgYWNjZXB0ZWQgb25seSBmcm9tIHRoaXMgcG9vbC4AAAAAAAAEcG9vbAAAABM=",
        "AAAAAQAAABpPbmUgWksgcHJvb2YgYXMgc3VibWl0dGVkLgAAAAAAAAAAAApaa0V2aWRlbmNlAAAAAAAEAAAAP1RoZSBjcmVkZW50aWFsJ3MgbnVsbGlmaWVyICh0aGUgY2lyY3VpdCdzIHNlY29uZCBwdWJsaWMgaW5wdXQpLgAAAAAJbnVsbGlmaWVyAAAAAAAD7gAAACAAAAAVVGhlIHNlcmlhbGl6ZWQgcHJvb2YuAAAAAAAABXByb29mAAAAAAAADgAAAGBUaGUgcm9vdCB0aGUgcHJvb2Ygd2FzIGdlbmVyYXRlZCBhZ2FpbnN0OyBtdXN0IGJlIGFjY2VwdGFibGUgdG8gdGhlCmVucm9sbGVkIHBvb2wgZm9yIGB0cmVlX2lkYC4AAAAEcm9vdAAAA+4AAAAgAAAALFRoZSBwb29sIHRyZWUgdGhlIHByb29mJ3MgTWVya2xlIHBhdGggaXMgaW4uAAAAB3RyZWVfaWQAAAAABA==",
        "AAAABAAAAIVFdmVyeXRoaW5nIFtgWmtBZGFwdGVySW50ZXJmYWNlOjp2ZXJpZnlgXSBjYW4gcmVmdXNlLiBFYWNoIGlzIGEgcmVmdXNhbApvZiB0aGlzIGV2aWRlbmNlIG9ubHk7IG5vbmUgaXMgYSBzdGF0ZW1lbnQgYWJvdXQgdGhlIGFjY291bnQuAAAAAAAAAAAAAA5aa0FkYXB0ZXJFcnJvcgAAAAAACAAAADlUaGUgYmluZGluZyBuYW1lcyBhIGNpcmN1aXQgdGhpcyBhZGFwdGVyIGRvZXMgbm90IHZlcmlmeS4AAAAAAAAPQ2lyY3VpdE1pc21hdGNoAAAAAAEAAABYVGhlIHN0YXRlbWVudCBjYW5ub3QgYmUgcHJvamVjdGVkIChpdHMgYWNjb3VudCBvciBjb250cm9sbGVyIGlzIG5vdCBhIGNvbnRyYWN0IGFkZHJlc3MpLgAAABBJbnZhbGlkU3RhdGVtZW50AAAAAgAAADdUaGUgcm9vdCBvciBudWxsaWZpZXIgaXMgbm90IGEgY2Fub25pY2FsIGZpZWxkIGVsZW1lbnQuAAAAABFOb25DYW5vbmljYWxGaWVsZAAAAAAAAAMAAAA0VGhlIGVucm9sbGVkIHBvb2wgZG9lcyBub3QgYWNjZXB0IGAodHJlZV9pZCwgcm9vdClgLgAAAAtVbmtub3duUm9vdAAAAAAEAAAAJlRoZSBlbnJvbGxlZCBwb29sIGNvdWxkIG5vdCBiZSBjYWxsZWQuAAAAAAAPUG9vbFVuYXZhaWxhYmxlAAAAAAUAAAA3VGhlIHByb29mIGlzIG5vdCB0aGUgbGVuZ3RoL3NoYXBlIHRoZSBjaXJjdWl0IHByb2R1Y2VzLgAAAAAOTWFsZm9ybWVkUHJvb2YAAAAAAAYAAAAgVGhlIHZlcmlmaWVyIHJlamVjdGVkIHRoZSBwcm9vZi4AAAANUHJvb2ZSZWplY3RlZAAAAAAAAAcAAABAVGhlIHZlcmlmaWVyIGNvdWxkIG5vdCBiZSBjYWxsZWQgb3IgZmFpbGVkIHRvIHBhcnNlIGl0cyBvd24ga2V5LgAAABNWZXJpZmllclVuYXZhaWxhYmxlAAAAAAg=",
        "AAAABAAAAKhBIGJhY2tlbmQgdmVyaWZpZXIncyByZWZ1c2Fscy4gU2FtZSBuYW1lcywgb3JkZXIsIGFuZCBjb2RlcyAoMSwgMiwgMykKYXMgTmlkbydzIGNvbnN0cnVjdG9ybGVzcyBgbmlkby1yZWNvdmVyeS12ZXJpZmllcmAsIHNvIGVpdGhlciBjYW4gc2l0CmJlaGluZCBhbiBhZGFwdGVyIHVuY2hhbmdlZC4AAAAAAAAAElByb29mVmVyaWZpZXJFcnJvcgAAAAAAAwAAAClUaGUgdmVyaWZpY2F0aW9uIGtleSBjb3VsZCBub3QgYmUgcGFyc2VkLgAAAAAAAAxWa1BhcnNlRXJyb3IAAAABAAAARVRoZSBwcm9vZiBjb3VsZCBub3QgYmUgcGFyc2VkIChmb3IgZXhhbXBsZSwgaXQgaGFzIHRoZSB3cm9uZyBsZW5ndGgpLgAAAAAAAA9Qcm9vZlBhcnNlRXJyb3IAAAAAAgAAADRUaGUgcHJvb2YgZG9lcyBub3QgdmVyaWZ5IGFnYWluc3QgdGhlIHB1YmxpYyBpbnB1dHMuAAAAElZlcmlmaWNhdGlvbkZhaWxlZAAAAAAAAw==",
        "AAAAAgAAAHdXaG8gbWF5IGNoYW5nZSB0aGUgcmVjb3ZlcnkgY29uZmlndXJhdGlvbiwgYW5kIHdoZXRoZXIgYW4gYXV0aG9yaXplZAphdHRlbXB0IGZyZWV6ZXMgb3JkaW5hcnkgYWN0aXZpdHkgKHNwZWMgwqcyLCDCpzkpLgAAAAAAAAAAD1JlY292ZXJ5UHJvZmlsZQAAAAACAAAAAAAAAHdPd25lciBhdXRob3JpemF0aW9uIGFsb25lIHJlY29uZmlndXJlczsgYWN0aXZpdHkgY29udGludWVzIHdoaWxlIGFuCmF0dGVtcHQgaXMgYXV0aG9yaXplZDsgdGhlIG93bmVyIGNhbiBhbHdheXMgY2FuY2VsLgAAAAAETG9zcwAAAAAAAABpUmVjb25maWd1cmF0aW9uIGFuZCB1cGdyYWRlcyBhbHNvIG5lZWQgdGhlIGVucm9sbGVkIGNvbmRpdGlvbjsgYW4KYXV0aG9yaXplZCBhdHRlbXB0IGZyZWV6ZXMgdGhlIGFjY291bnQuAAAAAAAACVByb3RlY3RlZAAAAA==",
        "AAAAAQAAACJUaGUgWksgZmFjdG9yIChzcGVjIMKnMy4xLCDCpzMuNCkuAAAAAAAAAAAAEENvbXBpbGVkWmtGYWN0b3IAAAAFAAAANFRoZSBjb25zdHJ1Y3Rvcmxlc3MgWksgYWRhcHRlciB0aGUgY29udHJvbGxlciBjYWxscy4AAAAHYWRhcHRlcgAAAAATAAAAVGBzaGEyNTZgIG9mIHRoZSBhZGFwdGVyJ3MgdmVyaWZpY2F0aW9uIGtleTsgbXVzdCBlcXVhbCB0aGUgYWRhcHRlcidzCmBjaXJjdWl0X2lkKClgLgAAAApjaXJjdWl0X2lkAAAAAAPuAAAAIAAAAHJUaGUgY3VycmVudCBjcmVkZW50aWFsJ3MgaW5uZXIgY29tbWl0bWVudCwgYFBvc2VpZG9uMihET01fTEVBRiwKc2VjcmV0KWAsIGZyb20gd2hpY2ggdGhlIGFjY291bnQgaW5zZXJ0cyB0aGUgbGVhZi4AAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAD9UaGUgY3VycmVudCBjcmVkZW50aWFsJ3MgaWQsIGJvdW5kIGludG8gaXRzIGxlYWYgYW5kIG51bGxpZmllci4AAAAADWVucm9sbG1lbnRfaWQAAAAAAAPuAAAAIAAAACxUaGUgbWVtYmVyc2hpcCBwb29sIHJvb3RzIGFyZSBhY2NlcHRlZCBmcm9tLgAAAARwb29sAAAAEw==",
        "AAAAAQAAABRUaGUgZ3VhcmRpYW4gZmFjdG9yLgAAAAAAAAATQ29tcGlsZWRHdWFyZGlhblNldAAAAAACAAAAQEd1YXJkaWFuIGFkZHJlc3NlcyAoYEcuLi5gIG9yIGBDLi4uYCksIG5ldmVyIHRoZSBhY2NvdW50IGl0c2VsZi4AAAAJZ3VhcmRpYW5zAAAAAAAD6gAAABMAAAAhYDEgPD0gcXVvcnVtIDw9IGd1YXJkaWFucy5sZW4oKWAuAAAAAAAABnF1b3J1bQAAAAAABA==",
        "AAAAAgAAACBXaGljaCBmYWN0b3JzIGEgc3RhdGVtZW50IG5lZWRzLgAAAAAAAAAUQ29tcGlsZWRSZWNvdmVyeU1vZGUAAAADAAAAAQAAABZBIHF1b3J1bSBvZiBndWFyZGlhbnMuAAAAAAAMR3VhcmRpYW5Pbmx5AAAAAQAAB9AAAAATQ29tcGlsZWRHdWFyZGlhblNldAAAAAABAAAADU9uZSBaSyBwcm9vZi4AAAAAAAAGWmtPbmx5AAAAAAABAAAH0AAAABBDb21waWxlZFprRmFjdG9yAAAAAQAAACdBIHF1b3J1bSBvZiBndWFyZGlhbnMgYW5kIG9uZSBaSyBwcm9vZi4AAAAACENvbWJpbmVkAAAAAgAAB9AAAAATQ29tcGlsZWRHdWFyZGlhblNldAAAAAfQAAAAEENvbXBpbGVkWmtGYWN0b3I=",
        "AAAAAQAAAB1BIGNvbXBpbGVkIGByZWNvdmVyeWAgbWVtYmVyLgAAAAAAAAAAAAAWQ29tcGlsZWRSZWNvdmVyeUNvbmZpZwAAAAAACQAAAFRUaGUgZW5yb2xsZWQgYmFzZWxpbmUncyBjYW5vbmljYWwgZG9jdW1lbnQgaGFzaCwgaWYgY29tcHJvbWlzZQpyZWNvdmVyeSBpcyBlbnJvbGxlZC4AAAAIYmFzZWxpbmUAAAPoAAAD7gAAACAAAADUW2Bjb25maWdfaGFzaGBdIG9mIHRoZSBjYW5vbmljYWwgSlNPTiBvZiB0aGUgcmVjb3ZlcnkgbWVtYmVyLCBjb21wdXRlZApieSB0aGUgZG9jIGNvbXBpbGVyIChzcGVjIMKnMy4yKS4gQ29uZmlndXJhdGlvbgppZGVudGl0eTogdHdvIGNvbXBpbGVkIGNvbmZpZ3VyYXRpb25zIHdpdGggdGhlIHNhbWUgYGNvbmZpZ19oYXNoYCBhcmUKdGhlIHNhbWUgY29uZmlndXJhdGlvbi4AAAALY29uZmlnX2hhc2gAAAAD7gAAACAAAAAgVGhlIGFkb3B0ZWQgY29udHJvbGxlciBpbnN0YW5jZS4AAAAKY29udHJvbGxlcgAAAAAAEwAAAD5MZWRnZXJzIGZyb20gYW4gYXR0ZW1wdCdzIGF1dGhvcml6YXRpb24gdW50aWwgaXQgY2FuIGNvbXBsZXRlLgAAAAAADWRlbGF5X2xlZGdlcnMAAAAAAAAEAAAAZ1RoZSBldmlkZW5jZSB3aW5kb3cgb2YgYSBjb2xsZWN0aW5nIGF0dGVtcHQgYW5kIHRoZSBjb21wbGV0aW9uCndpbmRvdyBvZiBhbiBhdXRob3JpemVkIG9uZSwgaW4gbGVkZ2Vycy4AAAAADmV4cGlyeV9sZWRnZXJzAAAAAAAEAAAARExpZmV0aW1lIGNhcCBvbiBldmlkZW5jZS1iYXNlZCBjYW5jZWxsYXRpb25zIG9mIGF1dGhvcml6ZWQgYXR0ZW1wdHMuAAAAC21heF9jYW5jZWxzAAAAAAQAAAAiVGhlIGZhY3RvcnMgZXZpZGVuY2UgbXVzdCBzYXRpc2Z5LgAAAAAABG1vZGUAAAfQAAAAFENvbXBpbGVkUmVjb3ZlcnlNb2RlAAAAWFdobyBtYXkgY2hhbmdlIHRoZSBjb25maWd1cmF0aW9uLCBhbmQgd2hldGhlciBhbiBhdXRob3JpemVkIGF0dGVtcHQKZnJlZXplcyB0aGUgYWNjb3VudC4AAAAHcHJvZmlsZQAAAAfQAAAAD1JlY292ZXJ5UHJvZmlsZQAAAAB7U2lnbmVyIGlkcyAobm90IGNyZWRlbnRpYWwgZmluZ2VycHJpbnRzKSBhIHJlY292ZXJ5IG1heSByZXBsYWNlLCBzbwpyb3RhdGluZyBhIGtleSBkb2VzIG5vdCBjaGFuZ2UgdGhlIGNvbmZpZ3VyYXRpb24gKCM5MikuAAAAAAtyZXBsYWNlYWJsZQAAAAPqAAAAEA==",
        "AAAAAQAAABpBIHBlbmRpbmcgYWNjb3VudCB1cGdyYWRlLgAAAAAAAAAAAA5VcGdyYWRlUmVxdWVzdAAAAAAABQAAADZUaGUgYWRvcHRlZCBjb250cm9sbGVyJ3MgZXBvY2ggd2hlbiBzY2hlZHVsZWQsIGlmIGFueS4AAAAAABBjb250cm9sbGVyX2Vwb2NoAAAD6AAAAAYAAAAyVGhlIGZpcnN0IGxlZGdlciBhdCB3aGljaCB0aGUgcmVxdWVzdCBtYXkgZXhlY3V0ZS4AAAAAAA1leGVjdXRhYmxlX2F0AAAAAAAABAAAAEFUaGUgYWNjb3VudCdzIHJlY292ZXJ5IGdlbmVyYXRpb24gd2hlbiB0aGUgcmVxdWVzdCB3YXMgc2NoZWR1bGVkLgAAAAAAAApnZW5lcmF0aW9uAAAAAAAGAAAAGlBlci1hY2NvdW50LCBuZXZlciByZXVzZWQuAAAAAAAKcmVxdWVzdF9pZAAAAAAABgAAACRUaGUgZXhhY3QgV2FzbSB0aGUgYWNjb3VudCB3aWxsIHJ1bi4AAAAJd2FzbV9oYXNoAAAAAAAD7gAAACA=",
        "AAAAAgAAAEVXaGF0IGEgYFJlY29uZmlndXJlYCBzdGF0ZW1lbnQgY2hhbmdlcyB0aGUgZW5yb2xsZWQgY29uZmlndXJhdGlvbiB0by4AAAAAAAAAAAAADENvbmZpZ0NoYW5nZQAAAAIAAAAAAAAAIVJlbW92ZSByZWNvdmVyeSBmcm9tIHRoZSBhY2NvdW50LgAAAAAAAAZSZW1vdmUAAAAAAAEAAACLUmVwbGFjZSB0aGUgY29uZmlndXJhdGlvbiB3aXRoIHRoZSBvbmUgd2hvc2UKW2BDb25maWdCaW5kaW5nOjpjb25maWdfaGFzaGBdIGlzIHRoaXMgdmFsdWUgKHdoaWNoIG1heSBuYW1lIGEKZGlmZmVyZW50IGNvbnRyb2xsZXIgaW5zdGFuY2UpLgAAAAADU2V0AAAAAAEAAAPuAAAAIA==",
        "AAAAAQAAACRUaGUgc3ViamVjdCBvZiBhIGBDYW5jZWxgIHN0YXRlbWVudC4AAAAAAAAADUNhbmNlbFN1YmplY3QAAAAAAAACAAAAHFRoZSBhdHRlbXB0IGJlaW5nIGNhbmNlbGxlZC4AAAAKYXR0ZW1wdF9pZAAAAAAABgAAAHRUaGF0IGF0dGVtcHQncyBvd24gaW5pdGlhdGlvbiBzdGF0ZW1lbnQgZGlnZXN0LCBzbyBjYW5jZWxsYXRpb24KZXZpZGVuY2UgbmFtZXMgZXhhY3RseSBvbmUgcHJvcG9zYWwsIG5vdCBqdXN0IGFuIGlkLgAAABFhdHRlbXB0X3N0YXRlbWVudAAAAAAAA+4AAAAg",
        "AAAAAQAAADxUaGUgZW5yb2xsZWQgY29uZmlndXJhdGlvbiBhIHN0YXRlbWVudCBpcyBldmFsdWF0ZWQgYWdhaW5zdC4AAAAAAAAADUNvbmZpZ0JpbmRpbmcAAAAAAAACAAABZWBzaGEyNTYoInBlcmNoL3JlY292ZXJ5L2NvbmZpZyIgfHwgY2Fub25pY2FsIEpTT04gb2YgdGhlIGVucm9sbGVkCmRvY3VtZW50J3MgcmVjb3ZlcnkgbWVtYmVyKWAsIGFzIFtgY3JhdGU6OmNvbmZpZzo6Y29uZmlnX2hhc2hgXQpjb21wdXRlcyBpdCAoYGRvY3MvcmVjb3Zlcnkvc3BlYy5tZGAgwqczLjIpLiBCaW5kcyB0aGUgd2hvbGUKY29uZmlndXJhdGlvbjogcHJvZmlsZSwgbW9kZSwgZ3VhcmRpYW5zLCBxdW9ydW0sIFpLIGFkYXB0ZXIsIGNpcmN1aXQKaWQsIHBvb2wsIGVucm9sbG1lbnQgaWQgYW5kIGNvbW1pdG1lbnQsIGNvbnRyb2xsZXIsIGJhc2VsaW5lLApyZXBsYWNlYWJsZSBzaWduZXIgaWRzLCBhbmQgdGltaW5nLgAAAAAAAAtjb25maWdfaGFzaAAAAAPuAAAAIAAAAORUaGUgY29udHJvbGxlcidzIHBlci1hY2NvdW50IGNvbmZpZ3VyYXRpb24gZXBvY2guIEl0IGluY3JlbWVudHMgb24KZXZlcnkgZW5yb2xsbWVudCwgcmVjb25maWd1cmF0aW9uLCByZW1vdmFsLCBjb21wbGV0ZWQgcmVjb3ZlcnksIGFuZApleGVjdXRlZCBhY2NvdW50IHVwZ3JhZGUsIHNvIGV2aWRlbmNlIHByb2R1Y2VkIHVuZGVyIG9uZSBlcG9jaCBpcwpkZWFkIHVuZGVyIGV2ZXJ5IGxhdGVyIG9uZS4AAAAFZXBvY2gAAAAAAAAG",
        "AAAAAQAAADNUaGUgc3ViamVjdCBvZiBhIGBMb3N0S2V5YCBvciBgQ29tcHJvbWlzZWAgYXR0ZW1wdC4AAAAAAAAAAA5BdHRlbXB0U3ViamVjdAAAAAAABAAAAD5UaGUgY29udHJvbGxlci1hc3NpZ25lZCwgcGVyLWFjY291bnQsIG5ldmVyLXJldXNlZCBhdHRlbXB0IGlkLgAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAABJW2BjcmF0ZTo6Y3JlZGVudGlhbDo6UmVwbGFjZW1lbnRTZXQ6Omhhc2hgXSBvZiB0aGUgZGVjbGFyZWQKcmVwbGFjZW1lbnRzLgAAAAAAABFyZXBsYWNlbWVudHNfaGFzaAAAAAAAA+4AAAAgAAAAo2BMb3N0S2V5YDogdGhlIGNhbm9uaWNhbCBoYXNoIG9mIHRoZSBhY2NvdW50J3MgYXBwbGllZCBkb2N1bWVudCB3aGVuCnRoZSBhdHRlbXB0IGJlZ2FuICh0aGUgYWdyZWVkIHNuYXBzaG90KS4gYENvbXByb21pc2VgOiB0aGUgZW5yb2xsZWQKYmFzZWxpbmUncyBjYW5vbmljYWwgaGFzaC4AAAAAD3NvdXJjZV9kb2NfaGFzaAAAAAPuAAAAIAAAAHxUaGUgY2Fub25pY2FsIGhhc2ggb2YgdGhlIHRhcmdldCBkb2N1bWVudCwgZGVyaXZlZCBvbi1jaGFpbiBmcm9tCnRoZSBzb3VyY2UgYW5kIHRoZSByZXBsYWNlbWVudCBzZXQg4oCUIG5ldmVyIGNhbGxlci1jaG9zZW4uAAAAD3RhcmdldF9kb2NfaGFzaAAAAAPuAAAAIA==",
        "AAAAAwAAAUpUaGUgYWN0aW9uIGRvbWFpbiBhIHN0YXRlbWVudCBhdXRob3JpemVzLiBFdmlkZW5jZSBmb3Igb25lIGFjdGlvbiBuZXZlcgpzYXRpc2ZpZXMgYW5vdGhlcjogdGhlIGFjdGlvbiBjb2RlIGlzIHRoZSBlbmNvZGluZydzIDI2dGggYnl0ZSBhbmQgc2VsZWN0cwp0aGUgc3ViamVjdCBsYXlvdXQsIHNvIHR3byBzdGF0ZW1lbnRzIHRoYXQgZGlmZmVyIG9ubHkgaW4gYWN0aW9uIGhhdmUKZGlmZmVyZW50IGRpZ2VzdHMgKGFuZCBkaWZmZXJlbnQgZW5jb2RlZCBsZW5ndGhzIGZvciBtb3N0IHBhaXJzKS4KClRoZSBudW1lcmljIGNvZGVzIGFyZSBwYXJ0IG9mIHRoZSB3aXJlIGZvcm1hdC4AAAAAAAAAAAAOUmVjb3ZlcnlBY3Rpb24AAAAAAAUAAABgTG9zdC1rZXkgcmVjb3Zlcnk6IHJlcGxhY2UgZGVzaWduYXRlZCBjcmVkZW50aWFscyBpbiBhbiBhZ3JlZWQKc25hcHNob3Qgb2YgdGhlIGN1cnJlbnQgZG9jdW1lbnQuAAAAB0xvc3RLZXkAAAAAAQAAAFlDb21wcm9taXNlIHJlY292ZXJ5OiByZXN0b3JlIHRoZSBlbnJvbGxlZCBiYXNlbGluZSwgd2l0aCBkZXNpZ25hdGVkCmNyZWRlbnRpYWxzIHJlcGxhY2VkLgAAAAAAAApDb21wcm9taXNlAAAAAAACAAAAHkNhbmNlbCBvbmUgaWRlbnRpZmllZCBhdHRlbXB0LgAAAAAABkNhbmNlbAAAAAAAAwAAAINDaGFuZ2Ugb3IgcmVtb3ZlIHRoZSBlbnJvbGxlZCByZWNvdmVyeSBjb25maWd1cmF0aW9uICh0aGUgZXZpZGVuY2UgYQpgUHJvdGVjdGVkYCBhY2NvdW50IG5lZWRzIGluIGFkZGl0aW9uIHRvIG93bmVyIGF1dGhvcml6YXRpb24pLgAAAAALUmVjb25maWd1cmUAAAAABAAAAHRBcHByb3ZlIG9uZSBzY2hlZHVsZWQgYWNjb3VudCB1cGdyYWRlICh0aGUgZXZpZGVuY2UgYSBgUHJvdGVjdGVkYAphY2NvdW50IG5lZWRzIGluIGFkZGl0aW9uIHRvIG93bmVyIGF1dGhvcml6YXRpb24pLgAAAAdVcGdyYWRlAAAAAAU=",
        "AAAABAAAADhFdmVyeXRoaW5nIGVuY29kaW5nIGEgc3RhdGVtZW50IG9yIGl0cyBwYXJ0cyBjYW4gcmVmdXNlLgAAAAAAAAAOU3RhdGVtZW50RXJyb3IAAAAAAAcAAAAtYGFjY291bnRgIGlzIG5vdCBhIGNvbnRyYWN0IChgQy4uLmApIGFkZHJlc3MuAAAAAAAAEkFjY291bnROb3RDb250cmFjdAAAAAAAAQAAADBgY29udHJvbGxlcmAgaXMgbm90IGEgY29udHJhY3QgKGBDLi4uYCkgYWRkcmVzcy4AAAAVQ29udHJvbGxlck5vdENvbnRyYWN0AAAAAAAAAgAAAHdBIGNyZWRlbnRpYWwgbmFtZXMgYW4gYWRkcmVzcyBzaGFwZSB0aGUgcmVjb3Zlcnkgc3RhY2sgZG9lcyBub3QgYWNjZXB0IChtdXhlZCwgY2xhaW1hYmxlLWJhbGFuY2UsIGxpcXVpZGl0eS1wb29sLCAuLi4pLgAAAAASVW5zdXBwb3J0ZWRBZGRyZXNzAAAAAAADAAAAekEgcmVwbGFjZW1lbnQgc2V0J3Mgc2lnbmVyIGlkcyBhcmUgbm90IHN0cmljdGx5IGFzY2VuZGluZyAoc29ydGVkLCBubyBkdXBsaWNhdGVzKSwgc28gaXQgaGFzIG5vIHNpbmdsZSBjYW5vbmljYWwgZW5jb2RpbmcuAAAAAAAYUmVwbGFjZW1lbnRzTm90Q2Fub25pY2FsAAAABAAAACNBIHJlcGxhY2VtZW50IHNldCByZXBsYWNlcyBub3RoaW5nLgAAAAARRW1wdHlSZXBsYWNlbWVudHMAAAAAAAAFAAAAQFRoZSBjdXJyZW50IGxlZGdlciBpcyBwYXN0IHRoZSBzdGF0ZW1lbnQncyBgdmFsaWRfdW50aWxfbGVkZ2VyYC4AAAAPRXZpZGVuY2VFeHBpcmVkAAAAAAYAAAB5QSBwcm92aWRlci1jaG9zZW4gYHZhbGlkX3VudGlsX2xlZGdlcmAgcmVhY2hlcyBmdXJ0aGVyIHBhc3QgdGhlIGN1cnJlbnQgbGVkZ2VyIHRoYW4gdGhlIGVucm9sbGVkIGBleHBpcnlfbGVkZ2Vyc2AgYWxsb3dzLgAAAAAAABVFdmlkZW5jZVdpbmRvd1Rvb0xvbmcAAAAAAAAH",
        "AAAAAQAAACZUaGUgc3ViamVjdCBvZiBhbiBgVXBncmFkZWAgc3RhdGVtZW50LgAAAAAAAAAAAA5VcGdyYWRlU3ViamVjdAAAAAAAAgAAADtUaGUgYWNjb3VudCdzIHBlci1hY2NvdW50LCBuZXZlci1yZXVzZWQgdXBncmFkZSByZXF1ZXN0IGlkLgAAAAAKcmVxdWVzdF9pZAAAAAAABgAAADxUaGUgZXhhY3QgV2FzbSBoYXNoIHRoZSBhY2NvdW50IHdvdWxkIHJ1biBhZnRlciB0aGUgdXBncmFkZS4AAAAJd2FzbV9oYXNoAAAAAAAD7gAAACA=",
        "AAAAAQAAACtUaW1pbmcgdGVybXMsIGFsbCBpbiBsZWRnZXItc2VxdWVuY2UgdW5pdHMuAAAAAAAAAAAPU3RhdGVtZW50VGltaW5nAAAAAAMAAABmVGhlIGVucm9sbGVkIGBkZWxheS1sZWRnZXJzYDogbGVkZ2VycyBiZXR3ZWVuIGFuIGF0dGVtcHQgYmVjb21pbmcKYXV0aG9yaXplZCBhbmQgYmVjb21pbmcgY29tcGxldGFibGUuAAAAAAANZGVsYXlfbGVkZ2VycwAAAAAAAAQAAADQVGhlIGVucm9sbGVkIGBleHBpcnktbGVkZ2Vyc2A6IHRoZSBldmlkZW5jZSB3aW5kb3cgZm9yIGEgY29sbGVjdGluZwphdHRlbXB0LCB0aGUgY29tcGxldGlvbiB3aW5kb3cgZm9yIGFuIGF1dGhvcml6ZWQgb25lLCBhbmQgdGhlIHVwcGVyCmJvdW5kIG9uIGhvdyBmYXIgYWhlYWQgYSBwcm92aWRlci1jaG9zZW4gYHZhbGlkX3VudGlsX2xlZGdlcmAgbWF5CnJlYWNoLgAAAA5leHBpcnlfbGVkZ2VycwAAAAAABAAAAapUaGUgbGFzdCBsZWRnZXIgc2VxdWVuY2UgKGluY2x1c2l2ZSkgYXQgd2hpY2ggdGhpcyBldmlkZW5jZSBtYXkgYmUKYWNjZXB0ZWQuIFRoZSBjb250cm9sbGVyIGZpeGVzIGl0IGZvciBhdHRlbXB0LWJvdW5kIGFjdGlvbnM6CmBMb3N0S2V5YC9gQ29tcHJvbWlzZWAgdXNlIHRoZSBhdHRlbXB0J3MgZXZpZGVuY2UgZGVhZGxpbmUsIGFuZApgQ2FuY2VsYCB0aGUgbGFzdCBsZWRnZXIgdGhlIGF0dGVtcHQgY291bGQgcG9zc2libHkgYmUgbGl2ZSwgc28KYXBwcm92YWxzIGNvbGxlY3RlZCBvdmVyIHNldmVyYWwgdHJhbnNhY3Rpb25zIGFsbCBzaWduIG9uZQpzdGF0ZW1lbnQuIEZvciBgUmVjb25maWd1cmVgL2BVcGdyYWRlYCB0aGUgZXZpZGVuY2UgcHJvdmlkZXIgY2hvb3NlcwppdCwgd2l0aGluIGBleHBpcnlfbGVkZ2Vyc2Agb2Ygc3VibWlzc2lvbi4AAAAAABJ2YWxpZF91bnRpbF9sZWRnZXIAAAAAAAQ=",
        "AAAAAgAAAJ1UaGUgYWN0aW9uLXNwZWNpZmljIHBhcnQgb2YgYSBzdGF0ZW1lbnQuIFRoZSB2YXJpYW50IGRldGVybWluZXMKW2BSZWNvdmVyeVN0YXRlbWVudDo6YWN0aW9uYF07IHRoZXJlIGlzIG5vIHNlcGFyYXRlIGFjdGlvbiBmaWVsZCB0aGF0CmNvdWxkIGRpc2FncmVlIHdpdGggaXQuAAAAAAAAAAAAABBTdGF0ZW1lbnRTdWJqZWN0AAAABQAAAAEAAAAqQSBsb3N0LWtleSBhdHRlbXB0J3MgaW5pdGlhdGlvbiBzdGF0ZW1lbnQuAAAAAAAHTG9zdEtleQAAAAABAAAH0AAAAA5BdHRlbXB0U3ViamVjdAAAAAAAAQAAACxBIGNvbXByb21pc2UgYXR0ZW1wdCdzIGluaXRpYXRpb24gc3RhdGVtZW50LgAAAApDb21wcm9taXNlAAAAAAABAAAH0AAAAA5BdHRlbXB0U3ViamVjdAAAAAAAAQAAABNDYW5jZWwgb25lIGF0dGVtcHQuAAAAAAZDYW5jZWwAAAAAAAEAAAfQAAAADUNhbmNlbFN1YmplY3QAAAAAAAABAAAALENoYW5nZSBvciByZW1vdmUgdGhlIGVucm9sbGVkIGNvbmZpZ3VyYXRpb24uAAAAC1JlY29uZmlndXJlAAAAAAEAAAfQAAAADENvbmZpZ0NoYW5nZQAAAAEAAABCQXBwcm92ZSBvbmUgYWNjb3VudCB1cGdyYWRlIHJlcXVlc3QsIGNoZWNrZWQgd2hlbiBpdCBpcyBzY2hlZHVsZWQuAAAAAAAHVXBncmFkZQAAAAABAAAH0AAAAA5VcGdyYWRlU3ViamVjdAAA",
        "AAAAAQAAADBUaGUgb25lIHJlY292ZXJ5IHN0YXRlbWVudC4gU2VlIHRoZSBtb2R1bGUgZG9jcy4AAAAAAAAAEVJlY292ZXJ5U3RhdGVtZW50AAAAAAAABgAAADNUaGUgcmVjb3ZlcmluZyBhY2NvdW50LiBNdXN0IGJlIGEgY29udHJhY3QgYWRkcmVzcy4AAAAAB2FjY291bnQAAAAAEwAAADlUaGUgZW5yb2xsZWQgY29uZmlndXJhdGlvbiBhbmQgZXBvY2ggdGhlIGV2aWRlbmNlIGlzIGZvci4AAAAAAAAGY29uZmlnAAAAAAfQAAAADUNvbmZpZ0JpbmRpbmcAAAAAAACgVGhlIGNvbnRyb2xsZXIgaW5zdGFuY2UgZXZhbHVhdGluZyB0aGUgZXZpZGVuY2UgKGZvciBgUmVjb25maWd1cmVgLAp0aGUgY3VycmVudGx5IGFkb3B0ZWQgb25lLCBldmVuIHdoZW4gdGhlIGNoYW5nZSBhZG9wdHMgYW5vdGhlcikuCk11c3QgYmUgYSBjb250cmFjdCBhZGRyZXNzLgAAAApjb250cm9sbGVyAAAAAAATAAAAYFRoZSBuZXR3b3JrIGlkIChgc2hhMjU2YCBvZiB0aGUgbmV0d29yayBwYXNzcGhyYXNlKSwgYXMKYEVudjo6bGVkZ2VyKCkubmV0d29ya19pZCgpYCByZXR1cm5zIGl0LgAAAApuZXR3b3JrX2lkAAAAAAPuAAAAIAAAABtXaGF0IHRoZSBldmlkZW5jZSBhcHByb3Zlcy4AAAAAB3N1YmplY3QAAAAH0AAAABBTdGF0ZW1lbnRTdWJqZWN0AAAAPVRoZSBlbnJvbGxlZCB0aW1pbmcgdGVybXMgYW5kIHRoZSBldmlkZW5jZSdzIGZyZXNobmVzcyBib3VuZC4AAAAAAAAGdGltaW5nAAAAAAfQAAAAD1N0YXRlbWVudFRpbWluZwA=",
        "AAAAAgAAAEJSZXByZXNlbnRzIGRpZmZlcmVudCB0eXBlcyBvZiBzaWduZXJzIGluIHRoZSBzbWFydCBhY2NvdW50IHN5c3RlbS4AAAAAAAAAAAAGU2lnbmVyAAAAAAACAAAAAQAAAD1BIGRlbGVnYXRlZCBzaWduZXIgdGhhdCB1c2VzIGJ1aWx0LWluIHNpZ25hdHVyZSB2ZXJpZmljYXRpb24uAAAAAAAACURlbGVnYXRlZAAAAAAAAAEAAAATAAAAAQAAAHJBbiBleHRlcm5hbCBzaWduZXIgd2l0aCBjdXN0b20gdmVyaWZpY2F0aW9uIGxvZ2ljLgpDb250YWlucyB0aGUgdmVyaWZpZXIgY29udHJhY3QgYWRkcmVzcyBhbmQgdGhlIHB1YmxpYyBrZXkgZGF0YS4AAAAAAAhFeHRlcm5hbAAAAAIAAAATAAAADg==",
        "AAAAAQAABABUaGUgYXV0aG9yaXphdGlvbiBwYXlsb2FkIHBhc3NlZCB0byBgX19jaGVja19hdXRoYCwgYnVuZGxpbmcgY3J5cHRvZ3JhcGhpYwpwcm9vZnMgd2l0aCBjb250ZXh0IHJ1bGUgc2VsZWN0aW9uLgoKVGhpcyBzdHJ1Y3QgY2FycmllcyB0d28gZGlzdGluY3QgcGllY2VzIG9mIGluZm9ybWF0aW9uIHRoYXQgYXJlIGJvdGgKcmVxdWlyZWQgZm9yIGF1dGhvcml6YXRpb24gYnV0IGNhbm5vdCBiZSBkZXJpdmVkIGZyb20gZWFjaCBvdGhlcjoKCi0gYHNpZ25lcnNgIG1hcHMgZWFjaCBbYFNpZ25lcmBdIHRvIGl0cyByYXcgc2lnbmF0dXJlIGJ5dGVzLCBwcm92aWRpbmcKY3J5cHRvZ3JhcGhpYyBwcm9vZiB0aGF0IHRoZSBzaWduZXIgYWN0dWFsbHkgc2lnbmVkIHRoZSB0cmFuc2FjdGlvbgpwYXlsb2FkLiBBIGNvbnRleHQgcnVsZSBzdG9yZXMgd2hpY2ggc2lnbmVyICppZGVudGl0aWVzKiBhcmUgYXV0aG9yaXplZAoodmlhIGBzaWduZXJfaWRzYCksIGJ1dCB0aGUgcnVsZSBkb2VzIG5vdCBjb250YWluIHRoZSBzaWduYXR1cmVzCnRoZW1zZWx2ZXMg4oCUIHRob3NlIG11c3QgYmUgc3VwcGxpZWQgaGVyZS4KCi0gYGNvbnRleHRfcnVsZV9pZHNgIHRlbGxzIHRoZSBzeXN0ZW0gd2hpY2ggcnVsZSB0byB2YWxpZGF0ZSBmb3IgZWFjaCBhdXRoCmNvbnRleHQuIEJlY2F1c2UgbXVsdGlwbGUgcnVsZXMgY2FuIGV4aXN0IGZvciB0aGUgc2FtZSBjb250ZXh0IHR5cGUsIHRoZQpjYWxsZXIgbXVzdCBleHBsaWNpdGx5IHNlbGVjdCBvbmUgcGVyIGNvbnRleHQgcmF0aGVyIHRoYW4gcmVseWluZyBvbgphdXRvLWRpc2NvdmVyeS4gRWFjaCBlbnRyeSBpcyBhbGlnbmVkIGJ5IGluZGV4IHdpdGggdGhlIGBhdXRoX2NvbnRleHRzYApwYXNzZWQgdG8gYF9fY2hlY2tfYXV0aGAuCgpUaGUgbGVuZ3RoIG9mIGBjb250ZXh0X3J1bGVfaWRzYCBtdXN0IGVxdWFsIHRoZSBudW1iZXIgb2YgYXV0aCBjb250ZXh0czsKYSBtaXNtYXRjaCBpcyByZWplY3RlZCB3aXRoCltgU21hcnRBY2NvdW50RXJyb3I6OkNvbnRleHRSdWxlSWRzTGVuAAAAAAAAAAtBdXRoUGF5bG9hZAAAAAACAAAAPFBlci1jb250ZXh0IHJ1bGUgSURzLCBhbGlnbmVkIGJ5IGluZGV4IHdpdGggYGF1dGhfY29udGV4dHNgLgAAABBjb250ZXh0X3J1bGVfaWRzAAAD6gAAAAQAAAAlU2lnbmF0dXJlIGRhdGEgbWFwcGVkIHRvIGVhY2ggc2lnbmVyLgAAAAAAAAdzaWduZXJzAAAAA+wAAAfQAAAABlNpZ25lcgAAAAAADg==",
        "AAAAAQAAADxBIGNvbXBsZXRlIGNvbnRleHQgcnVsZSBkZWZpbmluZyBhdXRob3JpemF0aW9uIHJlcXVpcmVtZW50cy4AAAAAAAAAC0NvbnRleHRSdWxlAAAAAAgAAAApVGhlIHR5cGUgb2YgY29udGV4dCB0aGlzIHJ1bGUgYXBwbGllcyB0by4AAAAAAAAMY29udGV4dF90eXBlAAAH0AAAAA9Db250ZXh0UnVsZVR5cGUAAAAAJ1VuaXF1ZSBpZGVudGlmaWVyIGZvciB0aGUgY29udGV4dCBydWxlLgAAAAACaWQAAAAAAAQAAAApSHVtYW4tcmVhZGFibGUgbmFtZSBmb3IgdGhlIGNvbnRleHQgcnVsZS4AAAAAAAAEbmFtZQAAABAAAAAwTGlzdCBvZiBwb2xpY3kgY29udHJhY3RzIHRoYXQgbXVzdCBiZSBzYXRpc2ZpZWQuAAAACHBvbGljaWVzAAAD6gAAABMAAABKR2xvYmFsIHJlZ2lzdHJ5IElEcyBmb3IgZWFjaCBwb2xpY3ksIHBvc2l0aW9uYWxseSBhbGlnbmVkIHdpdGgKYHBvbGljaWVzYC4AAAAAAApwb2xpY3lfaWRzAAAAAAPqAAAABAAAAElHbG9iYWwgcmVnaXN0cnkgSURzIGZvciBlYWNoIHNpZ25lciwgcG9zaXRpb25hbGx5IGFsaWduZWQgd2l0aApgc2lnbmVyc2AuAAAAAAAACnNpZ25lcl9pZHMAAAAAA+oAAAAEAAAAKExpc3Qgb2Ygc2lnbmVycyBhdXRob3JpemVkIGJ5IHRoaXMgcnVsZS4AAAAHc2lnbmVycwAAAAPqAAAH0AAAAAZTaWduZXIAAAAAADFPcHRpb25hbCBleHBpcmF0aW9uIGxlZGdlciBzZXF1ZW5jZSBmb3IgdGhlIHJ1bGUuAAAAAAAAC3ZhbGlkX3VudGlsAAAAA+gAAAAE",
        "AAAAAgAAAEBUeXBlcyBvZiBjb250ZXh0cyB0aGF0IGNhbiBiZSBhdXRob3JpemVkIGJ5IHNtYXJ0IGFjY291bnQgcnVsZXMuAAAAAAAAAA9Db250ZXh0UnVsZVR5cGUAAAAABAAAAAAAAAAtRGVmYXVsdCBydWxlcyB0aGF0IGNhbiBhdXRob3JpemUgYW55IGNvbnRleHQuAAAAAAAAB0RlZmF1bHQAAAAAAQAAADBSdWxlcyBzcGVjaWZpYyB0byBjYWxsaW5nIGEgcGFydGljdWxhciBjb250cmFjdC4AAAAMQ2FsbENvbnRyYWN0AAAAAQAAABMAAAABAAAAQlJ1bGVzIHNwZWNpZmljIHRvIGNyZWF0aW5nIGEgY29udHJhY3Qgd2l0aCBhIHBhcnRpY3VsYXIgV0FTTSBoYXNoLgAAAAAADkNyZWF0ZUNvbnRyYWN0AAAAAAABAAAD7gAAACAAAAABAAAAZFJ1bGVzIHNwZWNpZmljIHRvIGNyZWF0aW5nIGEgY29udHJhY3QgZnJvbSB0aGUgZXhlY3V0YWJsZSByZWZlcmVuY2UgdGhhdApgb3duZXJgIHN0b3JlcyB1bmRlciBgdGFnYC4AAAAZQ3JlYXRlQ29udHJhY3RFeHRlcm5hbFJlZgAAAAAAAAIAAAATAAAAEA==",
        "AAAABAAAAClFcnJvciBjb2RlcyBmb3Igc21hcnQgYWNjb3VudCBvcGVyYXRpb25zLgAAAAAAAAAAAAARU21hcnRBY2NvdW50RXJyb3IAAAAAAAAFAAAAKlRoZSBzcGVjaWZpZWQgY29udGV4dCBydWxlIGRvZXMgbm90IGV4aXN0LgAAAAAAE0NvbnRleHRSdWxlTm90Rm91bmQAAAALuAAAADpUaGUgcHJvdmlkZWQgY29udGV4dCBjYW5ub3QgYmUgdmFsaWRhdGVkIGFnYWluc3QgYW55IHJ1bGUuAAAAAAASVW52YWxpZGF0ZWRDb250ZXh0AAAAAAu6AAAAJ0V4dGVybmFsIHNpZ25hdHVyZSB2ZXJpZmljYXRpb24gZmFpbGVkLgAAAAAaRXh0ZXJuYWxWZXJpZmljYXRpb25GYWlsZWQAAAAAC7sAAAA8Y29udGV4dF9ydWxlX2lkcyBsZW5ndGggZG9lcyBub3QgbWF0Y2ggYXV0aF9jb250ZXh0cyBsZW5ndGguAAAAHENvbnRleHRSdWxlSWRzTGVuZ3RoTWlzbWF0Y2gAAAvGAAAAQ0Egc2lnbmVyIGluIGBBdXRoUGF5bG9hZGAgaXMgbm90IHBhcnQgb2YgYW55IHNlbGVjdGVkIGNvbnRleHQgcnVsZS4AAAAAElVuYXV0aG9yaXplZFNpZ25lcgAAAAALyA==",
        "AAAAAgAAAF9Db250cmFjdCBleGVjdXRhYmxlIHVzZWQgZm9yIGNyZWF0aW5nIGEgbmV3IGNvbnRyYWN0IGFuZCB1c2VkIGluCmBDcmVhdGVDb250cmFjdEhvc3RGbkNvbnRleHRgLgAAAAAAAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAgAAAAEAAAB4RXhlY3V0YWJsZSBzcGVjaWZpZWQgYnkgdGhlIGNvbnRyYWN0IGluc3RhbmNlIGFzIGEgc3BlY2lmaWMgV2FzbSBjb250cmFjdCBjb2RlIGVudHJ5IGlkZW50aWZpZWQgYnkgaXRzIFdhc20gc2hhMjU2IGhhc2guAAAABFdhc20AAAABAAAD7gAAACAAAAABAAAAX0V4ZWN1dGFibGUgcmVmZXJlbmNlIHZpYSBhIHBlcnNpc3RlbnQgc3RvcmFnZSBlbnRyeSBvd25lZCBieSB0aGlzIGNvbnRyYWN0IG9yIGFub3RoZXIgY29udHJhY3QuAAAAAAtFeHRlcm5hbFJlZgAAAAABAAAH0AAAABVDb250cmFjdEV4ZWN1dGFibGVSZWYAAAA=",
        "AAAAAQAAAMBFeGVjdXRhYmxlIHJlZmVyZW5jZWQgdmlhIGEgcGVyc2lzdGVudCBzdG9yYWdlIGVudHJ5IG93bmVkIGJ5IGEgY29udHJhY3QsCmVpdGhlciB0aGlzIGNvbnRyYWN0IG9yIGFub3RoZXIgY29udHJhY3QuCgpUaGUgcGVyc2lzdGVudCBzdG9yYWdlIGVudHJ5IG93bmVkIGJ5IHRoZSBgb3duZXJgIGhhcyB0aGUgYHRhZ2AgYXMgaXRzIGtleS4AAAAAAAAAFUNvbnRyYWN0RXhlY3V0YWJsZVJlZgAAAAAAAAIAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAADdGFnAAAAABA=",
        "AAAAAgAAAONDb250ZXh0IG9mIGEgc2luZ2xlIGF1dGhvcml6ZWQgY2FsbCBwZXJmb3JtZWQgYnkgYW4gYWRkcmVzcy4KCkN1c3RvbSBhY2NvdW50IGNvbnRyYWN0cyB0aGF0IGltcGxlbWVudCBgX19jaGVja19hdXRoYCBzcGVjaWFsIGZ1bmN0aW9uCnJlY2VpdmUgYSBsaXN0IG9mIGBDb250ZXh0YCB2YWx1ZXMgY29ycmVzcG9uZGluZyB0byBhbGwgdGhlIGNhbGxzIHRoYXQKbmVlZCB0byBiZSBhdXRob3JpemVkLgAAAAAAAAAAB0NvbnRleHQAAAAAAwAAAAEAAAAUQ29udHJhY3QgaW52b2NhdGlvbi4AAAAIQ29udHJhY3QAAAABAAAH0AAAAA9Db250cmFjdENvbnRleHQAAAAAAQAAAD1Db250cmFjdCB0aGF0IGhhcyBhIGNvbnN0cnVjdG9yIHdpdGggbm8gYXJndW1lbnRzIGlzIGNyZWF0ZWQuAAAAAAAAFENyZWF0ZUNvbnRyYWN0SG9zdEZuAAAAAQAAB9AAAAAbQ3JlYXRlQ29udHJhY3RIb3N0Rm5Db250ZXh0AAAAAAEAAABEQ29udHJhY3QgdGhhdCBoYXMgYSBjb25zdHJ1Y3RvciB3aXRoIDEgb3IgbW9yZSBhcmd1bWVudHMgaXMgY3JlYXRlZC4AAAAcQ3JlYXRlQ29udHJhY3RXaXRoQ3Rvckhvc3RGbgAAAAEAAAfQAAAAKkNyZWF0ZUNvbnRyYWN0V2l0aENvbnN0cnVjdG9ySG9zdEZuQ29udGV4dAAA",
        "AAAAAQAAAL1BdXRob3JpemF0aW9uIGNvbnRleHQgb2YgYSBzaW5nbGUgY29udHJhY3QgY2FsbC4KClRoaXMgc3RydWN0IGNvcnJlc3BvbmRzIHRvIGEgYHJlcXVpcmVfYXV0aF9mb3JfYXJnc2AgY2FsbCBmb3IgYW4gYWRkcmVzcwpmcm9tIGBjb250cmFjdGAgZnVuY3Rpb24gd2l0aCBgZm5fbmFtZWAgbmFtZSBhbmQgYGFyZ3NgIGFyZ3VtZW50cy4AAAAAAAAAAAAAD0NvbnRyYWN0Q29udGV4dAAAAAADAAAAAAAAAARhcmdzAAAD6gAAAAAAAAAAAAAACGNvbnRyYWN0AAAAEwAAAAAAAAAHZm5fbmFtZQAAAAAR",
        "AAAAAQAAADhWYWx1ZSBvZiBjb250cmFjdCBub2RlIGluIEludm9rZXJDb250cmFjdEF1dGhFbnRyeSB0cmVlLgAAAAAAAAAVU3ViQ29udHJhY3RJbnZvY2F0aW9uAAAAAAAAAgAAAAAAAAAHY29udGV4dAAAAAfQAAAAD0NvbnRyYWN0Q29udGV4dAAAAAAAAAAAD3N1Yl9pbnZvY2F0aW9ucwAAAAPqAAAH0AAAABhJbnZva2VyQ29udHJhY3RBdXRoRW50cnk=",
        "AAAAAgAAAS9BIG5vZGUgaW4gdGhlIHRyZWUgb2YgYXV0aG9yaXphdGlvbnMgcGVyZm9ybWVkIG9uIGJlaGFsZiBvZiB0aGUgY3VycmVudApjb250cmFjdCBhcyBpbnZva2VyIG9mIHRoZSBjb250cmFjdHMgZGVlcGVyIGluIHRoZSBjYWxsIHN0YWNrLgoKVGhpcyBpcyB1c2VkIGFzIGFuIGFyZ3VtZW50IG9mIGBhdXRob3JpemVfYXNfY3VycmVudF9jb250cmFjdGAgaG9zdCBmdW5jdGlvbi4KClRoaXMgdHJlZSBjb3JyZXNwb25kcyBgcmVxdWlyZV9hdXRoW19mb3JfYXJnc11gIGNhbGxzIG9uIGJlaGFsZiBvZiB0aGUKY3VycmVudCBjb250cmFjdC4AAAAAAAAAABhJbnZva2VyQ29udHJhY3RBdXRoRW50cnkAAAADAAAAAQAAABJJbnZva2UgYSBjb250cmFjdC4AAAAAAAhDb250cmFjdAAAAAEAAAfQAAAAFVN1YkNvbnRyYWN0SW52b2NhdGlvbgAAAAAAAAEAAAA1Q3JlYXRlIGEgY29udHJhY3QgcGFzc2luZyAwIGFyZ3VtZW50cyB0byBjb25zdHJ1Y3Rvci4AAAAAAAAUQ3JlYXRlQ29udHJhY3RIb3N0Rm4AAAABAAAH0AAAABtDcmVhdGVDb250cmFjdEhvc3RGbkNvbnRleHQAAAAAAQAAAD1DcmVhdGUgYSBjb250cmFjdCBwYXNzaW5nIDAgb3IgbW9yZSBhcmd1bWVudHMgdG8gY29uc3RydWN0b3IuAAAAAAAAHENyZWF0ZUNvbnRyYWN0V2l0aEN0b3JIb3N0Rm4AAAABAAAH0AAAACpDcmVhdGVDb250cmFjdFdpdGhDb25zdHJ1Y3Rvckhvc3RGbkNvbnRleHQAAA==",
        "AAAAAQAAAHZBdXRob3JpemF0aW9uIGNvbnRleHQgZm9yIGBjcmVhdGVfY29udHJhY3RgIGhvc3QgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEKbmV3IGNvbnRyYWN0IG9uIGJlaGFsZiBvZiBhdXRob3JpemVyIGFkZHJlc3MuAAAAAAAAAAAAG0NyZWF0ZUNvbnRyYWN0SG9zdEZuQ29udGV4dAAAAAACAAAAAAAAAApleGVjdXRhYmxlAAAAAAfQAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAAAAAARzYWx0AAAD7gAAACA=",
        "AAAAAQAAANZBdXRob3JpemF0aW9uIGNvbnRleHQgZm9yIGBjcmVhdGVfY29udHJhY3RgIGhvc3QgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEKbmV3IGNvbnRyYWN0IG9uIGJlaGFsZiBvZiBhdXRob3JpemVyIGFkZHJlc3MuClRoaXMgaXMgdGhlIHNhbWUgYXMgYENyZWF0ZUNvbnRyYWN0SG9zdEZuQ29udGV4dGAsIGJ1dCBhbHNvIGhhcwpjb250cmFjdCBjb25zdHJ1Y3RvciBhcmd1bWVudHMuAAAAAAAAAAAAKkNyZWF0ZUNvbnRyYWN0V2l0aENvbnN0cnVjdG9ySG9zdEZuQ29udGV4dAAAAAAAAwAAAAAAAAAQY29uc3RydWN0b3JfYXJncwAAA+oAAAAAAAAAAAAAAApleGVjdXRhYmxlAAAAAAfQAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAAAAAARzYWx0AAAD7gAAACA=",
        "AAAAAgAAAAAAAAAAAAAACkV4ZWN1dGFibGUAAAAAAAMAAAABAAAAAAAAAARXYXNtAAAAAQAAA+4AAAAgAAAAAAAAAAAAAAAMU3RlbGxhckFzc2V0AAAAAAAAAAAAAAAHQWNjb3VudAA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    infra: this.txFromJSON<InfraPins>,
        renew: this.txFromJSON<null>,
        scope: this.txFromJSON<Option<ScopeRecord>>,
        scopes: this.txFromJSON<Array<u32>>,
        execute: this.txFromJSON<Result<any>>,
        document: this.txFromJSON<readonly [u64, Option<Buffer>]>,
        gc_scope: this.txFromJSON<Result<void>>,
        rcv_gate: this.txFromJSON<Result<void>>,
        revision: this.txFromJSON<u64>,
        rule_set: this.txFromJSON<Array<StoredRule>>,
        apply_doc: this.txFromJSON<Result<Buffer>>,
        is_revoked: this.txFromJSON<boolean>,
        applied_doc: this.txFromJSON<Option<Buffer>>,
        apply_scope: this.txFromJSON<Result<Buffer>>,
        scope_count: this.txFromJSON<u32>,
        capabilities: this.txFromJSON<AccountCapabilities>,
        doc_compiler: this.txFromJSON<string>,
        remove_scope: this.txFromJSON<Result<void>>,
        configuration: this.txFromJSON<AccountConfiguration>,
        recovery_gate: this.txFromJSON<Option<FreezeGate>>,
        cancel_upgrade: this.txFromJSON<Result<void>>,
        is_enrolled_id: this.txFromJSON<boolean>,
        scope_rule_set: this.txFromJSON<Array<StoredRule>>,
        cancel_recovery: this.txFromJSON<Result<void>>,
        execute_upgrade: this.txFromJSON<Result<void>>,
        installed_rules: this.txFromJSON<Array<InstalledRule>>,
        pending_upgrade: this.txFromJSON<Option<UpgradeRequest>>,
        applied_doc_hash: this.txFromJSON<Option<Buffer>>,
        get_context_rule: this.txFromJSON<ContextRule>,
        schedule_upgrade: this.txFromJSON<Result<u64>>,
        scope_generation: this.txFromJSON<u64>,
        scope_signer_ids: this.txFromJSON<Option<Array<string>>>,
        recovery_controller: this.txFromJSON<Option<string>>,
        recovery_generation: this.txFromJSON<u64>,
        scope_verifier_names: this.txFromJSON<Option<Array<string>>>,
        credential_generation: this.txFromJSON<Option<u64>>,
        get_context_rules_count: this.txFromJSON<u32>,
        next_upgrade_request_id: this.txFromJSON<u64>
  }
}