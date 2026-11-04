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
 * One pending account upgrade (spec §12).
 * 
 * Staleness is judged against the account's own **recovery generation**, a
 * `u64` the account keeps in its own storage. It starts at 0 and is never
 * reset. It advances on every `rcv_sync` outcome other than `Unchanged`
 * (`controller::SyncOutcome::bumps_generation`) and on every executed
 * upgrade.
 * 
 * The controller's epoch cannot play this role. It belongs to one
 * controller and does not exist while the account is unenrolled, so a
 * request scheduled unenrolled would survive enrolling recovery and
 * removing it again: the final state has no controller, just as at
 * scheduling.
 */
export interface UpgradeRequest {
  /**
 * The adopted controller's epoch when scheduled, if a controller was
 * adopted. Passed back as `UpgradeStep::Execute` so the controller can
 * check it too.
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
 * `rule_eval::Functions`.
 */
export type StoredFunctions = {tag: "AnyExcept", values: readonly [Array<string>]} | {tag: "Only", values: readonly [Array<string>]};


/**
 * The shared infra an account resolves, pinned when it was built (see
 * [`infra`]): what a deployment check compares with its manifest.
 */
export interface InfraPins {
  doc_compiler: string;
  interpreter: string;
  spending_limit: string;
}


/**
 * The `Protected` freeze, mirrored from the adopted controller through
 * [`PerchSmartAccount::rcv_gate`]: while `ledger < until`, the account
 * authorizes nothing but `attempt_id`'s completion.
 */
export interface FreezeGate {
  attempt_id: u64;
  /**
 * The authorized attempt's `expires_at`.
 */
until: u32;
}



/**
 * One scoped document as applied: what [`PerchSmartAccount::scope`]
 * returns.
 */
export interface ScopeRecord {
  /**
 * The scoped document's canonical `doc_hash`.
 */
doc_hash: Buffer;
  /**
 * The scope generation it was applied under. Once
 * [`PerchSmartAccount::scope_generation`] has moved past it, a recovery
 * completion has wiped the scope: its rules authorize nothing, and
 * anyone may remove them with `gc_scope`.
 */
gen: u64;
  /**
 * Every context rule it installed, with its OZ id.
 */
rules: Array<InstalledRule>;
}








/**
 * Everything the account's entry points can refuse. Compiler and controller failures flatten in via `#[from_contract_client]`, converted by `??`.
 */
export const PerchAccountError = {
  /**
   * The document keeps no constraint-free, never-expiring self-admin rule with a signer. Applying it could lock the admin out; refused (anti-brick).
   */
  1: {message:"AdminLockout"},
  /**
   * The document names a credential in the account's revoked set (`docs/recovery/spec.md` §8).
   */
  2: {message:"RevokedCredential"},
  /**
   * The document names a ZK enrollment id this account enrolled before (spec §3.4).
   */
  3: {message:"EnrollmentReused"},
  /**
   * The document changes the ZK factor without a new enrollment id (spec §3.4: the factor stays unchanged or carries a new id).
   */
  4: {message:"ZkFactorChangedInPlace"},
  /**
   * `execute` was asked to call an invoker-only hook (spec §15).
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
   * A completion handed back a credential that cannot be fingerprinted.
   */
  11: {message:"InvalidCredential"},
  /**
   * The recovery generation moved since the upgrade was scheduled (spec §12). The request stays pending but can never execute.
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
   * The document failed semantic validation (dangling signer ref, malformed address or key, ambiguous empty list, …).
   */
  15: {message:"Compiler_DocInvalid"},
  /**
   * The document names no network, or a network that is not this chain.
   */
  16: {message:"Compiler_WrongNetwork"},
  /**
   * The document cannot be lowered to rules: a rule with self-authenticating principals, or with more than [`MAX_RULE_CONSTRAINTS`] constraints.
   */
  17: {message:"Compiler_DocCompile"},
  /**
   * The document exceeds a document cap ([`MAX_DOC_SIGNERS`], [`MAX_DOC_RULES`], [`MAX_DOC_CANONICAL_BYTES`], [`MAX_RULE_NAME_BYTES`]).
   */
  18: {message:"Compiler_DocTooLarge"},
  /**
   * A signer's external `key` is not its verifier-canonical form: either the verifier could not canonicalize it at all, or the declared bytes differ from the canonical form the verifier returns (e.g. a WebAuthn key carrying a credential-id suffix the verifier drops, or a non-canonical point encoding). The compiler refuses it rather than silently canonicalizing, so the bytes the document hash — and a recovery attempt's `replacements_hash` — bind are exactly the bytes the installed credential uses, and two signers cannot hide one physical key under two spellings.
   */
  19: {message:"Compiler_KeyNotCanonicalizable"},
  /**
   * `derive_target`: the current document enrolls no recovery.
   */
  20: {message:"Compiler_NotEnrolled"},
  /**
   * `derive_target`: the replacement set breaks spec §7.3 rules 1-3 (not canonical, empty for lost-key, a signer id that is not replaceable or not declared in the source, or a change of credential kind or verifier), or the action is not a recovery attempt.
   */
  21: {message:"Compiler_ReplacementRefused"},
  /**
   * `derive_target`: the ZK enrollment is missing for a ZK mode, present for a guardian-only mode, or reuses the enrolled id.
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
   * An attempt is authorized and live: begin, policy changes, and upgrades are refused until it completes, is cancelled, or expires.
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
   * The ZK enrollment id was enrolled for this account before (the controller checks the account's `is_enrolled_id` at T1; the pure `derive_target` cannot see the account's history).
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
   * The configuration is malformed (for example, the account is one of its own guardians, or the quorum is out of range).
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
   * The policy was attached to a context rule of the wrong shape.
   */
  53: {message:"Recovery_MalformedContextRule"},
  /**
   * A credential the replacement set replaces still appears in the target (a swap or a no-op replacement, spec §7.3 rule 8).
   */
  54: {message:"Recovery_ReplacedCredentialRetained"},
  /**
   * `apply_doc` named an `expected_revision` and the account is at another revision: the document was prepared against a configuration that has since changed.
   */
  55: {message:"StaleRevision"},
  /**
   * A completed recovery would advance the scope generation past `u64::MAX`.
   */
  56: {message:"GenerationExhausted"},
  /**
   * `apply_scope` was given a document a scoped document may not be: it has a `recovery` member, a `self-admin` rule, or a rule scoped to the account itself, its recovery controller, or its ZK adapter or pool (spec §7.6).
   */
  57: {message:"ScopeEscalation"},
  /**
   * No scoped document has this scope id.
   */
  58: {message:"UnknownScope"},
  /**
   * `gc_scope` was asked to remove a scope of the current scope generation, which only `remove_scope` removes.
   */
  59: {message:"ScopeLive"},
  /**
   * The document names a credential a scoped document named under a scope generation a recovery completion has since ended (spec §7.6).
   */
  60: {message:"WipedCredential"},
  /**
   * The compiled document carries no model, more than one, a model soroban-facade cannot read, or one whose rules or recovery do not match the compiled rules one for one.
   */
  61: {message:"ModelInvalid"},
  /**
   * A rule other than the recovery rule asks for no signer (INV-1), so an authorization with no signer at all would satisfy it.
   */
  62: {message:"UnguardedRule"},
  /**
   * `apply_scope` was called on an account that stores no admin rule set: one upgraded from code that kept none and not re-applied since. Its first `apply_doc` stores it. Last, so every earlier code is unchanged.
   */
  63: {message:"NoRuleSet"},
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
 * Constants of the deployed account wasm a wallet checks before it builds
 * anything for this account: what [`PerchSmartAccount::capabilities`]
 * returns.
 */
export interface AccountCapabilities {
  /**
 * How documents are applied: `one_tx`, the admin document in one
 * `apply_doc` transaction; `scoped_v1`, scoped documents through
 * `apply_scope`, `remove_scope`, and `gc_scope` (spec §7.6).
 */
apply_modes: Array<string>;
  /**
 * What a signer signs: `addr_oz_v1`, OZ's
 * `sha256(bound_payload || context_rule_ids.to_xdr())`, where
 * `bound_payload = sha256(AUTH_ADDR_DOMAIN || account_id ||
 * signature_payload)` binds the account's own address so a signature
 * cannot be replayed on another account ([`AUTH_ADDR_DOMAIN`]). The
 * earlier `oz_rule_ids` scheme omitted the account address; a client
 * reads this symbol to tell which digest an account expects.
 */
auth_digest: string;
  /**
 * How the applied `doc_hash` is computed: `canon_v1`, `sha256` of the
 * CANON v1 canonical bytes.
 */
doc_identity: string;
  /**
 * [`INTERFACE_VERSION`].
 */
interface_version: u32;
  /**
 * [`SNAPSHOT_VERSION`].
 */
snapshot_version: u32;
}


/**
 * Everything rule selection and signing need, read at one ledger: what
 * [`PerchSmartAccount::configuration`] returns.
 */
export interface AccountConfiguration {
  /**
 * The applied document's `doc_hash`, or `None` before the first apply.
 */
doc_hash: Option<Buffer>;
  /**
 * The `Protected` freeze: zero or one entries (a `Vec` because
 * `#[contracttype]` has no conversion for `Option` of a custom struct).
 * It is in force while the ledger is below its `until`.
 */
gate: Array<FreezeGate>;
  infra: InfraPins;
  recovery_controller: Option<string>;
  recovery_generation: u64;
  /**
 * The zero-signer recovery rule's OZ id, if one is installed.
 */
recovery_rule: Option<u32>;
  /**
 * The configuration revision every other field belongs to.
 */
revision: u64;
  /**
 * Every installed context rule, with its OZ id.
 */
rules: Array<InstalledRule>;
}


/**
 * One context rule as the account installed it.
 */
export interface InstalledRule {
  context_type: ContextRuleType;
  /**
 * The OZ context-rule id.
 */
id: u32;
  name: string;
  policies: Array<InstalledPolicy>;
  /**
 * The zero-signer recovery rule. Document rules are matched by name;
 * the recovery rule by this flag, so a document rule that happens to be
 * named `recovery` is never confused with it.
 */
recovery: boolean;
  signers: Array<Signer>;
  valid_until: Option<u32>;
}


/**
 * One policy attached to an installed rule.
 */
export interface InstalledPolicy {
  /**
 * `sha256` of the install parameters' XDR. A policy whose parameters
 * change is uninstalled and installed again; one whose parameters are
 * unchanged is left alone.
 */
params: Buffer;
  policy: string;
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
   * Context rule must have at least one signer or policy.
   */
  3004: {message:"NoSignersAndPolicies"},
  /**
   * The valid_until timestamp is in the past.
   */
  3005: {message:"PastValidUntil"},
  /**
   * The specified signer was not found.
   */
  3006: {message:"SignerNotFound"},
  /**
   * The signer already exists in the context rule.
   */
  3007: {message:"DuplicateSigner"},
  /**
   * The specified policy was not found.
   */
  3008: {message:"PolicyNotFound"},
  /**
   * The policy already exists in the context rule.
   */
  3009: {message:"DuplicatePolicy"},
  /**
   * Too many signers in the context rule.
   */
  3010: {message:"TooManySigners"},
  /**
   * Too many policies in the context rule.
   */
  3011: {message:"TooManyPolicies"},
  /**
   * An internal ID counter (context rule, signer, or policy) has reached
   * its maximum value (`u32::MAX`) and cannot be incremented further.
   */
  3012: {message:"MathOverflow"},
  /**
   * External signer key data exceeds the maximum allowed size.
   */
  3013: {message:"KeyDataTooLarge"},
  /**
   * context_rule_ids length does not match auth_contexts length.
   */
  3014: {message:"ContextRuleIdsLengthMismatch"},
  /**
   * Context rule name exceeds the maximum allowed length.
   */
  3015: {message:"NameTooLong"},
  /**
   * A signer in `AuthPayload` is not part of any selected context rule.
   */
  3016: {message:"UnauthorizedSigner"}
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

export interface Client {
  /**
   * Construct and simulate a infra transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Every shared contract this account pins at build time.
   */
  infra: (options?: MethodOptions) => Promise<AssembledTransaction<InfraPins>>

  /**
   * Construct and simulate a renew transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend the account's instance, the applied document and its credential
   * fingerprints, and the named revoked-set and enrolled-id entries to the
   * network maximum. Permissionless; changes no meaning.
   */
  renew: ({fingerprints, enrollment_ids}: {fingerprints: Array<Buffer>, enrollment_ids: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a scope transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The scoped document under `scope` as applied, if any: its generation,
   * `doc_hash`, and rules with their OZ ids. Rule names repeat across
   * scopes, so a wallet selects a scoped rule by `(scope, name)`.
   */
  scope: ({scope}: {scope: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<ScopeRecord>>>

  /**
   * Construct and simulate a scopes transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The scope ids with a record at positions `start..start + count` of
   * the index (fewer at its end), wiped ones included. Removing a scope
   * moves the last id into its position, so a listing read across
   * several calls can miss an id that moved in between; read
   * [`Self::scope_count`] again to tell.
   */
  scopes: ({start, count}: {start: u32, count: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<u32>>>

  /**
   * Construct and simulate a execute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Call `target_fn` on `target` as this account (the account becomes
   * the invoker, so `target`'s `require_auth` of this account passes).
   * Requires the account's authorization of this exact call. Refuses the
   * invoker-only hook names: otherwise whoever can authorize `execute`
   * could reach a controller, policy, or pool hook as the account
   * (spec §15).
   */
  execute: ({target, target_fn, target_args}: {target: string, target_fn: string, target_args: Array<any>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<any>>>

  /**
   * Construct and simulate a document transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The applied document's canonical bytes with the revision they belong
   * to; `None` before the first `apply_doc`.
   */
  document: (options?: MethodOptions) => Promise<AssembledTransaction<readonly [u64, Option<Buffer>]>>

  /**
   * Construct and simulate a gc_scope transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove a scoped document a recovery completion wiped, with every rule
   * it installed. Permissionless: the rules already authorize nothing.
   * Refuses a scope of the current generation (`ScopeLive`).
   */
  gc_scope: ({scope}: {scope: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a rcv_gate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Invoker-only: the adopted controller sets (`frozen_until > 0`) or
   * clears (`0`) the `Protected` freeze for `attempt_id`. The account
   * mirrors the freeze rather than asking the controller from
   * `__check_auth`, because an account approving as a guardian through
   * the same controller instance runs `__check_auth` while that
   * controller is on the call stack, and the host refuses re-entry.
   */
  rcv_gate: ({attempt_id, frozen_until}: {attempt_id: u64, frozen_until: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a revision transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The configuration revision: 0 after the constructor, advanced by one
   * in every successful `apply_doc` (whatever it changes, a re-apply of
   * the same document included) and every executed upgrade. Freeze
   * changes, recovery attempts, evidence, and cancellations do not
   * advance it. Never decreases and never repeats, so unlike `doc_hash` it
   * tells A -> B -> A apart. Scoped documents do not advance it: a grant
   * changing never makes an admin document prepared against this
   * revision stale.
   */
  revision: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a rule_set transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The rule-eval rules the installed rules enforce, aligned with
   * [`Self::installed_rules`]: entry `i` is what installed rule `i`
   * enforces, and what `__check_auth` evaluates. Empty on an account that
   * has not applied a document since it was upgraded to code that keeps
   * them, which OZ's policies still decide.
   */
  rule_set: (options?: MethodOptions) => Promise<AssembledTransaction<Array<StoredRule>>>

  /**
   * Construct and simulate a apply_doc transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Apply the admin document: the account's own rules, its recovery
   * member, and everything a recovery restores. With the scoped-document
   * entry points ([`Self::apply_scope`]), **the only way authorization
   * changes**. The shared, immutable doc compiler it calls is derived from
   * build-time pins (see [`infra`]), never passed in. Brings the installed
   * rules to the document in one invocation, changing only the rules that
   * differ, and returns the canonical `doc_hash`.
   * 
   * Authorized by the owner (any ordinary rule scoped to the account),
   * or, for a recovery completion only, by the zero-signer recovery rule
   * whose controller checks the exact target. On an account with an
   * adopted controller, the controller's `rcv_sync` classifies the call
   * before any rule changes and refuses what the profile does not allow
   * (`docs/recovery/spec.md` §10). `approval_valid_until` is the
   * freshness bound a `Protected` reconfiguration's recorded approvals
   * were given for; it is ignored otherwise.
   * 
   * Refuses (`WipedCredential`) a document naming a credential
   */
  apply_doc: ({doc_json, approval_valid_until, expected_revision}: {doc_json: Buffer, approval_valid_until: u32, expected_revision: Option<u64>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a scope_doc transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The canonical bytes of the scoped document under `scope`, if any.
   * `sha256` of them is its `doc_hash`.
   */
  scope_doc: ({scope}: {scope: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a is_revoked transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Whether a credential fingerprint is permanently revoked.
   */
  is_revoked: ({fingerprint}: {fingerprint: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a applied_doc transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The applied document's canonical bytes, or `None` before the first
   * `apply_doc`. Under CANON v1, `sha256` of them is
   * [`Self::applied_doc_hash`].
   */
  applied_doc: (options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a apply_scope transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Apply a scoped document under `scope`, an id the owner chooses (one
   * per app grant, say), and return its `doc_hash` (spec §7.6). Owner
   * authorization. Refuses (`ScopeEscalation`) a `recovery` member, a
   * `self-admin` rule, or a rule scoped to the account, its recovery
   * controller, or its ZK adapter or pool, so no scoped document reaches
   * the admin document's rules, recovery, or upgrades. Refuses
   * (`WipedCredential`) a credential a scoped document named before the
   * last completed recovery, and records every credential it names under
   * the current scope generation. Compiled under the same caps as any
   * document and reconciled against this scope's records only. Every
   * rule it installs is tagged with the scope and the current scope
   * generation, so applying over a wiped scope revives it with the new
   * rules. Calls no controller, and leaves the applied `doc_hash` and the
   * revision alone. Refuses (`NoRuleSet`) on an account that stores no
   * admin rule set, until its first `apply_doc`.
   */
  apply_scope: ({scope, doc_json}: {scope: u32, doc_json: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a scope_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * How many scope ids have a record, wiped ones included.
   */
  scope_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a capabilities transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Constants of this account's wasm: interface and snapshot versions,
   * the document identity and authorization digest schemes, and the apply
   * modes.
   */
  capabilities: (options?: MethodOptions) => Promise<AssembledTransaction<AccountCapabilities>>

  /**
   * Construct and simulate a doc_compiler transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The doc compiler this account pins at build time.
   */
  doc_compiler: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a remove_scope transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove the scoped document under `scope` and every rule it installed:
   * revoking a grant. Owner authorization.
   */
  remove_scope: ({scope}: {scope: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a configuration transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Everything rule selection and signing need for the admin document,
   * read at one ledger, with the revision it belongs to. Scoped
   * documents' rules are not in it: [`Self::scopes`] and [`Self::scope`]
   * list them.
   */
  configuration: (options?: MethodOptions) => Promise<AssembledTransaction<AccountConfiguration>>

  /**
   * Construct and simulate a recovery_gate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The `Protected` freeze, if one was set and has not been cleared. It
   * is in force while the current ledger is below `until`.
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
   * The rule-eval rules the scoped document under `scope` installs,
   * aligned with its record's rules (entry `i` is what rule `i`
   * enforces), each carrying the scope generation it was applied under.
   * Empty when no scoped document has the id.
   */
  scope_rule_set: ({scope}: {scope: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<StoredRule>>>

  /**
   * Construct and simulate a cancel_recovery transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * A `Loss` owner's cancellation of a recovery attempt (spec T7). The
   * controller refuses it under `Protected`.
   */
  cancel_recovery: ({attempt_id}: {attempt_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a execute_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Execute the pending upgrade once its delay has elapsed. Owner
   * authorization. If the recovery generation moved since scheduling
   * (any enrollment, reconfiguration, removal, controller switch,
   * completed recovery, or executed upgrade), the request is stale and
   * the call refuses with `StaleUpgrade`. The refusal leaves the request
   * in place, since a failed invocation keeps none of its writes; it can
   * never execute, because the generation never decreases, and stays
   * until `schedule_upgrade` replaces it, `cancel_upgrade` removes it, or
   * a completion clears it. Otherwise the controller, if one is adopted,
   * checks its epoch and bumps it (refusing during an authorized
   * attempt), the generation advances, and the Wasm is replaced after
   * this invocation.
   */
  execute_upgrade: ({request_id}: {request_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a installed_rules transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Every context rule the admin document installed, with its OZ id. The
   * document's rules are matched against these by `apply_doc`. A scoped
   * document's are in its [`Self::scope`] record.
   */
  installed_rules: (options?: MethodOptions) => Promise<AssembledTransaction<Array<InstalledRule>>>

  /**
   * Construct and simulate a pending_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The scheduled upgrade, if any.
   */
  pending_upgrade: (options?: MethodOptions) => Promise<AssembledTransaction<Option<UpgradeRequest>>>

  /**
   * Construct and simulate a applied_doc_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The canonical `doc_hash` of the currently applied policy document, or
   * `None` before the first `apply_doc` (only the constructor's admin rule
   * exists then). Anyone can check installed == reviewed.
   */
  applied_doc_hash: (options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a get_context_rule transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_context_rule: ({context_rule_id}: {context_rule_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<ContextRule>>

  /**
   * Construct and simulate a schedule_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Schedule an upgrade to `wasm_hash`, executable after
   * [`ACCOUNT_UPGRADE_DELAY_LEDGERS`] (spec §12). Owner authorization;
   * under `Protected` also the condition's recorded approval of
   * `Upgrade { request_id, wasm_hash }` fresh until
   * `approval_valid_until` (`next_upgrade_request_id` names the id to
   * approve). Refused while a recovery attempt is authorized. Replaces any
   * earlier request. Returns the request id.
   */
  schedule_upgrade: ({wasm_hash, approval_valid_until}: {wasm_hash: Buffer, approval_valid_until: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a scope_generation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The account's scope generation: 0 until the first completed
   * recovery, then advanced by one by each completed recovery and by
   * nothing else (not by enrollment, reconfiguration, removal, a
   * controller switch, or an executed upgrade, all of which advance
   * [`Self::recovery_generation`]). A scope whose record has another
   * generation is wiped.
   */
  scope_generation: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a recovery_controller transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The adopted recovery controller, if any.
   */
  recovery_controller: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a recovery_generation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The account's recovery generation (spec §12).
   */
  recovery_generation: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a credential_generation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The last scope generation a scoped document named this credential
   * fingerprint under, if one ever did. Once [`Self::scope_generation`]
   * is past it, no document may name the credential (spec §7.6).
   */
  credential_generation: ({fingerprint}: {fingerprint: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<u64>>>

  /**
   * Construct and simulate a get_context_rules_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * OZ's count of the account's context rules, scoped documents' and
   * expired ones included.
   * Read-only rule surface, re-exposed here because `SmartAccount` itself
   * is deliberately not exported by doc-only accounts.
   */
  get_context_rules_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a next_upgrade_request_id transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The id the next `schedule_upgrade` will assign: what `Protected`
   * approvers approve.
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
        "AAAAAAAAAMJFeHRlbmQgdGhlIGFjY291bnQncyBpbnN0YW5jZSwgdGhlIGFwcGxpZWQgZG9jdW1lbnQgYW5kIGl0cyBjcmVkZW50aWFsCmZpbmdlcnByaW50cywgYW5kIHRoZSBuYW1lZCByZXZva2VkLXNldCBhbmQgZW5yb2xsZWQtaWQgZW50cmllcyB0byB0aGUKbmV0d29yayBtYXhpbXVtLiBQZXJtaXNzaW9ubGVzczsgY2hhbmdlcyBubyBtZWFuaW5nLgAAAAAABXJlbmV3AAAAAAAAAgAAAAAAAAAMZmluZ2VycHJpbnRzAAAD6gAAA+4AAAAgAAAAAAAAAA5lbnJvbGxtZW50X2lkcwAAAAAD6gAAA+4AAAAgAAAAAA==",
        "AAAAAAAAAMVUaGUgc2NvcGVkIGRvY3VtZW50IHVuZGVyIGBzY29wZWAgYXMgYXBwbGllZCwgaWYgYW55OiBpdHMgZ2VuZXJhdGlvbiwKYGRvY19oYXNoYCwgYW5kIHJ1bGVzIHdpdGggdGhlaXIgT1ogaWRzLiBSdWxlIG5hbWVzIHJlcGVhdCBhY3Jvc3MKc2NvcGVzLCBzbyBhIHdhbGxldCBzZWxlY3RzIGEgc2NvcGVkIHJ1bGUgYnkgYChzY29wZSwgbmFtZSlgLgAAAAAAAAVzY29wZQAAAAAAAAEAAAAAAAAABXNjb3BlAAAAAAAABAAAAAEAAAPoAAAH0AAAAAtTY29wZVJlY29yZAA=",
        "AAAAAAAAASJUaGUgc2NvcGUgaWRzIHdpdGggYSByZWNvcmQgYXQgcG9zaXRpb25zIGBzdGFydC4uc3RhcnQgKyBjb3VudGAgb2YKdGhlIGluZGV4IChmZXdlciBhdCBpdHMgZW5kKSwgd2lwZWQgb25lcyBpbmNsdWRlZC4gUmVtb3ZpbmcgYSBzY29wZQptb3ZlcyB0aGUgbGFzdCBpZCBpbnRvIGl0cyBwb3NpdGlvbiwgc28gYSBsaXN0aW5nIHJlYWQgYWNyb3NzCnNldmVyYWwgY2FsbHMgY2FuIG1pc3MgYW4gaWQgdGhhdCBtb3ZlZCBpbiBiZXR3ZWVuOyByZWFkCltgU2VsZjo6c2NvcGVfY291bnRgXSBhZ2FpbiB0byB0ZWxsLgAAAAAABnNjb3BlcwAAAAAAAgAAAAAAAAAFc3RhcnQAAAAAAAAEAAAAAAAAAAVjb3VudAAAAAAAAAQAAAABAAAD6gAAAAQ=",
        "AAAAAAAAAVdDYWxsIGB0YXJnZXRfZm5gIG9uIGB0YXJnZXRgIGFzIHRoaXMgYWNjb3VudCAodGhlIGFjY291bnQgYmVjb21lcwp0aGUgaW52b2tlciwgc28gYHRhcmdldGAncyBgcmVxdWlyZV9hdXRoYCBvZiB0aGlzIGFjY291bnQgcGFzc2VzKS4KUmVxdWlyZXMgdGhlIGFjY291bnQncyBhdXRob3JpemF0aW9uIG9mIHRoaXMgZXhhY3QgY2FsbC4gUmVmdXNlcyB0aGUKaW52b2tlci1vbmx5IGhvb2sgbmFtZXM6IG90aGVyd2lzZSB3aG9ldmVyIGNhbiBhdXRob3JpemUgYGV4ZWN1dGVgCmNvdWxkIHJlYWNoIGEgY29udHJvbGxlciwgcG9saWN5LCBvciBwb29sIGhvb2sgYXMgdGhlIGFjY291bnQKKHNwZWMgwqcxNSkuAAAAAAdleGVjdXRlAAAAAAMAAAAAAAAABnRhcmdldAAAAAAAEwAAAAAAAAAJdGFyZ2V0X2ZuAAAAAAAAEQAAAAAAAAALdGFyZ2V0X2FyZ3MAAAAD6gAAAAAAAAABAAAD6QAAAAAAAAfQAAAAEVBlcmNoQWNjb3VudEVycm9yAAAA",
        "AAAAAAAAAG1UaGUgYXBwbGllZCBkb2N1bWVudCdzIGNhbm9uaWNhbCBieXRlcyB3aXRoIHRoZSByZXZpc2lvbiB0aGV5IGJlbG9uZwp0bzsgYE5vbmVgIGJlZm9yZSB0aGUgZmlyc3QgYGFwcGx5X2RvY2AuAAAAAAAACGRvY3VtZW50AAAAAAAAAAEAAAPtAAAAAgAAAAYAAAPoAAAADg==",
        "AAAAAAAAAMFSZW1vdmUgYSBzY29wZWQgZG9jdW1lbnQgYSByZWNvdmVyeSBjb21wbGV0aW9uIHdpcGVkLCB3aXRoIGV2ZXJ5IHJ1bGUKaXQgaW5zdGFsbGVkLiBQZXJtaXNzaW9ubGVzczogdGhlIHJ1bGVzIGFscmVhZHkgYXV0aG9yaXplIG5vdGhpbmcuClJlZnVzZXMgYSBzY29wZSBvZiB0aGUgY3VycmVudCBnZW5lcmF0aW9uIChgU2NvcGVMaXZlYCkuAAAAAAAACGdjX3Njb3BlAAAAAQAAAAAAAAAFc2NvcGUAAAAAAAAEAAAAAQAAA+kAAAACAAAH0AAAABFQZXJjaEFjY291bnRFcnJvcgAAAA==",
        "AAAAAAAAAXxJbnZva2VyLW9ubHk6IHRoZSBhZG9wdGVkIGNvbnRyb2xsZXIgc2V0cyAoYGZyb3plbl91bnRpbCA+IDBgKSBvcgpjbGVhcnMgKGAwYCkgdGhlIGBQcm90ZWN0ZWRgIGZyZWV6ZSBmb3IgYGF0dGVtcHRfaWRgLiBUaGUgYWNjb3VudAptaXJyb3JzIHRoZSBmcmVlemUgcmF0aGVyIHRoYW4gYXNraW5nIHRoZSBjb250cm9sbGVyIGZyb20KYF9fY2hlY2tfYXV0aGAsIGJlY2F1c2UgYW4gYWNjb3VudCBhcHByb3ZpbmcgYXMgYSBndWFyZGlhbiB0aHJvdWdoCnRoZSBzYW1lIGNvbnRyb2xsZXIgaW5zdGFuY2UgcnVucyBgX19jaGVja19hdXRoYCB3aGlsZSB0aGF0CmNvbnRyb2xsZXIgaXMgb24gdGhlIGNhbGwgc3RhY2ssIGFuZCB0aGUgaG9zdCByZWZ1c2VzIHJlLWVudHJ5LgAAAAhyY3ZfZ2F0ZQAAAAIAAAAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAAAAAAAADGZyb3plbl91bnRpbAAAAAQAAAABAAAD6QAAAAIAAAfQAAAAEVBlcmNoQWNjb3VudEVycm9yAAAA",
        "AAAAAAAAAd9UaGUgY29uZmlndXJhdGlvbiByZXZpc2lvbjogMCBhZnRlciB0aGUgY29uc3RydWN0b3IsIGFkdmFuY2VkIGJ5IG9uZQppbiBldmVyeSBzdWNjZXNzZnVsIGBhcHBseV9kb2NgICh3aGF0ZXZlciBpdCBjaGFuZ2VzLCBhIHJlLWFwcGx5IG9mCnRoZSBzYW1lIGRvY3VtZW50IGluY2x1ZGVkKSBhbmQgZXZlcnkgZXhlY3V0ZWQgdXBncmFkZS4gRnJlZXplCmNoYW5nZXMsIHJlY292ZXJ5IGF0dGVtcHRzLCBldmlkZW5jZSwgYW5kIGNhbmNlbGxhdGlvbnMgZG8gbm90CmFkdmFuY2UgaXQuIE5ldmVyIGRlY3JlYXNlcyBhbmQgbmV2ZXIgcmVwZWF0cywgc28gdW5saWtlIGBkb2NfaGFzaGAgaXQKdGVsbHMgQSAtPiBCIC0+IEEgYXBhcnQuIFNjb3BlZCBkb2N1bWVudHMgZG8gbm90IGFkdmFuY2UgaXQ6IGEgZ3JhbnQKY2hhbmdpbmcgbmV2ZXIgbWFrZXMgYW4gYWRtaW4gZG9jdW1lbnQgcHJlcGFyZWQgYWdhaW5zdCB0aGlzCnJldmlzaW9uIHN0YWxlLgAAAAAIcmV2aXNpb24AAAAAAAAAAQAAAAY=",
        "AAAAAAAAAS9UaGUgcnVsZS1ldmFsIHJ1bGVzIHRoZSBpbnN0YWxsZWQgcnVsZXMgZW5mb3JjZSwgYWxpZ25lZCB3aXRoCltgU2VsZjo6aW5zdGFsbGVkX3J1bGVzYF06IGVudHJ5IGBpYCBpcyB3aGF0IGluc3RhbGxlZCBydWxlIGBpYAplbmZvcmNlcywgYW5kIHdoYXQgYF9fY2hlY2tfYXV0aGAgZXZhbHVhdGVzLiBFbXB0eSBvbiBhbiBhY2NvdW50IHRoYXQKaGFzIG5vdCBhcHBsaWVkIGEgZG9jdW1lbnQgc2luY2UgaXQgd2FzIHVwZ3JhZGVkIHRvIGNvZGUgdGhhdCBrZWVwcwp0aGVtLCB3aGljaCBPWidzIHBvbGljaWVzIHN0aWxsIGRlY2lkZS4AAAAACHJ1bGVfc2V0AAAAAAAAAAEAAAPqAAAH0AAAAApTdG9yZWRSdWxlAAA=",
        "AAAAAAAABABBcHBseSB0aGUgYWRtaW4gZG9jdW1lbnQ6IHRoZSBhY2NvdW50J3Mgb3duIHJ1bGVzLCBpdHMgcmVjb3ZlcnkKbWVtYmVyLCBhbmQgZXZlcnl0aGluZyBhIHJlY292ZXJ5IHJlc3RvcmVzLiBXaXRoIHRoZSBzY29wZWQtZG9jdW1lbnQKZW50cnkgcG9pbnRzIChbYFNlbGY6OmFwcGx5X3Njb3BlYF0pLCAqKnRoZSBvbmx5IHdheSBhdXRob3JpemF0aW9uCmNoYW5nZXMqKi4gVGhlIHNoYXJlZCwgaW1tdXRhYmxlIGRvYyBjb21waWxlciBpdCBjYWxscyBpcyBkZXJpdmVkIGZyb20KYnVpbGQtdGltZSBwaW5zIChzZWUgW2BpbmZyYWBdKSwgbmV2ZXIgcGFzc2VkIGluLiBCcmluZ3MgdGhlIGluc3RhbGxlZApydWxlcyB0byB0aGUgZG9jdW1lbnQgaW4gb25lIGludm9jYXRpb24sIGNoYW5naW5nIG9ubHkgdGhlIHJ1bGVzIHRoYXQKZGlmZmVyLCBhbmQgcmV0dXJucyB0aGUgY2Fub25pY2FsIGBkb2NfaGFzaGAuCgpBdXRob3JpemVkIGJ5IHRoZSBvd25lciAoYW55IG9yZGluYXJ5IHJ1bGUgc2NvcGVkIHRvIHRoZSBhY2NvdW50KSwKb3IsIGZvciBhIHJlY292ZXJ5IGNvbXBsZXRpb24gb25seSwgYnkgdGhlIHplcm8tc2lnbmVyIHJlY292ZXJ5IHJ1bGUKd2hvc2UgY29udHJvbGxlciBjaGVja3MgdGhlIGV4YWN0IHRhcmdldC4gT24gYW4gYWNjb3VudCB3aXRoIGFuCmFkb3B0ZWQgY29udHJvbGxlciwgdGhlIGNvbnRyb2xsZXIncyBgcmN2X3N5bmNgIGNsYXNzaWZpZXMgdGhlIGNhbGwKYmVmb3JlIGFueSBydWxlIGNoYW5nZXMgYW5kIHJlZnVzZXMgd2hhdCB0aGUgcHJvZmlsZSBkb2VzIG5vdCBhbGxvdwooYGRvY3MvcmVjb3Zlcnkvc3BlYy5tZGAgwqcxMCkuIGBhcHByb3ZhbF92YWxpZF91bnRpbGAgaXMgdGhlCmZyZXNobmVzcyBib3VuZCBhIGBQcm90ZWN0ZWRgIHJlY29uZmlndXJhdGlvbidzIHJlY29yZGVkIGFwcHJvdmFscwp3ZXJlIGdpdmVuIGZvcjsgaXQgaXMgaWdub3JlZCBvdGhlcndpc2UuCgpSZWZ1c2VzIChgV2lwZWRDcmVkZW50aWFsYCkgYSBkb2N1bWVudCBuYW1pbmcgYSBjcmVkZW50aWFsAAAACWFwcGx5X2RvYwAAAAAAAAMAAAAAAAAACGRvY19qc29uAAAADgAAAAAAAAAUYXBwcm92YWxfdmFsaWRfdW50aWwAAAAEAAAAAAAAABFleHBlY3RlZF9yZXZpc2lvbgAAAAAAA+gAAAAGAAAAAQAAA+kAAAPuAAAAIAAAB9AAAAARUGVyY2hBY2NvdW50RXJyb3IAAAA=",
        "AAAAAAAAAGVUaGUgY2Fub25pY2FsIGJ5dGVzIG9mIHRoZSBzY29wZWQgZG9jdW1lbnQgdW5kZXIgYHNjb3BlYCwgaWYgYW55Lgpgc2hhMjU2YCBvZiB0aGVtIGlzIGl0cyBgZG9jX2hhc2hgLgAAAAAAAAlzY29wZV9kb2MAAAAAAAABAAAAAAAAAAVzY29wZQAAAAAAAAQAAAABAAAD6AAAAA4=",
        "AAAAAAAAADhXaGV0aGVyIGEgY3JlZGVudGlhbCBmaW5nZXJwcmludCBpcyBwZXJtYW5lbnRseSByZXZva2VkLgAAAAppc19yZXZva2VkAAAAAAABAAAAAAAAAAtmaW5nZXJwcmludAAAAAPuAAAAIAAAAAEAAAAB",
        "AAAAAAAAAI9UaGUgYXBwbGllZCBkb2N1bWVudCdzIGNhbm9uaWNhbCBieXRlcywgb3IgYE5vbmVgIGJlZm9yZSB0aGUgZmlyc3QKYGFwcGx5X2RvY2AuIFVuZGVyIENBTk9OIHYxLCBgc2hhMjU2YCBvZiB0aGVtIGlzCltgU2VsZjo6YXBwbGllZF9kb2NfaGFzaGBdLgAAAAALYXBwbGllZF9kb2MAAAAAAAAAAAEAAAPoAAAADg==",
        "AAAAAAAAA85BcHBseSBhIHNjb3BlZCBkb2N1bWVudCB1bmRlciBgc2NvcGVgLCBhbiBpZCB0aGUgb3duZXIgY2hvb3NlcyAob25lCnBlciBhcHAgZ3JhbnQsIHNheSksIGFuZCByZXR1cm4gaXRzIGBkb2NfaGFzaGAgKHNwZWMgwqc3LjYpLiBPd25lcgphdXRob3JpemF0aW9uLiBSZWZ1c2VzIChgU2NvcGVFc2NhbGF0aW9uYCkgYSBgcmVjb3ZlcnlgIG1lbWJlciwgYQpgc2VsZi1hZG1pbmAgcnVsZSwgb3IgYSBydWxlIHNjb3BlZCB0byB0aGUgYWNjb3VudCwgaXRzIHJlY292ZXJ5CmNvbnRyb2xsZXIsIG9yIGl0cyBaSyBhZGFwdGVyIG9yIHBvb2wsIHNvIG5vIHNjb3BlZCBkb2N1bWVudCByZWFjaGVzCnRoZSBhZG1pbiBkb2N1bWVudCdzIHJ1bGVzLCByZWNvdmVyeSwgb3IgdXBncmFkZXMuIFJlZnVzZXMKKGBXaXBlZENyZWRlbnRpYWxgKSBhIGNyZWRlbnRpYWwgYSBzY29wZWQgZG9jdW1lbnQgbmFtZWQgYmVmb3JlIHRoZQpsYXN0IGNvbXBsZXRlZCByZWNvdmVyeSwgYW5kIHJlY29yZHMgZXZlcnkgY3JlZGVudGlhbCBpdCBuYW1lcyB1bmRlcgp0aGUgY3VycmVudCBzY29wZSBnZW5lcmF0aW9uLiBDb21waWxlZCB1bmRlciB0aGUgc2FtZSBjYXBzIGFzIGFueQpkb2N1bWVudCBhbmQgcmVjb25jaWxlZCBhZ2FpbnN0IHRoaXMgc2NvcGUncyByZWNvcmRzIG9ubHkuIEV2ZXJ5CnJ1bGUgaXQgaW5zdGFsbHMgaXMgdGFnZ2VkIHdpdGggdGhlIHNjb3BlIGFuZCB0aGUgY3VycmVudCBzY29wZQpnZW5lcmF0aW9uLCBzbyBhcHBseWluZyBvdmVyIGEgd2lwZWQgc2NvcGUgcmV2aXZlcyBpdCB3aXRoIHRoZSBuZXcKcnVsZXMuIENhbGxzIG5vIGNvbnRyb2xsZXIsIGFuZCBsZWF2ZXMgdGhlIGFwcGxpZWQgYGRvY19oYXNoYCBhbmQgdGhlCnJldmlzaW9uIGFsb25lLiBSZWZ1c2VzIChgTm9SdWxlU2V0YCkgb24gYW4gYWNjb3VudCB0aGF0IHN0b3JlcyBubwphZG1pbiBydWxlIHNldCwgdW50aWwgaXRzIGZpcnN0IGBhcHBseV9kb2NgLgAAAAAAC2FwcGx5X3Njb3BlAAAAAAIAAAAAAAAABXNjb3BlAAAAAAAABAAAAAAAAAAIZG9jX2pzb24AAAAOAAAAAQAAA+kAAAPuAAAAIAAAB9AAAAARUGVyY2hBY2NvdW50RXJyb3IAAAA=",
        "AAAAAAAAADZIb3cgbWFueSBzY29wZSBpZHMgaGF2ZSBhIHJlY29yZCwgd2lwZWQgb25lcyBpbmNsdWRlZC4AAAAAAAtzY29wZV9jb3VudAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAAMX19jaGVja19hdXRoAAAAAwAAAAAAAAARc2lnbmF0dXJlX3BheWxvYWQAAAAAAAPuAAAAIAAAAAAAAAAKc2lnbmF0dXJlcwAAAAAH0AAAAAtBdXRoUGF5bG9hZAAAAAAAAAAADWF1dGhfY29udGV4dHMAAAAAAAPqAAAH0AAAAAdDb250ZXh0AAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAI9Db25zdGFudHMgb2YgdGhpcyBhY2NvdW50J3Mgd2FzbTogaW50ZXJmYWNlIGFuZCBzbmFwc2hvdCB2ZXJzaW9ucywKdGhlIGRvY3VtZW50IGlkZW50aXR5IGFuZCBhdXRob3JpemF0aW9uIGRpZ2VzdCBzY2hlbWVzLCBhbmQgdGhlIGFwcGx5Cm1vZGVzLgAAAAAMY2FwYWJpbGl0aWVzAAAAAAAAAAEAAAfQAAAAE0FjY291bnRDYXBhYmlsaXRpZXMA",
        "AAAAAAAAADFUaGUgZG9jIGNvbXBpbGVyIHRoaXMgYWNjb3VudCBwaW5zIGF0IGJ1aWxkIHRpbWUuAAAAAAAADGRvY19jb21waWxlcgAAAAAAAAABAAAAEw==",
        "AAAAAAAAAGxSZW1vdmUgdGhlIHNjb3BlZCBkb2N1bWVudCB1bmRlciBgc2NvcGVgIGFuZCBldmVyeSBydWxlIGl0IGluc3RhbGxlZDoKcmV2b2tpbmcgYSBncmFudC4gT3duZXIgYXV0aG9yaXphdGlvbi4AAAAMcmVtb3ZlX3Njb3BlAAAAAQAAAAAAAAAFc2NvcGUAAAAAAAAEAAAAAQAAA+kAAAACAAAH0AAAABFQZXJjaEFjY291bnRFcnJvcgAAAA==",
        "AAAAAAAAAWJEZXBsb3ktdGltZSBydWxlIDAsIGBhZG1pbmA6IGEgcG9saWN5LWZyZWUgc2VsZi1hZG1pbiBydWxlIGZvciB0aGUKYWRtaW4gc2lnbmVycy4gQSBydWxlIHNjb3BlZCB0byB0aGUgYWNjb3VudCBhdXRob3JpemVzIGV2ZXJ5IGVudHJ5CnBvaW50IHRoYXQgcmVxdWlyZXMgdGhlIGFjY291bnQncyBvd24gYXV0aG9yaXphdGlvbiDigJQgYGFwcGx5X2RvY2AsCmBleGVjdXRlYCAoYXJiaXRyYXJ5IGNhbGxzIGFzIHRoZSBhY2NvdW50KSwgdGhlIHVwZ3JhZGUgZW50cnkgcG9pbnRzLAphbmQgYGNhbmNlbF9yZWNvdmVyeWAg4oCUIHNvIHRoaXMgaXMgZnVsbCBvd25lciBhdXRob3JpdHksIG5vdApgYXBwbHlfZG9jYCBhbG9uZS4AAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAAAQAAAAAAAAANYWRtaW5fc2lnbmVycwAAAAAAA+oAAAfQAAAABlNpZ25lcgAAAAAAAA==",
        "AAAAAAAAAM5FdmVyeXRoaW5nIHJ1bGUgc2VsZWN0aW9uIGFuZCBzaWduaW5nIG5lZWQgZm9yIHRoZSBhZG1pbiBkb2N1bWVudCwKcmVhZCBhdCBvbmUgbGVkZ2VyLCB3aXRoIHRoZSByZXZpc2lvbiBpdCBiZWxvbmdzIHRvLiBTY29wZWQKZG9jdW1lbnRzJyBydWxlcyBhcmUgbm90IGluIGl0OiBbYFNlbGY6OnNjb3Blc2BdIGFuZCBbYFNlbGY6OnNjb3BlYF0KbGlzdCB0aGVtLgAAAAAADWNvbmZpZ3VyYXRpb24AAAAAAAAAAAAAAQAAB9AAAAAUQWNjb3VudENvbmZpZ3VyYXRpb24=",
        "AAAAAAAAAHpUaGUgYFByb3RlY3RlZGAgZnJlZXplLCBpZiBvbmUgd2FzIHNldCBhbmQgaGFzIG5vdCBiZWVuIGNsZWFyZWQuIEl0CmlzIGluIGZvcmNlIHdoaWxlIHRoZSBjdXJyZW50IGxlZGdlciBpcyBiZWxvdyBgdW50aWxgLgAAAAAADXJlY292ZXJ5X2dhdGUAAAAAAAAAAAAAAQAAA+gAAAfQAAAACkZyZWV6ZUdhdGUAAA==",
        "AAAAAAAAADBDYW5jZWwgdGhlIHBlbmRpbmcgdXBncmFkZS4gT3duZXIgYXV0aG9yaXphdGlvbi4AAAAOY2FuY2VsX3VwZ3JhZGUAAAAAAAAAAAABAAAD6QAAAAIAAAfQAAAAEVBlcmNoQWNjb3VudEVycm9yAAAA",
        "AAAAAAAAADZXaGV0aGVyIHRoaXMgYWNjb3VudCBldmVyIGVucm9sbGVkIGEgWksgZW5yb2xsbWVudCBpZC4AAAAAAA5pc19lbnJvbGxlZF9pZAAAAAAAAQAAAAAAAAANZW5yb2xsbWVudF9pZAAAAAAAA+4AAAAgAAAAAQAAAAE=",
        "AAAAAAAAAOlUaGUgcnVsZS1ldmFsIHJ1bGVzIHRoZSBzY29wZWQgZG9jdW1lbnQgdW5kZXIgYHNjb3BlYCBpbnN0YWxscywKYWxpZ25lZCB3aXRoIGl0cyByZWNvcmQncyBydWxlcyAoZW50cnkgYGlgIGlzIHdoYXQgcnVsZSBgaWAKZW5mb3JjZXMpLCBlYWNoIGNhcnJ5aW5nIHRoZSBzY29wZSBnZW5lcmF0aW9uIGl0IHdhcyBhcHBsaWVkIHVuZGVyLgpFbXB0eSB3aGVuIG5vIHNjb3BlZCBkb2N1bWVudCBoYXMgdGhlIGlkLgAAAAAAAA5zY29wZV9ydWxlX3NldAAAAAAAAQAAAAAAAAAFc2NvcGUAAAAAAAAEAAAAAQAAA+oAAAfQAAAAClN0b3JlZFJ1bGUAAA==",
        "AAAAAAAAAGtBIGBMb3NzYCBvd25lcidzIGNhbmNlbGxhdGlvbiBvZiBhIHJlY292ZXJ5IGF0dGVtcHQgKHNwZWMgVDcpLiBUaGUKY29udHJvbGxlciByZWZ1c2VzIGl0IHVuZGVyIGBQcm90ZWN0ZWRgLgAAAAAPY2FuY2VsX3JlY292ZXJ5AAAAAAEAAAAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAAABAAAD6QAAAAIAAAfQAAAAEVBlcmNoQWNjb3VudEVycm9yAAAA",
        "AAAAAAAAAuVFeGVjdXRlIHRoZSBwZW5kaW5nIHVwZ3JhZGUgb25jZSBpdHMgZGVsYXkgaGFzIGVsYXBzZWQuIE93bmVyCmF1dGhvcml6YXRpb24uIElmIHRoZSByZWNvdmVyeSBnZW5lcmF0aW9uIG1vdmVkIHNpbmNlIHNjaGVkdWxpbmcKKGFueSBlbnJvbGxtZW50LCByZWNvbmZpZ3VyYXRpb24sIHJlbW92YWwsIGNvbnRyb2xsZXIgc3dpdGNoLApjb21wbGV0ZWQgcmVjb3ZlcnksIG9yIGV4ZWN1dGVkIHVwZ3JhZGUpLCB0aGUgcmVxdWVzdCBpcyBzdGFsZSBhbmQKdGhlIGNhbGwgcmVmdXNlcyB3aXRoIGBTdGFsZVVwZ3JhZGVgLiBUaGUgcmVmdXNhbCBsZWF2ZXMgdGhlIHJlcXVlc3QKaW4gcGxhY2UsIHNpbmNlIGEgZmFpbGVkIGludm9jYXRpb24ga2VlcHMgbm9uZSBvZiBpdHMgd3JpdGVzOyBpdCBjYW4KbmV2ZXIgZXhlY3V0ZSwgYmVjYXVzZSB0aGUgZ2VuZXJhdGlvbiBuZXZlciBkZWNyZWFzZXMsIGFuZCBzdGF5cwp1bnRpbCBgc2NoZWR1bGVfdXBncmFkZWAgcmVwbGFjZXMgaXQsIGBjYW5jZWxfdXBncmFkZWAgcmVtb3ZlcyBpdCwgb3IKYSBjb21wbGV0aW9uIGNsZWFycyBpdC4gT3RoZXJ3aXNlIHRoZSBjb250cm9sbGVyLCBpZiBvbmUgaXMgYWRvcHRlZCwKY2hlY2tzIGl0cyBlcG9jaCBhbmQgYnVtcHMgaXQgKHJlZnVzaW5nIGR1cmluZyBhbiBhdXRob3JpemVkCmF0dGVtcHQpLCB0aGUgZ2VuZXJhdGlvbiBhZHZhbmNlcywgYW5kIHRoZSBXYXNtIGlzIHJlcGxhY2VkIGFmdGVyCnRoaXMgaW52b2NhdGlvbi4AAAAAAAAPZXhlY3V0ZV91cGdyYWRlAAAAAAEAAAAAAAAACnJlcXVlc3RfaWQAAAAAAAYAAAABAAAD6QAAAAIAAAfQAAAAEVBlcmNoQWNjb3VudEVycm9yAAAA",
        "AAAAAAAAALZFdmVyeSBjb250ZXh0IHJ1bGUgdGhlIGFkbWluIGRvY3VtZW50IGluc3RhbGxlZCwgd2l0aCBpdHMgT1ogaWQuIFRoZQpkb2N1bWVudCdzIHJ1bGVzIGFyZSBtYXRjaGVkIGFnYWluc3QgdGhlc2UgYnkgYGFwcGx5X2RvY2AuIEEgc2NvcGVkCmRvY3VtZW50J3MgYXJlIGluIGl0cyBbYFNlbGY6OnNjb3BlYF0gcmVjb3JkLgAAAAAAD2luc3RhbGxlZF9ydWxlcwAAAAAAAAAAAQAAA+oAAAfQAAAADUluc3RhbGxlZFJ1bGUAAAA=",
        "AAAAAAAAAB5UaGUgc2NoZWR1bGVkIHVwZ3JhZGUsIGlmIGFueS4AAAAAAA9wZW5kaW5nX3VwZ3JhZGUAAAAAAAAAAAEAAAPoAAAH0AAAAA5VcGdyYWRlUmVxdWVzdAAA",
        "AAAAAAAAAMJUaGUgY2Fub25pY2FsIGBkb2NfaGFzaGAgb2YgdGhlIGN1cnJlbnRseSBhcHBsaWVkIHBvbGljeSBkb2N1bWVudCwgb3IKYE5vbmVgIGJlZm9yZSB0aGUgZmlyc3QgYGFwcGx5X2RvY2AgKG9ubHkgdGhlIGNvbnN0cnVjdG9yJ3MgYWRtaW4gcnVsZQpleGlzdHMgdGhlbikuIEFueW9uZSBjYW4gY2hlY2sgaW5zdGFsbGVkID09IHJldmlld2VkLgAAAAAAEGFwcGxpZWRfZG9jX2hhc2gAAAAAAAAAAQAAA+gAAAPuAAAAIA==",
        "AAAAAAAAAAAAAAAQZ2V0X2NvbnRleHRfcnVsZQAAAAEAAAAAAAAAD2NvbnRleHRfcnVsZV9pZAAAAAAEAAAAAQAAB9AAAAALQ29udGV4dFJ1bGUA",
        "AAAAAAAAAZZTY2hlZHVsZSBhbiB1cGdyYWRlIHRvIGB3YXNtX2hhc2hgLCBleGVjdXRhYmxlIGFmdGVyCltgQUNDT1VOVF9VUEdSQURFX0RFTEFZX0xFREdFUlNgXSAoc3BlYyDCpzEyKS4gT3duZXIgYXV0aG9yaXphdGlvbjsKdW5kZXIgYFByb3RlY3RlZGAgYWxzbyB0aGUgY29uZGl0aW9uJ3MgcmVjb3JkZWQgYXBwcm92YWwgb2YKYFVwZ3JhZGUgeyByZXF1ZXN0X2lkLCB3YXNtX2hhc2ggfWAgZnJlc2ggdW50aWwKYGFwcHJvdmFsX3ZhbGlkX3VudGlsYCAoYG5leHRfdXBncmFkZV9yZXF1ZXN0X2lkYCBuYW1lcyB0aGUgaWQgdG8KYXBwcm92ZSkuIFJlZnVzZWQgd2hpbGUgYSByZWNvdmVyeSBhdHRlbXB0IGlzIGF1dGhvcml6ZWQuIFJlcGxhY2VzIGFueQplYXJsaWVyIHJlcXVlc3QuIFJldHVybnMgdGhlIHJlcXVlc3QgaWQuAAAAAAAQc2NoZWR1bGVfdXBncmFkZQAAAAIAAAAAAAAACXdhc21faGFzaAAAAAAAA+4AAAAgAAAAAAAAABRhcHByb3ZhbF92YWxpZF91bnRpbAAAAAQAAAABAAAD6QAAAAYAAAfQAAAAEVBlcmNoQWNjb3VudEVycm9yAAAA",
        "AAAAAAAAAU9UaGUgYWNjb3VudCdzIHNjb3BlIGdlbmVyYXRpb246IDAgdW50aWwgdGhlIGZpcnN0IGNvbXBsZXRlZApyZWNvdmVyeSwgdGhlbiBhZHZhbmNlZCBieSBvbmUgYnkgZWFjaCBjb21wbGV0ZWQgcmVjb3ZlcnkgYW5kIGJ5Cm5vdGhpbmcgZWxzZSAobm90IGJ5IGVucm9sbG1lbnQsIHJlY29uZmlndXJhdGlvbiwgcmVtb3ZhbCwgYQpjb250cm9sbGVyIHN3aXRjaCwgb3IgYW4gZXhlY3V0ZWQgdXBncmFkZSwgYWxsIG9mIHdoaWNoIGFkdmFuY2UKW2BTZWxmOjpyZWNvdmVyeV9nZW5lcmF0aW9uYF0pLiBBIHNjb3BlIHdob3NlIHJlY29yZCBoYXMgYW5vdGhlcgpnZW5lcmF0aW9uIGlzIHdpcGVkLgAAAAAQc2NvcGVfZ2VuZXJhdGlvbgAAAAAAAAABAAAABg==",
        "AAAAAAAAAChUaGUgYWRvcHRlZCByZWNvdmVyeSBjb250cm9sbGVyLCBpZiBhbnkuAAAAE3JlY292ZXJ5X2NvbnRyb2xsZXIAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAC5UaGUgYWNjb3VudCdzIHJlY292ZXJ5IGdlbmVyYXRpb24gKHNwZWMgwqcxMikuAAAAAAATcmVjb3ZlcnlfZ2VuZXJhdGlvbgAAAAAAAAAAAQAAAAY=",
        "AAAAAAAAAMNUaGUgbGFzdCBzY29wZSBnZW5lcmF0aW9uIGEgc2NvcGVkIGRvY3VtZW50IG5hbWVkIHRoaXMgY3JlZGVudGlhbApmaW5nZXJwcmludCB1bmRlciwgaWYgb25lIGV2ZXIgZGlkLiBPbmNlIFtgU2VsZjo6c2NvcGVfZ2VuZXJhdGlvbmBdCmlzIHBhc3QgaXQsIG5vIGRvY3VtZW50IG1heSBuYW1lIHRoZSBjcmVkZW50aWFsIChzcGVjIMKnNy42KS4AAAAAFWNyZWRlbnRpYWxfZ2VuZXJhdGlvbgAAAAAAAAEAAAAAAAAAC2ZpbmdlcnByaW50AAAAA+4AAAAgAAAAAQAAA+gAAAAG",
        "AAAAAAAAANBPWidzIGNvdW50IG9mIHRoZSBhY2NvdW50J3MgY29udGV4dCBydWxlcywgc2NvcGVkIGRvY3VtZW50cycgYW5kCmV4cGlyZWQgb25lcyBpbmNsdWRlZC4KUmVhZC1vbmx5IHJ1bGUgc3VyZmFjZSwgcmUtZXhwb3NlZCBoZXJlIGJlY2F1c2UgYFNtYXJ0QWNjb3VudGAgaXRzZWxmCmlzIGRlbGliZXJhdGVseSBub3QgZXhwb3J0ZWQgYnkgZG9jLW9ubHkgYWNjb3VudHMuAAAAF2dldF9jb250ZXh0X3J1bGVzX2NvdW50AAAAAAAAAAABAAAABA==",
        "AAAAAAAAAFNUaGUgaWQgdGhlIG5leHQgYHNjaGVkdWxlX3VwZ3JhZGVgIHdpbGwgYXNzaWduOiB3aGF0IGBQcm90ZWN0ZWRgCmFwcHJvdmVycyBhcHByb3ZlLgAAAAAXbmV4dF91cGdyYWRlX3JlcXVlc3RfaWQAAAAAAAAAAAEAAAAG",
        "AAAAAQAAAmFPbmUgcGVuZGluZyBhY2NvdW50IHVwZ3JhZGUgKHNwZWMgwqcxMikuCgpTdGFsZW5lc3MgaXMganVkZ2VkIGFnYWluc3QgdGhlIGFjY291bnQncyBvd24gKipyZWNvdmVyeSBnZW5lcmF0aW9uKiosIGEKYHU2NGAgdGhlIGFjY291bnQga2VlcHMgaW4gaXRzIG93biBzdG9yYWdlLiBJdCBzdGFydHMgYXQgMCBhbmQgaXMgbmV2ZXIKcmVzZXQuIEl0IGFkdmFuY2VzIG9uIGV2ZXJ5IGByY3Zfc3luY2Agb3V0Y29tZSBvdGhlciB0aGFuIGBVbmNoYW5nZWRgCihgY29udHJvbGxlcjo6U3luY091dGNvbWU6OmJ1bXBzX2dlbmVyYXRpb25gKSBhbmQgb24gZXZlcnkgZXhlY3V0ZWQKdXBncmFkZS4KClRoZSBjb250cm9sbGVyJ3MgZXBvY2ggY2Fubm90IHBsYXkgdGhpcyByb2xlLiBJdCBiZWxvbmdzIHRvIG9uZQpjb250cm9sbGVyIGFuZCBkb2VzIG5vdCBleGlzdCB3aGlsZSB0aGUgYWNjb3VudCBpcyB1bmVucm9sbGVkLCBzbyBhCnJlcXVlc3Qgc2NoZWR1bGVkIHVuZW5yb2xsZWQgd291bGQgc3Vydml2ZSBlbnJvbGxpbmcgcmVjb3ZlcnkgYW5kCnJlbW92aW5nIGl0IGFnYWluOiB0aGUgZmluYWwgc3RhdGUgaGFzIG5vIGNvbnRyb2xsZXIsIGp1c3QgYXMgYXQKc2NoZWR1bGluZy4AAAAAAAAAAAAADlVwZ3JhZGVSZXF1ZXN0AAAAAAAFAAAAlVRoZSBhZG9wdGVkIGNvbnRyb2xsZXIncyBlcG9jaCB3aGVuIHNjaGVkdWxlZCwgaWYgYSBjb250cm9sbGVyIHdhcwphZG9wdGVkLiBQYXNzZWQgYmFjayBhcyBgVXBncmFkZVN0ZXA6OkV4ZWN1dGVgIHNvIHRoZSBjb250cm9sbGVyIGNhbgpjaGVjayBpdCB0b28uAAAAAAAAEGNvbnRyb2xsZXJfZXBvY2gAAAPoAAAABgAAADJUaGUgZmlyc3QgbGVkZ2VyIGF0IHdoaWNoIHRoZSByZXF1ZXN0IG1heSBleGVjdXRlLgAAAAAADWV4ZWN1dGFibGVfYXQAAAAAAAAEAAAAQVRoZSBhY2NvdW50J3MgcmVjb3ZlcnkgZ2VuZXJhdGlvbiB3aGVuIHRoZSByZXF1ZXN0IHdhcyBzY2hlZHVsZWQuAAAAAAAACmdlbmVyYXRpb24AAAAAAAYAAAAaUGVyLWFjY291bnQsIG5ldmVyIHJldXNlZC4AAAAAAApyZXF1ZXN0X2lkAAAAAAAGAAAAJFRoZSBleGFjdCBXYXNtIHRoZSBhY2NvdW50IHdpbGwgcnVuLgAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIA==",
        "AAAAAQAAABFgcnVsZV9ldmFsOjpDYXBgLgAAAAAAAAAAAAAJU3RvcmVkQ2FwAAAAAAAAAwAAAAAAAAAKYW1vdW50X2FyZwAAAAAABAAAAAAAAAAFbGltaXQAAAAAAAALAAAAAAAAAAZwZXJpb2QAAAAAAAQ=",
        "AAAAAgAAABFgcnVsZV9ldmFsOjpWYWxgLgAAAAAAAAAAAAAJU3RvcmVkVmFsAAAAAAAACAAAAAEAAAAAAAAABEkxMjgAAAABAAAACwAAAAEAAAAAAAAAA1U2NAAAAAABAAAABgAAAAEAAAAAAAAABEJvb2wAAAABAAAAAQAAAAEAAAAAAAAABUJ5dGVzAAAAAAAAAQAAAA4AAAABAAAAAAAAAAdBZGRyZXNzAAAAAAEAAAATAAAAAQAAAAAAAAAGU3ltYm9sAAAAAAABAAAAEQAAAAEAAAAAAAAABlN0cmluZwAAAAAAAQAAABAAAAABAAAALEFueSBvdGhlciBhcmd1bWVudCwgYXMgaXRzIGZ1bGwgYFNjVmFsYCBYRFIuAAAABU90aGVyAAAAAAAAAQAAAA4=",
        "AAAAAgAAABJgcnVsZV9ldmFsOjpDb25kYC4AAAAAAAAAAAAKU3RvcmVkQ29uZAAAAAAABAAAAAEAAAAAAAAABUFyZ0VxAAAAAAAAAgAAAAQAAAfQAAAACVN0b3JlZFZhbAAAAAAAAAEAAAAAAAAADUFyZ0kxMjhBdE1vc3QAAAAAAAACAAAABAAAAAsAAAABAAAAAAAAAAVBcmdJbgAAAAAAAAIAAAAEAAAD6gAAB9AAAAAJU3RvcmVkVmFsAAAAAAAAAQAAAAAAAAAMQXJnU3RyUHJlZml4AAAAAgAAAAQAAAAQ",
        "AAAAAQAAABJgcnVsZV9ldmFsOjpSdWxlYC4AAAAAAAAAAAAKU3RvcmVkUnVsZQAAAAAACAAAAFVaZXJvIG9yIG9uZSBlbnRyaWVzOiBgI1tjb250cmFjdHR5cGVdYCBoYXMgbm8gYE9wdGlvbmAgb2YgYQpgI1tjb250cmFjdHR5cGVdYCBzdHJ1Y3QuAAAAAAAAA2NhcAAAAAPqAAAH0AAAAAlTdG9yZWRDYXAAAAAAAAAAAAAABWNvbmRzAAAAAAAD6gAAB9AAAAAKU3RvcmVkQ29uZAAAAAAAAAAAAAhjb250cmFjdAAAABMAAAAAAAAACWZ1bmN0aW9ucwAAAAAAB9AAAAAPU3RvcmVkRnVuY3Rpb25zAAAAAAAAAAAKZ2VuZXJhdGlvbgAAAAAD6AAAAAYAAAAAAAAAB3NpZ25lcnMAAAAD6gAAB9AAAAAGU2lnbmVyAAAAAAAAAAAACXRocmVzaG9sZAAAAAAAAAQAAAAAAAAAC3ZhbGlkX3VudGlsAAAAA+gAAAAE",
        "AAAAAgAAABdgcnVsZV9ldmFsOjpGdW5jdGlvbnNgLgAAAAAAAAAAD1N0b3JlZEZ1bmN0aW9ucwAAAAACAAAAAQAAAAAAAAAJQW55RXhjZXB0AAAAAAAAAQAAA+oAAAARAAAAAQAAAAAAAAAET25seQAAAAEAAAPqAAAAEQ==",
        "AAAAAQAAAINUaGUgc2hhcmVkIGluZnJhIGFuIGFjY291bnQgcmVzb2x2ZXMsIHBpbm5lZCB3aGVuIGl0IHdhcyBidWlsdCAoc2VlCltgaW5mcmFgXSk6IHdoYXQgYSBkZXBsb3ltZW50IGNoZWNrIGNvbXBhcmVzIHdpdGggaXRzIG1hbmlmZXN0LgAAAAAAAAAACUluZnJhUGlucwAAAAAAAAMAAAAAAAAADGRvY19jb21waWxlcgAAABMAAAAAAAAAC2ludGVycHJldGVyAAAAABMAAAAAAAAADnNwZW5kaW5nX2xpbWl0AAAAAAAT",
        "AAAAAQAAALtUaGUgYFByb3RlY3RlZGAgZnJlZXplLCBtaXJyb3JlZCBmcm9tIHRoZSBhZG9wdGVkIGNvbnRyb2xsZXIgdGhyb3VnaApbYFBlcmNoU21hcnRBY2NvdW50OjpyY3ZfZ2F0ZWBdOiB3aGlsZSBgbGVkZ2VyIDwgdW50aWxgLCB0aGUgYWNjb3VudAphdXRob3JpemVzIG5vdGhpbmcgYnV0IGBhdHRlbXB0X2lkYCdzIGNvbXBsZXRpb24uAAAAAAAAAAAKRnJlZXplR2F0ZQAAAAAAAgAAAAAAAAAKYXR0ZW1wdF9pZAAAAAAABgAAACZUaGUgYXV0aG9yaXplZCBhdHRlbXB0J3MgYGV4cGlyZXNfYXRgLgAAAAAABXVudGlsAAAAAAAABA==",
        "AAAABQAAAT1FbWl0dGVkIGFmdGVyIGEgZG9jdW1lbnQgaXMgYXBwbGllZDogdGhlIG5ldyBjYW5vbmljYWwgYGRvY19oYXNoYCwgdGhlCmNvbmZpZ3VyYXRpb24gcmV2aXNpb24gaXQgd2FzIGFwcGxpZWQgYXQsIGFuZCB3aGF0IGNoYW5nZWQgaW4gdGhlIHJ1bGUKc2V0LiBUaGUgcnVsZSwgc2lnbmVyLCBhbmQgcG9saWN5IG11dGF0aW9ucyBlbWl0IG5vdGhpbmcgdGhlbXNlbHZlcyAoT1oncwpgX25vX2V2ZW50c2AgdmFyaWFudHMpLCBzbyB0aGlzIGlzIHRoZSB3aG9sZSByZWNvcmQgb2YgdGhlIGNoYW5nZTsKYGFwcGxpZWRfZG9jYCBzZXJ2ZXMgdGhlIGRvY3VtZW50LgAAAAAAAAAAAAAKRG9jQXBwbGllZAAAAAAAAQAAAAtkb2NfYXBwbGllZAAAAAAJAAAAAAAAAAhkb2NfaGFzaAAAA+4AAAAgAAAAAQAAAAAAAAAIcmV2aXNpb24AAAAGAAAAAAAAAAAAAAALcnVsZXNfYWRkZWQAAAAABAAAAAAAAAAAAAAADXJ1bGVzX3JlbW92ZWQAAAAAAAAEAAAAAAAAAAAAAAAMcnVsZXNfZWRpdGVkAAAABAAAAAAAAAAAAAAADXNpZ25lcnNfYWRkZWQAAAAAAAAEAAAAAAAAAAAAAAAPc2lnbmVyc19yZW1vdmVkAAAAAAQAAAAAAAAAAAAAAA5wb2xpY2llc19hZGRlZAAAAAAABAAAAAAAAAAAAAAAEHBvbGljaWVzX3JlbW92ZWQAAAAEAAAAAAAAAAI=",
        "AAAAAQAAAEpPbmUgc2NvcGVkIGRvY3VtZW50IGFzIGFwcGxpZWQ6IHdoYXQgW2BQZXJjaFNtYXJ0QWNjb3VudDo6c2NvcGVgXQpyZXR1cm5zLgAAAAAAAAAAAAtTY29wZVJlY29yZAAAAAADAAAAK1RoZSBzY29wZWQgZG9jdW1lbnQncyBjYW5vbmljYWwgYGRvY19oYXNoYC4AAAAACGRvY19oYXNoAAAD7gAAACAAAADeVGhlIHNjb3BlIGdlbmVyYXRpb24gaXQgd2FzIGFwcGxpZWQgdW5kZXIuIE9uY2UKW2BQZXJjaFNtYXJ0QWNjb3VudDo6c2NvcGVfZ2VuZXJhdGlvbmBdIGhhcyBtb3ZlZCBwYXN0IGl0LCBhIHJlY292ZXJ5CmNvbXBsZXRpb24gaGFzIHdpcGVkIHRoZSBzY29wZTogaXRzIHJ1bGVzIGF1dGhvcml6ZSBub3RoaW5nLCBhbmQKYW55b25lIG1heSByZW1vdmUgdGhlbSB3aXRoIGBnY19zY29wZWAuAAAAAAADZ2VuAAAAAAYAAAAwRXZlcnkgY29udGV4dCBydWxlIGl0IGluc3RhbGxlZCwgd2l0aCBpdHMgT1ogaWQuAAAABXJ1bGVzAAAAAAAD6gAAB9AAAAANSW5zdGFsbGVkUnVsZQAAAA==",
        "AAAABQAAAIJFbWl0dGVkIHdoZW4gYSByZWNvdmVyeSBjb21wbGV0aW9uIGFkdmFuY2VzIHRoZSBzY29wZSBnZW5lcmF0aW9uIHRvCmBnZW5gOiBldmVyeSBzY29wZWQgZG9jdW1lbnQgYXBwbGllZCBiZWZvcmUgc3RvcHMgYXV0aG9yaXppbmcuAAAAAAAAAAAAC1Njb3Blc1dpcGVkAAAAAAEAAAAMc2NvcGVzX3dpcGVkAAAAAQAAAAAAAAADZ2VuAAAAAAYAAAAAAAAAAg==",
        "AAAABQAAANxFbWl0dGVkIGFmdGVyIGEgc2NvcGVkIGRvY3VtZW50IGlzIGFwcGxpZWQ6IGl0cyBzY29wZSBpZCwgY2Fub25pY2FsCmBkb2NfaGFzaGAsIHRoZSBzY29wZSBnZW5lcmF0aW9uIGl0IHdhcyBhcHBsaWVkIHVuZGVyLCBhbmQgd2hhdCBjaGFuZ2VkIGluCml0cyBydWxlIHNldCwgY291bnRlZCBsaWtlIFtgRG9jQXBwbGllZGBdJ3MuIGBzY29wZV9kb2NgIHNlcnZlcyB0aGUKZG9jdW1lbnQuAAAAAAAAAAxTY29wZUFwcGxpZWQAAAABAAAADXNjb3BlX2FwcGxpZWQAAAAAAAAKAAAAAAAAAAVzY29wZQAAAAAAAAQAAAABAAAAAAAAAAhkb2NfaGFzaAAAA+4AAAAgAAAAAAAAAAAAAAADZ2VuAAAAAAYAAAAAAAAAAAAAAAtydWxlc19hZGRlZAAAAAAEAAAAAAAAAAAAAAANcnVsZXNfcmVtb3ZlZAAAAAAAAAQAAAAAAAAAAAAAAAxydWxlc19lZGl0ZWQAAAAEAAAAAAAAAAAAAAANc2lnbmVyc19hZGRlZAAAAAAAAAQAAAAAAAAAAAAAAA9zaWduZXJzX3JlbW92ZWQAAAAABAAAAAAAAAAAAAAADnBvbGljaWVzX2FkZGVkAAAAAAAEAAAAAAAAAAAAAAAQcG9saWNpZXNfcmVtb3ZlZAAAAAQAAAAAAAAAAg==",
        "AAAABQAAAIdFbWl0dGVkIHdoZW4gYSBzY29wZWQgZG9jdW1lbnQgaXMgcmVtb3ZlZCB3aXRoIGV2ZXJ5IHJ1bGUgaXQgaW5zdGFsbGVkLApieSBgcmVtb3ZlX3Njb3BlYCwgb3IgYnkgYGdjX3Njb3BlYCBvbmNlIGEgY29tcGxldGlvbiB3aXBlZCBpdC4AAAAAAAAAAAxTY29wZVJlbW92ZWQAAAABAAAADXNjb3BlX3JlbW92ZWQAAAAAAAADAAAAAAAAAAVzY29wZQAAAAAAAAQAAAABAAAAL1RoZSBzY29wZSBnZW5lcmF0aW9uIGl0IGhhZCBiZWVuIGFwcGxpZWQgdW5kZXIuAAAAAANnZW4AAAAABgAAAAAAAAAAAAAADXJ1bGVzX3JlbW92ZWQAAAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAAFhFbWl0dGVkIHdoZW4gdGhlIGFkb3B0ZWQgY29udHJvbGxlciBzZXRzIChgdW50aWwgPiAwYCkgb3IgY2xlYXJzIHRoZQpgUHJvdGVjdGVkYCBmcmVlemUuAAAAAAAAAA1GcmVlemVDaGFuZ2VkAAAAAAAAAQAAAA5mcmVlemVfY2hhbmdlZAAAAAAAAgAAAAAAAAAKYXR0ZW1wdF9pZAAAAAAABgAAAAAAAAAAAAAABXVudGlsAAAAAAAABAAAAAAAAAAC",
        "AAAABQAAAIhFbWl0dGVkIHdoZW4gYSBzY2hlZHVsZWQgdXBncmFkZSBpcyBkcm9wcGVkOiBjYW5jZWxsZWQsIHJlcGxhY2VkIGJ5IGEKbmV3ZXIgcmVxdWVzdCwgZm91bmQgc3RhbGUgYXQgZXhlY3V0aW9uLCBvciBjbGVhcmVkIGJ5IGEgcmVjb3ZlcnkuAAAAAAAAAA5VcGdyYWRlRHJvcHBlZAAAAAAAAQAAAA91cGdyYWRlX2Ryb3BwZWQAAAAAAQAAAAAAAAAKcmVxdWVzdF9pZAAAAAAABgAAAAEAAAAC",
        "AAAABQAAACFFbWl0dGVkIHdoZW4gYW4gdXBncmFkZSBleGVjdXRlcy4AAAAAAAAAAAAAD1VwZ3JhZGVFeGVjdXRlZAAAAAABAAAAEHVwZ3JhZGVfZXhlY3V0ZWQAAAACAAAAAAAAAApyZXF1ZXN0X2lkAAAAAAAGAAAAAQAAAAAAAAAJd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAAAAAAAg==",
        "AAAABQAAACVFbWl0dGVkIHdoZW4gYW4gdXBncmFkZSBpcyBzY2hlZHVsZWQuAAAAAAAAAAAAABBVcGdyYWRlU2NoZWR1bGVkAAAAAQAAABF1cGdyYWRlX3NjaGVkdWxlZAAAAAAAAAMAAAAAAAAACnJlcXVlc3RfaWQAAAAAAAYAAAABAAAAAAAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAAAAAAADWV4ZWN1dGFibGVfYXQAAAAAAAAEAAAAAAAAAAI=",
        "AAAABAAAAI9FdmVyeXRoaW5nIHRoZSBhY2NvdW50J3MgZW50cnkgcG9pbnRzIGNhbiByZWZ1c2UuIENvbXBpbGVyIGFuZCBjb250cm9sbGVyIGZhaWx1cmVzIGZsYXR0ZW4gaW4gdmlhIGAjW2Zyb21fY29udHJhY3RfY2xpZW50XWAsIGNvbnZlcnRlZCBieSBgPz9gLgAAAAAAAAAAEVBlcmNoQWNjb3VudEVycm9yAAAAAAAAQQAAAJBUaGUgZG9jdW1lbnQga2VlcHMgbm8gY29uc3RyYWludC1mcmVlLCBuZXZlci1leHBpcmluZyBzZWxmLWFkbWluIHJ1bGUgd2l0aCBhIHNpZ25lci4gQXBwbHlpbmcgaXQgY291bGQgbG9jayB0aGUgYWRtaW4gb3V0OyByZWZ1c2VkIChhbnRpLWJyaWNrKS4AAAAMQWRtaW5Mb2Nrb3V0AAAAAQAAAFtUaGUgZG9jdW1lbnQgbmFtZXMgYSBjcmVkZW50aWFsIGluIHRoZSBhY2NvdW50J3MgcmV2b2tlZCBzZXQgKGBkb2NzL3JlY292ZXJ5L3NwZWMubWRgIMKnOCkuAAAAABFSZXZva2VkQ3JlZGVudGlhbAAAAAAAAAIAAABQVGhlIGRvY3VtZW50IG5hbWVzIGEgWksgZW5yb2xsbWVudCBpZCB0aGlzIGFjY291bnQgZW5yb2xsZWQgYmVmb3JlIChzcGVjIMKnMy40KS4AAAAQRW5yb2xsbWVudFJldXNlZAAAAAMAAAB8VGhlIGRvY3VtZW50IGNoYW5nZXMgdGhlIFpLIGZhY3RvciB3aXRob3V0IGEgbmV3IGVucm9sbG1lbnQgaWQgKHNwZWMgwqczLjQ6IHRoZSBmYWN0b3Igc3RheXMgdW5jaGFuZ2VkIG9yIGNhcnJpZXMgYSBuZXcgaWQpLgAAABZaa0ZhY3RvckNoYW5nZWRJblBsYWNlAAAAAAAEAAAAPWBleGVjdXRlYCB3YXMgYXNrZWQgdG8gY2FsbCBhbiBpbnZva2VyLW9ubHkgaG9vayAoc3BlYyDCpzE1KS4AAAAAAAAQUmVzZXJ2ZWRGdW5jdGlvbgAAAAUAAAAvVGhlIGFjY291bnQgaGFzIG5vIGFkb3B0ZWQgcmVjb3ZlcnkgY29udHJvbGxlci4AAAAAE1JlY292ZXJ5Tm90RW5yb2xsZWQAAAAABgAAABhObyB1cGdyYWRlIGlzIHNjaGVkdWxlZC4AAAAQTm9QZW5kaW5nVXBncmFkZQAAAAcAAAAsVGhlIHJlcXVlc3QgaWQgaXMgbm90IHRoZSBwZW5kaW5nIHVwZ3JhZGUncy4AAAAWVXBncmFkZVJlcXVlc3RNaXNtYXRjaAAAAAAACAAAACJUaGUgdXBncmFkZSBkZWxheSBoYXMgbm90IGVsYXBzZWQuAAAAAAAPVXBncmFkZU5vdFJlYWR5AAAAAAkAAAAmQSBsZWRnZXIgY29tcHV0YXRpb24gb3ZlcmZsb3dlZCBgdTMyYC4AAAAAAA5UaW1pbmdPdmVyZmxvdwAAAAAACgAAAENBIGNvbXBsZXRpb24gaGFuZGVkIGJhY2sgYSBjcmVkZW50aWFsIHRoYXQgY2Fubm90IGJlIGZpbmdlcnByaW50ZWQuAAAAABFJbnZhbGlkQ3JlZGVudGlhbAAAAAAAAAsAAAB7VGhlIHJlY292ZXJ5IGdlbmVyYXRpb24gbW92ZWQgc2luY2UgdGhlIHVwZ3JhZGUgd2FzIHNjaGVkdWxlZCAoc3BlYyDCpzEyKS4gVGhlIHJlcXVlc3Qgc3RheXMgcGVuZGluZyBidXQgY2FuIG5ldmVyIGV4ZWN1dGUuAAAAAAxTdGFsZVVwZ3JhZGUAAAAMAAAAK1RoZSBzdWJtaXR0ZWQgZG9jdW1lbnQgYnl0ZXMgYXJlIG5vdCBVVEYtOC4AAAAAE0NvbXBpbGVyX0RvY05vdFV0ZjgAAAAADQAAAGxUaGUgZG9jdW1lbnQgZmFpbGVkIGZhaWwtY2xvc2VkIHBhcnNpbmcgKHVua25vd24gZmllbGQsIGJhZCBzaGFwZSwgdW5zdXBwb3J0ZWQgdmVyc2lvbiwgZHVwbGljYXRlIGtleSwg4oCmKS4AAAARQ29tcGlsZXJfRG9jUGFyc2UAAAAAAAAOAAAAc1RoZSBkb2N1bWVudCBmYWlsZWQgc2VtYW50aWMgdmFsaWRhdGlvbiAoZGFuZ2xpbmcgc2lnbmVyIHJlZiwgbWFsZm9ybWVkIGFkZHJlc3Mgb3Iga2V5LCBhbWJpZ3VvdXMgZW1wdHkgbGlzdCwg4oCmKS4AAAAAE0NvbXBpbGVyX0RvY0ludmFsaWQAAAAADwAAAENUaGUgZG9jdW1lbnQgbmFtZXMgbm8gbmV0d29yaywgb3IgYSBuZXR3b3JrIHRoYXQgaXMgbm90IHRoaXMgY2hhaW4uAAAAABVDb21waWxlcl9Xcm9uZ05ldHdvcmsAAAAAAAAQAAAAjFRoZSBkb2N1bWVudCBjYW5ub3QgYmUgbG93ZXJlZCB0byBydWxlczogYSBydWxlIHdpdGggc2VsZi1hdXRoZW50aWNhdGluZyBwcmluY2lwYWxzLCBvciB3aXRoIG1vcmUgdGhhbiBbYE1BWF9SVUxFX0NPTlNUUkFJTlRTYF0gY29uc3RyYWludHMuAAAAE0NvbXBpbGVyX0RvY0NvbXBpbGUAAAAAEQAAAINUaGUgZG9jdW1lbnQgZXhjZWVkcyBhIGRvY3VtZW50IGNhcCAoW2BNQVhfRE9DX1NJR05FUlNgXSwgW2BNQVhfRE9DX1JVTEVTYF0sIFtgTUFYX0RPQ19DQU5PTklDQUxfQllURVNgXSwgW2BNQVhfUlVMRV9OQU1FX0JZVEVTYF0pLgAAAAAUQ29tcGlsZXJfRG9jVG9vTGFyZ2UAAAASAAACN0Egc2lnbmVyJ3MgZXh0ZXJuYWwgYGtleWAgaXMgbm90IGl0cyB2ZXJpZmllci1jYW5vbmljYWwgZm9ybTogZWl0aGVyIHRoZSB2ZXJpZmllciBjb3VsZCBub3QgY2Fub25pY2FsaXplIGl0IGF0IGFsbCwgb3IgdGhlIGRlY2xhcmVkIGJ5dGVzIGRpZmZlciBmcm9tIHRoZSBjYW5vbmljYWwgZm9ybSB0aGUgdmVyaWZpZXIgcmV0dXJucyAoZS5nLiBhIFdlYkF1dGhuIGtleSBjYXJyeWluZyBhIGNyZWRlbnRpYWwtaWQgc3VmZml4IHRoZSB2ZXJpZmllciBkcm9wcywgb3IgYSBub24tY2Fub25pY2FsIHBvaW50IGVuY29kaW5nKS4gVGhlIGNvbXBpbGVyIHJlZnVzZXMgaXQgcmF0aGVyIHRoYW4gc2lsZW50bHkgY2Fub25pY2FsaXppbmcsIHNvIHRoZSBieXRlcyB0aGUgZG9jdW1lbnQgaGFzaCDigJQgYW5kIGEgcmVjb3ZlcnkgYXR0ZW1wdCdzIGByZXBsYWNlbWVudHNfaGFzaGAg4oCUIGJpbmQgYXJlIGV4YWN0bHkgdGhlIGJ5dGVzIHRoZSBpbnN0YWxsZWQgY3JlZGVudGlhbCB1c2VzLCBhbmQgdHdvIHNpZ25lcnMgY2Fubm90IGhpZGUgb25lIHBoeXNpY2FsIGtleSB1bmRlciB0d28gc3BlbGxpbmdzLgAAAAAeQ29tcGlsZXJfS2V5Tm90Q2Fub25pY2FsaXphYmxlAAAAAAATAAAAOmBkZXJpdmVfdGFyZ2V0YDogdGhlIGN1cnJlbnQgZG9jdW1lbnQgZW5yb2xscyBubyByZWNvdmVyeS4AAAAAABRDb21waWxlcl9Ob3RFbnJvbGxlZAAAABQAAAD9YGRlcml2ZV90YXJnZXRgOiB0aGUgcmVwbGFjZW1lbnQgc2V0IGJyZWFrcyBzcGVjIMKnNy4zIHJ1bGVzIDEtMyAobm90IGNhbm9uaWNhbCwgZW1wdHkgZm9yIGxvc3Qta2V5LCBhIHNpZ25lciBpZCB0aGF0IGlzIG5vdCByZXBsYWNlYWJsZSBvciBub3QgZGVjbGFyZWQgaW4gdGhlIHNvdXJjZSwgb3IgYSBjaGFuZ2Ugb2YgY3JlZGVudGlhbCBraW5kIG9yIHZlcmlmaWVyKSwgb3IgdGhlIGFjdGlvbiBpcyBub3QgYSByZWNvdmVyeSBhdHRlbXB0LgAAAAAAABtDb21waWxlcl9SZXBsYWNlbWVudFJlZnVzZWQAAAAAFQAAAHlgZGVyaXZlX3RhcmdldGA6IHRoZSBaSyBlbnJvbGxtZW50IGlzIG1pc3NpbmcgZm9yIGEgWksgbW9kZSwgcHJlc2VudCBmb3IgYSBndWFyZGlhbi1vbmx5IG1vZGUsIG9yIHJldXNlcyB0aGUgZW5yb2xsZWQgaWQuAAAAAAAAHUNvbXBpbGVyX1prRW5yb2xsbWVudE1pc21hdGNoAAAAAAAAFgAAAGhgZGVyaXZlX3RhcmdldGA6IHRoZSB0YXJnZXQgaGFzIG5vIGNvbnN0cmFpbnQtZnJlZSBzZWxmLWFkbWluIHJ1bGUgd2l0aCBhIHNpZ25lciAodGhlIGFudGktYnJpY2sgY2hlY2spLgAAABVDb21waWxlcl9BZG1pbkxvY2tvdXQAAAAAAAAXAAAAQU5vIGNvbmZpZ3VyYXRpb24gaXMgZW5yb2xsZWQgZm9yIHRoaXMgYWNjb3VudCBhdCB0aGlzIGNvbnRyb2xsZXIuAAAAAAAAFFJlY292ZXJ5X05vdEVucm9sbGVkAAAAGAAAAIBBbiBhdHRlbXB0IGlzIGF1dGhvcml6ZWQgYW5kIGxpdmU6IGJlZ2luLCBwb2xpY3kgY2hhbmdlcywgYW5kIHVwZ3JhZGVzIGFyZSByZWZ1c2VkIHVudGlsIGl0IGNvbXBsZXRlcywgaXMgY2FuY2VsbGVkLCBvciBleHBpcmVzLgAAABpSZWNvdmVyeV9BdHRlbXB0QXV0aG9yaXplZAAAAAAAGQAAAC9ObyBhdHRlbXB0IHdpdGggdGhpcyBpZCBleGlzdHMgZm9yIHRoZSBhY2NvdW50LgAAAAAWUmVjb3ZlcnlfTm9TdWNoQXR0ZW1wdAAAAAAAGgAAAGNUaGUgYXR0ZW1wdCBpcyB0ZXJtaW5hbCwgZXhwaXJlZCwgZnJvbSBhbiBvbGRlciBlcG9jaCwgb3IgaW52YWxpZGF0ZWQgYnkgYSBzaWJsaW5nJ3MgYXV0aG9yaXphdGlvbi4AAAAAF1JlY292ZXJ5X0F0dGVtcHROb3RMaXZlAAAAABsAAABASW5pdGlhdGlvbiBldmlkZW5jZSBmb3IgYW4gYXR0ZW1wdCB0aGF0IGlzIG5vIGxvbmdlciBjb2xsZWN0aW5nLgAAAB1SZWNvdmVyeV9BdHRlbXB0Tm90Q29sbGVjdGluZwAAAAAAABwAAAAlQ29tcGxldGlvbiBiZWZvcmUgYGV4ZWN1dGFibGVfYWZ0ZXJgLgAAAAAAABlSZWNvdmVyeV9Ob3RFeGVjdXRhYmxlWWV0AAAAAAAAHQAAAGZUaGUgY29tcGxldGlvbiBjb250ZXh0LCBvciB0aGUgY29tcGlsZWQgZG9jdW1lbnQgaGFzaCwgZG9lcyBub3QgbWF0Y2ggdGhlIGF1dGhvcml6ZWQgYXR0ZW1wdCdzIHRhcmdldC4AAAAAABRSZWNvdmVyeV9Xcm9uZ1RhcmdldAAAAB4AAAAoVGhlIGFkZHJlc3MgaXMgbm90IGFuIGVucm9sbGVkIGd1YXJkaWFuLgAAABVSZWNvdmVyeV9Ob3RBR3VhcmRpYW4AAAAAAAAfAAAAO1RoaXMgZ3VhcmRpYW4gb3IgZmFjdG9yIGFscmVhZHkgY291bnRlZCBmb3IgdGhpcyBzdGF0ZW1lbnQuAAAAABdSZWNvdmVyeV9BbHJlYWR5Q291bnRlZAAAAAAgAAAAKVRoZSBlbnJvbGxlZCBtb2RlIGhhcyBubyBndWFyZGlhbiBmYWN0b3IuAAAAAAAAG1JlY292ZXJ5X01vZGVIYXNOb0d1YXJkaWFucwAAAAAhAAAAI1RoZSBlbnJvbGxlZCBtb2RlIGhhcyBubyBaSyBmYWN0b3IuAAAAABRSZWNvdmVyeV9Nb2RlSGFzTm9aawAAACIAAAA+VGhlIGFkYXB0ZXIgcmVmdXNlZCB0aGUgcHJvb2YgKGl0cyBgWmtBZGFwdGVyRXJyb3JgIHNheXMgd2h5KS4AAAAAABtSZWNvdmVyeV9aa0V2aWRlbmNlUmVqZWN0ZWQAAAAAIwAAAB9UaGUgcHJvb2YncyBudWxsaWZpZXIgaXMgc3BlbnQuAAAAABdSZWNvdmVyeV9OdWxsaWZpZXJTcGVudAAAAAAkAAAAPlRoZSBzdGF0ZW1lbnQncyBmcmVzaG5lc3MgYm91bmQgaGFzIHBhc3NlZCBvciByZWFjaGVzIHRvbyBmYXIuAAAAAAAYUmVjb3ZlcnlfRXZpZGVuY2VFeHBpcmVkAAAAJQAAAEdUaGUgc3RhdGVtZW50IGNhbm5vdCBiZSBlbmNvZGVkIChhIG5vbi1jb250cmFjdCBhY2NvdW50IG9yIGNvbnRyb2xsZXIpLgAAAAAZUmVjb3ZlcnlfSW52YWxpZFN0YXRlbWVudAAAAAAAACYAAABdUmVjb3JkZWQgYXBwcm92YWxzIGRvIG5vdCBzYXRpc2Z5IHRoZSBlbnJvbGxlZCBjb25kaXRpb24gZm9yIHRoaXMgcmVjb25maWd1cmF0aW9uIG9yIHVwZ3JhZGUuAAAAAAAAGFJlY292ZXJ5X0NvbmRpdGlvbk5vdE1ldAAAACcAAAAnVGhlIGFjY291bnQncyBgbWF4LWNhbmNlbHNgIGlzIHVzZWQgdXAuAAAAABpSZWNvdmVyeV9NYXhDYW5jZWxzUmVhY2hlZAAAAAAAKAAAADJPd25lciBjYW5jZWxsYXRpb24gaXMgb25seSBhdmFpbGFibGUgdW5kZXIgYExvc3NgLgAAAAAAG1JlY292ZXJ5X093bmVyQ2FuY2VsUmVmdXNlZAAAAAApAAAAQlRoZSByZXBsYWNlbWVudCBzZXQgYnJlYWtzIGEgwqc3LjMgcnVsZSwgb3IgZGVyaXZhdGlvbiByZWZ1c2VkIGl0LgAAAAAAHFJlY292ZXJ5X0ludmFsaWRSZXBsYWNlbWVudHMAAAAqAAAAOlRoZSB0YXJnZXQgb3IgYSByZXBsYWNlbWVudCBjb250YWlucyBhIHJldm9rZWQgY3JlZGVudGlhbC4AAAAAABpSZWNvdmVyeV9DcmVkZW50aWFsUmV2b2tlZAAAAAAAKwAAALJUaGUgWksgZW5yb2xsbWVudCBpZCB3YXMgZW5yb2xsZWQgZm9yIHRoaXMgYWNjb3VudCBiZWZvcmUgKHRoZSBjb250cm9sbGVyIGNoZWNrcyB0aGUgYWNjb3VudCdzIGBpc19lbnJvbGxlZF9pZGAgYXQgVDE7IHRoZSBwdXJlIGBkZXJpdmVfdGFyZ2V0YCBjYW5ub3Qgc2VlIHRoZSBhY2NvdW50J3MgaGlzdG9yeSkuAAAAAAAbUmVjb3ZlcnlfRW5yb2xsbWVudElkUmV1c2VkAAAAACwAAAAuQ29tcHJvbWlzZSByZWNvdmVyeSB3aXRoIG5vIGJhc2VsaW5lIGVucm9sbGVkLgAAAAAAE1JlY292ZXJ5X05vQmFzZWxpbmUAAAAALQAAAEBDb21wcm9taXNlIHJlY292ZXJ5IGJlZm9yZSB0aGUgYmFzZWxpbmUncyBjb250ZW50IHdhcyBwdWJsaXNoZWQuAAAAHVJlY292ZXJ5X0Jhc2VsaW5lTm90UHVibGlzaGVkAAAAAAAALgAAAD5UaGUgcHVibGlzaGVkIGRvY3VtZW50IGRvZXMgbm90IGhhc2ggdG8gdGhlIGVucm9sbGVkIGJhc2VsaW5lLgAAAAAAGVJlY292ZXJ5X0Jhc2VsaW5lTWlzbWF0Y2gAAAAAAAAvAAAAU1RoZSBhZGFwdGVyJ3MgY2lyY3VpdCBpZCBvciB0cmVlIGRlcHRoIGRvZXMgbm90IG1hdGNoIHRoZSBlbnJvbGxlZCBmYWN0b3IgYW5kIHBvb2wuAAAAABlSZWNvdmVyeV9aa1dpcmluZ01pc21hdGNoAAAAAAAAMAAAADJUaGUgWksgZmFjdG9yIGNoYW5nZWQgd2l0aG91dCBhIG5ldyBlbnJvbGxtZW50IGlkLgAAAAAAH1JlY292ZXJ5X1prRmFjdG9yQ2hhbmdlZEluUGxhY2UAAAAAMQAAAHVUaGUgY29uZmlndXJhdGlvbiBpcyBtYWxmb3JtZWQgKGZvciBleGFtcGxlLCB0aGUgYWNjb3VudCBpcyBvbmUgb2YgaXRzIG93biBndWFyZGlhbnMsIG9yIHRoZSBxdW9ydW0gaXMgb3V0IG9mIHJhbmdlKS4AAAAAAAAdUmVjb3ZlcnlfSW52YWxpZENvbmZpZ3VyYXRpb24AAAAAAAAyAAAAMUFuIHVwZ3JhZGUgcmVxdWVzdCByZWNvcmRlZCB1bmRlciBhbiBvbGRlciBlcG9jaC4AAAAAAAAVUmVjb3ZlcnlfU3RhbGVVcGdyYWRlAAAAAAAAMwAAAC9BIGxlZGdlci1zZXF1ZW5jZSBjb21wdXRhdGlvbiBvdmVyZmxvd2VkIGB1MzJgLgAAAAAXUmVjb3ZlcnlfTGVkZ2VyT3ZlcmZsb3cAAAAANAAAAD1UaGUgcG9saWN5IHdhcyBhdHRhY2hlZCB0byBhIGNvbnRleHQgcnVsZSBvZiB0aGUgd3Jvbmcgc2hhcGUuAAAAAAAAHVJlY292ZXJ5X01hbGZvcm1lZENvbnRleHRSdWxlAAAAAAAANQAAAHlBIGNyZWRlbnRpYWwgdGhlIHJlcGxhY2VtZW50IHNldCByZXBsYWNlcyBzdGlsbCBhcHBlYXJzIGluIHRoZSB0YXJnZXQgKGEgc3dhcCBvciBhIG5vLW9wIHJlcGxhY2VtZW50LCBzcGVjIMKnNy4zIHJ1bGUgOCkuAAAAAAAAI1JlY292ZXJ5X1JlcGxhY2VkQ3JlZGVudGlhbFJldGFpbmVkAAAAADYAAACaYGFwcGx5X2RvY2AgbmFtZWQgYW4gYGV4cGVjdGVkX3JldmlzaW9uYCBhbmQgdGhlIGFjY291bnQgaXMgYXQgYW5vdGhlciByZXZpc2lvbjogdGhlIGRvY3VtZW50IHdhcyBwcmVwYXJlZCBhZ2FpbnN0IGEgY29uZmlndXJhdGlvbiB0aGF0IGhhcyBzaW5jZSBjaGFuZ2VkLgAAAAAADVN0YWxlUmV2aXNpb24AAAAAAAA3AAAASEEgY29tcGxldGVkIHJlY292ZXJ5IHdvdWxkIGFkdmFuY2UgdGhlIHNjb3BlIGdlbmVyYXRpb24gcGFzdCBgdTY0OjpNQVhgLgAAABNHZW5lcmF0aW9uRXhoYXVzdGVkAAAAADgAAADaYGFwcGx5X3Njb3BlYCB3YXMgZ2l2ZW4gYSBkb2N1bWVudCBhIHNjb3BlZCBkb2N1bWVudCBtYXkgbm90IGJlOiBpdCBoYXMgYSBgcmVjb3ZlcnlgIG1lbWJlciwgYSBgc2VsZi1hZG1pbmAgcnVsZSwgb3IgYSBydWxlIHNjb3BlZCB0byB0aGUgYWNjb3VudCBpdHNlbGYsIGl0cyByZWNvdmVyeSBjb250cm9sbGVyLCBvciBpdHMgWksgYWRhcHRlciBvciBwb29sIChzcGVjIMKnNy42KS4AAAAAAA9TY29wZUVzY2FsYXRpb24AAAAAOQAAACVObyBzY29wZWQgZG9jdW1lbnQgaGFzIHRoaXMgc2NvcGUgaWQuAAAAAAAADFVua25vd25TY29wZQAAADoAAABqYGdjX3Njb3BlYCB3YXMgYXNrZWQgdG8gcmVtb3ZlIGEgc2NvcGUgb2YgdGhlIGN1cnJlbnQgc2NvcGUgZ2VuZXJhdGlvbiwgd2hpY2ggb25seSBgcmVtb3ZlX3Njb3BlYCByZW1vdmVzLgAAAAAACVNjb3BlTGl2ZQAAAAAAADsAAACEVGhlIGRvY3VtZW50IG5hbWVzIGEgY3JlZGVudGlhbCBhIHNjb3BlZCBkb2N1bWVudCBuYW1lZCB1bmRlciBhIHNjb3BlIGdlbmVyYXRpb24gYSByZWNvdmVyeSBjb21wbGV0aW9uIGhhcyBzaW5jZSBlbmRlZCAoc3BlYyDCpzcuNikuAAAAD1dpcGVkQ3JlZGVudGlhbAAAAAA8AAAAplRoZSBjb21waWxlZCBkb2N1bWVudCBjYXJyaWVzIG5vIG1vZGVsLCBtb3JlIHRoYW4gb25lLCBhIG1vZGVsIHNvcm9iYW4tZmFjYWRlIGNhbm5vdCByZWFkLCBvciBvbmUgd2hvc2UgcnVsZXMgb3IgcmVjb3ZlcnkgZG8gbm90IG1hdGNoIHRoZSBjb21waWxlZCBydWxlcyBvbmUgZm9yIG9uZS4AAAAAAAxNb2RlbEludmFsaWQAAAA9AAAAe0EgcnVsZSBvdGhlciB0aGFuIHRoZSByZWNvdmVyeSBydWxlIGFza3MgZm9yIG5vIHNpZ25lciAoSU5WLTEpLCBzbyBhbiBhdXRob3JpemF0aW9uIHdpdGggbm8gc2lnbmVyIGF0IGFsbCB3b3VsZCBzYXRpc2Z5IGl0LgAAAAANVW5ndWFyZGVkUnVsZQAAAAAAAD4AAADQYGFwcGx5X3Njb3BlYCB3YXMgY2FsbGVkIG9uIGFuIGFjY291bnQgdGhhdCBzdG9yZXMgbm8gYWRtaW4gcnVsZSBzZXQ6IG9uZSB1cGdyYWRlZCBmcm9tIGNvZGUgdGhhdCBrZXB0IG5vbmUgYW5kIG5vdCByZS1hcHBsaWVkIHNpbmNlLiBJdHMgZmlyc3QgYGFwcGx5X2RvY2Agc3RvcmVzIGl0LiBMYXN0LCBzbyBldmVyeSBlYXJsaWVyIGNvZGUgaXMgdW5jaGFuZ2VkLgAAAAlOb1J1bGVTZXQAAAAAAAA/AAAAG0Nyb3NzLWNvbnRyYWN0IGNhbGwgYWJvcnRlZAAAAAAHQWJvcnRlZAAAAAAAAAAAJlVua25vd24gZXJyb3IgZnJvbSBjcm9zcy1jb250cmFjdCBjYWxsAAAAAAAMVW5rbm93bkVycm9yf////w==",
        "AAAABQAAADhFbWl0dGVkIHdoZW4gYSByZWNvdmVyeSBjb21wbGV0aW9uIHJldm9rZXMgYSBjcmVkZW50aWFsLgAAAAAAAAARQ3JlZGVudGlhbFJldm9rZWQAAAAAAAABAAAAEmNyZWRlbnRpYWxfcmV2b2tlZAAAAAAAAQAAAAAAAAALZmluZ2VycHJpbnQAAAAD7gAAACAAAAABAAAAAg==",
        "AAAAAQAAAJRDb25zdGFudHMgb2YgdGhlIGRlcGxveWVkIGFjY291bnQgd2FzbSBhIHdhbGxldCBjaGVja3MgYmVmb3JlIGl0IGJ1aWxkcwphbnl0aGluZyBmb3IgdGhpcyBhY2NvdW50OiB3aGF0IFtgUGVyY2hTbWFydEFjY291bnQ6OmNhcGFiaWxpdGllc2BdCnJldHVybnMuAAAAAAAAABNBY2NvdW50Q2FwYWJpbGl0aWVzAAAAAAUAAAC5SG93IGRvY3VtZW50cyBhcmUgYXBwbGllZDogYG9uZV90eGAsIHRoZSBhZG1pbiBkb2N1bWVudCBpbiBvbmUKYGFwcGx5X2RvY2AgdHJhbnNhY3Rpb247IGBzY29wZWRfdjFgLCBzY29wZWQgZG9jdW1lbnRzIHRocm91Z2gKYGFwcGx5X3Njb3BlYCwgYHJlbW92ZV9zY29wZWAsIGFuZCBgZ2Nfc2NvcGVgIChzcGVjIMKnNy42KS4AAAAAAAALYXBwbHlfbW9kZXMAAAAD6gAAABEAAAGgV2hhdCBhIHNpZ25lciBzaWduczogYGFkZHJfb3pfdjFgLCBPWidzCmBzaGEyNTYoYm91bmRfcGF5bG9hZCB8fCBjb250ZXh0X3J1bGVfaWRzLnRvX3hkcigpKWAsIHdoZXJlCmBib3VuZF9wYXlsb2FkID0gc2hhMjU2KEFVVEhfQUREUl9ET01BSU4gfHwgYWNjb3VudF9pZCB8fApzaWduYXR1cmVfcGF5bG9hZClgIGJpbmRzIHRoZSBhY2NvdW50J3Mgb3duIGFkZHJlc3Mgc28gYSBzaWduYXR1cmUKY2Fubm90IGJlIHJlcGxheWVkIG9uIGFub3RoZXIgYWNjb3VudCAoW2BBVVRIX0FERFJfRE9NQUlOYF0pLiBUaGUKZWFybGllciBgb3pfcnVsZV9pZHNgIHNjaGVtZSBvbWl0dGVkIHRoZSBhY2NvdW50IGFkZHJlc3M7IGEgY2xpZW50CnJlYWRzIHRoaXMgc3ltYm9sIHRvIHRlbGwgd2hpY2ggZGlnZXN0IGFuIGFjY291bnQgZXhwZWN0cy4AAAALYXV0aF9kaWdlc3QAAAAAEQAAAF1Ib3cgdGhlIGFwcGxpZWQgYGRvY19oYXNoYCBpcyBjb21wdXRlZDogYGNhbm9uX3YxYCwgYHNoYTI1NmAgb2YgdGhlCkNBTk9OIHYxIGNhbm9uaWNhbCBieXRlcy4AAAAAAAAMZG9jX2lkZW50aXR5AAAAEQAAABZbYElOVEVSRkFDRV9WRVJTSU9OYF0uAAAAAAARaW50ZXJmYWNlX3ZlcnNpb24AAAAAAAAEAAAAFVtgU05BUFNIT1RfVkVSU0lPTmBdLgAAAAAAABBzbmFwc2hvdF92ZXJzaW9uAAAABA==",
        "AAAAAQAAAHJFdmVyeXRoaW5nIHJ1bGUgc2VsZWN0aW9uIGFuZCBzaWduaW5nIG5lZWQsIHJlYWQgYXQgb25lIGxlZGdlcjogd2hhdApbYFBlcmNoU21hcnRBY2NvdW50Ojpjb25maWd1cmF0aW9uYF0gcmV0dXJucy4AAAAAAAAAAAAUQWNjb3VudENvbmZpZ3VyYXRpb24AAAAIAAAARFRoZSBhcHBsaWVkIGRvY3VtZW50J3MgYGRvY19oYXNoYCwgb3IgYE5vbmVgIGJlZm9yZSB0aGUgZmlyc3QgYXBwbHkuAAAACGRvY19oYXNoAAAD6AAAA+4AAAAgAAAAuFRoZSBgUHJvdGVjdGVkYCBmcmVlemU6IHplcm8gb3Igb25lIGVudHJpZXMgKGEgYFZlY2AgYmVjYXVzZQpgI1tjb250cmFjdHR5cGVdYCBoYXMgbm8gY29udmVyc2lvbiBmb3IgYE9wdGlvbmAgb2YgYSBjdXN0b20gc3RydWN0KS4KSXQgaXMgaW4gZm9yY2Ugd2hpbGUgdGhlIGxlZGdlciBpcyBiZWxvdyBpdHMgYHVudGlsYC4AAAAEZ2F0ZQAAA+oAAAfQAAAACkZyZWV6ZUdhdGUAAAAAAAAAAAAFaW5mcmEAAAAAAAfQAAAACUluZnJhUGlucwAAAAAAAAAAAAATcmVjb3ZlcnlfY29udHJvbGxlcgAAAAPoAAAAEwAAAAAAAAATcmVjb3ZlcnlfZ2VuZXJhdGlvbgAAAAAGAAAAO1RoZSB6ZXJvLXNpZ25lciByZWNvdmVyeSBydWxlJ3MgT1ogaWQsIGlmIG9uZSBpcyBpbnN0YWxsZWQuAAAAAA1yZWNvdmVyeV9ydWxlAAAAAAAD6AAAAAQAAAA4VGhlIGNvbmZpZ3VyYXRpb24gcmV2aXNpb24gZXZlcnkgb3RoZXIgZmllbGQgYmVsb25ncyB0by4AAAAIcmV2aXNpb24AAAAGAAAALUV2ZXJ5IGluc3RhbGxlZCBjb250ZXh0IHJ1bGUsIHdpdGggaXRzIE9aIGlkLgAAAAAAAAVydWxlcwAAAAAAA+oAAAfQAAAADUluc3RhbGxlZFJ1bGUAAAA=",
        "AAAAAQAAAC1PbmUgY29udGV4dCBydWxlIGFzIHRoZSBhY2NvdW50IGluc3RhbGxlZCBpdC4AAAAAAAAAAAAADUluc3RhbGxlZFJ1bGUAAAAAAAAHAAAAAAAAAAxjb250ZXh0X3R5cGUAAAfQAAAAD0NvbnRleHRSdWxlVHlwZQAAAAAXVGhlIE9aIGNvbnRleHQtcnVsZSBpZC4AAAAAAmlkAAAAAAAEAAAAAAAAAARuYW1lAAAAEAAAAAAAAAAIcG9saWNpZXMAAAPqAAAH0AAAAA9JbnN0YWxsZWRQb2xpY3kAAAAAtFRoZSB6ZXJvLXNpZ25lciByZWNvdmVyeSBydWxlLiBEb2N1bWVudCBydWxlcyBhcmUgbWF0Y2hlZCBieSBuYW1lOwp0aGUgcmVjb3ZlcnkgcnVsZSBieSB0aGlzIGZsYWcsIHNvIGEgZG9jdW1lbnQgcnVsZSB0aGF0IGhhcHBlbnMgdG8gYmUKbmFtZWQgYHJlY292ZXJ5YCBpcyBuZXZlciBjb25mdXNlZCB3aXRoIGl0LgAAAAhyZWNvdmVyeQAAAAEAAAAAAAAAB3NpZ25lcnMAAAAD6gAAB9AAAAAGU2lnbmVyAAAAAAAAAAAAC3ZhbGlkX3VudGlsAAAAA+gAAAAE",
        "AAAAAQAAAClPbmUgcG9saWN5IGF0dGFjaGVkIHRvIGFuIGluc3RhbGxlZCBydWxlLgAAAAAAAAAAAAAPSW5zdGFsbGVkUG9saWN5AAAAAAIAAACfYHNoYTI1NmAgb2YgdGhlIGluc3RhbGwgcGFyYW1ldGVycycgWERSLiBBIHBvbGljeSB3aG9zZSBwYXJhbWV0ZXJzCmNoYW5nZSBpcyB1bmluc3RhbGxlZCBhbmQgaW5zdGFsbGVkIGFnYWluOyBvbmUgd2hvc2UgcGFyYW1ldGVycyBhcmUKdW5jaGFuZ2VkIGlzIGxlZnQgYWxvbmUuAAAAAAZwYXJhbXMAAAAAA+4AAAAgAAAAAAAAAAZwb2xpY3kAAAAAABM=",
        "AAAAAgAAAF9Db250cmFjdCBleGVjdXRhYmxlIHVzZWQgZm9yIGNyZWF0aW5nIGEgbmV3IGNvbnRyYWN0IGFuZCB1c2VkIGluCmBDcmVhdGVDb250cmFjdEhvc3RGbkNvbnRleHRgLgAAAAAAAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAgAAAAEAAAB4RXhlY3V0YWJsZSBzcGVjaWZpZWQgYnkgdGhlIGNvbnRyYWN0IGluc3RhbmNlIGFzIGEgc3BlY2lmaWMgV2FzbSBjb250cmFjdCBjb2RlIGVudHJ5IGlkZW50aWZpZWQgYnkgaXRzIFdhc20gc2hhMjU2IGhhc2guAAAABFdhc20AAAABAAAD7gAAACAAAAABAAAAX0V4ZWN1dGFibGUgcmVmZXJlbmNlIHZpYSBhIHBlcnNpc3RlbnQgc3RvcmFnZSBlbnRyeSBvd25lZCBieSB0aGlzIGNvbnRyYWN0IG9yIGFub3RoZXIgY29udHJhY3QuAAAAAAtFeHRlcm5hbFJlZgAAAAABAAAH0AAAABVDb250cmFjdEV4ZWN1dGFibGVSZWYAAAA=",
        "AAAAAQAAAMBFeGVjdXRhYmxlIHJlZmVyZW5jZWQgdmlhIGEgcGVyc2lzdGVudCBzdG9yYWdlIGVudHJ5IG93bmVkIGJ5IGEgY29udHJhY3QsCmVpdGhlciB0aGlzIGNvbnRyYWN0IG9yIGFub3RoZXIgY29udHJhY3QuCgpUaGUgcGVyc2lzdGVudCBzdG9yYWdlIGVudHJ5IG93bmVkIGJ5IHRoZSBgb3duZXJgIGhhcyB0aGUgYHRhZ2AgYXMgaXRzIGtleS4AAAAAAAAAFUNvbnRyYWN0RXhlY3V0YWJsZVJlZgAAAAAAAAIAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAADdGFnAAAAABA=",
        "AAAAAgAAAONDb250ZXh0IG9mIGEgc2luZ2xlIGF1dGhvcml6ZWQgY2FsbCBwZXJmb3JtZWQgYnkgYW4gYWRkcmVzcy4KCkN1c3RvbSBhY2NvdW50IGNvbnRyYWN0cyB0aGF0IGltcGxlbWVudCBgX19jaGVja19hdXRoYCBzcGVjaWFsIGZ1bmN0aW9uCnJlY2VpdmUgYSBsaXN0IG9mIGBDb250ZXh0YCB2YWx1ZXMgY29ycmVzcG9uZGluZyB0byBhbGwgdGhlIGNhbGxzIHRoYXQKbmVlZCB0byBiZSBhdXRob3JpemVkLgAAAAAAAAAAB0NvbnRleHQAAAAAAwAAAAEAAAAUQ29udHJhY3QgaW52b2NhdGlvbi4AAAAIQ29udHJhY3QAAAABAAAH0AAAAA9Db250cmFjdENvbnRleHQAAAAAAQAAAD1Db250cmFjdCB0aGF0IGhhcyBhIGNvbnN0cnVjdG9yIHdpdGggbm8gYXJndW1lbnRzIGlzIGNyZWF0ZWQuAAAAAAAAFENyZWF0ZUNvbnRyYWN0SG9zdEZuAAAAAQAAB9AAAAAbQ3JlYXRlQ29udHJhY3RIb3N0Rm5Db250ZXh0AAAAAAEAAABEQ29udHJhY3QgdGhhdCBoYXMgYSBjb25zdHJ1Y3RvciB3aXRoIDEgb3IgbW9yZSBhcmd1bWVudHMgaXMgY3JlYXRlZC4AAAAcQ3JlYXRlQ29udHJhY3RXaXRoQ3Rvckhvc3RGbgAAAAEAAAfQAAAAKkNyZWF0ZUNvbnRyYWN0V2l0aENvbnN0cnVjdG9ySG9zdEZuQ29udGV4dAAA",
        "AAAAAQAAAL1BdXRob3JpemF0aW9uIGNvbnRleHQgb2YgYSBzaW5nbGUgY29udHJhY3QgY2FsbC4KClRoaXMgc3RydWN0IGNvcnJlc3BvbmRzIHRvIGEgYHJlcXVpcmVfYXV0aF9mb3JfYXJnc2AgY2FsbCBmb3IgYW4gYWRkcmVzcwpmcm9tIGBjb250cmFjdGAgZnVuY3Rpb24gd2l0aCBgZm5fbmFtZWAgbmFtZSBhbmQgYGFyZ3NgIGFyZ3VtZW50cy4AAAAAAAAAAAAAD0NvbnRyYWN0Q29udGV4dAAAAAADAAAAAAAAAARhcmdzAAAD6gAAAAAAAAAAAAAACGNvbnRyYWN0AAAAEwAAAAAAAAAHZm5fbmFtZQAAAAAR",
        "AAAAAQAAAHZBdXRob3JpemF0aW9uIGNvbnRleHQgZm9yIGBjcmVhdGVfY29udHJhY3RgIGhvc3QgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEKbmV3IGNvbnRyYWN0IG9uIGJlaGFsZiBvZiBhdXRob3JpemVyIGFkZHJlc3MuAAAAAAAAAAAAG0NyZWF0ZUNvbnRyYWN0SG9zdEZuQ29udGV4dAAAAAACAAAAAAAAAApleGVjdXRhYmxlAAAAAAfQAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAAAAAARzYWx0AAAD7gAAACA=",
        "AAAAAQAAANZBdXRob3JpemF0aW9uIGNvbnRleHQgZm9yIGBjcmVhdGVfY29udHJhY3RgIGhvc3QgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEKbmV3IGNvbnRyYWN0IG9uIGJlaGFsZiBvZiBhdXRob3JpemVyIGFkZHJlc3MuClRoaXMgaXMgdGhlIHNhbWUgYXMgYENyZWF0ZUNvbnRyYWN0SG9zdEZuQ29udGV4dGAsIGJ1dCBhbHNvIGhhcwpjb250cmFjdCBjb25zdHJ1Y3RvciBhcmd1bWVudHMuAAAAAAAAAAAAKkNyZWF0ZUNvbnRyYWN0V2l0aENvbnN0cnVjdG9ySG9zdEZuQ29udGV4dAAAAAAAAwAAAAAAAAAQY29uc3RydWN0b3JfYXJncwAAA+oAAAAAAAAAAAAAAApleGVjdXRhYmxlAAAAAAfQAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAAAAAARzYWx0AAAD7gAAACA=",
        "AAAABQAAACtFdmVudCBlbWl0dGVkIHdoZW4gYSBjb250ZXh0IHJ1bGUgaXMgYWRkZWQuAAAAAAAAAAAQQ29udGV4dFJ1bGVBZGRlZAAAAAEAAAASY29udGV4dF9ydWxlX2FkZGVkAAAAAAAGAAAAAAAAAA9jb250ZXh0X3J1bGVfaWQAAAAABAAAAAEAAAAAAAAABG5hbWUAAAAQAAAAAAAAAAAAAAAMY29udGV4dF90eXBlAAAH0AAAAA9Db250ZXh0UnVsZVR5cGUAAAAAAAAAAAAAAAALdmFsaWRfdW50aWwAAAAD6AAAAAQAAAAAAAAAAAAAAApzaWduZXJfaWRzAAAAAAPqAAAABAAAAAAAAAAAAAAACnBvbGljeV9pZHMAAAAAA+oAAAAEAAAAAAAAAAI=",
        "AAAABQAAAEFFdmVudCBlbWl0dGVkIHdoZW4gYSBwb2xpY3kgaXMgcmVnaXN0ZXJlZCBpbiB0aGUgZ2xvYmFsIHJlZ2lzdHJ5LgAAAAAAAAAAAAAQUG9saWN5UmVnaXN0ZXJlZAAAAAEAAAARcG9saWN5X3JlZ2lzdGVyZWQAAAAAAAACAAAAAAAAAAlwb2xpY3lfaWQAAAAAAAAEAAAAAQAAAAAAAAAGcG9saWN5AAAAAAATAAAAAAAAAAI=",
        "AAAABQAAAEFFdmVudCBlbWl0dGVkIHdoZW4gYSBzaWduZXIgaXMgcmVnaXN0ZXJlZCBpbiB0aGUgZ2xvYmFsIHJlZ2lzdHJ5LgAAAAAAAAAAAAAQU2lnbmVyUmVnaXN0ZXJlZAAAAAEAAAARc2lnbmVyX3JlZ2lzdGVyZWQAAAAAAAACAAAAAAAAAAlzaWduZXJfaWQAAAAAAAAEAAAAAQAAAAAAAAAGc2lnbmVyAAAAAAfQAAAABlNpZ25lcgAAAAAAAAAAAAI=",
        "AAAABAAAAClFcnJvciBjb2RlcyBmb3Igc21hcnQgYWNjb3VudCBvcGVyYXRpb25zLgAAAAAAAAAAAAARU21hcnRBY2NvdW50RXJyb3IAAAAAAAAQAAAAKlRoZSBzcGVjaWZpZWQgY29udGV4dCBydWxlIGRvZXMgbm90IGV4aXN0LgAAAAAAE0NvbnRleHRSdWxlTm90Rm91bmQAAAALuAAAADpUaGUgcHJvdmlkZWQgY29udGV4dCBjYW5ub3QgYmUgdmFsaWRhdGVkIGFnYWluc3QgYW55IHJ1bGUuAAAAAAASVW52YWxpZGF0ZWRDb250ZXh0AAAAAAu6AAAAJ0V4dGVybmFsIHNpZ25hdHVyZSB2ZXJpZmljYXRpb24gZmFpbGVkLgAAAAAaRXh0ZXJuYWxWZXJpZmljYXRpb25GYWlsZWQAAAAAC7sAAAA1Q29udGV4dCBydWxlIG11c3QgaGF2ZSBhdCBsZWFzdCBvbmUgc2lnbmVyIG9yIHBvbGljeS4AAAAAAAAUTm9TaWduZXJzQW5kUG9saWNpZXMAAAu8AAAAKVRoZSB2YWxpZF91bnRpbCB0aW1lc3RhbXAgaXMgaW4gdGhlIHBhc3QuAAAAAAAADlBhc3RWYWxpZFVudGlsAAAAAAu9AAAAI1RoZSBzcGVjaWZpZWQgc2lnbmVyIHdhcyBub3QgZm91bmQuAAAAAA5TaWduZXJOb3RGb3VuZAAAAAALvgAAAC5UaGUgc2lnbmVyIGFscmVhZHkgZXhpc3RzIGluIHRoZSBjb250ZXh0IHJ1bGUuAAAAAAAPRHVwbGljYXRlU2lnbmVyAAAAC78AAAAjVGhlIHNwZWNpZmllZCBwb2xpY3kgd2FzIG5vdCBmb3VuZC4AAAAADlBvbGljeU5vdEZvdW5kAAAAAAvAAAAALlRoZSBwb2xpY3kgYWxyZWFkeSBleGlzdHMgaW4gdGhlIGNvbnRleHQgcnVsZS4AAAAAAA9EdXBsaWNhdGVQb2xpY3kAAAALwQAAACVUb28gbWFueSBzaWduZXJzIGluIHRoZSBjb250ZXh0IHJ1bGUuAAAAAAAADlRvb01hbnlTaWduZXJzAAAAAAvCAAAAJlRvbyBtYW55IHBvbGljaWVzIGluIHRoZSBjb250ZXh0IHJ1bGUuAAAAAAAPVG9vTWFueVBvbGljaWVzAAAAC8MAAACGQW4gaW50ZXJuYWwgSUQgY291bnRlciAoY29udGV4dCBydWxlLCBzaWduZXIsIG9yIHBvbGljeSkgaGFzIHJlYWNoZWQKaXRzIG1heGltdW0gdmFsdWUgKGB1MzI6Ok1BWGApIGFuZCBjYW5ub3QgYmUgaW5jcmVtZW50ZWQgZnVydGhlci4AAAAAAAxNYXRoT3ZlcmZsb3cAAAvEAAAAOkV4dGVybmFsIHNpZ25lciBrZXkgZGF0YSBleGNlZWRzIHRoZSBtYXhpbXVtIGFsbG93ZWQgc2l6ZS4AAAAAAA9LZXlEYXRhVG9vTGFyZ2UAAAALxQAAADxjb250ZXh0X3J1bGVfaWRzIGxlbmd0aCBkb2VzIG5vdCBtYXRjaCBhdXRoX2NvbnRleHRzIGxlbmd0aC4AAAAcQ29udGV4dFJ1bGVJZHNMZW5ndGhNaXNtYXRjaAAAC8YAAAA1Q29udGV4dCBydWxlIG5hbWUgZXhjZWVkcyB0aGUgbWF4aW11bSBhbGxvd2VkIGxlbmd0aC4AAAAAAAALTmFtZVRvb0xvbmcAAAALxwAAAENBIHNpZ25lciBpbiBgQXV0aFBheWxvYWRgIGlzIG5vdCBwYXJ0IG9mIGFueSBzZWxlY3RlZCBjb250ZXh0IHJ1bGUuAAAAABJVbmF1dGhvcml6ZWRTaWduZXIAAAAAC8g=",
        "AAAAAgAAAEJSZXByZXNlbnRzIGRpZmZlcmVudCB0eXBlcyBvZiBzaWduZXJzIGluIHRoZSBzbWFydCBhY2NvdW50IHN5c3RlbS4AAAAAAAAAAAAGU2lnbmVyAAAAAAACAAAAAQAAAD1BIGRlbGVnYXRlZCBzaWduZXIgdGhhdCB1c2VzIGJ1aWx0LWluIHNpZ25hdHVyZSB2ZXJpZmljYXRpb24uAAAAAAAACURlbGVnYXRlZAAAAAAAAAEAAAATAAAAAQAAAHJBbiBleHRlcm5hbCBzaWduZXIgd2l0aCBjdXN0b20gdmVyaWZpY2F0aW9uIGxvZ2ljLgpDb250YWlucyB0aGUgdmVyaWZpZXIgY29udHJhY3QgYWRkcmVzcyBhbmQgdGhlIHB1YmxpYyBrZXkgZGF0YS4AAAAAAAhFeHRlcm5hbAAAAAIAAAATAAAADg==",
        "AAAAAQAABABUaGUgYXV0aG9yaXphdGlvbiBwYXlsb2FkIHBhc3NlZCB0byBgX19jaGVja19hdXRoYCwgYnVuZGxpbmcgY3J5cHRvZ3JhcGhpYwpwcm9vZnMgd2l0aCBjb250ZXh0IHJ1bGUgc2VsZWN0aW9uLgoKVGhpcyBzdHJ1Y3QgY2FycmllcyB0d28gZGlzdGluY3QgcGllY2VzIG9mIGluZm9ybWF0aW9uIHRoYXQgYXJlIGJvdGgKcmVxdWlyZWQgZm9yIGF1dGhvcml6YXRpb24gYnV0IGNhbm5vdCBiZSBkZXJpdmVkIGZyb20gZWFjaCBvdGhlcjoKCi0gYHNpZ25lcnNgIG1hcHMgZWFjaCBbYFNpZ25lcmBdIHRvIGl0cyByYXcgc2lnbmF0dXJlIGJ5dGVzLCBwcm92aWRpbmcKY3J5cHRvZ3JhcGhpYyBwcm9vZiB0aGF0IHRoZSBzaWduZXIgYWN0dWFsbHkgc2lnbmVkIHRoZSB0cmFuc2FjdGlvbgpwYXlsb2FkLiBBIGNvbnRleHQgcnVsZSBzdG9yZXMgd2hpY2ggc2lnbmVyICppZGVudGl0aWVzKiBhcmUgYXV0aG9yaXplZAoodmlhIGBzaWduZXJfaWRzYCksIGJ1dCB0aGUgcnVsZSBkb2VzIG5vdCBjb250YWluIHRoZSBzaWduYXR1cmVzCnRoZW1zZWx2ZXMg4oCUIHRob3NlIG11c3QgYmUgc3VwcGxpZWQgaGVyZS4KCi0gYGNvbnRleHRfcnVsZV9pZHNgIHRlbGxzIHRoZSBzeXN0ZW0gd2hpY2ggcnVsZSB0byB2YWxpZGF0ZSBmb3IgZWFjaCBhdXRoCmNvbnRleHQuIEJlY2F1c2UgbXVsdGlwbGUgcnVsZXMgY2FuIGV4aXN0IGZvciB0aGUgc2FtZSBjb250ZXh0IHR5cGUsIHRoZQpjYWxsZXIgbXVzdCBleHBsaWNpdGx5IHNlbGVjdCBvbmUgcGVyIGNvbnRleHQgcmF0aGVyIHRoYW4gcmVseWluZyBvbgphdXRvLWRpc2NvdmVyeS4gRWFjaCBlbnRyeSBpcyBhbGlnbmVkIGJ5IGluZGV4IHdpdGggdGhlIGBhdXRoX2NvbnRleHRzYApwYXNzZWQgdG8gYF9fY2hlY2tfYXV0aGAuCgpUaGUgbGVuZ3RoIG9mIGBjb250ZXh0X3J1bGVfaWRzYCBtdXN0IGVxdWFsIHRoZSBudW1iZXIgb2YgYXV0aCBjb250ZXh0czsKYSBtaXNtYXRjaCBpcyByZWplY3RlZCB3aXRoCltgU21hcnRBY2NvdW50RXJyb3I6OkNvbnRleHRSdWxlSWRzTGVuAAAAAAAAAAtBdXRoUGF5bG9hZAAAAAACAAAAPFBlci1jb250ZXh0IHJ1bGUgSURzLCBhbGlnbmVkIGJ5IGluZGV4IHdpdGggYGF1dGhfY29udGV4dHNgLgAAABBjb250ZXh0X3J1bGVfaWRzAAAD6gAAAAQAAAAlU2lnbmF0dXJlIGRhdGEgbWFwcGVkIHRvIGVhY2ggc2lnbmVyLgAAAAAAAAdzaWduZXJzAAAAA+wAAAfQAAAABlNpZ25lcgAAAAAADg==",
        "AAAAAQAAADxBIGNvbXBsZXRlIGNvbnRleHQgcnVsZSBkZWZpbmluZyBhdXRob3JpemF0aW9uIHJlcXVpcmVtZW50cy4AAAAAAAAAC0NvbnRleHRSdWxlAAAAAAgAAAApVGhlIHR5cGUgb2YgY29udGV4dCB0aGlzIHJ1bGUgYXBwbGllcyB0by4AAAAAAAAMY29udGV4dF90eXBlAAAH0AAAAA9Db250ZXh0UnVsZVR5cGUAAAAAJ1VuaXF1ZSBpZGVudGlmaWVyIGZvciB0aGUgY29udGV4dCBydWxlLgAAAAACaWQAAAAAAAQAAAApSHVtYW4tcmVhZGFibGUgbmFtZSBmb3IgdGhlIGNvbnRleHQgcnVsZS4AAAAAAAAEbmFtZQAAABAAAAAwTGlzdCBvZiBwb2xpY3kgY29udHJhY3RzIHRoYXQgbXVzdCBiZSBzYXRpc2ZpZWQuAAAACHBvbGljaWVzAAAD6gAAABMAAABKR2xvYmFsIHJlZ2lzdHJ5IElEcyBmb3IgZWFjaCBwb2xpY3ksIHBvc2l0aW9uYWxseSBhbGlnbmVkIHdpdGgKYHBvbGljaWVzYC4AAAAAAApwb2xpY3lfaWRzAAAAAAPqAAAABAAAAElHbG9iYWwgcmVnaXN0cnkgSURzIGZvciBlYWNoIHNpZ25lciwgcG9zaXRpb25hbGx5IGFsaWduZWQgd2l0aApgc2lnbmVyc2AuAAAAAAAACnNpZ25lcl9pZHMAAAAAA+oAAAAEAAAAKExpc3Qgb2Ygc2lnbmVycyBhdXRob3JpemVkIGJ5IHRoaXMgcnVsZS4AAAAHc2lnbmVycwAAAAPqAAAH0AAAAAZTaWduZXIAAAAAADFPcHRpb25hbCBleHBpcmF0aW9uIGxlZGdlciBzZXF1ZW5jZSBmb3IgdGhlIHJ1bGUuAAAAAAAAC3ZhbGlkX3VudGlsAAAAA+gAAAAE",
        "AAAAAgAAAEBUeXBlcyBvZiBjb250ZXh0cyB0aGF0IGNhbiBiZSBhdXRob3JpemVkIGJ5IHNtYXJ0IGFjY291bnQgcnVsZXMuAAAAAAAAAA9Db250ZXh0UnVsZVR5cGUAAAAABAAAAAAAAAAtRGVmYXVsdCBydWxlcyB0aGF0IGNhbiBhdXRob3JpemUgYW55IGNvbnRleHQuAAAAAAAAB0RlZmF1bHQAAAAAAQAAADBSdWxlcyBzcGVjaWZpYyB0byBjYWxsaW5nIGEgcGFydGljdWxhciBjb250cmFjdC4AAAAMQ2FsbENvbnRyYWN0AAAAAQAAABMAAAABAAAAQlJ1bGVzIHNwZWNpZmljIHRvIGNyZWF0aW5nIGEgY29udHJhY3Qgd2l0aCBhIHBhcnRpY3VsYXIgV0FTTSBoYXNoLgAAAAAADkNyZWF0ZUNvbnRyYWN0AAAAAAABAAAD7gAAACAAAAABAAAAZFJ1bGVzIHNwZWNpZmljIHRvIGNyZWF0aW5nIGEgY29udHJhY3QgZnJvbSB0aGUgZXhlY3V0YWJsZSByZWZlcmVuY2UgdGhhdApgb3duZXJgIHN0b3JlcyB1bmRlciBgdGFnYC4AAAAZQ3JlYXRlQ29udHJhY3RFeHRlcm5hbFJlZgAAAAAAAAIAAAATAAAAEA==" ]),
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
        scope_doc: this.txFromJSON<Option<Buffer>>,
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
        recovery_controller: this.txFromJSON<Option<string>>,
        recovery_generation: this.txFromJSON<u64>,
        credential_generation: this.txFromJSON<Option<u64>>,
        get_context_rules_count: this.txFromJSON<u32>,
        next_upgrade_request_id: this.txFromJSON<u64>
  }
}