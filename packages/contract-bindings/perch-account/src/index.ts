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
 * An optional singleton containing the root. The optional field lets
 * the SDK read legacy rules; `mirror::rule` checks the exact old/new
 * layouts before a stored value can authorize anything.
 */
auth_root: Option<Array<StoredAuthRoot>>;
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
 * Exact authorization-entry root in host form.
 */
export interface StoredAuthRoot {
  contract: string;
  function: string;
}

/**
 * `rule_eval::Functions`.
 */
export type StoredFunctions = {tag: "AnyExcept", values: readonly [Array<string>]} | {tag: "Only", values: readonly [Array<string>]};


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
 * A grant document as applied.
 */
export interface GrantRecord {
  /**
 * Its canonical `doc_hash`.
 */
doc_hash: Buffer;
  /**
 * The grant generation it was applied under; wiped once
 * `grant_generation` moves past it.
 */
gen: u64;
  /**
 * Every context rule it installed, with its id.
 */
rules: Array<InstalledRule>;
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
   * A completed recovery would overflow the grant generation.
   */
  56: {message:"GenerationExhausted"},
  /**
   * A grant document has a `recovery` member, a self-admin rule, a rule on the account or its recovery contracts, a guardian approval, or a token-admin function.
   */
  57: {message:"GrantEscalation"},
  /**
   * No grant document has this grant id.
   */
  58: {message:"UnknownGrant"},
  /**
   * `gc_grant` was given a live grant; `remove_grant` removes it.
   */
  59: {message:"GrantLive"},
  /**
   * The document names a credential from a grant a recovery has wiped.
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
   * A grant document is not in normal form, or has a rule already expired.
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
 * `one_tx` (account document) and `grant_v1` (grant documents).
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
 * What rule selection and signing need for the account document, read at one
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
 * One context rule as the account installed it.
 */
export interface InstalledRule {
  /**
 * Exact root of this account's authorization entry, if constrained.
 */
auth_root: Option<Array<StoredAuthRoot>>;
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

export interface Client {
  /**
   * Construct and simulate a grant transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The grant document under `grant` as applied, if any.
   */
  grant: ({grant}: {grant: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<GrantRecord>>>

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
   * Construct and simulate a grants transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The grant ids at index positions `start..start + count`, wiped ones
   * included.
   */
  grants: ({start, count}: {start: u32, count: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<u32>>>

  /**
   * Construct and simulate a execute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Call `target_fn` on `target` as this account. Owner authorization;
   * refuses invoker-only hooks.
   */
  execute: ({target, target_fn, target_args}: {target: string, target_fn: string, target_args: Array<any>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<any>>>

  /**
   * Construct and simulate a document transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The applied account document's canonical bytes, with the revision they
   * belong to.
   */
  document: (options?: MethodOptions) => Promise<AssembledTransaction<readonly [u64, Option<Buffer>]>>

  /**
   * Construct and simulate a gc_grant transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove a grant document a recovery wiped, and its rules.
   * Permissionless.
   */
  gc_grant: ({grant}: {grant: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
   * Apply the account document and return its `doc_hash`. Owner
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
   * The applied account document's canonical bytes, if any.
   */
  applied_doc: (options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a apply_grant transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Apply a grant document under `grant` and return its `doc_hash`. Owner
   * authorization.
   */
  apply_grant: ({grant, doc_json}: {grant: u32, doc_json: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a grant_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * How many grant ids have a record, wiped ones included.
   */
  grant_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

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
   * Construct and simulate a remove_grant transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove the grant document under `grant` and its rules. Owner
   * authorization.
   */
  remove_grant: ({grant}: {grant: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a configuration transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The account document's configuration, read at one ledger.
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
   * Construct and simulate a grant_rule_set transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The rule-eval rules of the grant document under `grant`, aligned with
   * its record's rules.
   */
  grant_rule_set: ({grant}: {grant: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<StoredRule>>>

  /**
   * Construct and simulate a is_enrolled_id transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Whether this account ever enrolled a ZK enrollment id.
   */
  is_enrolled_id: ({enrollment_id}: {enrollment_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

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
   * Every context rule the account document installed, with its id.
   */
  installed_rules: (options?: MethodOptions) => Promise<AssembledTransaction<Array<InstalledRule>>>

  /**
   * Construct and simulate a pending_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The scheduled upgrade, if any.
   */
  pending_upgrade: (options?: MethodOptions) => Promise<AssembledTransaction<Option<UpgradeRequest>>>

  /**
   * Construct and simulate a applied_doc_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The applied account document's canonical `doc_hash`, if any.
   */
  applied_doc_hash: (options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a get_context_rule transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The context rule with this id; panics if there is none.
   */
  get_context_rule: ({context_rule_id}: {context_rule_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<ContextRule>>

  /**
   * Construct and simulate a grant_generation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The grant generation: advanced only by completed recoveries. A grant
   * applied under another is wiped.
   */
  grant_generation: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a grant_signer_ids transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The signer ids of the grant document under `grant`, in declaration
   * order, if any: with its rules, they give back its canonical text.
   */
  grant_signer_ids: ({grant}: {grant: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Array<string>>>>

  /**
   * Construct and simulate a schedule_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Schedule an upgrade to `wasm_hash` after the upgrade delay, replacing
   * any pending one, and return its id. Owner authorization; under
   * `Protected`, also approvals fresh until `approval_valid_until`.
   */
  schedule_upgrade: ({wasm_hash, approval_valid_until}: {wasm_hash: Buffer, approval_valid_until: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

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
   * Construct and simulate a grant_verifier_names transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Each signer's `verifier-name` in the grant document under `grant`,
   * aligned with `grant_signer_ids`, if any: empty where a signer has
   * none, and no entries when no signer has one.
   */
  grant_verifier_names: ({grant}: {grant: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Array<string>>>>

  /**
   * Construct and simulate a credential_generation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The last grant generation a grant document named this credential under,
   * if any.
   */
  credential_generation: ({fingerprint}: {fingerprint: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<u64>>>

  /**
   * Construct and simulate a get_context_rules_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The count of context rules, grants' and expired ones included.
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
      new ContractSpec([ "AAAAAAAAADRUaGUgZ3JhbnQgZG9jdW1lbnQgdW5kZXIgYGdyYW50YCBhcyBhcHBsaWVkLCBpZiBhbnkuAAAABWdyYW50AAAAAAAAAQAAAAAAAAAFZ3JhbnQAAAAAAAAEAAAAAQAAA+gAAAfQAAAAC0dyYW50UmVjb3JkAA==",
        "AAAAAAAAADZFdmVyeSBzaGFyZWQgY29udHJhY3QgdGhpcyBhY2NvdW50IHBpbnMgYXQgYnVpbGQgdGltZS4AAAAAAAVpbmZyYQAAAAAAAAAAAAABAAAH0AAAAAlJbmZyYVBpbnMAAAA=",
        "AAAAAAAAAHdFeHRlbmQgdGhlIGFjY291bnQncyBpbnN0YW5jZSwgZG9jdW1lbnQsIGFuZCB0aGUgbmFtZWQgcmV2b2tlZCBhbmQKZW5yb2xsZWQgZW50cmllcyB0byB0aGUgbWF4aW11bSBUVEwuIFBlcm1pc3Npb25sZXNzLgAAAAAFcmVuZXcAAAAAAAACAAAAAAAAAAxmaW5nZXJwcmludHMAAAPqAAAD7gAAACAAAAAAAAAADmVucm9sbG1lbnRfaWRzAAAAAAPqAAAD7gAAACAAAAAA",
        "AAAAAAAAAE1UaGUgZ3JhbnQgaWRzIGF0IGluZGV4IHBvc2l0aW9ucyBgc3RhcnQuLnN0YXJ0ICsgY291bnRgLCB3aXBlZCBvbmVzCmluY2x1ZGVkLgAAAAAAAAZncmFudHMAAAAAAAIAAAAAAAAABXN0YXJ0AAAAAAAABAAAAAAAAAAFY291bnQAAAAAAAAEAAAAAQAAA+oAAAAE",
        "AAAAAAAAAF5DYWxsIGB0YXJnZXRfZm5gIG9uIGB0YXJnZXRgIGFzIHRoaXMgYWNjb3VudC4gT3duZXIgYXV0aG9yaXphdGlvbjsKcmVmdXNlcyBpbnZva2VyLW9ubHkgaG9va3MuAAAAAAAHZXhlY3V0ZQAAAAADAAAAAAAAAAZ0YXJnZXQAAAAAABMAAAAAAAAACXRhcmdldF9mbgAAAAAAABEAAAAAAAAAC3RhcmdldF9hcmdzAAAAA+oAAAAAAAAAAQAAA+kAAAAAAAAH0AAAABFQZXJjaEFjY291bnRFcnJvcgAAAA==",
        "AAAAAAAAAFFUaGUgYXBwbGllZCBhY2NvdW50IGRvY3VtZW50J3MgY2Fub25pY2FsIGJ5dGVzLCB3aXRoIHRoZSByZXZpc2lvbiB0aGV5CmJlbG9uZyB0by4AAAAAAAAIZG9jdW1lbnQAAAAAAAAAAQAAA+0AAAACAAAABgAAA+gAAAAO",
        "AAAAAAAAAEhSZW1vdmUgYSBncmFudCBkb2N1bWVudCBhIHJlY292ZXJ5IHdpcGVkLCBhbmQgaXRzIHJ1bGVzLgpQZXJtaXNzaW9ubGVzcy4AAAAIZ2NfZ3JhbnQAAAABAAAAAAAAAAVncmFudAAAAAAAAAQAAAABAAAD6QAAAAIAAAfQAAAAEVBlcmNoQWNjb3VudEVycm9yAAAA",
        "AAAAAAAAAGZJbnZva2VyLW9ubHk6IHRoZSBhZG9wdGVkIGNvbnRyb2xsZXIgc2V0cyAoYGZyb3plbl91bnRpbCA+IDBgKSBvciBjbGVhcnMKKGAwYCkgdGhlIGBQcm90ZWN0ZWRgIGZyZWV6ZS4AAAAAAAhyY3ZfZ2F0ZQAAAAIAAAAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAAAAAAAADGZyb3plbl91bnRpbAAAAAQAAAABAAAD6QAAAAIAAAfQAAAAEVBlcmNoQWNjb3VudEVycm9yAAAA",
        "AAAAAAAAAF5UaGUgY29uZmlndXJhdGlvbiByZXZpc2lvbjogYWR2YW5jZWQgYnkgZXZlcnkgYGFwcGx5X2RvY2AgYW5kIGV4ZWN1dGVkCnVwZ3JhZGU7IG5ldmVyIHJlcGVhdHMuAAAAAAAIcmV2aXNpb24AAAAAAAAAAQAAAAY=",
        "AAAAAAAAAE1UaGUgcnVsZS1ldmFsIHJ1bGVzIGBfX2NoZWNrX2F1dGhgIGV2YWx1YXRlcywgYWxpZ25lZCB3aXRoCmBpbnN0YWxsZWRfcnVsZXNgLgAAAAAAAAhydWxlX3NldAAAAAAAAAABAAAD6gAAB9AAAAAKU3RvcmVkUnVsZQAA",
        "AAAAAAAAAQpBcHBseSB0aGUgYWNjb3VudCBkb2N1bWVudCBhbmQgcmV0dXJuIGl0cyBgZG9jX2hhc2hgLiBPd25lcgphdXRob3JpemF0aW9uLCBvciB0aGUgcmVjb3ZlcnkgcnVsZSBmb3IgYSBjb21wbGV0aW9uLiBSZWZ1c2VzCmBTdGFsZVJldmlzaW9uYCB1bmxlc3MgdGhlIGFjY291bnQgaXMgYXQgYGV4cGVjdGVkX3JldmlzaW9uYCwgaWYgZ2l2ZW4uCmBhcHByb3ZhbF92YWxpZF91bnRpbGAgYm91bmRzIGEgYFByb3RlY3RlZGAgcmVjb25maWd1cmF0aW9uJ3MgYXBwcm92YWxzLgAAAAAACWFwcGx5X2RvYwAAAAAAAAMAAAAAAAAACGRvY19qc29uAAAADgAAAAAAAAAUYXBwcm92YWxfdmFsaWRfdW50aWwAAAAEAAAAAAAAABFleHBlY3RlZF9yZXZpc2lvbgAAAAAAA+gAAAAGAAAAAQAAA+kAAAPuAAAAIAAAB9AAAAARUGVyY2hBY2NvdW50RXJyb3IAAAA=",
        "AAAAAAAAADhXaGV0aGVyIGEgY3JlZGVudGlhbCBmaW5nZXJwcmludCBpcyBwZXJtYW5lbnRseSByZXZva2VkLgAAAAppc19yZXZva2VkAAAAAAABAAAAAAAAAAtmaW5nZXJwcmludAAAAAPuAAAAIAAAAAEAAAAB",
        "AAAAAAAAADdUaGUgYXBwbGllZCBhY2NvdW50IGRvY3VtZW50J3MgY2Fub25pY2FsIGJ5dGVzLCBpZiBhbnkuAAAAAAthcHBsaWVkX2RvYwAAAAAAAAAAAQAAA+gAAAAO",
        "AAAAAAAAAFRBcHBseSBhIGdyYW50IGRvY3VtZW50IHVuZGVyIGBncmFudGAgYW5kIHJldHVybiBpdHMgYGRvY19oYXNoYC4gT3duZXIKYXV0aG9yaXphdGlvbi4AAAALYXBwbHlfZ3JhbnQAAAAAAgAAAAAAAAAFZ3JhbnQAAAAAAAAEAAAAAAAAAAhkb2NfanNvbgAAAA4AAAABAAAD6QAAA+4AAAAgAAAH0AAAABFQZXJjaEFjY291bnRFcnJvcgAAAA==",
        "AAAAAAAAADZIb3cgbWFueSBncmFudCBpZHMgaGF2ZSBhIHJlY29yZCwgd2lwZWQgb25lcyBpbmNsdWRlZC4AAAAAAAtncmFudF9jb3VudAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAADdEZWNpZGUgd2hldGhlciB0aGlzIGFjY291bnQgYXV0aG9yaXplcyBgYXV0aF9jb250ZXh0c2AuAAAAAAxfX2NoZWNrX2F1dGgAAAADAAAAAAAAABFzaWduYXR1cmVfcGF5bG9hZAAAAAAAA+4AAAAgAAAAAAAAAApzaWduYXR1cmVzAAAAAAfQAAAAC0F1dGhQYXlsb2FkAAAAAAAAAAANYXV0aF9jb250ZXh0cwAAAAAAA+oAAAfQAAAAB0NvbnRleHQAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAFlDb25zdGFudHMgb2YgdGhpcyB3YXNtOiBpbnRlcmZhY2UgYW5kIHNuYXBzaG90IHZlcnNpb25zLCBkaWdlc3Qgc2NoZW1lcywKYW5kIGFwcGx5IG1vZGVzLgAAAAAAAAxjYXBhYmlsaXRpZXMAAAAAAAAAAQAAB9AAAAATQWNjb3VudENhcGFiaWxpdGllcwA=",
        "AAAAAAAAADFUaGUgZG9jIGNvbXBpbGVyIHRoaXMgYWNjb3VudCBwaW5zIGF0IGJ1aWxkIHRpbWUuAAAAAAAADGRvY19jb21waWxlcgAAAAAAAAABAAAAEw==",
        "AAAAAAAAAEtSZW1vdmUgdGhlIGdyYW50IGRvY3VtZW50IHVuZGVyIGBncmFudGAgYW5kIGl0cyBydWxlcy4gT3duZXIKYXV0aG9yaXphdGlvbi4AAAAADHJlbW92ZV9ncmFudAAAAAEAAAAAAAAABWdyYW50AAAAAAAABAAAAAEAAAPpAAAAAgAAB9AAAAARUGVyY2hBY2NvdW50RXJyb3IAAAA=",
        "AAAAAAAAAFpJbnN0YWxsIHJ1bGUgMCwgYGFkbWluYDogYSBzZWxmLWFkbWluIHJ1bGUgZm9yIGBhZG1pbl9zaWduZXJzYCwgd2l0aApmdWxsIG93bmVyIGF1dGhvcml0eS4AAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAAAQAAAAAAAAANYWRtaW5fc2lnbmVycwAAAAAAA+oAAAfQAAAABlNpZ25lcgAAAAAAAA==",
        "AAAAAAAAADlUaGUgYWNjb3VudCBkb2N1bWVudCdzIGNvbmZpZ3VyYXRpb24sIHJlYWQgYXQgb25lIGxlZGdlci4AAAAAAAANY29uZmlndXJhdGlvbgAAAAAAAAAAAAABAAAH0AAAABRBY2NvdW50Q29uZmlndXJhdGlvbg==",
        "AAAAAAAAAEtUaGUgYFByb3RlY3RlZGAgZnJlZXplLCBpZiBzZXQ7IGluIGZvcmNlIHdoaWxlIHRoZSBsZWRnZXIgaXMgYmVsb3cKYHVudGlsYC4AAAAADXJlY292ZXJ5X2dhdGUAAAAAAAAAAAAAAQAAA+gAAAfQAAAACkZyZWV6ZUdhdGUAAA==",
        "AAAAAAAAADBDYW5jZWwgdGhlIHBlbmRpbmcgdXBncmFkZS4gT3duZXIgYXV0aG9yaXphdGlvbi4AAAAOY2FuY2VsX3VwZ3JhZGUAAAAAAAAAAAABAAAD6QAAAAIAAAfQAAAAEVBlcmNoQWNjb3VudEVycm9yAAAA",
        "AAAAAAAAAFlUaGUgcnVsZS1ldmFsIHJ1bGVzIG9mIHRoZSBncmFudCBkb2N1bWVudCB1bmRlciBgZ3JhbnRgLCBhbGlnbmVkIHdpdGgKaXRzIHJlY29yZCdzIHJ1bGVzLgAAAAAAAA5ncmFudF9ydWxlX3NldAAAAAAAAQAAAAAAAAAFZ3JhbnQAAAAAAAAEAAAAAQAAA+oAAAfQAAAAClN0b3JlZFJ1bGUAAA==",
        "AAAAAAAAADZXaGV0aGVyIHRoaXMgYWNjb3VudCBldmVyIGVucm9sbGVkIGEgWksgZW5yb2xsbWVudCBpZC4AAAAAAA5pc19lbnJvbGxlZF9pZAAAAAAAAQAAAAAAAAANZW5yb2xsbWVudF9pZAAAAAAAA+4AAAAgAAAAAQAAAAE=",
        "AAAAAAAAADRBIGBMb3NzYCBvd25lcidzIGNhbmNlbGxhdGlvbiBvZiBhIHJlY292ZXJ5IGF0dGVtcHQuAAAAD2NhbmNlbF9yZWNvdmVyeQAAAAABAAAAAAAAAAphdHRlbXB0X2lkAAAAAAAGAAAAAQAAA+kAAAACAAAH0AAAABFQZXJjaEFjY291bnRFcnJvcgAAAA==",
        "AAAAAAAAAJVFeGVjdXRlIHRoZSBwZW5kaW5nIHVwZ3JhZGUgb25jZSBpdHMgZGVsYXkgaGFzIHBhc3NlZC4gT3duZXIKYXV0aG9yaXphdGlvbi4gUmVmdXNlcyBgU3RhbGVVcGdyYWRlYCBpZiB0aGUgcmVjb3ZlcnkgZ2VuZXJhdGlvbiBtb3ZlZApzaW5jZSBzY2hlZHVsaW5nLgAAAAAAAA9leGVjdXRlX3VwZ3JhZGUAAAAAAQAAAAAAAAAKcmVxdWVzdF9pZAAAAAAABgAAAAEAAAPpAAAAAgAAB9AAAAARUGVyY2hBY2NvdW50RXJyb3IAAAA=",
        "AAAAAAAAAD9FdmVyeSBjb250ZXh0IHJ1bGUgdGhlIGFjY291bnQgZG9jdW1lbnQgaW5zdGFsbGVkLCB3aXRoIGl0cyBpZC4AAAAAD2luc3RhbGxlZF9ydWxlcwAAAAAAAAAAAQAAA+oAAAfQAAAADUluc3RhbGxlZFJ1bGUAAAA=",
        "AAAAAAAAAB5UaGUgc2NoZWR1bGVkIHVwZ3JhZGUsIGlmIGFueS4AAAAAAA9wZW5kaW5nX3VwZ3JhZGUAAAAAAAAAAAEAAAPoAAAH0AAAAA5VcGdyYWRlUmVxdWVzdAAA",
        "AAAAAAAAADxUaGUgYXBwbGllZCBhY2NvdW50IGRvY3VtZW50J3MgY2Fub25pY2FsIGBkb2NfaGFzaGAsIGlmIGFueS4AAAAQYXBwbGllZF9kb2NfaGFzaAAAAAAAAAABAAAD6AAAA+4AAAAg",
        "AAAAAAAAADdUaGUgY29udGV4dCBydWxlIHdpdGggdGhpcyBpZDsgcGFuaWNzIGlmIHRoZXJlIGlzIG5vbmUuAAAAABBnZXRfY29udGV4dF9ydWxlAAAAAQAAAAAAAAAPY29udGV4dF9ydWxlX2lkAAAAAAQAAAABAAAH0AAAAAtDb250ZXh0UnVsZQA=",
        "AAAAAAAAAGRUaGUgZ3JhbnQgZ2VuZXJhdGlvbjogYWR2YW5jZWQgb25seSBieSBjb21wbGV0ZWQgcmVjb3Zlcmllcy4gQSBncmFudAphcHBsaWVkIHVuZGVyIGFub3RoZXIgaXMgd2lwZWQuAAAAEGdyYW50X2dlbmVyYXRpb24AAAAAAAAAAQAAAAY=",
        "AAAAAAAAAIRUaGUgc2lnbmVyIGlkcyBvZiB0aGUgZ3JhbnQgZG9jdW1lbnQgdW5kZXIgYGdyYW50YCwgaW4gZGVjbGFyYXRpb24Kb3JkZXIsIGlmIGFueTogd2l0aCBpdHMgcnVsZXMsIHRoZXkgZ2l2ZSBiYWNrIGl0cyBjYW5vbmljYWwgdGV4dC4AAAAQZ3JhbnRfc2lnbmVyX2lkcwAAAAEAAAAAAAAABWdyYW50AAAAAAAABAAAAAEAAAPoAAAD6gAAABA=",
        "AAAAAAAAAMRTY2hlZHVsZSBhbiB1cGdyYWRlIHRvIGB3YXNtX2hhc2hgIGFmdGVyIHRoZSB1cGdyYWRlIGRlbGF5LCByZXBsYWNpbmcKYW55IHBlbmRpbmcgb25lLCBhbmQgcmV0dXJuIGl0cyBpZC4gT3duZXIgYXV0aG9yaXphdGlvbjsgdW5kZXIKYFByb3RlY3RlZGAsIGFsc28gYXBwcm92YWxzIGZyZXNoIHVudGlsIGBhcHByb3ZhbF92YWxpZF91bnRpbGAuAAAAEHNjaGVkdWxlX3VwZ3JhZGUAAAACAAAAAAAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAAUYXBwcm92YWxfdmFsaWRfdW50aWwAAAAEAAAAAQAAA+kAAAAGAAAH0AAAABFQZXJjaEFjY291bnRFcnJvcgAAAA==",
        "AAAAAAAAAChUaGUgYWRvcHRlZCByZWNvdmVyeSBjb250cm9sbGVyLCBpZiBhbnkuAAAAE3JlY292ZXJ5X2NvbnRyb2xsZXIAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAACJUaGUgYWNjb3VudCdzIHJlY292ZXJ5IGdlbmVyYXRpb24uAAAAAAATcmVjb3ZlcnlfZ2VuZXJhdGlvbgAAAAAAAAAAAQAAAAY=",
        "AAAAAAAAALFFYWNoIHNpZ25lcidzIGB2ZXJpZmllci1uYW1lYCBpbiB0aGUgZ3JhbnQgZG9jdW1lbnQgdW5kZXIgYGdyYW50YCwKYWxpZ25lZCB3aXRoIGBncmFudF9zaWduZXJfaWRzYCwgaWYgYW55OiBlbXB0eSB3aGVyZSBhIHNpZ25lciBoYXMKbm9uZSwgYW5kIG5vIGVudHJpZXMgd2hlbiBubyBzaWduZXIgaGFzIG9uZS4AAAAAAAAUZ3JhbnRfdmVyaWZpZXJfbmFtZXMAAAABAAAAAAAAAAVncmFudAAAAAAAAAQAAAABAAAD6AAAA+oAAAAQ",
        "AAAAAAAAAE9UaGUgbGFzdCBncmFudCBnZW5lcmF0aW9uIGEgZ3JhbnQgZG9jdW1lbnQgbmFtZWQgdGhpcyBjcmVkZW50aWFsIHVuZGVyLAppZiBhbnkuAAAAABVjcmVkZW50aWFsX2dlbmVyYXRpb24AAAAAAAABAAAAAAAAAAtmaW5nZXJwcmludAAAAAPuAAAAIAAAAAEAAAPoAAAABg==",
        "AAAAAAAAAD5UaGUgY291bnQgb2YgY29udGV4dCBydWxlcywgZ3JhbnRzJyBhbmQgZXhwaXJlZCBvbmVzIGluY2x1ZGVkLgAAAAAAF2dldF9jb250ZXh0X3J1bGVzX2NvdW50AAAAAAAAAAABAAAABA==",
        "AAAAAAAAACtUaGUgaWQgdGhlIG5leHQgYHNjaGVkdWxlX3VwZ3JhZGVgIGFzc2lnbnMuAAAAABduZXh0X3VwZ3JhZGVfcmVxdWVzdF9pZAAAAAAAAAAAAQAAAAY=",
        "AAAAAgAAAEJSZXByZXNlbnRzIGRpZmZlcmVudCB0eXBlcyBvZiBzaWduZXJzIGluIHRoZSBzbWFydCBhY2NvdW50IHN5c3RlbS4AAAAAAAAAAAAGU2lnbmVyAAAAAAACAAAAAQAAAD1BIGRlbGVnYXRlZCBzaWduZXIgdGhhdCB1c2VzIGJ1aWx0LWluIHNpZ25hdHVyZSB2ZXJpZmljYXRpb24uAAAAAAAACURlbGVnYXRlZAAAAAAAAAEAAAATAAAAAQAAAHJBbiBleHRlcm5hbCBzaWduZXIgd2l0aCBjdXN0b20gdmVyaWZpY2F0aW9uIGxvZ2ljLgpDb250YWlucyB0aGUgdmVyaWZpZXIgY29udHJhY3QgYWRkcmVzcyBhbmQgdGhlIHB1YmxpYyBrZXkgZGF0YS4AAAAAAAhFeHRlcm5hbAAAAAIAAAATAAAADg==",
        "AAAAAQAABABUaGUgYXV0aG9yaXphdGlvbiBwYXlsb2FkIHBhc3NlZCB0byBgX19jaGVja19hdXRoYCwgYnVuZGxpbmcgY3J5cHRvZ3JhcGhpYwpwcm9vZnMgd2l0aCBjb250ZXh0IHJ1bGUgc2VsZWN0aW9uLgoKVGhpcyBzdHJ1Y3QgY2FycmllcyB0d28gZGlzdGluY3QgcGllY2VzIG9mIGluZm9ybWF0aW9uIHRoYXQgYXJlIGJvdGgKcmVxdWlyZWQgZm9yIGF1dGhvcml6YXRpb24gYnV0IGNhbm5vdCBiZSBkZXJpdmVkIGZyb20gZWFjaCBvdGhlcjoKCi0gYHNpZ25lcnNgIG1hcHMgZWFjaCBbYFNpZ25lcmBdIHRvIGl0cyByYXcgc2lnbmF0dXJlIGJ5dGVzLCBwcm92aWRpbmcKY3J5cHRvZ3JhcGhpYyBwcm9vZiB0aGF0IHRoZSBzaWduZXIgYWN0dWFsbHkgc2lnbmVkIHRoZSB0cmFuc2FjdGlvbgpwYXlsb2FkLiBBIGNvbnRleHQgcnVsZSBzdG9yZXMgd2hpY2ggc2lnbmVyICppZGVudGl0aWVzKiBhcmUgYXV0aG9yaXplZAoodmlhIGBzaWduZXJfaWRzYCksIGJ1dCB0aGUgcnVsZSBkb2VzIG5vdCBjb250YWluIHRoZSBzaWduYXR1cmVzCnRoZW1zZWx2ZXMg4oCUIHRob3NlIG11c3QgYmUgc3VwcGxpZWQgaGVyZS4KCi0gYGNvbnRleHRfcnVsZV9pZHNgIHRlbGxzIHRoZSBzeXN0ZW0gd2hpY2ggcnVsZSB0byB2YWxpZGF0ZSBmb3IgZWFjaCBhdXRoCmNvbnRleHQuIEJlY2F1c2UgbXVsdGlwbGUgcnVsZXMgY2FuIGV4aXN0IGZvciB0aGUgc2FtZSBjb250ZXh0IHR5cGUsIHRoZQpjYWxsZXIgbXVzdCBleHBsaWNpdGx5IHNlbGVjdCBvbmUgcGVyIGNvbnRleHQgcmF0aGVyIHRoYW4gcmVseWluZyBvbgphdXRvLWRpc2NvdmVyeS4gRWFjaCBlbnRyeSBpcyBhbGlnbmVkIGJ5IGluZGV4IHdpdGggdGhlIGBhdXRoX2NvbnRleHRzYApwYXNzZWQgdG8gYF9fY2hlY2tfYXV0aGAuCgpUaGUgbGVuZ3RoIG9mIGBjb250ZXh0X3J1bGVfaWRzYCBtdXN0IGVxdWFsIHRoZSBudW1iZXIgb2YgYXV0aCBjb250ZXh0czsKYSBtaXNtYXRjaCBpcyByZWplY3RlZCB3aXRoCltgU21hcnRBY2NvdW50RXJyb3I6OkNvbnRleHRSdWxlSWRzTGVuAAAAAAAAAAtBdXRoUGF5bG9hZAAAAAACAAAAPFBlci1jb250ZXh0IHJ1bGUgSURzLCBhbGlnbmVkIGJ5IGluZGV4IHdpdGggYGF1dGhfY29udGV4dHNgLgAAABBjb250ZXh0X3J1bGVfaWRzAAAD6gAAAAQAAAAlU2lnbmF0dXJlIGRhdGEgbWFwcGVkIHRvIGVhY2ggc2lnbmVyLgAAAAAAAAdzaWduZXJzAAAAA+wAAAfQAAAABlNpZ25lcgAAAAAADg==",
        "AAAAAQAAADxBIGNvbXBsZXRlIGNvbnRleHQgcnVsZSBkZWZpbmluZyBhdXRob3JpemF0aW9uIHJlcXVpcmVtZW50cy4AAAAAAAAAC0NvbnRleHRSdWxlAAAAAAgAAAApVGhlIHR5cGUgb2YgY29udGV4dCB0aGlzIHJ1bGUgYXBwbGllcyB0by4AAAAAAAAMY29udGV4dF90eXBlAAAH0AAAAA9Db250ZXh0UnVsZVR5cGUAAAAAJ1VuaXF1ZSBpZGVudGlmaWVyIGZvciB0aGUgY29udGV4dCBydWxlLgAAAAACaWQAAAAAAAQAAAApSHVtYW4tcmVhZGFibGUgbmFtZSBmb3IgdGhlIGNvbnRleHQgcnVsZS4AAAAAAAAEbmFtZQAAABAAAAAwTGlzdCBvZiBwb2xpY3kgY29udHJhY3RzIHRoYXQgbXVzdCBiZSBzYXRpc2ZpZWQuAAAACHBvbGljaWVzAAAD6gAAABMAAABKR2xvYmFsIHJlZ2lzdHJ5IElEcyBmb3IgZWFjaCBwb2xpY3ksIHBvc2l0aW9uYWxseSBhbGlnbmVkIHdpdGgKYHBvbGljaWVzYC4AAAAAAApwb2xpY3lfaWRzAAAAAAPqAAAABAAAAElHbG9iYWwgcmVnaXN0cnkgSURzIGZvciBlYWNoIHNpZ25lciwgcG9zaXRpb25hbGx5IGFsaWduZWQgd2l0aApgc2lnbmVyc2AuAAAAAAAACnNpZ25lcl9pZHMAAAAAA+oAAAAEAAAAKExpc3Qgb2Ygc2lnbmVycyBhdXRob3JpemVkIGJ5IHRoaXMgcnVsZS4AAAAHc2lnbmVycwAAAAPqAAAH0AAAAAZTaWduZXIAAAAAADFPcHRpb25hbCBleHBpcmF0aW9uIGxlZGdlciBzZXF1ZW5jZSBmb3IgdGhlIHJ1bGUuAAAAAAAAC3ZhbGlkX3VudGlsAAAAA+gAAAAE",
        "AAAAAgAAAEBUeXBlcyBvZiBjb250ZXh0cyB0aGF0IGNhbiBiZSBhdXRob3JpemVkIGJ5IHNtYXJ0IGFjY291bnQgcnVsZXMuAAAAAAAAAA9Db250ZXh0UnVsZVR5cGUAAAAABAAAAAAAAAAtRGVmYXVsdCBydWxlcyB0aGF0IGNhbiBhdXRob3JpemUgYW55IGNvbnRleHQuAAAAAAAAB0RlZmF1bHQAAAAAAQAAADBSdWxlcyBzcGVjaWZpYyB0byBjYWxsaW5nIGEgcGFydGljdWxhciBjb250cmFjdC4AAAAMQ2FsbENvbnRyYWN0AAAAAQAAABMAAAABAAAAQlJ1bGVzIHNwZWNpZmljIHRvIGNyZWF0aW5nIGEgY29udHJhY3Qgd2l0aCBhIHBhcnRpY3VsYXIgV0FTTSBoYXNoLgAAAAAADkNyZWF0ZUNvbnRyYWN0AAAAAAABAAAD7gAAACAAAAABAAAAZFJ1bGVzIHNwZWNpZmljIHRvIGNyZWF0aW5nIGEgY29udHJhY3QgZnJvbSB0aGUgZXhlY3V0YWJsZSByZWZlcmVuY2UgdGhhdApgb3duZXJgIHN0b3JlcyB1bmRlciBgdGFnYC4AAAAZQ3JlYXRlQ29udHJhY3RFeHRlcm5hbFJlZgAAAAAAAAIAAAATAAAAEA==",
        "AAAABAAAAClFcnJvciBjb2RlcyBmb3Igc21hcnQgYWNjb3VudCBvcGVyYXRpb25zLgAAAAAAAAAAAAARU21hcnRBY2NvdW50RXJyb3IAAAAAAAAFAAAAKlRoZSBzcGVjaWZpZWQgY29udGV4dCBydWxlIGRvZXMgbm90IGV4aXN0LgAAAAAAE0NvbnRleHRSdWxlTm90Rm91bmQAAAALuAAAADpUaGUgcHJvdmlkZWQgY29udGV4dCBjYW5ub3QgYmUgdmFsaWRhdGVkIGFnYWluc3QgYW55IHJ1bGUuAAAAAAASVW52YWxpZGF0ZWRDb250ZXh0AAAAAAu6AAAAJ0V4dGVybmFsIHNpZ25hdHVyZSB2ZXJpZmljYXRpb24gZmFpbGVkLgAAAAAaRXh0ZXJuYWxWZXJpZmljYXRpb25GYWlsZWQAAAAAC7sAAAA8Y29udGV4dF9ydWxlX2lkcyBsZW5ndGggZG9lcyBub3QgbWF0Y2ggYXV0aF9jb250ZXh0cyBsZW5ndGguAAAAHENvbnRleHRSdWxlSWRzTGVuZ3RoTWlzbWF0Y2gAAAvGAAAAQ0Egc2lnbmVyIGluIGBBdXRoUGF5bG9hZGAgaXMgbm90IHBhcnQgb2YgYW55IHNlbGVjdGVkIGNvbnRleHQgcnVsZS4AAAAAElVuYXV0aG9yaXplZFNpZ25lcgAAAAALyA==",
        "AAAAAQAAABpBIHBlbmRpbmcgYWNjb3VudCB1cGdyYWRlLgAAAAAAAAAAAA5VcGdyYWRlUmVxdWVzdAAAAAAABQAAADZUaGUgYWRvcHRlZCBjb250cm9sbGVyJ3MgZXBvY2ggd2hlbiBzY2hlZHVsZWQsIGlmIGFueS4AAAAAABBjb250cm9sbGVyX2Vwb2NoAAAD6AAAAAYAAAAyVGhlIGZpcnN0IGxlZGdlciBhdCB3aGljaCB0aGUgcmVxdWVzdCBtYXkgZXhlY3V0ZS4AAAAAAA1leGVjdXRhYmxlX2F0AAAAAAAABAAAAEFUaGUgYWNjb3VudCdzIHJlY292ZXJ5IGdlbmVyYXRpb24gd2hlbiB0aGUgcmVxdWVzdCB3YXMgc2NoZWR1bGVkLgAAAAAAAApnZW5lcmF0aW9uAAAAAAAGAAAAGlBlci1hY2NvdW50LCBuZXZlciByZXVzZWQuAAAAAAAKcmVxdWVzdF9pZAAAAAAABgAAACRUaGUgZXhhY3QgV2FzbSB0aGUgYWNjb3VudCB3aWxsIHJ1bi4AAAAJd2FzbV9oYXNoAAAAAAAD7gAAACA=",
        "AAAAAQAAABFgcnVsZV9ldmFsOjpDYXBgLgAAAAAAAAAAAAAJU3RvcmVkQ2FwAAAAAAAAAwAAAAAAAAAKYW1vdW50X2FyZwAAAAAABAAAAAAAAAAFbGltaXQAAAAAAAALAAAAAAAAAAZwZXJpb2QAAAAAAAQ=",
        "AAAAAgAAABFgcnVsZV9ldmFsOjpWYWxgLgAAAAAAAAAAAAAJU3RvcmVkVmFsAAAAAAAACAAAAAEAAAAAAAAABEkxMjgAAAABAAAACwAAAAEAAAAAAAAAA1U2NAAAAAABAAAABgAAAAEAAAAAAAAABEJvb2wAAAABAAAAAQAAAAEAAAAAAAAABUJ5dGVzAAAAAAAAAQAAAA4AAAABAAAAAAAAAAdBZGRyZXNzAAAAAAEAAAATAAAAAQAAAAAAAAAGU3ltYm9sAAAAAAABAAAAEQAAAAEAAAAAAAAABlN0cmluZwAAAAAAAQAAABAAAAABAAAALEFueSBvdGhlciBhcmd1bWVudCwgYXMgaXRzIGZ1bGwgYFNjVmFsYCBYRFIuAAAABU90aGVyAAAAAAAAAQAAAA4=",
        "AAAAAgAAABJgcnVsZV9ldmFsOjpDb25kYC4AAAAAAAAAAAAKU3RvcmVkQ29uZAAAAAAABAAAAAEAAAAAAAAABUFyZ0VxAAAAAAAAAgAAAAQAAAfQAAAACVN0b3JlZFZhbAAAAAAAAAEAAAAAAAAADUFyZ0kxMjhBdE1vc3QAAAAAAAACAAAABAAAAAsAAAABAAAAAAAAAAVBcmdJbgAAAAAAAAIAAAAEAAAD6gAAB9AAAAAJU3RvcmVkVmFsAAAAAAAAAQAAAAAAAAAMQXJnU3RyUHJlZml4AAAAAgAAAAQAAAAQ",
        "AAAAAQAAABJgcnVsZV9ldmFsOjpSdWxlYC4AAAAAAAAAAAAKU3RvcmVkUnVsZQAAAAAACQAAALtBbiBvcHRpb25hbCBzaW5nbGV0b24gY29udGFpbmluZyB0aGUgcm9vdC4gVGhlIG9wdGlvbmFsIGZpZWxkIGxldHMKdGhlIFNESyByZWFkIGxlZ2FjeSBydWxlczsgYG1pcnJvcjo6cnVsZWAgY2hlY2tzIHRoZSBleGFjdCBvbGQvbmV3CmxheW91dHMgYmVmb3JlIGEgc3RvcmVkIHZhbHVlIGNhbiBhdXRob3JpemUgYW55dGhpbmcuAAAAAAlhdXRoX3Jvb3QAAAAAAAPoAAAD6gAAB9AAAAAOU3RvcmVkQXV0aFJvb3QAAAAAAFVaZXJvIG9yIG9uZSBlbnRyaWVzOiBgI1tjb250cmFjdHR5cGVdYCBoYXMgbm8gYE9wdGlvbmAgb2YgYQpgI1tjb250cmFjdHR5cGVdYCBzdHJ1Y3QuAAAAAAAAA2NhcAAAAAPqAAAH0AAAAAlTdG9yZWRDYXAAAAAAAAAAAAAABWNvbmRzAAAAAAAD6gAAB9AAAAAKU3RvcmVkQ29uZAAAAAAAAAAAAAhjb250cmFjdAAAABMAAAAAAAAACWZ1bmN0aW9ucwAAAAAAB9AAAAAPU3RvcmVkRnVuY3Rpb25zAAAAAAAAAAAKZ2VuZXJhdGlvbgAAAAAD6AAAAAYAAAAAAAAAB3NpZ25lcnMAAAAD6gAAB9AAAAAGU2lnbmVyAAAAAAAAAAAACXRocmVzaG9sZAAAAAAAAAQAAAAAAAAAC3ZhbGlkX3VudGlsAAAAA+gAAAAE",
        "AAAAAQAAACxFeGFjdCBhdXRob3JpemF0aW9uLWVudHJ5IHJvb3QgaW4gaG9zdCBmb3JtLgAAAAAAAAAOU3RvcmVkQXV0aFJvb3QAAAAAAAIAAAAAAAAACGNvbnRyYWN0AAAAEwAAAAAAAAAIZnVuY3Rpb24AAAAR",
        "AAAAAgAAABdgcnVsZV9ldmFsOjpGdW5jdGlvbnNgLgAAAAAAAAAAD1N0b3JlZEZ1bmN0aW9ucwAAAAACAAAAAQAAAAAAAAAJQW55RXhjZXB0AAAAAAAAAQAAA+oAAAARAAAAAQAAAAAAAAAET25seQAAAAEAAAPqAAAAEQ==",
        "AAAAAQAAADtUaGUgc2hhcmVkIGluZnJhIGNvbnRyYWN0cyB0aGlzIGFjY291bnQgcGlucyBhdCBidWlsZCB0aW1lLgAAAAAAAAAACUluZnJhUGlucwAAAAAAAAMAAAAAAAAADGRvY19jb21waWxlcgAAABMAAAAAAAAAC2ludGVycHJldGVyAAAAABMAAAAAAAAADnNwZW5kaW5nX2xpbWl0AAAAAAAT",
        "AAAAAQAAAGZUaGUgYFByb3RlY3RlZGAgZnJlZXplOiB3aGlsZSBgbGVkZ2VyIDwgdW50aWxgLCB0aGUgYWNjb3VudCBhdXRob3JpemVzCm9ubHkgYGF0dGVtcHRfaWRgJ3MgY29tcGxldGlvbi4AAAAAAAAAAAAKRnJlZXplR2F0ZQAAAAAAAgAAABdUaGUgYXV0aG9yaXplZCBhdHRlbXB0LgAAAAAKYXR0ZW1wdF9pZAAAAAAABgAAACZUaGUgYXV0aG9yaXplZCBhdHRlbXB0J3MgYGV4cGlyZXNfYXRgLgAAAAAABXVudGlsAAAAAAAABA==",
        "AAAABQAAAG5FbWl0dGVkIGFmdGVyIHRoZSBhY2NvdW50IGRvY3VtZW50IGlzIGFwcGxpZWQ6IGl0cyBgZG9jX2hhc2hgLCB0aGUgcmV2aXNpb24sCmFuZCB3aGF0IGNoYW5nZWQgaW4gdGhlIHJ1bGUgc2V0LgAAAAAAAAAAAApEb2NBcHBsaWVkAAAAAAABAAAAC2RvY19hcHBsaWVkAAAAAAkAAAAAAAAACGRvY19oYXNoAAAD7gAAACAAAAABAAAAAAAAAAhyZXZpc2lvbgAAAAYAAAAAAAAAAAAAAAtydWxlc19hZGRlZAAAAAAEAAAAAAAAAAAAAAANcnVsZXNfcmVtb3ZlZAAAAAAAAAQAAAAAAAAAAAAAAAxydWxlc19lZGl0ZWQAAAAEAAAAAAAAAAAAAAANc2lnbmVyc19hZGRlZAAAAAAAAAQAAAAAAAAAAAAAAA9zaWduZXJzX3JlbW92ZWQAAAAABAAAAAAAAAAAAAAADnBvbGljaWVzX2FkZGVkAAAAAAAEAAAAAAAAAAAAAAAQcG9saWNpZXNfcmVtb3ZlZAAAAAQAAAAAAAAAAg==",
        "AAAAAQAAABxBIGdyYW50IGRvY3VtZW50IGFzIGFwcGxpZWQuAAAAAAAAAAtHcmFudFJlY29yZAAAAAADAAAAGUl0cyBjYW5vbmljYWwgYGRvY19oYXNoYC4AAAAAAAAIZG9jX2hhc2gAAAPuAAAAIAAAAFdUaGUgZ3JhbnQgZ2VuZXJhdGlvbiBpdCB3YXMgYXBwbGllZCB1bmRlcjsgd2lwZWQgb25jZQpgZ3JhbnRfZ2VuZXJhdGlvbmAgbW92ZXMgcGFzdCBpdC4AAAAAA2dlbgAAAAAGAAAALUV2ZXJ5IGNvbnRleHQgcnVsZSBpdCBpbnN0YWxsZWQsIHdpdGggaXRzIGlkLgAAAAAAAAVydWxlcwAAAAAAA+oAAAfQAAAADUluc3RhbGxlZFJ1bGUAAAA=",
        "AAAABQAAAElFbWl0dGVkIHdoZW4gYSBjb21wbGV0ZWQgcmVjb3ZlcnkgYWR2YW5jZXMgdGhlIGdyYW50IGdlbmVyYXRpb24gdG8gYGdlbmAuAAAAAAAAAAAAAAtHcmFudHNXaXBlZAAAAAABAAAADGdyYW50c193aXBlZAAAAAEAAAAAAAAAA2dlbgAAAAAGAAAAAAAAAAI=",
        "AAAABQAAAHhFbWl0dGVkIGFmdGVyIGEgZ3JhbnQgZG9jdW1lbnQgaXMgYXBwbGllZDogaXRzIGdyYW50IGlkLCBgZG9jX2hhc2hgLCBncmFudApnZW5lcmF0aW9uLCBhbmQgd2hhdCBjaGFuZ2VkIGluIGl0cyBydWxlIHNldC4AAAAAAAAADEdyYW50QXBwbGllZAAAAAEAAAANZ3JhbnRfYXBwbGllZAAAAAAAAAoAAAAAAAAABWdyYW50AAAAAAAABAAAAAEAAAAAAAAACGRvY19oYXNoAAAD7gAAACAAAAAAAAAAAAAAAANnZW4AAAAABgAAAAAAAAAAAAAAC3J1bGVzX2FkZGVkAAAAAAQAAAAAAAAAAAAAAA1ydWxlc19yZW1vdmVkAAAAAAAABAAAAAAAAAAAAAAADHJ1bGVzX2VkaXRlZAAAAAQAAAAAAAAAAAAAAA1zaWduZXJzX2FkZGVkAAAAAAAABAAAAAAAAAAAAAAAD3NpZ25lcnNfcmVtb3ZlZAAAAAAEAAAAAAAAAAAAAAAOcG9saWNpZXNfYWRkZWQAAAAAAAQAAAAAAAAAAAAAABBwb2xpY2llc19yZW1vdmVkAAAABAAAAAAAAAAC",
        "AAAABQAAADhFbWl0dGVkIHdoZW4gYSBncmFudCBkb2N1bWVudCBhbmQgaXRzIHJ1bGVzIGFyZSByZW1vdmVkLgAAAAAAAAAMR3JhbnRSZW1vdmVkAAAAAQAAAA1ncmFudF9yZW1vdmVkAAAAAAAAAwAAAAAAAAAFZ3JhbnQAAAAAAAAEAAAAAQAAACpUaGUgZ3JhbnQgZ2VuZXJhdGlvbiBpdCB3YXMgYXBwbGllZCB1bmRlci4AAAAAAANnZW4AAAAABgAAAAAAAAAAAAAADXJ1bGVzX3JlbW92ZWQAAAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAAERFbWl0dGVkIHdoZW4gdGhlIGNvbnRyb2xsZXIgc2V0cyAoYHVudGlsID4gMGApIG9yIGNsZWFycyB0aGUgZnJlZXplLgAAAAAAAAANRnJlZXplQ2hhbmdlZAAAAAAAAAEAAAAOZnJlZXplX2NoYW5nZWQAAAAAAAIAAAAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAAAAAAAAAAAAAAV1bnRpbAAAAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAACxFbWl0dGVkIHdoZW4gYSBzY2hlZHVsZWQgdXBncmFkZSBpcyBkcm9wcGVkLgAAAAAAAAAOVXBncmFkZURyb3BwZWQAAAAAAAEAAAAPdXBncmFkZV9kcm9wcGVkAAAAAAEAAAAAAAAACnJlcXVlc3RfaWQAAAAAAAYAAAABAAAAAg==",
        "AAAABQAAACFFbWl0dGVkIHdoZW4gYW4gdXBncmFkZSBleGVjdXRlcy4AAAAAAAAAAAAAD1VwZ3JhZGVFeGVjdXRlZAAAAAABAAAAEHVwZ3JhZGVfZXhlY3V0ZWQAAAACAAAAAAAAAApyZXF1ZXN0X2lkAAAAAAAGAAAAAQAAAAAAAAAJd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAAAAAAAg==",
        "AAAABQAAACtFdmVudCBlbWl0dGVkIHdoZW4gYSBjb250ZXh0IHJ1bGUgaXMgYWRkZWQuAAAAAAAAAAAQQ29udGV4dFJ1bGVBZGRlZAAAAAEAAAASY29udGV4dF9ydWxlX2FkZGVkAAAAAAAGAAAAAAAAAA9jb250ZXh0X3J1bGVfaWQAAAAABAAAAAEAAAAAAAAABG5hbWUAAAAQAAAAAAAAAAAAAAAMY29udGV4dF90eXBlAAAH0AAAAA9Db250ZXh0UnVsZVR5cGUAAAAAAAAAAAAAAAALdmFsaWRfdW50aWwAAAAD6AAAAAQAAAAAAAAAAAAAAApzaWduZXJfaWRzAAAAAAPqAAAABAAAAAAAAAAAAAAACnBvbGljeV9pZHMAAAAAA+oAAAAEAAAAAAAAAAI=",
        "AAAABQAAACVFbWl0dGVkIHdoZW4gYW4gdXBncmFkZSBpcyBzY2hlZHVsZWQuAAAAAAAAAAAAABBVcGdyYWRlU2NoZWR1bGVkAAAAAQAAABF1cGdyYWRlX3NjaGVkdWxlZAAAAAAAAAMAAAAAAAAACnJlcXVlc3RfaWQAAAAAAAYAAAABAAAAAAAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAAgVGhlIGZpcnN0IGxlZGdlciBpdCBtYXkgZXhlY3V0ZS4AAAANZXhlY3V0YWJsZV9hdAAAAAAAAAQAAAAAAAAAAg==",
        "AAAABAAAAI9FdmVyeXRoaW5nIHRoZSBhY2NvdW50J3MgZW50cnkgcG9pbnRzIGNhbiByZWZ1c2UuIENvbXBpbGVyIGFuZCBjb250cm9sbGVyIGZhaWx1cmVzIGZsYXR0ZW4gaW4gdmlhIGAjW2Zyb21fY29udHJhY3RfY2xpZW50XWAsIGNvbnZlcnRlZCBieSBgPz9gLgAAAAAAAAAAEVBlcmNoQWNjb3VudEVycm9yAAAAAAAAQgAAAGFUaGUgZG9jdW1lbnQga2VlcHMgbm8gY29uc3RyYWludC1mcmVlLCBuZXZlci1leHBpcmluZyBzZWxmLWFkbWluIHJ1bGUgd2l0aCBhIHNpZ25lciAoYW50aS1icmljaykuAAAAAAAADEFkbWluTG9ja291dAAAAAEAAAAoVGhlIGRvY3VtZW50IG5hbWVzIGEgcmV2b2tlZCBjcmVkZW50aWFsLgAAABFSZXZva2VkQ3JlZGVudGlhbAAAAAAAAAIAAABEVGhlIGRvY3VtZW50IHJldXNlcyBhIFpLIGVucm9sbG1lbnQgaWQgdGhpcyBhY2NvdW50IGVucm9sbGVkIGJlZm9yZS4AAAAQRW5yb2xsbWVudFJldXNlZAAAAAMAAAA/VGhlIGRvY3VtZW50IGNoYW5nZXMgdGhlIFpLIGZhY3RvciB3aXRob3V0IGEgbmV3IGVucm9sbG1lbnQgaWQuAAAAABZaa0ZhY3RvckNoYW5nZWRJblBsYWNlAAAAAAAEAAAAMWBleGVjdXRlYCB3YXMgYXNrZWQgdG8gY2FsbCBhbiBpbnZva2VyLW9ubHkgaG9vay4AAAAAAAAQUmVzZXJ2ZWRGdW5jdGlvbgAAAAUAAAAvVGhlIGFjY291bnQgaGFzIG5vIGFkb3B0ZWQgcmVjb3ZlcnkgY29udHJvbGxlci4AAAAAE1JlY292ZXJ5Tm90RW5yb2xsZWQAAAAABgAAABhObyB1cGdyYWRlIGlzIHNjaGVkdWxlZC4AAAAQTm9QZW5kaW5nVXBncmFkZQAAAAcAAAAsVGhlIHJlcXVlc3QgaWQgaXMgbm90IHRoZSBwZW5kaW5nIHVwZ3JhZGUncy4AAAAWVXBncmFkZVJlcXVlc3RNaXNtYXRjaAAAAAAACAAAACJUaGUgdXBncmFkZSBkZWxheSBoYXMgbm90IGVsYXBzZWQuAAAAAAAPVXBncmFkZU5vdFJlYWR5AAAAAAkAAAAmQSBsZWRnZXIgY29tcHV0YXRpb24gb3ZlcmZsb3dlZCBgdTMyYC4AAAAAAA5UaW1pbmdPdmVyZmxvdwAAAAAACgAAAEBBIGNvbXBsZXRpb24gcmV0dXJuZWQgYSBjcmVkZW50aWFsIHRoYXQgY2Fubm90IGJlIGZpbmdlcnByaW50ZWQuAAAAEUludmFsaWRDcmVkZW50aWFsAAAAAAAACwAAAE5UaGUgcmVjb3ZlcnkgZ2VuZXJhdGlvbiBtb3ZlZCBzaW5jZSBzY2hlZHVsaW5nOyB0aGUgcmVxdWVzdCBjYW4gbmV2ZXIgZXhlY3V0ZS4AAAAAAAxTdGFsZVVwZ3JhZGUAAAAMAAAAK1RoZSBzdWJtaXR0ZWQgZG9jdW1lbnQgYnl0ZXMgYXJlIG5vdCBVVEYtOC4AAAAAE0NvbXBpbGVyX0RvY05vdFV0ZjgAAAAADQAAAGxUaGUgZG9jdW1lbnQgZmFpbGVkIGZhaWwtY2xvc2VkIHBhcnNpbmcgKHVua25vd24gZmllbGQsIGJhZCBzaGFwZSwgdW5zdXBwb3J0ZWQgdmVyc2lvbiwgZHVwbGljYXRlIGtleSwg4oCmKS4AAAARQ29tcGlsZXJfRG9jUGFyc2UAAAAAAAAOAAAAqFRoZSBkb2N1bWVudCBmYWlsZWQgc2VtYW50aWMgdmFsaWRhdGlvbiAoZGFuZ2xpbmcgc2lnbmVyIHJlZiwgbWFsZm9ybWVkIGFkZHJlc3Mgb3Iga2V5LCBhbWJpZ3VvdXMgZW1wdHkgbGlzdCwg4oCmKSBvciBuYW1lcyBpdHMgdmVyaWZpZXJzIGFzIHRoZSBjb21waWxlciBkb2VzIG5vdCB0YWtlLgAAABNDb21waWxlcl9Eb2NJbnZhbGlkAAAAAA8AAABDVGhlIGRvY3VtZW50IG5hbWVzIG5vIG5ldHdvcmssIG9yIGEgbmV0d29yayB0aGF0IGlzIG5vdCB0aGlzIGNoYWluLgAAAAAVQ29tcGlsZXJfV3JvbmdOZXR3b3JrAAAAAAAAEAAAAG1UaGUgZG9jdW1lbnQgY2Fubm90IGJlIGxvd2VyZWQgdG8gcnVsZXM6IGEgcnVsZSB3aXRoIHNlbGYtYXV0aGVudGljYXRpbmcgcHJpbmNpcGFscywgb3IgdG9vIG1hbnkgY29uc3RyYWludHMuAAAAAAAAE0NvbXBpbGVyX0RvY0NvbXBpbGUAAAAAEQAAAERUaGUgZG9jdW1lbnQgZXhjZWVkcyBhIGNhcCBvbiBzaWduZXJzLCBydWxlcywgYnl0ZXMsIG9yIG5hbWUgbGVuZ3RoLgAAABRDb21waWxlcl9Eb2NUb29MYXJnZQAAABIAAAA9QSBzaWduZXIncyBleHRlcm5hbCBga2V5YCBpcyBub3QgaXRzIHZlcmlmaWVyLWNhbm9uaWNhbCBmb3JtLgAAAAAAAB5Db21waWxlcl9LZXlOb3RDYW5vbmljYWxpemFibGUAAAAAABMAAAA6YGRlcml2ZV90YXJnZXRgOiB0aGUgY3VycmVudCBkb2N1bWVudCBlbnJvbGxzIG5vIHJlY292ZXJ5LgAAAAAAFENvbXBpbGVyX05vdEVucm9sbGVkAAAAFAAAAGpgZGVyaXZlX3RhcmdldGA6IHRoZSByZXBsYWNlbWVudCBzZXQgYnJlYWtzIHNwZWMgwqc3LjMgcnVsZXMgMS0zLCBvciB0aGUgYWN0aW9uIGlzIG5vdCBhIHJlY292ZXJ5IGF0dGVtcHQuAAAAAAAbQ29tcGlsZXJfUmVwbGFjZW1lbnRSZWZ1c2VkAAAAABUAAABVYGRlcml2ZV90YXJnZXRgOiB0aGUgWksgZW5yb2xsbWVudCBpcyBtaXNzaW5nLCB1bmV4cGVjdGVkLCBvciByZXVzZXMgdGhlIGVucm9sbGVkIGlkLgAAAAAAAB1Db21waWxlcl9aa0Vucm9sbG1lbnRNaXNtYXRjaAAAAAAAABYAAABoYGRlcml2ZV90YXJnZXRgOiB0aGUgdGFyZ2V0IGhhcyBubyBjb25zdHJhaW50LWZyZWUgc2VsZi1hZG1pbiBydWxlIHdpdGggYSBzaWduZXIgKHRoZSBhbnRpLWJyaWNrIGNoZWNrKS4AAAAVQ29tcGlsZXJfQWRtaW5Mb2Nrb3V0AAAAAAAAFwAAAEFObyBjb25maWd1cmF0aW9uIGlzIGVucm9sbGVkIGZvciB0aGlzIGFjY291bnQgYXQgdGhpcyBjb250cm9sbGVyLgAAAAAAABRSZWNvdmVyeV9Ob3RFbnJvbGxlZAAAABgAAABUQW4gYXR0ZW1wdCBpcyBhdXRob3JpemVkIGFuZCBsaXZlLCB3aGljaCBibG9ja3MgYmVnaW4sIHBvbGljeSBjaGFuZ2VzLCBhbmQgdXBncmFkZXMuAAAAGlJlY292ZXJ5X0F0dGVtcHRBdXRob3JpemVkAAAAAAAZAAAAL05vIGF0dGVtcHQgd2l0aCB0aGlzIGlkIGV4aXN0cyBmb3IgdGhlIGFjY291bnQuAAAAABZSZWNvdmVyeV9Ob1N1Y2hBdHRlbXB0AAAAAAAaAAAAY1RoZSBhdHRlbXB0IGlzIHRlcm1pbmFsLCBleHBpcmVkLCBmcm9tIGFuIG9sZGVyIGVwb2NoLCBvciBpbnZhbGlkYXRlZCBieSBhIHNpYmxpbmcncyBhdXRob3JpemF0aW9uLgAAAAAXUmVjb3ZlcnlfQXR0ZW1wdE5vdExpdmUAAAAAGwAAAEBJbml0aWF0aW9uIGV2aWRlbmNlIGZvciBhbiBhdHRlbXB0IHRoYXQgaXMgbm8gbG9uZ2VyIGNvbGxlY3RpbmcuAAAAHVJlY292ZXJ5X0F0dGVtcHROb3RDb2xsZWN0aW5nAAAAAAAAHAAAACVDb21wbGV0aW9uIGJlZm9yZSBgZXhlY3V0YWJsZV9hZnRlcmAuAAAAAAAAGVJlY292ZXJ5X05vdEV4ZWN1dGFibGVZZXQAAAAAAAAdAAAAZlRoZSBjb21wbGV0aW9uIGNvbnRleHQsIG9yIHRoZSBjb21waWxlZCBkb2N1bWVudCBoYXNoLCBkb2VzIG5vdCBtYXRjaCB0aGUgYXV0aG9yaXplZCBhdHRlbXB0J3MgdGFyZ2V0LgAAAAAAFFJlY292ZXJ5X1dyb25nVGFyZ2V0AAAAHgAAAChUaGUgYWRkcmVzcyBpcyBub3QgYW4gZW5yb2xsZWQgZ3VhcmRpYW4uAAAAFVJlY292ZXJ5X05vdEFHdWFyZGlhbgAAAAAAAB8AAAA7VGhpcyBndWFyZGlhbiBvciBmYWN0b3IgYWxyZWFkeSBjb3VudGVkIGZvciB0aGlzIHN0YXRlbWVudC4AAAAAF1JlY292ZXJ5X0FscmVhZHlDb3VudGVkAAAAACAAAAApVGhlIGVucm9sbGVkIG1vZGUgaGFzIG5vIGd1YXJkaWFuIGZhY3Rvci4AAAAAAAAbUmVjb3ZlcnlfTW9kZUhhc05vR3VhcmRpYW5zAAAAACEAAAAjVGhlIGVucm9sbGVkIG1vZGUgaGFzIG5vIFpLIGZhY3Rvci4AAAAAFFJlY292ZXJ5X01vZGVIYXNOb1prAAAAIgAAAD5UaGUgYWRhcHRlciByZWZ1c2VkIHRoZSBwcm9vZiAoaXRzIGBaa0FkYXB0ZXJFcnJvcmAgc2F5cyB3aHkpLgAAAAAAG1JlY292ZXJ5X1prRXZpZGVuY2VSZWplY3RlZAAAAAAjAAAAH1RoZSBwcm9vZidzIG51bGxpZmllciBpcyBzcGVudC4AAAAAF1JlY292ZXJ5X051bGxpZmllclNwZW50AAAAACQAAAA+VGhlIHN0YXRlbWVudCdzIGZyZXNobmVzcyBib3VuZCBoYXMgcGFzc2VkIG9yIHJlYWNoZXMgdG9vIGZhci4AAAAAABhSZWNvdmVyeV9FdmlkZW5jZUV4cGlyZWQAAAAlAAAAR1RoZSBzdGF0ZW1lbnQgY2Fubm90IGJlIGVuY29kZWQgKGEgbm9uLWNvbnRyYWN0IGFjY291bnQgb3IgY29udHJvbGxlcikuAAAAABlSZWNvdmVyeV9JbnZhbGlkU3RhdGVtZW50AAAAAAAAJgAAAF1SZWNvcmRlZCBhcHByb3ZhbHMgZG8gbm90IHNhdGlzZnkgdGhlIGVucm9sbGVkIGNvbmRpdGlvbiBmb3IgdGhpcyByZWNvbmZpZ3VyYXRpb24gb3IgdXBncmFkZS4AAAAAAAAYUmVjb3ZlcnlfQ29uZGl0aW9uTm90TWV0AAAAJwAAACdUaGUgYWNjb3VudCdzIGBtYXgtY2FuY2Vsc2AgaXMgdXNlZCB1cC4AAAAAGlJlY292ZXJ5X01heENhbmNlbHNSZWFjaGVkAAAAAAAoAAAAMk93bmVyIGNhbmNlbGxhdGlvbiBpcyBvbmx5IGF2YWlsYWJsZSB1bmRlciBgTG9zc2AuAAAAAAAbUmVjb3ZlcnlfT3duZXJDYW5jZWxSZWZ1c2VkAAAAACkAAABCVGhlIHJlcGxhY2VtZW50IHNldCBicmVha3MgYSDCpzcuMyBydWxlLCBvciBkZXJpdmF0aW9uIHJlZnVzZWQgaXQuAAAAAAAcUmVjb3ZlcnlfSW52YWxpZFJlcGxhY2VtZW50cwAAACoAAAA6VGhlIHRhcmdldCBvciBhIHJlcGxhY2VtZW50IGNvbnRhaW5zIGEgcmV2b2tlZCBjcmVkZW50aWFsLgAAAAAAGlJlY292ZXJ5X0NyZWRlbnRpYWxSZXZva2VkAAAAAAArAAAAOlRoZSBaSyBlbnJvbGxtZW50IGlkIHdhcyBlbnJvbGxlZCBmb3IgdGhpcyBhY2NvdW50IGJlZm9yZS4AAAAAABtSZWNvdmVyeV9FbnJvbGxtZW50SWRSZXVzZWQAAAAALAAAAC5Db21wcm9taXNlIHJlY292ZXJ5IHdpdGggbm8gYmFzZWxpbmUgZW5yb2xsZWQuAAAAAAATUmVjb3ZlcnlfTm9CYXNlbGluZQAAAAAtAAAAQENvbXByb21pc2UgcmVjb3ZlcnkgYmVmb3JlIHRoZSBiYXNlbGluZSdzIGNvbnRlbnQgd2FzIHB1Ymxpc2hlZC4AAAAdUmVjb3ZlcnlfQmFzZWxpbmVOb3RQdWJsaXNoZWQAAAAAAAAuAAAAPlRoZSBwdWJsaXNoZWQgZG9jdW1lbnQgZG9lcyBub3QgaGFzaCB0byB0aGUgZW5yb2xsZWQgYmFzZWxpbmUuAAAAAAAZUmVjb3ZlcnlfQmFzZWxpbmVNaXNtYXRjaAAAAAAAAC8AAABTVGhlIGFkYXB0ZXIncyBjaXJjdWl0IGlkIG9yIHRyZWUgZGVwdGggZG9lcyBub3QgbWF0Y2ggdGhlIGVucm9sbGVkIGZhY3RvciBhbmQgcG9vbC4AAAAAGVJlY292ZXJ5X1prV2lyaW5nTWlzbWF0Y2gAAAAAAAAwAAAAMlRoZSBaSyBmYWN0b3IgY2hhbmdlZCB3aXRob3V0IGEgbmV3IGVucm9sbG1lbnQgaWQuAAAAAAAfUmVjb3ZlcnlfWmtGYWN0b3JDaGFuZ2VkSW5QbGFjZQAAAAAxAAAAH1RoZSBjb25maWd1cmF0aW9uIGlzIG1hbGZvcm1lZC4AAAAAHVJlY292ZXJ5X0ludmFsaWRDb25maWd1cmF0aW9uAAAAAAAAMgAAADFBbiB1cGdyYWRlIHJlcXVlc3QgcmVjb3JkZWQgdW5kZXIgYW4gb2xkZXIgZXBvY2guAAAAAAAAFVJlY292ZXJ5X1N0YWxlVXBncmFkZQAAAAAAADMAAAAvQSBsZWRnZXItc2VxdWVuY2UgY29tcHV0YXRpb24gb3ZlcmZsb3dlZCBgdTMyYC4AAAAAF1JlY292ZXJ5X0xlZGdlck92ZXJmbG93AAAAADQAAAA5QSBob29rIHdhcyBjYWxsZWQgZm9yIGEgcmVjb3ZlcnkgcnVsZSBvZiB0aGUgd3Jvbmcgc2hhcGUuAAAAAAAAHVJlY292ZXJ5X01hbGZvcm1lZENvbnRleHRSdWxlAAAAAAAANQAAADtUaGUgdGFyZ2V0IGtlZXBzIGEgY3JlZGVudGlhbCB0aGUgcmVwbGFjZW1lbnQgc2V0IHJlcGxhY2VzLgAAAAAjUmVjb3ZlcnlfUmVwbGFjZWRDcmVkZW50aWFsUmV0YWluZWQAAAAANgAAADhUaGUgYWNjb3VudCBpcyBub3QgYXQgYGFwcGx5X2RvY2AncyBgZXhwZWN0ZWRfcmV2aXNpb25gLgAAAA1TdGFsZVJldmlzaW9uAAAAAAAANwAAADlBIGNvbXBsZXRlZCByZWNvdmVyeSB3b3VsZCBvdmVyZmxvdyB0aGUgZ3JhbnQgZ2VuZXJhdGlvbi4AAAAAAAATR2VuZXJhdGlvbkV4aGF1c3RlZAAAAAA4AAAAnUEgZ3JhbnQgZG9jdW1lbnQgaGFzIGEgYHJlY292ZXJ5YCBtZW1iZXIsIGEgc2VsZi1hZG1pbiBydWxlLCBhIHJ1bGUgb24gdGhlIGFjY291bnQgb3IgaXRzIHJlY292ZXJ5IGNvbnRyYWN0cywgYSBndWFyZGlhbiBhcHByb3ZhbCwgb3IgYSB0b2tlbi1hZG1pbiBmdW5jdGlvbi4AAAAAAAAPR3JhbnRFc2NhbGF0aW9uAAAAADkAAAAkTm8gZ3JhbnQgZG9jdW1lbnQgaGFzIHRoaXMgZ3JhbnQgaWQuAAAADFVua25vd25HcmFudAAAADoAAAA9YGdjX2dyYW50YCB3YXMgZ2l2ZW4gYSBsaXZlIGdyYW50OyBgcmVtb3ZlX2dyYW50YCByZW1vdmVzIGl0LgAAAAAAAAlHcmFudExpdmUAAAAAAAA7AAAAQlRoZSBkb2N1bWVudCBuYW1lcyBhIGNyZWRlbnRpYWwgZnJvbSBhIGdyYW50IGEgcmVjb3ZlcnkgaGFzIHdpcGVkLgAAAAAAD1dpcGVkQ3JlZGVudGlhbAAAAAA8AAAAXlRoZSBjb21waWxlZCBkb2N1bWVudCdzIG1vZGVsIGlzIG1pc3NpbmcsIGR1cGxpY2F0ZWQsIHVucmVhZGFibGUsIG9yIGRvZXMgbm90IG1hdGNoIGl0cyBydWxlcy4AAAAAAAxNb2RlbEludmFsaWQAAAA9AAAAP0EgcnVsZSBvdGhlciB0aGFuIHRoZSByZWNvdmVyeSBydWxlIGFza3MgZm9yIG5vIHNpZ25lciAoSU5WLTEpLgAAAAANVW5ndWFyZGVkUnVsZQAAAAAAAD4AAABGQSBncmFudCBkb2N1bWVudCBpcyBub3QgaW4gbm9ybWFsIGZvcm0sIG9yIGhhcyBhIHJ1bGUgYWxyZWFkeSBleHBpcmVkLgAAAAAADU5vdE5vcm1hbEZvcm0AAAAAAAA/AAAATEEgY29uc3RydWN0b3IgYWRtaW4gc2lnbmVyJ3MgdmVyaWZpZXIgaXMgbm90IG9uZSBgcGVyY2gvdmVyaWZpZXJzYCBkZXBsb3llZC4AAAASVW52ZXJpZmllZFZlcmlmaWVyAAAAAABAAAAAG0Nyb3NzLWNvbnRyYWN0IGNhbGwgYWJvcnRlZAAAAAAHQWJvcnRlZAAAAAAAAAAAJlVua25vd24gZXJyb3IgZnJvbSBjcm9zcy1jb250cmFjdCBjYWxsAAAAAAAMVW5rbm93bkVycm9yf////w==",
        "AAAABQAAADhFbWl0dGVkIHdoZW4gYSByZWNvdmVyeSBjb21wbGV0aW9uIHJldm9rZXMgYSBjcmVkZW50aWFsLgAAAAAAAAARQ3JlZGVudGlhbFJldm9rZWQAAAAAAAABAAAAEmNyZWRlbnRpYWxfcmV2b2tlZAAAAAAAAQAAAAAAAAALZmluZ2VycHJpbnQAAAAD7gAAACAAAAABAAAAAg==",
        "AAAAAQAAAEdDb25zdGFudHMgb2YgdGhpcyB3YXNtIGEgd2FsbGV0IGNoZWNrcyBiZWZvcmUgYnVpbGRpbmcgZm9yIHRoZSBhY2NvdW50LgAAAAAAAAAAE0FjY291bnRDYXBhYmlsaXRpZXMAAAAABQAAAD1gb25lX3R4YCAoYWNjb3VudCBkb2N1bWVudCkgYW5kIGBncmFudF92MWAgKGdyYW50IGRvY3VtZW50cykuAAAAAAAAC2FwcGx5X21vZGVzAAAAA+oAAAARAAAAQFdoYXQgc2lnbmVycyBzaWduOiBgYWRkcl9vel92MWAsIGJvdW5kIHRvIHRoZSBhY2NvdW50J3MgYWRkcmVzcy4AAAALYXV0aF9kaWdlc3QAAAAAEQAAACdIb3cgYGRvY19oYXNoYCBpcyBjb21wdXRlZDogYGNhbm9uX3YxYC4AAAAADGRvY19pZGVudGl0eQAAABEAAAAWVGhlIGludGVyZmFjZSB2ZXJzaW9uLgAAAAAAEWludGVyZmFjZV92ZXJzaW9uAAAAAAAABAAAACpUaGUgYEFjY291bnRDb25maWd1cmF0aW9uYCBsYXlvdXQgdmVyc2lvbi4AAAAAABBzbmFwc2hvdF92ZXJzaW9uAAAABA==",
        "AAAAAQAAAFJXaGF0IHJ1bGUgc2VsZWN0aW9uIGFuZCBzaWduaW5nIG5lZWQgZm9yIHRoZSBhY2NvdW50IGRvY3VtZW50LCByZWFkIGF0IG9uZQpsZWRnZXIuAAAAAAAAAAAAFEFjY291bnRDb25maWd1cmF0aW9uAAAACAAAACpUaGUgYXBwbGllZCBkb2N1bWVudCdzIGBkb2NfaGFzaGAsIGlmIGFueS4AAAAAAAhkb2NfaGFzaAAAA+gAAAPuAAAAIAAAACxUaGUgYFByb3RlY3RlZGAgZnJlZXplOiB6ZXJvIG9yIG9uZSBlbnRyaWVzLgAAAARnYXRlAAAD6gAAB9AAAAAKRnJlZXplR2F0ZQAAAAAAIlRoZSBzaGFyZWQgaW5mcmEgdGhlIGFjY291bnQgcGlucy4AAAAAAAVpbmZyYQAAAAAAB9AAAAAJSW5mcmFQaW5zAAAAAAAAKFRoZSBhZG9wdGVkIHJlY292ZXJ5IGNvbnRyb2xsZXIsIGlmIGFueS4AAAATcmVjb3ZlcnlfY29udHJvbGxlcgAAAAPoAAAAEwAAABhUaGUgcmVjb3ZlcnkgZ2VuZXJhdGlvbi4AAAATcmVjb3ZlcnlfZ2VuZXJhdGlvbgAAAAAGAAAAJVRoZSByZWNvdmVyeSBydWxlJ3MgaWQsIGlmIGluc3RhbGxlZC4AAAAAAAANcmVjb3ZlcnlfcnVsZQAAAAAAA+gAAAAEAAAAKlRoZSByZXZpc2lvbiBldmVyeSBvdGhlciBmaWVsZCBiZWxvbmdzIHRvLgAAAAAACHJldmlzaW9uAAAABgAAADBFdmVyeSBpbnN0YWxsZWQgYWRtaW4gY29udGV4dCBydWxlLCB3aXRoIGl0cyBpZC4AAAAFcnVsZXMAAAAAAAPqAAAH0AAAAA1JbnN0YWxsZWRSdWxlAAAA",
        "AAAAAQAAAC1PbmUgY29udGV4dCBydWxlIGFzIHRoZSBhY2NvdW50IGluc3RhbGxlZCBpdC4AAAAAAAAAAAAADUluc3RhbGxlZFJ1bGUAAAAAAAAIAAAAQUV4YWN0IHJvb3Qgb2YgdGhpcyBhY2NvdW50J3MgYXV0aG9yaXphdGlvbiBlbnRyeSwgaWYgY29uc3RyYWluZWQuAAAAAAAACWF1dGhfcm9vdAAAAAAAA+gAAAPqAAAH0AAAAA5TdG9yZWRBdXRoUm9vdAAAAAAAKlRoZSBjb250cmFjdCB0aGUgcnVsZSBhdXRob3JpemVzIGNhbGxzIHRvLgAAAAAADGNvbnRleHRfdHlwZQAAB9AAAAAPQ29udGV4dFJ1bGVUeXBlAAAAAAxUaGUgcnVsZSBpZC4AAAACaWQAAAAAAAQAAAAQVGhlIHJ1bGUncyBuYW1lLgAAAARuYW1lAAAAEAAAACJUaGUgcG9saWNpZXMgYXR0YWNoZWQgdG8gdGhlIHJ1bGUuAAAAAAAIcG9saWNpZXMAAAPqAAAH0AAAAA9JbnN0YWxsZWRQb2xpY3kAAAAALldoZXRoZXIgdGhpcyBpcyB0aGUgemVyby1zaWduZXIgcmVjb3ZlcnkgcnVsZS4AAAAAAAhyZWNvdmVyeQAAAAEAAAATVGhlIHJ1bGUncyBzaWduZXJzLgAAAAAHc2lnbmVycwAAAAPqAAAH0AAAAAZTaWduZXIAAAAAACxUaGUgaW5jbHVzaXZlIGxhc3QgdmFsaWQgbGVkZ2VyLCBpZiBib3VuZGVkLgAAAAt2YWxpZF91bnRpbAAAAAPoAAAABA==",
        "AAAAAQAAAClPbmUgcG9saWN5IGF0dGFjaGVkIHRvIGFuIGluc3RhbGxlZCBydWxlLgAAAAAAAAAAAAAPSW5zdGFsbGVkUG9saWN5AAAAAAIAAAAoYHNoYTI1NmAgb2YgdGhlIGluc3RhbGwgcGFyYW1ldGVycycgWERSLgAAAAZwYXJhbXMAAAAAA+4AAAAgAAAAFFRoZSBwb2xpY3kgY29udHJhY3QuAAAABnBvbGljeQAAAAAAEw==",
        "AAAAAgAAAF9Db250cmFjdCBleGVjdXRhYmxlIHVzZWQgZm9yIGNyZWF0aW5nIGEgbmV3IGNvbnRyYWN0IGFuZCB1c2VkIGluCmBDcmVhdGVDb250cmFjdEhvc3RGbkNvbnRleHRgLgAAAAAAAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAgAAAAEAAAB4RXhlY3V0YWJsZSBzcGVjaWZpZWQgYnkgdGhlIGNvbnRyYWN0IGluc3RhbmNlIGFzIGEgc3BlY2lmaWMgV2FzbSBjb250cmFjdCBjb2RlIGVudHJ5IGlkZW50aWZpZWQgYnkgaXRzIFdhc20gc2hhMjU2IGhhc2guAAAABFdhc20AAAABAAAD7gAAACAAAAABAAAAX0V4ZWN1dGFibGUgcmVmZXJlbmNlIHZpYSBhIHBlcnNpc3RlbnQgc3RvcmFnZSBlbnRyeSBvd25lZCBieSB0aGlzIGNvbnRyYWN0IG9yIGFub3RoZXIgY29udHJhY3QuAAAAAAtFeHRlcm5hbFJlZgAAAAABAAAH0AAAABVDb250cmFjdEV4ZWN1dGFibGVSZWYAAAA=",
        "AAAAAQAAAMBFeGVjdXRhYmxlIHJlZmVyZW5jZWQgdmlhIGEgcGVyc2lzdGVudCBzdG9yYWdlIGVudHJ5IG93bmVkIGJ5IGEgY29udHJhY3QsCmVpdGhlciB0aGlzIGNvbnRyYWN0IG9yIGFub3RoZXIgY29udHJhY3QuCgpUaGUgcGVyc2lzdGVudCBzdG9yYWdlIGVudHJ5IG93bmVkIGJ5IHRoZSBgb3duZXJgIGhhcyB0aGUgYHRhZ2AgYXMgaXRzIGtleS4AAAAAAAAAFUNvbnRyYWN0RXhlY3V0YWJsZVJlZgAAAAAAAAIAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAADdGFnAAAAABA=",
        "AAAAAgAAAONDb250ZXh0IG9mIGEgc2luZ2xlIGF1dGhvcml6ZWQgY2FsbCBwZXJmb3JtZWQgYnkgYW4gYWRkcmVzcy4KCkN1c3RvbSBhY2NvdW50IGNvbnRyYWN0cyB0aGF0IGltcGxlbWVudCBgX19jaGVja19hdXRoYCBzcGVjaWFsIGZ1bmN0aW9uCnJlY2VpdmUgYSBsaXN0IG9mIGBDb250ZXh0YCB2YWx1ZXMgY29ycmVzcG9uZGluZyB0byBhbGwgdGhlIGNhbGxzIHRoYXQKbmVlZCB0byBiZSBhdXRob3JpemVkLgAAAAAAAAAAB0NvbnRleHQAAAAAAwAAAAEAAAAUQ29udHJhY3QgaW52b2NhdGlvbi4AAAAIQ29udHJhY3QAAAABAAAH0AAAAA9Db250cmFjdENvbnRleHQAAAAAAQAAAD1Db250cmFjdCB0aGF0IGhhcyBhIGNvbnN0cnVjdG9yIHdpdGggbm8gYXJndW1lbnRzIGlzIGNyZWF0ZWQuAAAAAAAAFENyZWF0ZUNvbnRyYWN0SG9zdEZuAAAAAQAAB9AAAAAbQ3JlYXRlQ29udHJhY3RIb3N0Rm5Db250ZXh0AAAAAAEAAABEQ29udHJhY3QgdGhhdCBoYXMgYSBjb25zdHJ1Y3RvciB3aXRoIDEgb3IgbW9yZSBhcmd1bWVudHMgaXMgY3JlYXRlZC4AAAAcQ3JlYXRlQ29udHJhY3RXaXRoQ3Rvckhvc3RGbgAAAAEAAAfQAAAAKkNyZWF0ZUNvbnRyYWN0V2l0aENvbnN0cnVjdG9ySG9zdEZuQ29udGV4dAAA",
        "AAAAAQAAAL1BdXRob3JpemF0aW9uIGNvbnRleHQgb2YgYSBzaW5nbGUgY29udHJhY3QgY2FsbC4KClRoaXMgc3RydWN0IGNvcnJlc3BvbmRzIHRvIGEgYHJlcXVpcmVfYXV0aF9mb3JfYXJnc2AgY2FsbCBmb3IgYW4gYWRkcmVzcwpmcm9tIGBjb250cmFjdGAgZnVuY3Rpb24gd2l0aCBgZm5fbmFtZWAgbmFtZSBhbmQgYGFyZ3NgIGFyZ3VtZW50cy4AAAAAAAAAAAAAD0NvbnRyYWN0Q29udGV4dAAAAAADAAAAAAAAAARhcmdzAAAD6gAAAAAAAAAAAAAACGNvbnRyYWN0AAAAEwAAAAAAAAAHZm5fbmFtZQAAAAAR",
        "AAAAAQAAAHZBdXRob3JpemF0aW9uIGNvbnRleHQgZm9yIGBjcmVhdGVfY29udHJhY3RgIGhvc3QgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEKbmV3IGNvbnRyYWN0IG9uIGJlaGFsZiBvZiBhdXRob3JpemVyIGFkZHJlc3MuAAAAAAAAAAAAG0NyZWF0ZUNvbnRyYWN0SG9zdEZuQ29udGV4dAAAAAACAAAAAAAAAApleGVjdXRhYmxlAAAAAAfQAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAAAAAARzYWx0AAAD7gAAACA=",
        "AAAAAQAAANZBdXRob3JpemF0aW9uIGNvbnRleHQgZm9yIGBjcmVhdGVfY29udHJhY3RgIGhvc3QgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEKbmV3IGNvbnRyYWN0IG9uIGJlaGFsZiBvZiBhdXRob3JpemVyIGFkZHJlc3MuClRoaXMgaXMgdGhlIHNhbWUgYXMgYENyZWF0ZUNvbnRyYWN0SG9zdEZuQ29udGV4dGAsIGJ1dCBhbHNvIGhhcwpjb250cmFjdCBjb25zdHJ1Y3RvciBhcmd1bWVudHMuAAAAAAAAAAAAKkNyZWF0ZUNvbnRyYWN0V2l0aENvbnN0cnVjdG9ySG9zdEZuQ29udGV4dAAAAAAAAwAAAAAAAAAQY29uc3RydWN0b3JfYXJncwAAA+oAAAAAAAAAAAAAAApleGVjdXRhYmxlAAAAAAfQAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAAAAAARzYWx0AAAD7gAAACA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    grant: this.txFromJSON<Option<GrantRecord>>,
        infra: this.txFromJSON<InfraPins>,
        renew: this.txFromJSON<null>,
        grants: this.txFromJSON<Array<u32>>,
        execute: this.txFromJSON<Result<any>>,
        document: this.txFromJSON<readonly [u64, Option<Buffer>]>,
        gc_grant: this.txFromJSON<Result<void>>,
        rcv_gate: this.txFromJSON<Result<void>>,
        revision: this.txFromJSON<u64>,
        rule_set: this.txFromJSON<Array<StoredRule>>,
        apply_doc: this.txFromJSON<Result<Buffer>>,
        is_revoked: this.txFromJSON<boolean>,
        applied_doc: this.txFromJSON<Option<Buffer>>,
        apply_grant: this.txFromJSON<Result<Buffer>>,
        grant_count: this.txFromJSON<u32>,
        capabilities: this.txFromJSON<AccountCapabilities>,
        doc_compiler: this.txFromJSON<string>,
        remove_grant: this.txFromJSON<Result<void>>,
        configuration: this.txFromJSON<AccountConfiguration>,
        recovery_gate: this.txFromJSON<Option<FreezeGate>>,
        cancel_upgrade: this.txFromJSON<Result<void>>,
        grant_rule_set: this.txFromJSON<Array<StoredRule>>,
        is_enrolled_id: this.txFromJSON<boolean>,
        cancel_recovery: this.txFromJSON<Result<void>>,
        execute_upgrade: this.txFromJSON<Result<void>>,
        installed_rules: this.txFromJSON<Array<InstalledRule>>,
        pending_upgrade: this.txFromJSON<Option<UpgradeRequest>>,
        applied_doc_hash: this.txFromJSON<Option<Buffer>>,
        get_context_rule: this.txFromJSON<ContextRule>,
        grant_generation: this.txFromJSON<u64>,
        grant_signer_ids: this.txFromJSON<Option<Array<string>>>,
        schedule_upgrade: this.txFromJSON<Result<u64>>,
        recovery_controller: this.txFromJSON<Option<string>>,
        recovery_generation: this.txFromJSON<u64>,
        grant_verifier_names: this.txFromJSON<Option<Array<string>>>,
        credential_generation: this.txFromJSON<Option<u64>>,
        get_context_rules_count: this.txFromJSON<u32>,
        next_upgrade_request_id: this.txFromJSON<u64>
  }
}