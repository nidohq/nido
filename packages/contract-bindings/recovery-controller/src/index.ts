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




export type Key = {tag: "Config", values: readonly [string]} | {tag: "RevokedCredentials", values: readonly [string]} | {tag: "Attempt", values: readonly [string]} | {tag: "NextAttemptId", values: readonly [string]} | {tag: "CancelsUsed", values: readonly [string]} | {tag: "CancelTally", values: readonly [string, u64]} | {tag: "Nullifier", values: readonly [Buffer]} | {tag: "Installed", values: readonly [string]} | {tag: "CompletionGrant", values: readonly [string]};

export const Errors = {
  1: {message:"AlreadyEnrolled"},
  2: {message:"NotEnrolled"},
  /**
   * `enroll`: `GuardianOnly` mode must not set `verifier`/`zk_pool`, or
   * `ZkOnly`/`Combined` must set them and `ZkOnly` must NOT set
   * `guardians` — the follow-up.md §5.2 HARD mode/machinery match.
   */
  3: {message:"ModeConfigMismatch"},
  /**
   * `enroll`: `threshold` is 0 or exceeds `guardians.len()`.
   */
  4: {message:"InvalidThreshold"},
  /**
   * `enroll`: `pending_activity_policy` is the unimplemented `Restrict`
   * placeholder (follow-up.md §7 — no default; this is not a default, it
   * is a refusal).
   */
  5: {message:"UnresolvedPolicyBranch"},
  /**
   * `begin_attempt`: a live (non-terminal, non-expired) attempt already
   * exists — Stage 1 spec's "no silent supersede".
   */
  6: {message:"AttemptAlreadyActive"},
  /**
   * `begin_attempt`: `Compromise` action's `source_or_baseline_hash` did
   * not equal `config.baseline_doc_hash`.
   */
  7: {message:"BaselineMismatch"},
  /**
   * `begin_attempt`: a declared `replaced_credential_id` is already in
   * `RevokedCredentials` — reviving a credential a prior recovery removed
   * (property 10).
   */
  8: {message:"RevokedCredentialRevived"},
  /**
   * `submit_guardian_approval`/`submit_zk_proof` (and their `_cancel`
   * counterparts): the account's mode does not include this factor.
   */
  9: {message:"ModeMismatch"},
  /**
   * No live attempt with this id in the expected state.
   */
  10: {message:"NoSuchAttempt"},
  /**
   * `submit_guardian_approval`: caller is not in the enrolled guardian
   * set.
   */
  11: {message:"NotAGuardian"},
  /**
   * `submit_guardian_approval`: this guardian already approved this
   * attempt/cancellation.
   */
  12: {message:"DuplicateApproval"},
  /**
   * `submit_zk_proof`/cancel: the submitted Merkle root is not a known
   * historical root of the enrolled pool.
   */
  13: {message:"UnknownRoot"},
  /**
   * `submit_zk_proof`/cancel: nullifier already `Spent`, or `Reserved` by
   * a DIFFERENT account/attempt.
   */
  14: {message:"NullifierUnavailable"},
  /**
   * `submit_zk_proof`/cancel: the verifier rejected the proof.
   */
  15: {message:"VerificationFailed"},
  /**
   * `cancel_*`: no live attempt to cancel.
   */
  16: {message:"NoPending"},
  /**
   * `cancel_*`: `max_cancels` already reached for this account (mirrors
   * `nido-zk-recovery`'s cancel cap — bounds griefing via repeated
   * initiate/cancel).
   */
  17: {message:"CancelCapReached"},
  /**
   * `Policy::enforce`: wrong `fn_name`/arg-shape, or submitted doc's hash
   * doesn't match the attempt's committed `target_doc_hash`.
   */
  18: {message:"ContextMismatch"},
  19: {message:"RuleMismatch"},
  20: {message:"NotInstalled"},
  21: {message:"AlreadyInstalled"},
  /**
   * `uninstall` always refuses — see `lib.rs`'s doc comment (same
   * reentrancy argument as `nido-zk-recovery`/`nido-recovery-doc-completion`).
   */
  22: {message:"Unauthorized"},
  23: {message:"TimelockNotElapsed"},
  24: {message:"RecoveryExpired"}
}


/**
 * A single recovery attempt's full lifecycle record (§6's reference model:
 * `collecting-evidence -> authorized-pending -> {completed, cancelled}`;
 * "expired" is a DERIVED predicate, not a stored state — see `lib.rs
 * ::is_live`, mirroring `TRANSITION_SPEC.md`'s "readiness may be derived
 * from time rather than stored as another state").
 */
export interface Attempt {
  action: RecoveryAction;
  commitment: ProposalCommitment;
  created_at: u64;
  executable_after: Option<u64>;
  expires_at: Option<u64>;
  guardian_approvals: Array<string>;
  id: u64;
  /**
 * Credential ids the target document replaces (client-declared — see
 * the crate doc comment's "Known limits" on why this is a declared
 * bookkeeping input, not an on-chain-verified doc diff).
 */
replaced_credential_ids: Array<Buffer>;
  state: AttemptState;
  zk_nullifier: Option<Buffer>;
  zk_verified: boolean;
}

/**
 * Follow-up.md §2.1: routine recovery-CONFIGURATION change authority (not
 * modeled by this experiment — no `reconfigure` entry point exists, see the
 * crate doc comment's "Known limits" — this field is retained on
 * `RecoveryConfig` because it is part of the account's reviewable
 * commitment even though this experiment fixes it at enrollment).
 */
export type Profile = {tag: "Loss", values: void} | {tag: "Protected", values: void};

/**
 * Which evidence factor(s) an account's recovery requires. Follow-up.md
 * §5.2's HARD requirement: `GuardianOnly` must not require ANY ZK
 * machinery — no secret, no Merkle witness, no proof. Enforced at `enroll`
 * (see `lib.rs`), not just documented here.
 */
export type AuthMode = {tag: "GuardianOnly", values: void} | {tag: "ZkOnly", values: void} | {tag: "Combined", values: void};


/**
 * Per-attempt cancellation-evidence tally (follow-up.md §2.2: cancellation
 * is its OWN action domain, bound to the specific attempt it cancels — a
 * distinct commitment from initiation, distinct storage, no shared state
 * with `Attempt::guardian_approvals`/`zk_verified` above).
 */
export interface CancelTally {
  guardian_approvals: Array<string>;
  zk_verified: boolean;
}

export type AttemptState = {tag: "CollectingEvidence", values: void} | {tag: "AuthorizedPending", values: void} | {tag: "Completed", values: void} | {tag: "Cancelled", values: void};

/**
 * Global (not per-account) ZK nullifier lifecycle — mirrors
 * `nido-zk-recovery`'s `NullifierState`. A nullifier reserved by one
 * account's attempt cannot be reserved by another's.
 */
export type NullifierState = {tag: "Reserved", values: readonly [string]} | {tag: "Spent", values: void};

/**
 * Which target-document construction rule an attempt uses
 * (`docs/recovery/TRANSITION_SPEC.md`, follow-up.md §4.2). Encoded as the
 * circuit/commitment's numeric `action` too — see `lib.rs::action_code`.
 */
export type RecoveryAction = {tag: "LostKey", values: void} | {tag: "Compromise", values: void};


/**
 * Immutable-after-enrollment recovery configuration for one account
 * (follow-up.md §5.5: the reviewable recovery-configuration commitment —
 * mode, profile, guardian identities/quorum, verifier identity, baseline
 * commitment). NOT embedded in the account's own Perch policy document —
 * this experiment keeps recovery configuration entirely in this
 * controller's storage, so an account's document canonical bytes are
 * UNCHANGED by enrolling in recovery (see `lib.rs` tests
 * `enrolling_does_not_touch_the_account_doc`).
 * 
 * No `reconfigure`/baseline-update entry point exists in this experiment —
 * see the crate doc comment's "Known limits". `version` therefore only ever
 * reads `1` today, but is a real `u32` field (not a constant) so a future
 * `reconfigure` can bump it without an ABI change, and so the
 * `ProposalCommitment.config_version` / circuit `cfg_version` fields have a
 * real value to bind rather than a placeholder.
 */
export interface RecoveryConfig {
  /**
 * The approved baseline document's canonical hash (follow-up.md §4.1).
 * `Compromise` attempts MUST target `baseline_doc_hash` plus
 * replacements — never the live document — enforced at `begin_attempt`.
 */
baseline_doc_hash: Buffer;
  delay_secs: u64;
  expiry_secs: u64;
  guardian_threshold: u32;
  /**
 * Non-empty (with `guardian_threshold` in `1..=guardians.len()`) for
 * `GuardianOnly`/`Combined`; MUST be empty for `ZkOnly`. Flattened from
 * a [`GuardianSet`] rather than storing `Option<GuardianSet>` directly
 * — see that type's doc comment for why.
 */
guardians: Array<string>;
  max_cancels: u32;
  mode: AuthMode;
  /**
 * Raw network passphrase bytes (this contract sha256's it internally,
 * mirroring `nido_zk_recovery::hash::compute_auth_hash`'s own
 * convention) — part of the §5.3 "network identity" commitment field.
 */
network_passphrase: Buffer;
  pending_activity_policy: PendingActivityPolicy;
  profile: Profile;
  /**
 * The `nido-recovery-verifier` (constructorless, VK-baked-in) instance
 * this account's ZK evidence must verify against. Required for
 * `ZkOnly`/`Combined`; MUST be absent for `GuardianOnly` (the HARD "no
 * ZK machinery" requirement — see `AuthMode::GuardianOnly`'s doc).
 */
verifier: Option<string>;
  version: u32;
  /**
 * The `nido-zk-recovery` Merkle pool this account's enrollment secret
 * was inserted into (`ZkRecoveryClient::insert_for`, called by the
 * CLIENT at enrollment, not by this contract). Required iff `verifier`
 * is.
 */
zk_pool: Option<string>;
}

/**
 * The action tag baked into a `ProposalCommitment` (follow-up.md §5.3) and,
 * for ZK evidence, into the circuit's `auth_hash` (via
 * `nido_zk_recovery::hash::compute_auth_hash`'s `action` parameter) — this
 * is cancellation-domain separation (follow-up.md §2.2): a `Cancel`
 * commitment is structurally and cryptographically distinct from the
 * `LostKey`/`Compromise` commitment it targets, so initiation evidence can
 * never double as cancellation evidence.
 */
export type CommitmentAction = {tag: "LostKey", values: void} | {tag: "Compromise", values: void} | {tag: "Cancel", values: void};




/**
 * Follow-up.md §5.3's exact proposal-commitment field list. `network` is
 * `sha256(config.network_passphrase)` (32 bytes) rather than the raw
 * passphrase, matching the circuit's `npass_hi/lo` convention.
 * `baseline_or_source_id` is `config.baseline_doc_hash` for `Compromise`,
 * or the caller-supplied live-doc snapshot hash for `LostKey` (§4.2:
 * "current means a defined source snapshot" — captured once, at
 * `begin_attempt`, never recomputed).
 */
export interface ProposalCommitment {
  account: string;
  action: CommitmentAction;
  attempt_id: u64;
  baseline_or_source_id: Buffer;
  config_version: u32;
  controller_id: string;
  delay_secs: u64;
  network: Buffer;
  target_doc_hash: Buffer;
}



/**
 * Follow-up.md §7 — deliberately deferred, NO default. Mirrors
 * `TRANSITION_SPEC.md`'s three-way `pendingActivityPolicy` enum exactly
 * (including the symbolic, deliberately-unimplemented third branch) so the
 * "no default" property is a real, testable refusal rather than a type that
 * simply omits the unresolved option. `Freeze`/`Continue` are real and
 * tested; `Restrict` is accepted by the TYPE but REJECTED by `enroll`
 * (`Error::UnresolvedPolicyBranch`) — an account can be offered the choice
 * and see it explicitly refused, exactly like
 * `packages/recovery-spec/src/model.ts`'s `restrict`/`other` branches
 * throwing `UNRESOLVED_POLICY_BRANCH` with no `default:` case. See the
 * crate doc comment's "Known limits" for what `TRANSITION_SPEC.md`'s
 * separate `policyWriteConflictPolicy` axis (`invalidate-attempt` vs
 * `block`) would add on top of this — not implemented here.
 */
export type PendingActivityPolicy = {tag: "Freeze", values: void} | {tag: "Continue", values: void} | {tag: "Restrict", values: void};


/**
 * Install parameters for this `Policy` — structurally identical to
 * `nido-recovery-doc-completion::DocRecoveryInstallParams` /
 * `nido-zk-recovery::ZkRecoveryInstallParams` (`{ version: u32 }`), so the
 * account's existing constructor/`enroll_zk_recovery` install path decodes
 * into this type unchanged (see that crate's doc comment for why —
 * `#[contracttype]` structs encode structurally, not nominally).
 */
export interface RecoveryInstallParams {
  version: u32;
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
 * Contract executable used for creating a new contract and used in
 * `CreateContractHostFnContext`.
 */
export type ContractExecutable = {tag: "Wasm", values: readonly [Buffer]};


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
 * Combines policy data and its reference count into a single storage entry.
 */
export interface PolicyEntry {
  /**
 * Number of context rules referencing this policy.
 */
count: u32;
  /**
 * The policy address stored in the global registry.
 */
policy: string;
}


/**
 * Combines signer data and its reference count into a single storage entry.
 */
export interface SignerEntry {
  /**
 * Number of context rules referencing this signer.
 */
count: u32;
  /**
 * The signer stored in the global registry.
 */
signer: Signer;
}

/**
 * Types of contexts that can be authorized by smart account rules.
 */
export type ContextRuleType = {tag: "Default", values: void} | {tag: "CallContract", values: readonly [string]} | {tag: "CreateContract", values: readonly [Buffer]};


/**
 * Combines context rule metadata, signer IDs, and policy addresses into a
 * single storage entry, reducing persistent reads per auth check from 3 to 1.
 */
export interface ContextRuleEntry {
  /**
 * The type of context this rule applies to.
 */
context_type: ContextRuleType;
  /**
 * Human-readable name for the context rule.
 */
name: string;
  /**
 * Policy IDs referenced by this rule.
 */
policy_ids: Array<u32>;
  /**
 * Global signer IDs referenced by this rule.
 */
signer_ids: Array<u32>;
  /**
 * Optional expiration ledger sequence.
 */
valid_until: Option<u32>;
}

/**
 * Storage keys for smart account data.
 */
export type SmartAccountStorageKey = {tag: "ContextRuleData", values: readonly [u32]} | {tag: "NextId", values: void} | {tag: "Count", values: void} | {tag: "SignerData", values: readonly [u32]} | {tag: "SignerLookup", values: readonly [Buffer]} | {tag: "NextSignerId", values: void} | {tag: "PolicyData", values: readonly [u32]} | {tag: "PolicyLookup", values: readonly [string]} | {tag: "NextPolicyId", values: void};


/**
 * Individual spending entry for tracking purposes.
 */
export interface SpendingEntry {
  /**
 * The amount spent in this transaction.
 */
amount: i128;
  /**
 * The ledger sequence when this transaction occurred.
 */
ledger_sequence: u32;
}


/**
 * Internal storage structure for spending limit tracking.
 */
export interface SpendingLimitData {
  /**
 * Cached total of all amounts in spending_history.
 */
cached_total_spent: i128;
  /**
 * The period in ledgers over which the spending limit applies.
 */
period_ledgers: u32;
  /**
 * History of spending transactions with their ledger sequences.
 */
spending_history: Array<SpendingEntry>;
  /**
 * The spending limit for the period.
 */
spending_limit: i128;
}

/**
 * Error codes for spending limit policy operations.
 */
export const SpendingLimitError = {
  /**
   * The smart account does not have a spending limit policy installed.
   */
  3220: {message:"SmartAccountNotInstalled"},
  /**
   * The spending limit has been exceeded.
   */
  3221: {message:"SpendingLimitExceeded"},
  /**
   * The spending limit or period is invalid.
   */
  3222: {message:"InvalidLimitOrPeriod"},
  /**
   * The transaction is not allowed by this policy.
   */
  3223: {message:"NotAllowed"},
  /**
   * The spending history has reached maximum capacity.
   */
  3224: {message:"HistoryCapacityExceeded"},
  /**
   * The context rule for the smart account has been already installed.
   */
  3225: {message:"AlreadyInstalled"},
  /**
   * The transfer amount is negative.
   */
  3226: {message:"LessThanZero"},
  /**
   * Only the `CallContract` context rule type is allowed.
   */
  3227: {message:"OnlyCallContractAllowed"}
}




/**
 * Storage keys for spending limit policy data.
 */
export type SpendingLimitStorageKey = {tag: "AccountContext", values: readonly [string, u32]};



/**
 * Installation parameters for the spending limit policy.
 */
export interface SpendingLimitAccountParams {
  /**
 * The period in ledgers over which the spending limit applies.
 */
period_ledgers: u32;
  /**
 * The maximum amount that can be spent within the specified period (in
 * stroops).
 */
spending_limit: i128;
}




/**
 * Error codes for simple threshold policy operations.
 */
export const SimpleThresholdError = {
  /**
   * The smart account does not have a simple threshold policy installed.
   */
  3200: {message:"SmartAccountNotInstalled"},
  /**
   * When threshold is 0 or exceeds the number of available signers.
   */
  3201: {message:"InvalidThreshold"},
  /**
   * The transaction is not allowed by this policy.
   */
  3202: {message:"NotAllowed"},
  /**
   * The context rule for the smart account has been already installed.
   */
  3203: {message:"AlreadyInstalled"}
}


/**
 * Storage keys for simple threshold policy data.
 */
export type SimpleThresholdStorageKey = {tag: "AccountContext", values: readonly [string, u32]};


/**
 * Installation parameters for the simple threshold policy.
 */
export interface SimpleThresholdAccountParams {
  /**
 * The minimum number of signers required for authorization.
 */
threshold: u32;
}




/**
 * Error codes for weighted threshold policy operations.
 */
export const WeightedThresholdError = {
  /**
   * The smart account does not have a weighted threshold policy installed.
   */
  3210: {message:"SmartAccountNotInstalled"},
  /**
   * The threshold value is invalid.
   */
  3211: {message:"InvalidThreshold"},
  /**
   * A mathematical operation would overflow.
   */
  3212: {message:"MathOverflow"},
  /**
   * The transaction is not allowed by this policy.
   */
  3213: {message:"NotAllowed"},
  /**
   * The context rule for the smart account has been already installed.
   */
  3214: {message:"AlreadyInstalled"}
}


/**
 * Storage keys for weighted threshold policy data.
 */
export type WeightedThresholdStorageKey = {tag: "AccountContext", values: readonly [string, u32]};



/**
 * Installation parameters for the weighted threshold policy.
 */
export interface WeightedThresholdAccountParams {
  /**
 * Mapping of signers to their respective weights.
 */
signer_weights: Map<Signer, u32>;
  /**
 * The minimum total weight required for authorization.
 */
threshold: u32;
}

/**
 * Error types for WebAuthn verification operations.
 */
export const WebAuthnError = {
  /**
   * The signature payload is invalid or has incorrect format.
   */
  3110: {message:"SignaturePayloadInvalid"},
  /**
   * The client data exceeds the maximum allowed length.
   */
  3111: {message:"ClientDataTooLong"},
  /**
   * Failed to parse JSON from client data.
   */
  3112: {message:"JsonParseError"},
  /**
   * The type field in client data is not "webauthn.get".
   */
  3113: {message:"TypeFieldInvalid"},
  /**
   * The challenge in client data does not match expected value.
   */
  3114: {message:"ChallengeInvalid"},
  /**
   * The authenticator data format is invalid or too short.
   */
  3115: {message:"AuthDataFormatInvalid"},
  /**
   * The User Present (UP) bit is not set in authenticator flags.
   */
  3116: {message:"PresentBitNotSet"},
  /**
   * The User Verified (UV) bit is not set in authenticator flags.
   */
  3117: {message:"VerifiedBitNotSet"},
  /**
   * Invalid relationship between Backup Eligibility and State bits.
   */
  3118: {message:"BackupEligibilityAndStateNotSet"},
  /**
   * The provided key data does not contain a valid 65-byte public key.
   */
  3119: {message:"KeyDataInvalid"}
}


/**
 * WebAuthn signature data structure containing all components needed for
 * verification.
 * 
 * This structure encapsulates the signature and associated data generated
 * during a WebAuthn authentication ceremony.
 */
export interface WebAuthnSigData {
  /**
 * Raw authenticator data from the WebAuthn response.
 */
authenticator_data: Buffer;
  /**
 * Raw client data JSON from the WebAuthn response.
 */
client_data: Buffer;
  /**
 * The cryptographic signature (64 bytes for secp256r1).
 */
signature: Buffer;
}

export interface Client {
  /**
   * Construct and simulate a config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  config: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<RecoveryConfig>>>

  /**
   * Construct and simulate a enroll transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One-shot per account, self-authed. Validates the follow-up.md §5.2
   * HARD mode/machinery match (`GuardianOnly` MUST NOT configure any ZK
   * address; `ZkOnly` MUST NOT configure guardians; `Combined` needs
   * both), a sane guardian threshold, and refuses the unimplemented
   * `PendingActivityPolicy::Restrict` (§7 — no default; a refusal, not a
   * silent substitution).
   * 
   * No `reconfigure` entry point exists — see the crate doc comment's
   * "Known limits". This makes `RecoveryConfig` effectively immutable
   * once set, which trivially satisfies follow-up.md §4.3's "a stolen
   * admin key must not be able to refresh the baseline" property (there
   * is no refresh path AT ALL, not even a legitimate one).
   */
  enroll: ({account, config}: {account: string, config: RecoveryConfig}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a enforce transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The completion gate — Variant A only (`docs/recovery/stage2-findings.md`'s
   * recommendation). Ordered checks mirror
   * `nido-recovery-doc-completion::Policy::enforce` exactly (that
   * document's §3 call-ordering analysis applies verbatim: `enforce` runs
   * during the completing call's OWN `__check_auth`, BEFORE its body, so
   * consuming the attempt HERE is what makes `has_pending` read `false`
   * for that same call's body-time guard check, with no separate
   * completion-grant bridge needed):
   * 1. `context_rule.id` matches the id this policy was installed under.
   * 2. A live attempt exists, is `AuthorizedPending`, its timelock has
   * elapsed, and it is not expired.
   * 3. `context` is a self-call to `apply_doc` with exactly one `Bytes`
   * argument whose sha256 equals `attempt.commitment.target_doc_hash`.
   * 4. Consume: mark `Completed`, append `replaced_credential_ids` to
   * `RevokedCredentials` (property 10 bookkeeping), spend the ZK
   * nullifier if one was reserved, emit.
   */
  enforce: ({context, authenticated_signers, context_rule, smart_account}: {context: Context, authenticated_signers: Array<Signer>, context_rule: ContextRule, smart_account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a install transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Identical shape to `nido-recovery-doc-completion::Policy::install` —
   * same stolen-passkey-repoint hardening (`AlreadyInstalled` guard, see
   * that crate's doc comment for the full reentrancy argument): zero-signer,
   * `CallContract(smart_account)`-scoped rule only, one-shot per account.
   */
  install: ({install_params, context_rule, smart_account}: {install_params: RecoveryInstallParams, context_rule: ContextRule, smart_account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a revoked transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  revoked: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Buffer>>>

  /**
   * Construct and simulate a uninstall transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * UNCONDITIONALLY REFUSES — identical reentrancy-safety argument as
   * `nido-zk-recovery`/`nido-recovery-doc-completion::Policy::uninstall`
   * (see either's doc comment): from inside the account's own
   * `remove_context_rule`/`remove_policy`, no cross-call back into the
   * account can distinguish a legitimate teardown from a thief's forged
   * direct call, so both are refused; the legitimate path still succeeds
   * via OZ's `try_uninstall` panic-swallowing.
   */
  uninstall: ({context_rule, smart_account}: {context_rule: ContextRule, smart_account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a config_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * A reviewable, on-chain-computable commitment to `account`'s enrolled
   * `RecoveryConfig` — `sha256(xdr(config))`, Soroban's own `ToXdr`
   * serialization (deterministic for a given value: same `RecoveryConfig`
   * always encodes to the same bytes). This is follow-up.md §5.5's
   * "document commitment must cover all authority-bearing recovery
   * configuration" property, satisfied WITHOUT embedding recovery
   * configuration in the account's own Perch policy document — see the
   * crate doc comment's "Known limits" for exactly why that embedding is
   * blocked by the DEPLOYED, pinned `perch-doc-compiler`'s wire protocol
   * (an external dependency this experiment does not control), not by a
   * gap in this contract. `None` if `account` is not enrolled.
   */
  config_hash: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a get_attempt transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_attempt: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Attempt>>>

  /**
   * Construct and simulate a has_pending transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * View cross-called by the smart account's `guard_no_pending`
   * (`contracts/smart-account/src/contract.rs`), exactly like Stage 2's
   * `has_pending`. Governed by `config.pending_activity_policy` — see
   * `PendingActivityPolicy`'s doc for what `Freeze`/`Continue` each mean.
   * An account with NO enrollment (never called `enroll`) trivially has
   * no pending — this must not panic for an unenrolled account, since the
   * smart account cross-calls it unconditionally whenever ANY controller
   * is installed as `recovery_controller`.
   */
  has_pending: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a begin_attempt transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Opens a new recovery attempt (`TRANSITION_SPEC.md`'s `beginAttempt`).
   * PERMISSIONLESS — no `require_auth` at all: declaring intent carries
   * no authority by itself, real gating happens at evidence-driven
   * promotion (`submit_guardian_approval`/`submit_zk_proof`). Refuses
   * (`AttemptAlreadyActive`) if a LIVE attempt already exists ("no silent
   * supersede") — but if the existing attempt is stale (expired,
   * `CollectingEvidence` past its deadline, or terminal), it is replaced,
   * releasing any nullifier reservation it held first (mirrors
   * `nido-zk-recovery::initiate_recovery`'s stale-pending-supersede
   * step).
   * 
   * `action == Compromise` MUST target `config.baseline_doc_hash`
   * (`BaselineMismatch` otherwise) — follow-up.md §4.1/§4.2: compromise
   * recovery restores the approved BASELINE plus replacements, never the
   * live (possibly attacker-modified) document. `action == LostKey`
   * accepts any `source_or_baseline_hash` — the CALLER captures the live
   * document's current hash as the fixed source snapshot at this exact
   * moment (§4.2: "
   */
  begin_attempt: ({account, action, target_doc_hash, source_or_baseline_hash, replaced_credential_ids}: {account: string, action: RecoveryAction, target_doc_hash: Buffer, source_or_baseline_hash: Buffer, replaced_credential_ids: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a submit_zk_proof transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * PERMISSIONLESS caller — the proof itself is the authorization (mirrors
   * `nido-zk-recovery::initiate_recovery`: no `require_auth`, the entire
   * security property is "the proof verifies against an `auth_hash` this
   * contract recomputes from its own known state", so nothing is gained
   * by ALSO requiring a signature from whoever happens to relay the
   * proof on-chain). Recomputes `auth_hash` from `attempt.commitment`'s
   * OWN fields (never trusts a caller-supplied hash) via `zk::verify`.
   */
  submit_zk_proof: ({account, attempt_id, root, nullifier, proof}: {account: string, attempt_id: u64, root: Buffer, nullifier: Buffer, proof: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a submit_zk_cancel transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * ZK cancellation evidence — PERMISSIONLESS caller (same reasoning as
   * `submit_zk_proof`). The proof's `auth_hash` binds `action = Cancel`
   * (via `zk::action_code`), so a cancellation proof can NEVER be reused
   * as initiation evidence or vice versa — cryptographic domain
   * separation, not just a storage-layout separation.
   */
  submit_zk_cancel: ({account, attempt_id, root, nullifier, proof}: {account: string, attempt_id: u64, root: Buffer, nullifier: Buffer, proof: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a completion_granted transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * SPIKE-parity view (mirrors `nido-recovery-doc-completion`'s /
   * `nido-zk-recovery`'s identically-named view): always `false`. This
   * experiment only wires Variant A (gating the account's EXISTING
   * `apply_doc`), never the account's raw `add_context_rule` completion
   * vehicle — the smart account's guard cross-calls this unconditionally
   * whenever this controller is installed, so it must exist.
   */
  completion_granted: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a submit_guardian_cancel transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Guardian cancellation evidence (own action domain — follow-up.md
   * §2.2). Distinct storage (`CancelTally`) from initiation's
   * `Attempt::guardian_approvals`: a guardian who approved INITIATION has
   * approved nothing about CANCELLATION, and vice versa.
   */
  submit_guardian_cancel: ({account, attempt_id, guardian}: {account: string, attempt_id: u64, guardian: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a submit_guardian_approval transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `guardian` must `require_auth` (real Soroban authorization — the
   * guardian's own signature) and be a member of the enrolled
   * `GuardianSet`. A `GuardianOnly`/`Combined` account only — `ZkOnly`
   * rejects with `ModeMismatch`, since it enrolled with no guardian set
   * at all (follow-up.md §5.2's HARD "no ZK machinery for
   * `GuardianOnly`" requirement is symmetric: `ZkOnly` correspondingly
   * has no guardian machinery to accept an approval into).
   */
  submit_guardian_approval: ({account, attempt_id, guardian}: {account: string, attempt_id: u64, guardian: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
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
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAgAAAAAAAAAAAAAAA0tleQAAAAAJAAAAAQAAAAAAAAAGQ29uZmlnAAAAAAABAAAAEwAAAAEAAAAAAAAAElJldm9rZWRDcmVkZW50aWFscwAAAAAAAQAAABMAAAABAAAAAAAAAAdBdHRlbXB0AAAAAAEAAAATAAAAAQAAAAAAAAANTmV4dEF0dGVtcHRJZAAAAAAAAAEAAAATAAAAAQAAAMhDdW11bGF0aXZlIHN1Y2Nlc3NmdWwgY2FuY2VsbGF0aW9ucyBmb3IgdGhpcyBhY2NvdW50IChtaXJyb3JzCmBuaWRvLXprLXJlY292ZXJ5YCdzIGBDYW5jZWxzKEFkZHJlc3MpYCDigJQgYm91bmRzIHJlcGVhdGVkCmluaXRpYXRlL2NhbmNlbCBncmllZmluZyBhY3Jvc3MgdGhlIGFjY291bnQncyBXSE9MRSBoaXN0b3J5LCBub3QKcGVyLWF0dGVtcHQpLgAAAAtDYW5jZWxzVXNlZAAAAAABAAAAEwAAAAEAAAAAAAAAC0NhbmNlbFRhbGx5AAAAAAIAAAATAAAABgAAAAEAAAAAAAAACU51bGxpZmllcgAAAAAAAAEAAAPuAAAAIAAAAAEAAACdVGhlIGNvbnRleHQtcnVsZSBpZCB0aGlzIHBvbGljeSB3YXMgaW5zdGFsbGVkIHVuZGVyLCBwZXIgYWNjb3VudCDigJQKc2FtZSBzdG9sZW4tcGFzc2tleS1yZXBvaW50IGhhcmRlbmluZyBhcwpgbmlkby1yZWNvdmVyeS1kb2MtY29tcGxldGlvbjo6S2V5OjpJbnN0YWxsZWRgLgAAAAAAAAlJbnN0YWxsZWQAAAAAAAABAAAAEwAAAAEAAAFGVEVNUE9SQVJZOiB2YWx1ZS1ib3VuZCBjb21wbGV0aW9uIG1hcmtlciwgd3JpdHRlbiBieSBgZW5mb3JjZWAgdGhlCmluc3RhbnQgaXQgY29uc3VtZXMgYW4gYXR0ZW1wdC4gTm90IHJlYWQgYnkgdGhpcyBleHBlcmltZW50J3MKVmFyaWFudC1BLW9ubHkgY29tcGxldGlvbiBwYXRoIChWYXJpYW50IEEgbmVlZHMgbm8gc3VjaCBicmlkZ2Ug4oCUIHNlZQpgZG9jcy9yZWNvdmVyeS9zdGFnZTItZmluZGluZ3MubWRgIMKnMykgYnV0IGtlcHQgc28gYSBmdXR1cmUgVmFyaWFudCBCCnZlaGljbGUgY291bGQgcmV1c2UgaXQgd2l0aG91dCBhIHN0b3JhZ2Uta2V5IEFCSSBicmVhay4AAAAAAA9Db21wbGV0aW9uR3JhbnQAAAAAAQAAABM=",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAGAAAAAAAAAAPQWxyZWFkeUVucm9sbGVkAAAAAAEAAAAAAAAAC05vdEVucm9sbGVkAAAAAAIAAADBYGVucm9sbGA6IGBHdWFyZGlhbk9ubHlgIG1vZGUgbXVzdCBub3Qgc2V0IGB2ZXJpZmllcmAvYHprX3Bvb2xgLCBvcgpgWmtPbmx5YC9gQ29tYmluZWRgIG11c3Qgc2V0IHRoZW0gYW5kIGBaa09ubHlgIG11c3QgTk9UIHNldApgZ3VhcmRpYW5zYCDigJQgdGhlIGZvbGxvdy11cC5tZCDCpzUuMiBIQVJEIG1vZGUvbWFjaGluZXJ5IG1hdGNoLgAAAAAAABJNb2RlQ29uZmlnTWlzbWF0Y2gAAAAAAAMAAAA4YGVucm9sbGA6IGB0aHJlc2hvbGRgIGlzIDAgb3IgZXhjZWVkcyBgZ3VhcmRpYW5zLmxlbigpYC4AAAAQSW52YWxpZFRocmVzaG9sZAAAAAQAAACaYGVucm9sbGA6IGBwZW5kaW5nX2FjdGl2aXR5X3BvbGljeWAgaXMgdGhlIHVuaW1wbGVtZW50ZWQgYFJlc3RyaWN0YApwbGFjZWhvbGRlciAoZm9sbG93LXVwLm1kIMKnNyDigJQgbm8gZGVmYXVsdDsgdGhpcyBpcyBub3QgYSBkZWZhdWx0LCBpdAppcyBhIHJlZnVzYWwpLgAAAAAAFlVucmVzb2x2ZWRQb2xpY3lCcmFuY2gAAAAAAAUAAAB0YGJlZ2luX2F0dGVtcHRgOiBhIGxpdmUgKG5vbi10ZXJtaW5hbCwgbm9uLWV4cGlyZWQpIGF0dGVtcHQgYWxyZWFkeQpleGlzdHMg4oCUIFN0YWdlIDEgc3BlYydzICJubyBzaWxlbnQgc3VwZXJzZWRlIi4AAAAUQXR0ZW1wdEFscmVhZHlBY3RpdmUAAAAGAAAAamBiZWdpbl9hdHRlbXB0YDogYENvbXByb21pc2VgIGFjdGlvbidzIGBzb3VyY2Vfb3JfYmFzZWxpbmVfaGFzaGAgZGlkCm5vdCBlcXVhbCBgY29uZmlnLmJhc2VsaW5lX2RvY19oYXNoYC4AAAAAABBCYXNlbGluZU1pc21hdGNoAAAABwAAAJlgYmVnaW5fYXR0ZW1wdGA6IGEgZGVjbGFyZWQgYHJlcGxhY2VkX2NyZWRlbnRpYWxfaWRgIGlzIGFscmVhZHkgaW4KYFJldm9rZWRDcmVkZW50aWFsc2Ag4oCUIHJldml2aW5nIGEgY3JlZGVudGlhbCBhIHByaW9yIHJlY292ZXJ5IHJlbW92ZWQKKHByb3BlcnR5IDEwKS4AAAAAAAAYUmV2b2tlZENyZWRlbnRpYWxSZXZpdmVkAAAACAAAAIFgc3VibWl0X2d1YXJkaWFuX2FwcHJvdmFsYC9gc3VibWl0X3prX3Byb29mYCAoYW5kIHRoZWlyIGBfY2FuY2VsYApjb3VudGVycGFydHMpOiB0aGUgYWNjb3VudCdzIG1vZGUgZG9lcyBub3QgaW5jbHVkZSB0aGlzIGZhY3Rvci4AAAAAAAAMTW9kZU1pc21hdGNoAAAACQAAADNObyBsaXZlIGF0dGVtcHQgd2l0aCB0aGlzIGlkIGluIHRoZSBleHBlY3RlZCBzdGF0ZS4AAAAADU5vU3VjaEF0dGVtcHQAAAAAAAAKAAAAR2BzdWJtaXRfZ3VhcmRpYW5fYXBwcm92YWxgOiBjYWxsZXIgaXMgbm90IGluIHRoZSBlbnJvbGxlZCBndWFyZGlhbgpzZXQuAAAAAAxOb3RBR3VhcmRpYW4AAAALAAAAVWBzdWJtaXRfZ3VhcmRpYW5fYXBwcm92YWxgOiB0aGlzIGd1YXJkaWFuIGFscmVhZHkgYXBwcm92ZWQgdGhpcwphdHRlbXB0L2NhbmNlbGxhdGlvbi4AAAAAAAARRHVwbGljYXRlQXBwcm92YWwAAAAAAAAMAAAAaGBzdWJtaXRfemtfcHJvb2ZgL2NhbmNlbDogdGhlIHN1Ym1pdHRlZCBNZXJrbGUgcm9vdCBpcyBub3QgYSBrbm93bgpoaXN0b3JpY2FsIHJvb3Qgb2YgdGhlIGVucm9sbGVkIHBvb2wuAAAAC1Vua25vd25Sb290AAAAAA0AAABiYHN1Ym1pdF96a19wcm9vZmAvY2FuY2VsOiBudWxsaWZpZXIgYWxyZWFkeSBgU3BlbnRgLCBvciBgUmVzZXJ2ZWRgIGJ5CmEgRElGRkVSRU5UIGFjY291bnQvYXR0ZW1wdC4AAAAAABROdWxsaWZpZXJVbmF2YWlsYWJsZQAAAA4AAAA6YHN1Ym1pdF96a19wcm9vZmAvY2FuY2VsOiB0aGUgdmVyaWZpZXIgcmVqZWN0ZWQgdGhlIHByb29mLgAAAAAAElZlcmlmaWNhdGlvbkZhaWxlZAAAAAAADwAAACZgY2FuY2VsXypgOiBubyBsaXZlIGF0dGVtcHQgdG8gY2FuY2VsLgAAAAAACU5vUGVuZGluZwAAAAAAABAAAACWYGNhbmNlbF8qYDogYG1heF9jYW5jZWxzYCBhbHJlYWR5IHJlYWNoZWQgZm9yIHRoaXMgYWNjb3VudCAobWlycm9ycwpgbmlkby16ay1yZWNvdmVyeWAncyBjYW5jZWwgY2FwIOKAlCBib3VuZHMgZ3JpZWZpbmcgdmlhIHJlcGVhdGVkCmluaXRpYXRlL2NhbmNlbCkuAAAAAAAQQ2FuY2VsQ2FwUmVhY2hlZAAAABEAAAB+YFBvbGljeTo6ZW5mb3JjZWA6IHdyb25nIGBmbl9uYW1lYC9hcmctc2hhcGUsIG9yIHN1Ym1pdHRlZCBkb2MncyBoYXNoCmRvZXNuJ3QgbWF0Y2ggdGhlIGF0dGVtcHQncyBjb21taXR0ZWQgYHRhcmdldF9kb2NfaGFzaGAuAAAAAAAPQ29udGV4dE1pc21hdGNoAAAAABIAAAAAAAAADFJ1bGVNaXNtYXRjaAAAABMAAAAAAAAADE5vdEluc3RhbGxlZAAAABQAAAAAAAAAEEFscmVhZHlJbnN0YWxsZWQAAAAVAAAAimB1bmluc3RhbGxgIGFsd2F5cyByZWZ1c2VzIOKAlCBzZWUgYGxpYi5yc2AncyBkb2MgY29tbWVudCAoc2FtZQpyZWVudHJhbmN5IGFyZ3VtZW50IGFzIGBuaWRvLXprLXJlY292ZXJ5YC9gbmlkby1yZWNvdmVyeS1kb2MtY29tcGxldGlvbmApLgAAAAAADFVuYXV0aG9yaXplZAAAABYAAAAAAAAAElRpbWVsb2NrTm90RWxhcHNlZAAAAAAAFwAAAAAAAAAPUmVjb3ZlcnlFeHBpcmVkAAAAABg=",
        "AAAAAQAAAU1BIHNpbmdsZSByZWNvdmVyeSBhdHRlbXB0J3MgZnVsbCBsaWZlY3ljbGUgcmVjb3JkICjCpzYncyByZWZlcmVuY2UgbW9kZWw6CmBjb2xsZWN0aW5nLWV2aWRlbmNlIC0+IGF1dGhvcml6ZWQtcGVuZGluZyAtPiB7Y29tcGxldGVkLCBjYW5jZWxsZWR9YDsKImV4cGlyZWQiIGlzIGEgREVSSVZFRCBwcmVkaWNhdGUsIG5vdCBhIHN0b3JlZCBzdGF0ZSDigJQgc2VlIGBsaWIucnMKOjppc19saXZlYCwgbWlycm9yaW5nIGBUUkFOU0lUSU9OX1NQRUMubWRgJ3MgInJlYWRpbmVzcyBtYXkgYmUgZGVyaXZlZApmcm9tIHRpbWUgcmF0aGVyIHRoYW4gc3RvcmVkIGFzIGFub3RoZXIgc3RhdGUiKS4AAAAAAAAAAAAAB0F0dGVtcHQAAAAACwAAAAAAAAAGYWN0aW9uAAAAAAfQAAAADlJlY292ZXJ5QWN0aW9uAAAAAAAAAAAACmNvbW1pdG1lbnQAAAAAB9AAAAASUHJvcG9zYWxDb21taXRtZW50AAAAAAAAAAAACmNyZWF0ZWRfYXQAAAAAAAYAAAAAAAAAEGV4ZWN1dGFibGVfYWZ0ZXIAAAPoAAAABgAAAAAAAAAKZXhwaXJlc19hdAAAAAAD6AAAAAYAAAAAAAAAEmd1YXJkaWFuX2FwcHJvdmFscwAAAAAD6gAAABMAAAAAAAAAAmlkAAAAAAAGAAAAvENyZWRlbnRpYWwgaWRzIHRoZSB0YXJnZXQgZG9jdW1lbnQgcmVwbGFjZXMgKGNsaWVudC1kZWNsYXJlZCDigJQgc2VlCnRoZSBjcmF0ZSBkb2MgY29tbWVudCdzICJLbm93biBsaW1pdHMiIG9uIHdoeSB0aGlzIGlzIGEgZGVjbGFyZWQKYm9va2tlZXBpbmcgaW5wdXQsIG5vdCBhbiBvbi1jaGFpbi12ZXJpZmllZCBkb2MgZGlmZikuAAAAF3JlcGxhY2VkX2NyZWRlbnRpYWxfaWRzAAAAA+oAAAPuAAAAIAAAAAAAAAAFc3RhdGUAAAAAAAfQAAAADEF0dGVtcHRTdGF0ZQAAAAAAAAAMemtfbnVsbGlmaWVyAAAD6AAAA+4AAAAgAAAAAAAAAAt6a192ZXJpZmllZAAAAAAB",
        "AAAAAgAAAVVGb2xsb3ctdXAubWQgwqcyLjE6IHJvdXRpbmUgcmVjb3ZlcnktQ09ORklHVVJBVElPTiBjaGFuZ2UgYXV0aG9yaXR5IChub3QKbW9kZWxlZCBieSB0aGlzIGV4cGVyaW1lbnQg4oCUIG5vIGByZWNvbmZpZ3VyZWAgZW50cnkgcG9pbnQgZXhpc3RzLCBzZWUgdGhlCmNyYXRlIGRvYyBjb21tZW50J3MgIktub3duIGxpbWl0cyIg4oCUIHRoaXMgZmllbGQgaXMgcmV0YWluZWQgb24KYFJlY292ZXJ5Q29uZmlnYCBiZWNhdXNlIGl0IGlzIHBhcnQgb2YgdGhlIGFjY291bnQncyByZXZpZXdhYmxlCmNvbW1pdG1lbnQgZXZlbiB0aG91Z2ggdGhpcyBleHBlcmltZW50IGZpeGVzIGl0IGF0IGVucm9sbG1lbnQpLgAAAAAAAAAAAAAHUHJvZmlsZQAAAAACAAAAAAAAAAAAAAAETG9zcwAAAAAAAAAAAAAACVByb3RlY3RlZAAAAA==",
        "AAAAAgAAAPtXaGljaCBldmlkZW5jZSBmYWN0b3IocykgYW4gYWNjb3VudCdzIHJlY292ZXJ5IHJlcXVpcmVzLiBGb2xsb3ctdXAubWQKwqc1LjIncyBIQVJEIHJlcXVpcmVtZW50OiBgR3VhcmRpYW5Pbmx5YCBtdXN0IG5vdCByZXF1aXJlIEFOWSBaSwptYWNoaW5lcnkg4oCUIG5vIHNlY3JldCwgbm8gTWVya2xlIHdpdG5lc3MsIG5vIHByb29mLiBFbmZvcmNlZCBhdCBgZW5yb2xsYAooc2VlIGBsaWIucnNgKSwgbm90IGp1c3QgZG9jdW1lbnRlZCBoZXJlLgAAAAAAAAAACEF1dGhNb2RlAAAAAwAAAAAAAAAAAAAADEd1YXJkaWFuT25seQAAAAAAAAAAAAAABlprT25seQAAAAAAAAAAAAAAAAAIQ29tYmluZWQ=",
        "AAAAAQAAARJQZXItYXR0ZW1wdCBjYW5jZWxsYXRpb24tZXZpZGVuY2UgdGFsbHkgKGZvbGxvdy11cC5tZCDCpzIuMjogY2FuY2VsbGF0aW9uCmlzIGl0cyBPV04gYWN0aW9uIGRvbWFpbiwgYm91bmQgdG8gdGhlIHNwZWNpZmljIGF0dGVtcHQgaXQgY2FuY2VscyDigJQgYQpkaXN0aW5jdCBjb21taXRtZW50IGZyb20gaW5pdGlhdGlvbiwgZGlzdGluY3Qgc3RvcmFnZSwgbm8gc2hhcmVkIHN0YXRlCndpdGggYEF0dGVtcHQ6Omd1YXJkaWFuX2FwcHJvdmFsc2AvYHprX3ZlcmlmaWVkYCBhYm92ZSkuAAAAAAAAAAAAC0NhbmNlbFRhbGx5AAAAAAIAAAAAAAAAEmd1YXJkaWFuX2FwcHJvdmFscwAAAAAD6gAAABMAAAAAAAAAC3prX3ZlcmlmaWVkAAAAAAE=",
        "AAAAAgAAAAAAAAAAAAAADEF0dGVtcHRTdGF0ZQAAAAQAAAAAAAAAAAAAABJDb2xsZWN0aW5nRXZpZGVuY2UAAAAAAAAAAAAAAAAAEUF1dGhvcml6ZWRQZW5kaW5nAAAAAAAAAAAAAAAAAAAJQ29tcGxldGVkAAAAAAAAAAAAAAAAAAAJQ2FuY2VsbGVkAAAA",
        "AAAAAgAAALFHbG9iYWwgKG5vdCBwZXItYWNjb3VudCkgWksgbnVsbGlmaWVyIGxpZmVjeWNsZSDigJQgbWlycm9ycwpgbmlkby16ay1yZWNvdmVyeWAncyBgTnVsbGlmaWVyU3RhdGVgLiBBIG51bGxpZmllciByZXNlcnZlZCBieSBvbmUKYWNjb3VudCdzIGF0dGVtcHQgY2Fubm90IGJlIHJlc2VydmVkIGJ5IGFub3RoZXIncy4AAAAAAAAAAAAADk51bGxpZmllclN0YXRlAAAAAAACAAAAAQAAAAAAAAAIUmVzZXJ2ZWQAAAABAAAAEwAAAAAAAAAAAAAABVNwZW50AAAA",
        "AAAAAgAAAMlXaGljaCB0YXJnZXQtZG9jdW1lbnQgY29uc3RydWN0aW9uIHJ1bGUgYW4gYXR0ZW1wdCB1c2VzCihgZG9jcy9yZWNvdmVyeS9UUkFOU0lUSU9OX1NQRUMubWRgLCBmb2xsb3ctdXAubWQgwqc0LjIpLiBFbmNvZGVkIGFzIHRoZQpjaXJjdWl0L2NvbW1pdG1lbnQncyBudW1lcmljIGBhY3Rpb25gIHRvbyDigJQgc2VlIGBsaWIucnM6OmFjdGlvbl9jb2RlYC4AAAAAAAAAAAAADlJlY292ZXJ5QWN0aW9uAAAAAAACAAAAAAAAAAAAAAAHTG9zdEtleQAAAAAAAAAAAAAAAApDb21wcm9taXNlAAA=",
        "AAAAAQAAA5JJbW11dGFibGUtYWZ0ZXItZW5yb2xsbWVudCByZWNvdmVyeSBjb25maWd1cmF0aW9uIGZvciBvbmUgYWNjb3VudAooZm9sbG93LXVwLm1kIMKnNS41OiB0aGUgcmV2aWV3YWJsZSByZWNvdmVyeS1jb25maWd1cmF0aW9uIGNvbW1pdG1lbnQg4oCUCm1vZGUsIHByb2ZpbGUsIGd1YXJkaWFuIGlkZW50aXRpZXMvcXVvcnVtLCB2ZXJpZmllciBpZGVudGl0eSwgYmFzZWxpbmUKY29tbWl0bWVudCkuIE5PVCBlbWJlZGRlZCBpbiB0aGUgYWNjb3VudCdzIG93biBQZXJjaCBwb2xpY3kgZG9jdW1lbnQg4oCUCnRoaXMgZXhwZXJpbWVudCBrZWVwcyByZWNvdmVyeSBjb25maWd1cmF0aW9uIGVudGlyZWx5IGluIHRoaXMKY29udHJvbGxlcidzIHN0b3JhZ2UsIHNvIGFuIGFjY291bnQncyBkb2N1bWVudCBjYW5vbmljYWwgYnl0ZXMgYXJlClVOQ0hBTkdFRCBieSBlbnJvbGxpbmcgaW4gcmVjb3ZlcnkgKHNlZSBgbGliLnJzYCB0ZXN0cwpgZW5yb2xsaW5nX2RvZXNfbm90X3RvdWNoX3RoZV9hY2NvdW50X2RvY2ApLgoKTm8gYHJlY29uZmlndXJlYC9iYXNlbGluZS11cGRhdGUgZW50cnkgcG9pbnQgZXhpc3RzIGluIHRoaXMgZXhwZXJpbWVudCDigJQKc2VlIHRoZSBjcmF0ZSBkb2MgY29tbWVudCdzICJLbm93biBsaW1pdHMiLiBgdmVyc2lvbmAgdGhlcmVmb3JlIG9ubHkgZXZlcgpyZWFkcyBgMWAgdG9kYXksIGJ1dCBpcyBhIHJlYWwgYHUzMmAgZmllbGQgKG5vdCBhIGNvbnN0YW50KSBzbyBhIGZ1dHVyZQpgcmVjb25maWd1cmVgIGNhbiBidW1wIGl0IHdpdGhvdXQgYW4gQUJJIGNoYW5nZSwgYW5kIHNvIHRoZQpgUHJvcG9zYWxDb21taXRtZW50LmNvbmZpZ192ZXJzaW9uYCAvIGNpcmN1aXQgYGNmZ192ZXJzaW9uYCBmaWVsZHMgaGF2ZSBhCnJlYWwgdmFsdWUgdG8gYmluZCByYXRoZXIgdGhhbiBhIHBsYWNlaG9sZGVyLgAAAAAAAAAAAA5SZWNvdmVyeUNvbmZpZwAAAAAADQAAAMpUaGUgYXBwcm92ZWQgYmFzZWxpbmUgZG9jdW1lbnQncyBjYW5vbmljYWwgaGFzaCAoZm9sbG93LXVwLm1kIMKnNC4xKS4KYENvbXByb21pc2VgIGF0dGVtcHRzIE1VU1QgdGFyZ2V0IGBiYXNlbGluZV9kb2NfaGFzaGAgcGx1cwpyZXBsYWNlbWVudHMg4oCUIG5ldmVyIHRoZSBsaXZlIGRvY3VtZW50IOKAlCBlbmZvcmNlZCBhdCBgYmVnaW5fYXR0ZW1wdGAuAAAAAAARYmFzZWxpbmVfZG9jX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAAKZGVsYXlfc2VjcwAAAAAABgAAAAAAAAALZXhwaXJ5X3NlY3MAAAAABgAAAAAAAAASZ3VhcmRpYW5fdGhyZXNob2xkAAAAAAAEAAAA9k5vbi1lbXB0eSAod2l0aCBgZ3VhcmRpYW5fdGhyZXNob2xkYCBpbiBgMS4uPWd1YXJkaWFucy5sZW4oKWApIGZvcgpgR3VhcmRpYW5Pbmx5YC9gQ29tYmluZWRgOyBNVVNUIGJlIGVtcHR5IGZvciBgWmtPbmx5YC4gRmxhdHRlbmVkIGZyb20KYSBbYEd1YXJkaWFuU2V0YF0gcmF0aGVyIHRoYW4gc3RvcmluZyBgT3B0aW9uPEd1YXJkaWFuU2V0PmAgZGlyZWN0bHkK4oCUIHNlZSB0aGF0IHR5cGUncyBkb2MgY29tbWVudCBmb3Igd2h5LgAAAAAACWd1YXJkaWFucwAAAAAAA+oAAAATAAAAAAAAAAttYXhfY2FuY2VscwAAAAAEAAAAAAAAAARtb2RlAAAH0AAAAAhBdXRoTW9kZQAAAMZSYXcgbmV0d29yayBwYXNzcGhyYXNlIGJ5dGVzICh0aGlzIGNvbnRyYWN0IHNoYTI1NidzIGl0IGludGVybmFsbHksCm1pcnJvcmluZyBgbmlkb196a19yZWNvdmVyeTo6aGFzaDo6Y29tcHV0ZV9hdXRoX2hhc2hgJ3Mgb3duCmNvbnZlbnRpb24pIOKAlCBwYXJ0IG9mIHRoZSDCpzUuMyAibmV0d29yayBpZGVudGl0eSIgY29tbWl0bWVudCBmaWVsZC4AAAAAABJuZXR3b3JrX3Bhc3NwaHJhc2UAAAAAAA4AAAAAAAAAF3BlbmRpbmdfYWN0aXZpdHlfcG9saWN5AAAAB9AAAAAVUGVuZGluZ0FjdGl2aXR5UG9saWN5AAAAAAAAAAAAAAdwcm9maWxlAAAAB9AAAAAHUHJvZmlsZQAAAAEJVGhlIGBuaWRvLXJlY292ZXJ5LXZlcmlmaWVyYCAoY29uc3RydWN0b3JsZXNzLCBWSy1iYWtlZC1pbikgaW5zdGFuY2UKdGhpcyBhY2NvdW50J3MgWksgZXZpZGVuY2UgbXVzdCB2ZXJpZnkgYWdhaW5zdC4gUmVxdWlyZWQgZm9yCmBaa09ubHlgL2BDb21iaW5lZGA7IE1VU1QgYmUgYWJzZW50IGZvciBgR3VhcmRpYW5Pbmx5YCAodGhlIEhBUkQgIm5vClpLIG1hY2hpbmVyeSIgcmVxdWlyZW1lbnQg4oCUIHNlZSBgQXV0aE1vZGU6Okd1YXJkaWFuT25seWAncyBkb2MpLgAAAAAAAAh2ZXJpZmllcgAAA+gAAAATAAAAAAAAAAd2ZXJzaW9uAAAAAAQAAADNVGhlIGBuaWRvLXprLXJlY292ZXJ5YCBNZXJrbGUgcG9vbCB0aGlzIGFjY291bnQncyBlbnJvbGxtZW50IHNlY3JldAp3YXMgaW5zZXJ0ZWQgaW50byAoYFprUmVjb3ZlcnlDbGllbnQ6Omluc2VydF9mb3JgLCBjYWxsZWQgYnkgdGhlCkNMSUVOVCBhdCBlbnJvbGxtZW50LCBub3QgYnkgdGhpcyBjb250cmFjdCkuIFJlcXVpcmVkIGlmZiBgdmVyaWZpZXJgCmlzLgAAAAAAAAd6a19wb29sAAAAA+gAAAAT",
        "AAAAAgAAAcBUaGUgYWN0aW9uIHRhZyBiYWtlZCBpbnRvIGEgYFByb3Bvc2FsQ29tbWl0bWVudGAgKGZvbGxvdy11cC5tZCDCpzUuMykgYW5kLApmb3IgWksgZXZpZGVuY2UsIGludG8gdGhlIGNpcmN1aXQncyBgYXV0aF9oYXNoYCAodmlhCmBuaWRvX3prX3JlY292ZXJ5OjpoYXNoOjpjb21wdXRlX2F1dGhfaGFzaGAncyBgYWN0aW9uYCBwYXJhbWV0ZXIpIOKAlCB0aGlzCmlzIGNhbmNlbGxhdGlvbi1kb21haW4gc2VwYXJhdGlvbiAoZm9sbG93LXVwLm1kIMKnMi4yKTogYSBgQ2FuY2VsYApjb21taXRtZW50IGlzIHN0cnVjdHVyYWxseSBhbmQgY3J5cHRvZ3JhcGhpY2FsbHkgZGlzdGluY3QgZnJvbSB0aGUKYExvc3RLZXlgL2BDb21wcm9taXNlYCBjb21taXRtZW50IGl0IHRhcmdldHMsIHNvIGluaXRpYXRpb24gZXZpZGVuY2UgY2FuCm5ldmVyIGRvdWJsZSBhcyBjYW5jZWxsYXRpb24gZXZpZGVuY2UuAAAAAAAAABBDb21taXRtZW50QWN0aW9uAAAAAwAAAAAAAAAAAAAAB0xvc3RLZXkAAAAAAAAAAAAAAAAKQ29tcHJvbWlzZQAAAAAAAAAAAAAAAAAGQ2FuY2VsAAA=",
        "AAAABQAAAAAAAAAAAAAAEFJlY292ZXJ5Q2FuY2VsZWQAAAABAAAAEXJlY292ZXJ5X2NhbmNlbGVkAAAAAAAAAgAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAKYXR0ZW1wdF9pZAAAAAAABgAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAEVJlY292ZXJ5Q29tcGxldGVkAAAAAAAAAQAAABJyZWNvdmVyeV9jb21wbGV0ZWQAAAAAAAMAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAAAAAAAAAAAAAA90YXJnZXRfZG9jX2hhc2gAAAAD7gAAACAAAAAAAAAAAg==",
        "AAAAAQAAAbdGb2xsb3ctdXAubWQgwqc1LjMncyBleGFjdCBwcm9wb3NhbC1jb21taXRtZW50IGZpZWxkIGxpc3QuIGBuZXR3b3JrYCBpcwpgc2hhMjU2KGNvbmZpZy5uZXR3b3JrX3Bhc3NwaHJhc2UpYCAoMzIgYnl0ZXMpIHJhdGhlciB0aGFuIHRoZSByYXcKcGFzc3BocmFzZSwgbWF0Y2hpbmcgdGhlIGNpcmN1aXQncyBgbnBhc3NfaGkvbG9gIGNvbnZlbnRpb24uCmBiYXNlbGluZV9vcl9zb3VyY2VfaWRgIGlzIGBjb25maWcuYmFzZWxpbmVfZG9jX2hhc2hgIGZvciBgQ29tcHJvbWlzZWAsCm9yIHRoZSBjYWxsZXItc3VwcGxpZWQgbGl2ZS1kb2Mgc25hcHNob3QgaGFzaCBmb3IgYExvc3RLZXlgICjCpzQuMjoKImN1cnJlbnQgbWVhbnMgYSBkZWZpbmVkIHNvdXJjZSBzbmFwc2hvdCIg4oCUIGNhcHR1cmVkIG9uY2UsIGF0CmBiZWdpbl9hdHRlbXB0YCwgbmV2ZXIgcmVjb21wdXRlZCkuAAAAAAAAAAASUHJvcG9zYWxDb21taXRtZW50AAAAAAAJAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAABmFjdGlvbgAAAAAH0AAAABBDb21taXRtZW50QWN0aW9uAAAAAAAAAAphdHRlbXB0X2lkAAAAAAAGAAAAAAAAABViYXNlbGluZV9vcl9zb3VyY2VfaWQAAAAAAAPuAAAAIAAAAAAAAAAOY29uZmlnX3ZlcnNpb24AAAAAAAQAAAAAAAAADWNvbnRyb2xsZXJfaWQAAAAAAAATAAAAAAAAAApkZWxheV9zZWNzAAAAAAAGAAAAAAAAAAduZXR3b3JrAAAAA+4AAAAgAAAAAAAAAA90YXJnZXRfZG9jX2hhc2gAAAAD7gAAACA=",
        "AAAABQAAAAAAAAAAAAAAElJlY292ZXJ5QXV0aG9yaXplZAAAAAAAAQAAABNyZWNvdmVyeV9hdXRob3JpemVkAAAAAAMAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAAAAAAAAAAAAABBleGVjdXRhYmxlX2FmdGVyAAAABgAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAFFJlY292ZXJ5QXR0ZW1wdEJlZ3VuAAAAAQAAABZyZWNvdmVyeV9hdHRlbXB0X2JlZ3VuAAAAAAADAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAAAAAAAAphdHRlbXB0X2lkAAAAAAAGAAAAAAAAAAAAAAAPdGFyZ2V0X2RvY19oYXNoAAAAA+4AAAAgAAAAAAAAAAI=",
        "AAAAAgAAA2NGb2xsb3ctdXAubWQgwqc3IOKAlCBkZWxpYmVyYXRlbHkgZGVmZXJyZWQsIE5PIGRlZmF1bHQuIE1pcnJvcnMKYFRSQU5TSVRJT05fU1BFQy5tZGAncyB0aHJlZS13YXkgYHBlbmRpbmdBY3Rpdml0eVBvbGljeWAgZW51bSBleGFjdGx5CihpbmNsdWRpbmcgdGhlIHN5bWJvbGljLCBkZWxpYmVyYXRlbHktdW5pbXBsZW1lbnRlZCB0aGlyZCBicmFuY2gpIHNvIHRoZQoibm8gZGVmYXVsdCIgcHJvcGVydHkgaXMgYSByZWFsLCB0ZXN0YWJsZSByZWZ1c2FsIHJhdGhlciB0aGFuIGEgdHlwZSB0aGF0CnNpbXBseSBvbWl0cyB0aGUgdW5yZXNvbHZlZCBvcHRpb24uIGBGcmVlemVgL2BDb250aW51ZWAgYXJlIHJlYWwgYW5kCnRlc3RlZDsgYFJlc3RyaWN0YCBpcyBhY2NlcHRlZCBieSB0aGUgVFlQRSBidXQgUkVKRUNURUQgYnkgYGVucm9sbGAKKGBFcnJvcjo6VW5yZXNvbHZlZFBvbGljeUJyYW5jaGApIOKAlCBhbiBhY2NvdW50IGNhbiBiZSBvZmZlcmVkIHRoZSBjaG9pY2UKYW5kIHNlZSBpdCBleHBsaWNpdGx5IHJlZnVzZWQsIGV4YWN0bHkgbGlrZQpgcGFja2FnZXMvcmVjb3Zlcnktc3BlYy9zcmMvbW9kZWwudHNgJ3MgYHJlc3RyaWN0YC9gb3RoZXJgIGJyYW5jaGVzCnRocm93aW5nIGBVTlJFU09MVkVEX1BPTElDWV9CUkFOQ0hgIHdpdGggbm8gYGRlZmF1bHQ6YCBjYXNlLiBTZWUgdGhlCmNyYXRlIGRvYyBjb21tZW50J3MgIktub3duIGxpbWl0cyIgZm9yIHdoYXQgYFRSQU5TSVRJT05fU1BFQy5tZGAncwpzZXBhcmF0ZSBgcG9saWN5V3JpdGVDb25mbGljdFBvbGljeWAgYXhpcyAoYGludmFsaWRhdGUtYXR0ZW1wdGAgdnMKYGJsb2NrYCkgd291bGQgYWRkIG9uIHRvcCBvZiB0aGlzIOKAlCBub3QgaW1wbGVtZW50ZWQgaGVyZS4AAAAAAAAAABVQZW5kaW5nQWN0aXZpdHlQb2xpY3kAAAAAAAADAAAAAAAAAIhPcmRpbmFyeSBgYXBwbHlfZG9jYCBjYWxscyBhcmUgYmxvY2tlZCAoYGhhc19wZW5kaW5nYCByZXBvcnRzIGB0cnVlYCkKd2hpbGUgYSBsaXZlIGF0dGVtcHQgZXhpc3RzIGZvciB0aGUgYWNjb3VudCwgZXhhY3RseSBsaWtlIFN0YWdlIDIuAAAABkZyZWV6ZQAAAAAAAAAAAWZPcmRpbmFyeSBgYXBwbHlfZG9jYCBjYWxscyBhcmUgTkVWRVIgYmxvY2tlZCBieSBhIGxpdmUgYXR0ZW1wdAooYGhhc19wZW5kaW5nYCBhbHdheXMgcmVwb3J0cyBgZmFsc2VgKSDigJQgYSBjb21wcm9taXNlZCBhZG1pbiBjYW4ga2VlcApyZXdyaXRpbmcgdGhlIGRvY3VtZW50IHVudGlsIGEgcmVjb3ZlcnkgYWN0dWFsbHkgY29tcGxldGVzLiBUaGlzIGlzCnRoZSBhY2NlcHRlZCByaXNrIGBmb2xsb3ctdXAubWRgIMKnNydzIGNhbmRpZGF0ZSB0YWJsZSBuYW1lcyBmb3IKIkNvbnRpbnVlIjsgY2hvb3NpbmcgaXQgaXMgYW4gZXhwbGljaXQsIGluZm9ybWVkIGNob2ljZSBtYWRlIGF0CmVucm9sbG1lbnQsIG5vdCBhIGRlZmF1bHQuAAAAAAAIQ29udGludWUAAAAAAAABPFN5bWJvbGljIHBsYWNlaG9sZGVyIGZvciBhIGNhcGFiaWxpdHktc2NvcGVkIHJlc3RyaWN0aW9uIChmb2xsb3ctdXAubWQKwqc3J3MgdGhpcmQgY2FuZGlkYXRlOiAiY2FuIHByZXNlcnZlIGVzc2VudGlhbCBhY3Rpdml0eSB3aGlsZSBsaW1pdGluZwpzcGVjaWZpYyByaXNrcyIpLiBVbmltcGxlbWVudGVkLCBkZWxpYmVyYXRlbHkg4oCUIGBlbnJvbGxgIHJlZnVzZXMgdGhpcwp2YWx1ZSB3aXRoIGBFcnJvcjo6VW5yZXNvbHZlZFBvbGljeUJyYW5jaGAgcmF0aGVyIHRoYW4gc2lsZW50bHkKdHJlYXRpbmcgaXQgYXMgYEZyZWV6ZWAgb3IgYENvbnRpbnVlYC4AAAAIUmVzdHJpY3Q=",
        "AAAAAAAAAAAAAAAGY29uZmlnAAAAAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAD6AAAB9AAAAAOUmVjb3ZlcnlDb25maWcAAA==",
        "AAAAAAAAAqtPbmUtc2hvdCBwZXIgYWNjb3VudCwgc2VsZi1hdXRoZWQuIFZhbGlkYXRlcyB0aGUgZm9sbG93LXVwLm1kIMKnNS4yCkhBUkQgbW9kZS9tYWNoaW5lcnkgbWF0Y2ggKGBHdWFyZGlhbk9ubHlgIE1VU1QgTk9UIGNvbmZpZ3VyZSBhbnkgWksKYWRkcmVzczsgYFprT25seWAgTVVTVCBOT1QgY29uZmlndXJlIGd1YXJkaWFuczsgYENvbWJpbmVkYCBuZWVkcwpib3RoKSwgYSBzYW5lIGd1YXJkaWFuIHRocmVzaG9sZCwgYW5kIHJlZnVzZXMgdGhlIHVuaW1wbGVtZW50ZWQKYFBlbmRpbmdBY3Rpdml0eVBvbGljeTo6UmVzdHJpY3RgICjCpzcg4oCUIG5vIGRlZmF1bHQ7IGEgcmVmdXNhbCwgbm90IGEKc2lsZW50IHN1YnN0aXR1dGlvbikuCgpObyBgcmVjb25maWd1cmVgIGVudHJ5IHBvaW50IGV4aXN0cyDigJQgc2VlIHRoZSBjcmF0ZSBkb2MgY29tbWVudCdzCiJLbm93biBsaW1pdHMiLiBUaGlzIG1ha2VzIGBSZWNvdmVyeUNvbmZpZ2AgZWZmZWN0aXZlbHkgaW1tdXRhYmxlCm9uY2Ugc2V0LCB3aGljaCB0cml2aWFsbHkgc2F0aXNmaWVzIGZvbGxvdy11cC5tZCDCpzQuMydzICJhIHN0b2xlbgphZG1pbiBrZXkgbXVzdCBub3QgYmUgYWJsZSB0byByZWZyZXNoIHRoZSBiYXNlbGluZSIgcHJvcGVydHkgKHRoZXJlCmlzIG5vIHJlZnJlc2ggcGF0aCBBVCBBTEwsIG5vdCBldmVuIGEgbGVnaXRpbWF0ZSBvbmUpLgAAAAAGZW5yb2xsAAAAAAACAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAABmNvbmZpZwAAAAAH0AAAAA5SZWNvdmVyeUNvbmZpZwAAAAAAAA==",
        "AAAAAAAAA7JUaGUgY29tcGxldGlvbiBnYXRlIOKAlCBWYXJpYW50IEEgb25seSAoYGRvY3MvcmVjb3Zlcnkvc3RhZ2UyLWZpbmRpbmdzLm1kYCdzCnJlY29tbWVuZGF0aW9uKS4gT3JkZXJlZCBjaGVja3MgbWlycm9yCmBuaWRvLXJlY292ZXJ5LWRvYy1jb21wbGV0aW9uOjpQb2xpY3k6OmVuZm9yY2VgIGV4YWN0bHkgKHRoYXQKZG9jdW1lbnQncyDCpzMgY2FsbC1vcmRlcmluZyBhbmFseXNpcyBhcHBsaWVzIHZlcmJhdGltOiBgZW5mb3JjZWAgcnVucwpkdXJpbmcgdGhlIGNvbXBsZXRpbmcgY2FsbCdzIE9XTiBgX19jaGVja19hdXRoYCwgQkVGT1JFIGl0cyBib2R5LCBzbwpjb25zdW1pbmcgdGhlIGF0dGVtcHQgSEVSRSBpcyB3aGF0IG1ha2VzIGBoYXNfcGVuZGluZ2AgcmVhZCBgZmFsc2VgCmZvciB0aGF0IHNhbWUgY2FsbCdzIGJvZHktdGltZSBndWFyZCBjaGVjaywgd2l0aCBubyBzZXBhcmF0ZQpjb21wbGV0aW9uLWdyYW50IGJyaWRnZSBuZWVkZWQpOgoxLiBgY29udGV4dF9ydWxlLmlkYCBtYXRjaGVzIHRoZSBpZCB0aGlzIHBvbGljeSB3YXMgaW5zdGFsbGVkIHVuZGVyLgoyLiBBIGxpdmUgYXR0ZW1wdCBleGlzdHMsIGlzIGBBdXRob3JpemVkUGVuZGluZ2AsIGl0cyB0aW1lbG9jayBoYXMKZWxhcHNlZCwgYW5kIGl0IGlzIG5vdCBleHBpcmVkLgozLiBgY29udGV4dGAgaXMgYSBzZWxmLWNhbGwgdG8gYGFwcGx5X2RvY2Agd2l0aCBleGFjdGx5IG9uZSBgQnl0ZXNgCmFyZ3VtZW50IHdob3NlIHNoYTI1NiBlcXVhbHMgYGF0dGVtcHQuY29tbWl0bWVudC50YXJnZXRfZG9jX2hhc2hgLgo0LiBDb25zdW1lOiBtYXJrIGBDb21wbGV0ZWRgLCBhcHBlbmQgYHJlcGxhY2VkX2NyZWRlbnRpYWxfaWRzYCB0bwpgUmV2b2tlZENyZWRlbnRpYWxzYCAocHJvcGVydHkgMTAgYm9va2tlZXBpbmcpLCBzcGVuZCB0aGUgWksKbnVsbGlmaWVyIGlmIG9uZSB3YXMgcmVzZXJ2ZWQsIGVtaXQuAAAAAAAHZW5mb3JjZQAAAAAEAAAAAAAAAAdjb250ZXh0AAAAB9AAAAAHQ29udGV4dAAAAAAAAAAAFWF1dGhlbnRpY2F0ZWRfc2lnbmVycwAAAAAAA+oAAAfQAAAABlNpZ25lcgAAAAAAAAAAAAxjb250ZXh0X3J1bGUAAAfQAAAAC0NvbnRleHRSdWxlAAAAAAAAAAANc21hcnRfYWNjb3VudAAAAAAAABMAAAAA",
        "AAAAAAAAARpJZGVudGljYWwgc2hhcGUgdG8gYG5pZG8tcmVjb3ZlcnktZG9jLWNvbXBsZXRpb246OlBvbGljeTo6aW5zdGFsbGAg4oCUCnNhbWUgc3RvbGVuLXBhc3NrZXktcmVwb2ludCBoYXJkZW5pbmcgKGBBbHJlYWR5SW5zdGFsbGVkYCBndWFyZCwgc2VlCnRoYXQgY3JhdGUncyBkb2MgY29tbWVudCBmb3IgdGhlIGZ1bGwgcmVlbnRyYW5jeSBhcmd1bWVudCk6IHplcm8tc2lnbmVyLApgQ2FsbENvbnRyYWN0KHNtYXJ0X2FjY291bnQpYC1zY29wZWQgcnVsZSBvbmx5LCBvbmUtc2hvdCBwZXIgYWNjb3VudC4AAAAAAAdpbnN0YWxsAAAAAAMAAAAAAAAADmluc3RhbGxfcGFyYW1zAAAAAAfQAAAAFVJlY292ZXJ5SW5zdGFsbFBhcmFtcwAAAAAAAAAAAAAMY29udGV4dF9ydWxlAAAH0AAAAAtDb250ZXh0UnVsZQAAAAAAAAAADXNtYXJ0X2FjY291bnQAAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAHcmV2b2tlZAAAAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAD6gAAA+4AAAAg",
        "AAAAAAAAAblVTkNPTkRJVElPTkFMTFkgUkVGVVNFUyDigJQgaWRlbnRpY2FsIHJlZW50cmFuY3ktc2FmZXR5IGFyZ3VtZW50IGFzCmBuaWRvLXprLXJlY292ZXJ5YC9gbmlkby1yZWNvdmVyeS1kb2MtY29tcGxldGlvbjo6UG9saWN5Ojp1bmluc3RhbGxgCihzZWUgZWl0aGVyJ3MgZG9jIGNvbW1lbnQpOiBmcm9tIGluc2lkZSB0aGUgYWNjb3VudCdzIG93bgpgcmVtb3ZlX2NvbnRleHRfcnVsZWAvYHJlbW92ZV9wb2xpY3lgLCBubyBjcm9zcy1jYWxsIGJhY2sgaW50byB0aGUKYWNjb3VudCBjYW4gZGlzdGluZ3Vpc2ggYSBsZWdpdGltYXRlIHRlYXJkb3duIGZyb20gYSB0aGllZidzIGZvcmdlZApkaXJlY3QgY2FsbCwgc28gYm90aCBhcmUgcmVmdXNlZDsgdGhlIGxlZ2l0aW1hdGUgcGF0aCBzdGlsbCBzdWNjZWVkcwp2aWEgT1oncyBgdHJ5X3VuaW5zdGFsbGAgcGFuaWMtc3dhbGxvd2luZy4AAAAAAAAJdW5pbnN0YWxsAAAAAAAAAgAAAAAAAAAMY29udGV4dF9ydWxlAAAH0AAAAAtDb250ZXh0UnVsZQAAAAAAAAAADXNtYXJ0X2FjY291bnQAAAAAAAATAAAAAA==",
        "AAAAAQAAAZFJbnN0YWxsIHBhcmFtZXRlcnMgZm9yIHRoaXMgYFBvbGljeWAg4oCUIHN0cnVjdHVyYWxseSBpZGVudGljYWwgdG8KYG5pZG8tcmVjb3ZlcnktZG9jLWNvbXBsZXRpb246OkRvY1JlY292ZXJ5SW5zdGFsbFBhcmFtc2AgLwpgbmlkby16ay1yZWNvdmVyeTo6WmtSZWNvdmVyeUluc3RhbGxQYXJhbXNgIChgeyB2ZXJzaW9uOiB1MzIgfWApLCBzbyB0aGUKYWNjb3VudCdzIGV4aXN0aW5nIGNvbnN0cnVjdG9yL2BlbnJvbGxfemtfcmVjb3ZlcnlgIGluc3RhbGwgcGF0aCBkZWNvZGVzCmludG8gdGhpcyB0eXBlIHVuY2hhbmdlZCAoc2VlIHRoYXQgY3JhdGUncyBkb2MgY29tbWVudCBmb3Igd2h5IOKAlApgI1tjb250cmFjdHR5cGVdYCBzdHJ1Y3RzIGVuY29kZSBzdHJ1Y3R1cmFsbHksIG5vdCBub21pbmFsbHkpLgAAAAAAAAAAAAAVUmVjb3ZlcnlJbnN0YWxsUGFyYW1zAAAAAAAAAQAAAAAAAAAHdmVyc2lvbgAAAAAE",
        "AAAAAAAAAtdBIHJldmlld2FibGUsIG9uLWNoYWluLWNvbXB1dGFibGUgY29tbWl0bWVudCB0byBgYWNjb3VudGAncyBlbnJvbGxlZApgUmVjb3ZlcnlDb25maWdgIOKAlCBgc2hhMjU2KHhkcihjb25maWcpKWAsIFNvcm9iYW4ncyBvd24gYFRvWGRyYApzZXJpYWxpemF0aW9uIChkZXRlcm1pbmlzdGljIGZvciBhIGdpdmVuIHZhbHVlOiBzYW1lIGBSZWNvdmVyeUNvbmZpZ2AKYWx3YXlzIGVuY29kZXMgdG8gdGhlIHNhbWUgYnl0ZXMpLiBUaGlzIGlzIGZvbGxvdy11cC5tZCDCpzUuNSdzCiJkb2N1bWVudCBjb21taXRtZW50IG11c3QgY292ZXIgYWxsIGF1dGhvcml0eS1iZWFyaW5nIHJlY292ZXJ5CmNvbmZpZ3VyYXRpb24iIHByb3BlcnR5LCBzYXRpc2ZpZWQgV0lUSE9VVCBlbWJlZGRpbmcgcmVjb3ZlcnkKY29uZmlndXJhdGlvbiBpbiB0aGUgYWNjb3VudCdzIG93biBQZXJjaCBwb2xpY3kgZG9jdW1lbnQg4oCUIHNlZSB0aGUKY3JhdGUgZG9jIGNvbW1lbnQncyAiS25vd24gbGltaXRzIiBmb3IgZXhhY3RseSB3aHkgdGhhdCBlbWJlZGRpbmcgaXMKYmxvY2tlZCBieSB0aGUgREVQTE9ZRUQsIHBpbm5lZCBgcGVyY2gtZG9jLWNvbXBpbGVyYCdzIHdpcmUgcHJvdG9jb2wKKGFuIGV4dGVybmFsIGRlcGVuZGVuY3kgdGhpcyBleHBlcmltZW50IGRvZXMgbm90IGNvbnRyb2wpLCBub3QgYnkgYQpnYXAgaW4gdGhpcyBjb250cmFjdC4gYE5vbmVgIGlmIGBhY2NvdW50YCBpcyBub3QgZW5yb2xsZWQuAAAAAAtjb25maWdfaGFzaAAAAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAD6AAAA+4AAAAg",
        "AAAAAAAAAAAAAAALZ2V0X2F0dGVtcHQAAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAA+gAAAfQAAAAB0F0dGVtcHQA",
        "AAAAAAAAAgFWaWV3IGNyb3NzLWNhbGxlZCBieSB0aGUgc21hcnQgYWNjb3VudCdzIGBndWFyZF9ub19wZW5kaW5nYAooYGNvbnRyYWN0cy9zbWFydC1hY2NvdW50L3NyYy9jb250cmFjdC5yc2ApLCBleGFjdGx5IGxpa2UgU3RhZ2UgMidzCmBoYXNfcGVuZGluZ2AuIEdvdmVybmVkIGJ5IGBjb25maWcucGVuZGluZ19hY3Rpdml0eV9wb2xpY3lgIOKAlCBzZWUKYFBlbmRpbmdBY3Rpdml0eVBvbGljeWAncyBkb2MgZm9yIHdoYXQgYEZyZWV6ZWAvYENvbnRpbnVlYCBlYWNoIG1lYW4uCkFuIGFjY291bnQgd2l0aCBOTyBlbnJvbGxtZW50IChuZXZlciBjYWxsZWQgYGVucm9sbGApIHRyaXZpYWxseSBoYXMKbm8gcGVuZGluZyDigJQgdGhpcyBtdXN0IG5vdCBwYW5pYyBmb3IgYW4gdW5lbnJvbGxlZCBhY2NvdW50LCBzaW5jZSB0aGUKc21hcnQgYWNjb3VudCBjcm9zcy1jYWxscyBpdCB1bmNvbmRpdGlvbmFsbHkgd2hlbmV2ZXIgQU5ZIGNvbnRyb2xsZXIKaXMgaW5zdGFsbGVkIGFzIGByZWNvdmVyeV9jb250cm9sbGVyYC4AAAAAAAALaGFzX3BlbmRpbmcAAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAE=",
        "AAAAAAAABABPcGVucyBhIG5ldyByZWNvdmVyeSBhdHRlbXB0IChgVFJBTlNJVElPTl9TUEVDLm1kYCdzIGBiZWdpbkF0dGVtcHRgKS4KUEVSTUlTU0lPTkxFU1Mg4oCUIG5vIGByZXF1aXJlX2F1dGhgIGF0IGFsbDogZGVjbGFyaW5nIGludGVudCBjYXJyaWVzCm5vIGF1dGhvcml0eSBieSBpdHNlbGYsIHJlYWwgZ2F0aW5nIGhhcHBlbnMgYXQgZXZpZGVuY2UtZHJpdmVuCnByb21vdGlvbiAoYHN1Ym1pdF9ndWFyZGlhbl9hcHByb3ZhbGAvYHN1Ym1pdF96a19wcm9vZmApLiBSZWZ1c2VzCihgQXR0ZW1wdEFscmVhZHlBY3RpdmVgKSBpZiBhIExJVkUgYXR0ZW1wdCBhbHJlYWR5IGV4aXN0cyAoIm5vIHNpbGVudApzdXBlcnNlZGUiKSDigJQgYnV0IGlmIHRoZSBleGlzdGluZyBhdHRlbXB0IGlzIHN0YWxlIChleHBpcmVkLApgQ29sbGVjdGluZ0V2aWRlbmNlYCBwYXN0IGl0cyBkZWFkbGluZSwgb3IgdGVybWluYWwpLCBpdCBpcyByZXBsYWNlZCwKcmVsZWFzaW5nIGFueSBudWxsaWZpZXIgcmVzZXJ2YXRpb24gaXQgaGVsZCBmaXJzdCAobWlycm9ycwpgbmlkby16ay1yZWNvdmVyeTo6aW5pdGlhdGVfcmVjb3ZlcnlgJ3Mgc3RhbGUtcGVuZGluZy1zdXBlcnNlZGUKc3RlcCkuCgpgYWN0aW9uID09IENvbXByb21pc2VgIE1VU1QgdGFyZ2V0IGBjb25maWcuYmFzZWxpbmVfZG9jX2hhc2hgCihgQmFzZWxpbmVNaXNtYXRjaGAgb3RoZXJ3aXNlKSDigJQgZm9sbG93LXVwLm1kIMKnNC4xL8KnNC4yOiBjb21wcm9taXNlCnJlY292ZXJ5IHJlc3RvcmVzIHRoZSBhcHByb3ZlZCBCQVNFTElORSBwbHVzIHJlcGxhY2VtZW50cywgbmV2ZXIgdGhlCmxpdmUgKHBvc3NpYmx5IGF0dGFja2VyLW1vZGlmaWVkKSBkb2N1bWVudC4gYGFjdGlvbiA9PSBMb3N0S2V5YAphY2NlcHRzIGFueSBgc291cmNlX29yX2Jhc2VsaW5lX2hhc2hgIOKAlCB0aGUgQ0FMTEVSIGNhcHR1cmVzIHRoZSBsaXZlCmRvY3VtZW50J3MgY3VycmVudCBoYXNoIGFzIHRoZSBmaXhlZCBzb3VyY2Ugc25hcHNob3QgYXQgdGhpcyBleGFjdAptb21lbnQgKMKnNC4yOiAiAAAADWJlZ2luX2F0dGVtcHQAAAAAAAAFAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAABmFjdGlvbgAAAAAH0AAAAA5SZWNvdmVyeUFjdGlvbgAAAAAAAAAAAA90YXJnZXRfZG9jX2hhc2gAAAAD7gAAACAAAAAAAAAAF3NvdXJjZV9vcl9iYXNlbGluZV9oYXNoAAAAA+4AAAAgAAAAAAAAABdyZXBsYWNlZF9jcmVkZW50aWFsX2lkcwAAAAPqAAAD7gAAACAAAAABAAAABg==",
        "AAAAAAAAAd1QRVJNSVNTSU9OTEVTUyBjYWxsZXIg4oCUIHRoZSBwcm9vZiBpdHNlbGYgaXMgdGhlIGF1dGhvcml6YXRpb24gKG1pcnJvcnMKYG5pZG8temstcmVjb3Zlcnk6OmluaXRpYXRlX3JlY292ZXJ5YDogbm8gYHJlcXVpcmVfYXV0aGAsIHRoZSBlbnRpcmUKc2VjdXJpdHkgcHJvcGVydHkgaXMgInRoZSBwcm9vZiB2ZXJpZmllcyBhZ2FpbnN0IGFuIGBhdXRoX2hhc2hgIHRoaXMKY29udHJhY3QgcmVjb21wdXRlcyBmcm9tIGl0cyBvd24ga25vd24gc3RhdGUiLCBzbyBub3RoaW5nIGlzIGdhaW5lZApieSBBTFNPIHJlcXVpcmluZyBhIHNpZ25hdHVyZSBmcm9tIHdob2V2ZXIgaGFwcGVucyB0byByZWxheSB0aGUKcHJvb2Ygb24tY2hhaW4pLiBSZWNvbXB1dGVzIGBhdXRoX2hhc2hgIGZyb20gYGF0dGVtcHQuY29tbWl0bWVudGAncwpPV04gZmllbGRzIChuZXZlciB0cnVzdHMgYSBjYWxsZXItc3VwcGxpZWQgaGFzaCkgdmlhIGB6azo6dmVyaWZ5YC4AAAAAAAAPc3VibWl0X3prX3Byb29mAAAAAAUAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAKYXR0ZW1wdF9pZAAAAAAABgAAAAAAAAAEcm9vdAAAA+4AAAAgAAAAAAAAAAludWxsaWZpZXIAAAAAAAPuAAAAIAAAAAAAAAAFcHJvb2YAAAAAAAAOAAAAAA==",
        "AAAAAAAAAT5aSyBjYW5jZWxsYXRpb24gZXZpZGVuY2Ug4oCUIFBFUk1JU1NJT05MRVNTIGNhbGxlciAoc2FtZSByZWFzb25pbmcgYXMKYHN1Ym1pdF96a19wcm9vZmApLiBUaGUgcHJvb2YncyBgYXV0aF9oYXNoYCBiaW5kcyBgYWN0aW9uID0gQ2FuY2VsYAoodmlhIGB6azo6YWN0aW9uX2NvZGVgKSwgc28gYSBjYW5jZWxsYXRpb24gcHJvb2YgY2FuIE5FVkVSIGJlIHJldXNlZAphcyBpbml0aWF0aW9uIGV2aWRlbmNlIG9yIHZpY2UgdmVyc2Eg4oCUIGNyeXB0b2dyYXBoaWMgZG9tYWluCnNlcGFyYXRpb24sIG5vdCBqdXN0IGEgc3RvcmFnZS1sYXlvdXQgc2VwYXJhdGlvbi4AAAAAABBzdWJtaXRfemtfY2FuY2VsAAAABQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAAphdHRlbXB0X2lkAAAAAAAGAAAAAAAAAARyb290AAAD7gAAACAAAAAAAAAACW51bGxpZmllcgAAAAAAA+4AAAAgAAAAAAAAAAVwcm9vZgAAAAAAAA4AAAAA",
        "AAAAAAAAAYNTUElLRS1wYXJpdHkgdmlldyAobWlycm9ycyBgbmlkby1yZWNvdmVyeS1kb2MtY29tcGxldGlvbmAncyAvCmBuaWRvLXprLXJlY292ZXJ5YCdzIGlkZW50aWNhbGx5LW5hbWVkIHZpZXcpOiBhbHdheXMgYGZhbHNlYC4gVGhpcwpleHBlcmltZW50IG9ubHkgd2lyZXMgVmFyaWFudCBBIChnYXRpbmcgdGhlIGFjY291bnQncyBFWElTVElORwpgYXBwbHlfZG9jYCksIG5ldmVyIHRoZSBhY2NvdW50J3MgcmF3IGBhZGRfY29udGV4dF9ydWxlYCBjb21wbGV0aW9uCnZlaGljbGUg4oCUIHRoZSBzbWFydCBhY2NvdW50J3MgZ3VhcmQgY3Jvc3MtY2FsbHMgdGhpcyB1bmNvbmRpdGlvbmFsbHkKd2hlbmV2ZXIgdGhpcyBjb250cm9sbGVyIGlzIGluc3RhbGxlZCwgc28gaXQgbXVzdCBleGlzdC4AAAAAEmNvbXBsZXRpb25fZ3JhbnRlZAAAAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAPhHdWFyZGlhbiBjYW5jZWxsYXRpb24gZXZpZGVuY2UgKG93biBhY3Rpb24gZG9tYWluIOKAlCBmb2xsb3ctdXAubWQKwqcyLjIpLiBEaXN0aW5jdCBzdG9yYWdlIChgQ2FuY2VsVGFsbHlgKSBmcm9tIGluaXRpYXRpb24ncwpgQXR0ZW1wdDo6Z3VhcmRpYW5fYXBwcm92YWxzYDogYSBndWFyZGlhbiB3aG8gYXBwcm92ZWQgSU5JVElBVElPTiBoYXMKYXBwcm92ZWQgbm90aGluZyBhYm91dCBDQU5DRUxMQVRJT04sIGFuZCB2aWNlIHZlcnNhLgAAABZzdWJtaXRfZ3VhcmRpYW5fY2FuY2VsAAAAAAADAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAAAAAAAACGd1YXJkaWFuAAAAEwAAAAA=",
        "AAAAAAAAAbZgZ3VhcmRpYW5gIG11c3QgYHJlcXVpcmVfYXV0aGAgKHJlYWwgU29yb2JhbiBhdXRob3JpemF0aW9uIOKAlCB0aGUKZ3VhcmRpYW4ncyBvd24gc2lnbmF0dXJlKSBhbmQgYmUgYSBtZW1iZXIgb2YgdGhlIGVucm9sbGVkCmBHdWFyZGlhblNldGAuIEEgYEd1YXJkaWFuT25seWAvYENvbWJpbmVkYCBhY2NvdW50IG9ubHkg4oCUIGBaa09ubHlgCnJlamVjdHMgd2l0aCBgTW9kZU1pc21hdGNoYCwgc2luY2UgaXQgZW5yb2xsZWQgd2l0aCBubyBndWFyZGlhbiBzZXQKYXQgYWxsIChmb2xsb3ctdXAubWQgwqc1LjIncyBIQVJEICJubyBaSyBtYWNoaW5lcnkgZm9yCmBHdWFyZGlhbk9ubHlgIiByZXF1aXJlbWVudCBpcyBzeW1tZXRyaWM6IGBaa09ubHlgIGNvcnJlc3BvbmRpbmdseQpoYXMgbm8gZ3VhcmRpYW4gbWFjaGluZXJ5IHRvIGFjY2VwdCBhbiBhcHByb3ZhbCBpbnRvKS4AAAAAABhzdWJtaXRfZ3VhcmRpYW5fYXBwcm92YWwAAAADAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAAAAAAAACGd1YXJkaWFuAAAAEwAAAAA=",
        "AAAAAgAAAONDb250ZXh0IG9mIGEgc2luZ2xlIGF1dGhvcml6ZWQgY2FsbCBwZXJmb3JtZWQgYnkgYW4gYWRkcmVzcy4KCkN1c3RvbSBhY2NvdW50IGNvbnRyYWN0cyB0aGF0IGltcGxlbWVudCBgX19jaGVja19hdXRoYCBzcGVjaWFsIGZ1bmN0aW9uCnJlY2VpdmUgYSBsaXN0IG9mIGBDb250ZXh0YCB2YWx1ZXMgY29ycmVzcG9uZGluZyB0byBhbGwgdGhlIGNhbGxzIHRoYXQKbmVlZCB0byBiZSBhdXRob3JpemVkLgAAAAAAAAAAB0NvbnRleHQAAAAAAwAAAAEAAAAUQ29udHJhY3QgaW52b2NhdGlvbi4AAAAIQ29udHJhY3QAAAABAAAH0AAAAA9Db250cmFjdENvbnRleHQAAAAAAQAAAD1Db250cmFjdCB0aGF0IGhhcyBhIGNvbnN0cnVjdG9yIHdpdGggbm8gYXJndW1lbnRzIGlzIGNyZWF0ZWQuAAAAAAAAFENyZWF0ZUNvbnRyYWN0SG9zdEZuAAAAAQAAB9AAAAAbQ3JlYXRlQ29udHJhY3RIb3N0Rm5Db250ZXh0AAAAAAEAAABEQ29udHJhY3QgdGhhdCBoYXMgYSBjb25zdHJ1Y3RvciB3aXRoIDEgb3IgbW9yZSBhcmd1bWVudHMgaXMgY3JlYXRlZC4AAAAcQ3JlYXRlQ29udHJhY3RXaXRoQ3Rvckhvc3RGbgAAAAEAAAfQAAAAKkNyZWF0ZUNvbnRyYWN0V2l0aENvbnN0cnVjdG9ySG9zdEZuQ29udGV4dAAA",
        "AAAAAQAAAL1BdXRob3JpemF0aW9uIGNvbnRleHQgb2YgYSBzaW5nbGUgY29udHJhY3QgY2FsbC4KClRoaXMgc3RydWN0IGNvcnJlc3BvbmRzIHRvIGEgYHJlcXVpcmVfYXV0aF9mb3JfYXJnc2AgY2FsbCBmb3IgYW4gYWRkcmVzcwpmcm9tIGBjb250cmFjdGAgZnVuY3Rpb24gd2l0aCBgZm5fbmFtZWAgbmFtZSBhbmQgYGFyZ3NgIGFyZ3VtZW50cy4AAAAAAAAAAAAAD0NvbnRyYWN0Q29udGV4dAAAAAADAAAAAAAAAARhcmdzAAAD6gAAAAAAAAAAAAAACGNvbnRyYWN0AAAAEwAAAAAAAAAHZm5fbmFtZQAAAAAR",
        "AAAAAgAAAF9Db250cmFjdCBleGVjdXRhYmxlIHVzZWQgZm9yIGNyZWF0aW5nIGEgbmV3IGNvbnRyYWN0IGFuZCB1c2VkIGluCmBDcmVhdGVDb250cmFjdEhvc3RGbkNvbnRleHRgLgAAAAAAAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAQAAAAEAAAAAAAAABFdhc20AAAABAAAD7gAAACA=",
        "AAAAAQAAADhWYWx1ZSBvZiBjb250cmFjdCBub2RlIGluIEludm9rZXJDb250cmFjdEF1dGhFbnRyeSB0cmVlLgAAAAAAAAAVU3ViQ29udHJhY3RJbnZvY2F0aW9uAAAAAAAAAgAAAAAAAAAHY29udGV4dAAAAAfQAAAAD0NvbnRyYWN0Q29udGV4dAAAAAAAAAAAD3N1Yl9pbnZvY2F0aW9ucwAAAAPqAAAH0AAAABhJbnZva2VyQ29udHJhY3RBdXRoRW50cnk=",
        "AAAAAgAAAS9BIG5vZGUgaW4gdGhlIHRyZWUgb2YgYXV0aG9yaXphdGlvbnMgcGVyZm9ybWVkIG9uIGJlaGFsZiBvZiB0aGUgY3VycmVudApjb250cmFjdCBhcyBpbnZva2VyIG9mIHRoZSBjb250cmFjdHMgZGVlcGVyIGluIHRoZSBjYWxsIHN0YWNrLgoKVGhpcyBpcyB1c2VkIGFzIGFuIGFyZ3VtZW50IG9mIGBhdXRob3JpemVfYXNfY3VycmVudF9jb250cmFjdGAgaG9zdCBmdW5jdGlvbi4KClRoaXMgdHJlZSBjb3JyZXNwb25kcyBgcmVxdWlyZV9hdXRoW19mb3JfYXJnc11gIGNhbGxzIG9uIGJlaGFsZiBvZiB0aGUKY3VycmVudCBjb250cmFjdC4AAAAAAAAAABhJbnZva2VyQ29udHJhY3RBdXRoRW50cnkAAAADAAAAAQAAABJJbnZva2UgYSBjb250cmFjdC4AAAAAAAhDb250cmFjdAAAAAEAAAfQAAAAFVN1YkNvbnRyYWN0SW52b2NhdGlvbgAAAAAAAAEAAAA1Q3JlYXRlIGEgY29udHJhY3QgcGFzc2luZyAwIGFyZ3VtZW50cyB0byBjb25zdHJ1Y3Rvci4AAAAAAAAUQ3JlYXRlQ29udHJhY3RIb3N0Rm4AAAABAAAH0AAAABtDcmVhdGVDb250cmFjdEhvc3RGbkNvbnRleHQAAAAAAQAAAD1DcmVhdGUgYSBjb250cmFjdCBwYXNzaW5nIDAgb3IgbW9yZSBhcmd1bWVudHMgdG8gY29uc3RydWN0b3IuAAAAAAAAHENyZWF0ZUNvbnRyYWN0V2l0aEN0b3JIb3N0Rm4AAAABAAAH0AAAACpDcmVhdGVDb250cmFjdFdpdGhDb25zdHJ1Y3Rvckhvc3RGbkNvbnRleHQAAA==",
        "AAAAAQAAAHZBdXRob3JpemF0aW9uIGNvbnRleHQgZm9yIGBjcmVhdGVfY29udHJhY3RgIGhvc3QgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEKbmV3IGNvbnRyYWN0IG9uIGJlaGFsZiBvZiBhdXRob3JpemVyIGFkZHJlc3MuAAAAAAAAAAAAG0NyZWF0ZUNvbnRyYWN0SG9zdEZuQ29udGV4dAAAAAACAAAAAAAAAApleGVjdXRhYmxlAAAAAAfQAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAAAAAARzYWx0AAAD7gAAACA=",
        "AAAAAQAAANZBdXRob3JpemF0aW9uIGNvbnRleHQgZm9yIGBjcmVhdGVfY29udHJhY3RgIGhvc3QgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEKbmV3IGNvbnRyYWN0IG9uIGJlaGFsZiBvZiBhdXRob3JpemVyIGFkZHJlc3MuClRoaXMgaXMgdGhlIHNhbWUgYXMgYENyZWF0ZUNvbnRyYWN0SG9zdEZuQ29udGV4dGAsIGJ1dCBhbHNvIGhhcwpjb250cmFjdCBjb25zdHJ1Y3RvciBhcmd1bWVudHMuAAAAAAAAAAAAKkNyZWF0ZUNvbnRyYWN0V2l0aENvbnN0cnVjdG9ySG9zdEZuQ29udGV4dAAAAAAAAwAAAAAAAAAQY29uc3RydWN0b3JfYXJncwAAA+oAAAAAAAAAAAAAAApleGVjdXRhYmxlAAAAAAfQAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAAAAAARzYWx0AAAD7gAAACA=",
        "AAAAAgAAAAAAAAAAAAAACkV4ZWN1dGFibGUAAAAAAAMAAAABAAAAAAAAAARXYXNtAAAAAQAAA+4AAAAgAAAAAAAAAAAAAAAMU3RlbGxhckFzc2V0AAAAAAAAAAAAAAAHQWNjb3VudAA=",
        "AAAABQAAADdFdmVudCBlbWl0dGVkIHdoZW4gYSBwb2xpY3kgaXMgYWRkZWQgdG8gYSBjb250ZXh0IHJ1bGUuAAAAAAAAAAALUG9saWN5QWRkZWQAAAAAAQAAAAxwb2xpY3lfYWRkZWQAAAACAAAAAAAAAA9jb250ZXh0X3J1bGVfaWQAAAAABAAAAAEAAAAAAAAACXBvbGljeV9pZAAAAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAADdFdmVudCBlbWl0dGVkIHdoZW4gYSBzaWduZXIgaXMgYWRkZWQgdG8gYSBjb250ZXh0IHJ1bGUuAAAAAAAAAAALU2lnbmVyQWRkZWQAAAAAAQAAAAxzaWduZXJfYWRkZWQAAAACAAAAAAAAAA9jb250ZXh0X3J1bGVfaWQAAAAABAAAAAEAAAAAAAAACXNpZ25lcl9pZAAAAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAADtFdmVudCBlbWl0dGVkIHdoZW4gYSBwb2xpY3kgaXMgcmVtb3ZlZCBmcm9tIGEgY29udGV4dCBydWxlLgAAAAAAAAAADVBvbGljeVJlbW92ZWQAAAAAAAABAAAADnBvbGljeV9yZW1vdmVkAAAAAAACAAAAAAAAAA9jb250ZXh0X3J1bGVfaWQAAAAABAAAAAEAAAAAAAAACXBvbGljeV9pZAAAAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAADtFdmVudCBlbWl0dGVkIHdoZW4gYSBzaWduZXIgaXMgcmVtb3ZlZCBmcm9tIGEgY29udGV4dCBydWxlLgAAAAAAAAAADVNpZ25lclJlbW92ZWQAAAAAAAABAAAADnNpZ25lcl9yZW1vdmVkAAAAAAACAAAAAAAAAA9jb250ZXh0X3J1bGVfaWQAAAAABAAAAAEAAAAAAAAACXNpZ25lcl9pZAAAAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAACtFdmVudCBlbWl0dGVkIHdoZW4gYSBjb250ZXh0IHJ1bGUgaXMgYWRkZWQuAAAAAAAAAAAQQ29udGV4dFJ1bGVBZGRlZAAAAAEAAAASY29udGV4dF9ydWxlX2FkZGVkAAAAAAAGAAAAAAAAAA9jb250ZXh0X3J1bGVfaWQAAAAABAAAAAEAAAAAAAAABG5hbWUAAAAQAAAAAAAAAAAAAAAMY29udGV4dF90eXBlAAAH0AAAAA9Db250ZXh0UnVsZVR5cGUAAAAAAAAAAAAAAAALdmFsaWRfdW50aWwAAAAD6AAAAAQAAAAAAAAAAAAAAApzaWduZXJfaWRzAAAAAAPqAAAABAAAAAAAAAAAAAAACnBvbGljeV9pZHMAAAAAA+oAAAAEAAAAAAAAAAI=",
        "AAAABQAAAEFFdmVudCBlbWl0dGVkIHdoZW4gYSBwb2xpY3kgaXMgcmVnaXN0ZXJlZCBpbiB0aGUgZ2xvYmFsIHJlZ2lzdHJ5LgAAAAAAAAAAAAAQUG9saWN5UmVnaXN0ZXJlZAAAAAEAAAARcG9saWN5X3JlZ2lzdGVyZWQAAAAAAAACAAAAAAAAAAlwb2xpY3lfaWQAAAAAAAAEAAAAAQAAAAAAAAAGcG9saWN5AAAAAAATAAAAAAAAAAI=",
        "AAAABQAAAEFFdmVudCBlbWl0dGVkIHdoZW4gYSBzaWduZXIgaXMgcmVnaXN0ZXJlZCBpbiB0aGUgZ2xvYmFsIHJlZ2lzdHJ5LgAAAAAAAAAAAAAQU2lnbmVyUmVnaXN0ZXJlZAAAAAEAAAARc2lnbmVyX3JlZ2lzdGVyZWQAAAAAAAACAAAAAAAAAAlzaWduZXJfaWQAAAAAAAAEAAAAAQAAAAAAAAAGc2lnbmVyAAAAAAfQAAAABlNpZ25lcgAAAAAAAAAAAAI=",
        "AAAABAAAAClFcnJvciBjb2RlcyBmb3Igc21hcnQgYWNjb3VudCBvcGVyYXRpb25zLgAAAAAAAAAAAAARU21hcnRBY2NvdW50RXJyb3IAAAAAAAAQAAAAKlRoZSBzcGVjaWZpZWQgY29udGV4dCBydWxlIGRvZXMgbm90IGV4aXN0LgAAAAAAE0NvbnRleHRSdWxlTm90Rm91bmQAAAALuAAAADpUaGUgcHJvdmlkZWQgY29udGV4dCBjYW5ub3QgYmUgdmFsaWRhdGVkIGFnYWluc3QgYW55IHJ1bGUuAAAAAAASVW52YWxpZGF0ZWRDb250ZXh0AAAAAAu6AAAAJ0V4dGVybmFsIHNpZ25hdHVyZSB2ZXJpZmljYXRpb24gZmFpbGVkLgAAAAAaRXh0ZXJuYWxWZXJpZmljYXRpb25GYWlsZWQAAAAAC7sAAAA1Q29udGV4dCBydWxlIG11c3QgaGF2ZSBhdCBsZWFzdCBvbmUgc2lnbmVyIG9yIHBvbGljeS4AAAAAAAAUTm9TaWduZXJzQW5kUG9saWNpZXMAAAu8AAAAKVRoZSB2YWxpZF91bnRpbCB0aW1lc3RhbXAgaXMgaW4gdGhlIHBhc3QuAAAAAAAADlBhc3RWYWxpZFVudGlsAAAAAAu9AAAAI1RoZSBzcGVjaWZpZWQgc2lnbmVyIHdhcyBub3QgZm91bmQuAAAAAA5TaWduZXJOb3RGb3VuZAAAAAALvgAAAC5UaGUgc2lnbmVyIGFscmVhZHkgZXhpc3RzIGluIHRoZSBjb250ZXh0IHJ1bGUuAAAAAAAPRHVwbGljYXRlU2lnbmVyAAAAC78AAAAjVGhlIHNwZWNpZmllZCBwb2xpY3kgd2FzIG5vdCBmb3VuZC4AAAAADlBvbGljeU5vdEZvdW5kAAAAAAvAAAAALlRoZSBwb2xpY3kgYWxyZWFkeSBleGlzdHMgaW4gdGhlIGNvbnRleHQgcnVsZS4AAAAAAA9EdXBsaWNhdGVQb2xpY3kAAAALwQAAACVUb28gbWFueSBzaWduZXJzIGluIHRoZSBjb250ZXh0IHJ1bGUuAAAAAAAADlRvb01hbnlTaWduZXJzAAAAAAvCAAAAJlRvbyBtYW55IHBvbGljaWVzIGluIHRoZSBjb250ZXh0IHJ1bGUuAAAAAAAPVG9vTWFueVBvbGljaWVzAAAAC8MAAACGQW4gaW50ZXJuYWwgSUQgY291bnRlciAoY29udGV4dCBydWxlLCBzaWduZXIsIG9yIHBvbGljeSkgaGFzIHJlYWNoZWQKaXRzIG1heGltdW0gdmFsdWUgKGB1MzI6Ok1BWGApIGFuZCBjYW5ub3QgYmUgaW5jcmVtZW50ZWQgZnVydGhlci4AAAAAAAxNYXRoT3ZlcmZsb3cAAAvEAAAAOkV4dGVybmFsIHNpZ25lciBrZXkgZGF0YSBleGNlZWRzIHRoZSBtYXhpbXVtIGFsbG93ZWQgc2l6ZS4AAAAAAA9LZXlEYXRhVG9vTGFyZ2UAAAALxQAAADxjb250ZXh0X3J1bGVfaWRzIGxlbmd0aCBkb2VzIG5vdCBtYXRjaCBhdXRoX2NvbnRleHRzIGxlbmd0aC4AAAAcQ29udGV4dFJ1bGVJZHNMZW5ndGhNaXNtYXRjaAAAC8YAAAA1Q29udGV4dCBydWxlIG5hbWUgZXhjZWVkcyB0aGUgbWF4aW11bSBhbGxvd2VkIGxlbmd0aC4AAAAAAAALTmFtZVRvb0xvbmcAAAALxwAAAENBIHNpZ25lciBpbiBgQXV0aFBheWxvYWRgIGlzIG5vdCBwYXJ0IG9mIGFueSBzZWxlY3RlZCBjb250ZXh0IHJ1bGUuAAAAABJVbmF1dGhvcml6ZWRTaWduZXIAAAAAC8g=",
        "AAAABQAAAC1FdmVudCBlbWl0dGVkIHdoZW4gYSBjb250ZXh0IHJ1bGUgaXMgcmVtb3ZlZC4AAAAAAAAAAAAAEkNvbnRleHRSdWxlUmVtb3ZlZAAAAAAAAQAAABRjb250ZXh0X3J1bGVfcmVtb3ZlZAAAAAEAAAAAAAAAD2NvbnRleHRfcnVsZV9pZAAAAAAEAAAAAQAAAAI=",
        "AAAABQAAAEVFdmVudCBlbWl0dGVkIHdoZW4gYSBwb2xpY3kgaXMgZGVyZWdpc3RlcmVkIGZyb20gdGhlIGdsb2JhbCByZWdpc3RyeS4AAAAAAAAAAAAAElBvbGljeURlcmVnaXN0ZXJlZAAAAAAAAQAAABNwb2xpY3lfZGVyZWdpc3RlcmVkAAAAAAEAAAAAAAAACXBvbGljeV9pZAAAAAAAAAQAAAABAAAAAg==",
        "AAAABQAAAEVFdmVudCBlbWl0dGVkIHdoZW4gYSBzaWduZXIgaXMgZGVyZWdpc3RlcmVkIGZyb20gdGhlIGdsb2JhbCByZWdpc3RyeS4AAAAAAAAAAAAAElNpZ25lckRlcmVnaXN0ZXJlZAAAAAAAAQAAABNzaWduZXJfZGVyZWdpc3RlcmVkAAAAAAEAAAAAAAAACXNpZ25lcl9pZAAAAAAAAAQAAAABAAAAAg==",
        "AAAABQAAAEJFdmVudCBlbWl0dGVkIHdoZW4gYSBjb250ZXh0IHJ1bGUgbmFtZSBvciB2YWxpZF91bnRpbCBhcmUgdXBkYXRlZC4AAAAAAAAAAAAWQ29udGV4dFJ1bGVNZXRhVXBkYXRlZAAAAAAAAQAAABljb250ZXh0X3J1bGVfbWV0YV91cGRhdGVkAAAAAAAAAwAAAAAAAAAPY29udGV4dF9ydWxlX2lkAAAAAAQAAAABAAAAAAAAAARuYW1lAAAAEAAAAAAAAAAAAAAAC3ZhbGlkX3VudGlsAAAAA+gAAAAEAAAAAAAAAAI=",
        "AAAAAgAAAEJSZXByZXNlbnRzIGRpZmZlcmVudCB0eXBlcyBvZiBzaWduZXJzIGluIHRoZSBzbWFydCBhY2NvdW50IHN5c3RlbS4AAAAAAAAAAAAGU2lnbmVyAAAAAAACAAAAAQAAAD1BIGRlbGVnYXRlZCBzaWduZXIgdGhhdCB1c2VzIGJ1aWx0LWluIHNpZ25hdHVyZSB2ZXJpZmljYXRpb24uAAAAAAAACURlbGVnYXRlZAAAAAAAAAEAAAATAAAAAQAAAHJBbiBleHRlcm5hbCBzaWduZXIgd2l0aCBjdXN0b20gdmVyaWZpY2F0aW9uIGxvZ2ljLgpDb250YWlucyB0aGUgdmVyaWZpZXIgY29udHJhY3QgYWRkcmVzcyBhbmQgdGhlIHB1YmxpYyBrZXkgZGF0YS4AAAAAAAhFeHRlcm5hbAAAAAIAAAATAAAADg==",
        "AAAAAQAABABUaGUgYXV0aG9yaXphdGlvbiBwYXlsb2FkIHBhc3NlZCB0byBgX19jaGVja19hdXRoYCwgYnVuZGxpbmcgY3J5cHRvZ3JhcGhpYwpwcm9vZnMgd2l0aCBjb250ZXh0IHJ1bGUgc2VsZWN0aW9uLgoKVGhpcyBzdHJ1Y3QgY2FycmllcyB0d28gZGlzdGluY3QgcGllY2VzIG9mIGluZm9ybWF0aW9uIHRoYXQgYXJlIGJvdGgKcmVxdWlyZWQgZm9yIGF1dGhvcml6YXRpb24gYnV0IGNhbm5vdCBiZSBkZXJpdmVkIGZyb20gZWFjaCBvdGhlcjoKCi0gYHNpZ25lcnNgIG1hcHMgZWFjaCBbYFNpZ25lcmBdIHRvIGl0cyByYXcgc2lnbmF0dXJlIGJ5dGVzLCBwcm92aWRpbmcKY3J5cHRvZ3JhcGhpYyBwcm9vZiB0aGF0IHRoZSBzaWduZXIgYWN0dWFsbHkgc2lnbmVkIHRoZSB0cmFuc2FjdGlvbgpwYXlsb2FkLiBBIGNvbnRleHQgcnVsZSBzdG9yZXMgd2hpY2ggc2lnbmVyICppZGVudGl0aWVzKiBhcmUgYXV0aG9yaXplZAoodmlhIGBzaWduZXJfaWRzYCksIGJ1dCB0aGUgcnVsZSBkb2VzIG5vdCBjb250YWluIHRoZSBzaWduYXR1cmVzCnRoZW1zZWx2ZXMg4oCUIHRob3NlIG11c3QgYmUgc3VwcGxpZWQgaGVyZS4KCi0gYGNvbnRleHRfcnVsZV9pZHNgIHRlbGxzIHRoZSBzeXN0ZW0gd2hpY2ggcnVsZSB0byB2YWxpZGF0ZSBmb3IgZWFjaCBhdXRoCmNvbnRleHQuIEJlY2F1c2UgbXVsdGlwbGUgcnVsZXMgY2FuIGV4aXN0IGZvciB0aGUgc2FtZSBjb250ZXh0IHR5cGUsIHRoZQpjYWxsZXIgbXVzdCBleHBsaWNpdGx5IHNlbGVjdCBvbmUgcGVyIGNvbnRleHQgcmF0aGVyIHRoYW4gcmVseWluZyBvbgphdXRvLWRpc2NvdmVyeS4gRWFjaCBlbnRyeSBpcyBhbGlnbmVkIGJ5IGluZGV4IHdpdGggdGhlIGBhdXRoX2NvbnRleHRzYApwYXNzZWQgdG8gYF9fY2hlY2tfYXV0aGAuCgpUaGUgbGVuZ3RoIG9mIGBjb250ZXh0X3J1bGVfaWRzYCBtdXN0IGVxdWFsIHRoZSBudW1iZXIgb2YgYXV0aCBjb250ZXh0czsKYSBtaXNtYXRjaCBpcyByZWplY3RlZCB3aXRoCltgU21hcnRBY2NvdW50RXJyb3I6OkNvbnRleHRSdWxlSWRzTGVuAAAAAAAAAAtBdXRoUGF5bG9hZAAAAAACAAAAPFBlci1jb250ZXh0IHJ1bGUgSURzLCBhbGlnbmVkIGJ5IGluZGV4IHdpdGggYGF1dGhfY29udGV4dHNgLgAAABBjb250ZXh0X3J1bGVfaWRzAAAD6gAAAAQAAAAlU2lnbmF0dXJlIGRhdGEgbWFwcGVkIHRvIGVhY2ggc2lnbmVyLgAAAAAAAAdzaWduZXJzAAAAA+wAAAfQAAAABlNpZ25lcgAAAAAADg==",
        "AAAAAQAAADxBIGNvbXBsZXRlIGNvbnRleHQgcnVsZSBkZWZpbmluZyBhdXRob3JpemF0aW9uIHJlcXVpcmVtZW50cy4AAAAAAAAAC0NvbnRleHRSdWxlAAAAAAgAAAApVGhlIHR5cGUgb2YgY29udGV4dCB0aGlzIHJ1bGUgYXBwbGllcyB0by4AAAAAAAAMY29udGV4dF90eXBlAAAH0AAAAA9Db250ZXh0UnVsZVR5cGUAAAAAJ1VuaXF1ZSBpZGVudGlmaWVyIGZvciB0aGUgY29udGV4dCBydWxlLgAAAAACaWQAAAAAAAQAAAApSHVtYW4tcmVhZGFibGUgbmFtZSBmb3IgdGhlIGNvbnRleHQgcnVsZS4AAAAAAAAEbmFtZQAAABAAAAAwTGlzdCBvZiBwb2xpY3kgY29udHJhY3RzIHRoYXQgbXVzdCBiZSBzYXRpc2ZpZWQuAAAACHBvbGljaWVzAAAD6gAAABMAAABKR2xvYmFsIHJlZ2lzdHJ5IElEcyBmb3IgZWFjaCBwb2xpY3ksIHBvc2l0aW9uYWxseSBhbGlnbmVkIHdpdGgKYHBvbGljaWVzYC4AAAAAAApwb2xpY3lfaWRzAAAAAAPqAAAABAAAAElHbG9iYWwgcmVnaXN0cnkgSURzIGZvciBlYWNoIHNpZ25lciwgcG9zaXRpb25hbGx5IGFsaWduZWQgd2l0aApgc2lnbmVyc2AuAAAAAAAACnNpZ25lcl9pZHMAAAAAA+oAAAAEAAAAKExpc3Qgb2Ygc2lnbmVycyBhdXRob3JpemVkIGJ5IHRoaXMgcnVsZS4AAAAHc2lnbmVycwAAAAPqAAAH0AAAAAZTaWduZXIAAAAAADFPcHRpb25hbCBleHBpcmF0aW9uIGxlZGdlciBzZXF1ZW5jZSBmb3IgdGhlIHJ1bGUuAAAAAAAAC3ZhbGlkX3VudGlsAAAAA+gAAAAE",
        "AAAAAQAAAElDb21iaW5lcyBwb2xpY3kgZGF0YSBhbmQgaXRzIHJlZmVyZW5jZSBjb3VudCBpbnRvIGEgc2luZ2xlIHN0b3JhZ2UgZW50cnkuAAAAAAAAAAAAAAtQb2xpY3lFbnRyeQAAAAACAAAAME51bWJlciBvZiBjb250ZXh0IHJ1bGVzIHJlZmVyZW5jaW5nIHRoaXMgcG9saWN5LgAAAAVjb3VudAAAAAAAAAQAAAAxVGhlIHBvbGljeSBhZGRyZXNzIHN0b3JlZCBpbiB0aGUgZ2xvYmFsIHJlZ2lzdHJ5LgAAAAAAAAZwb2xpY3kAAAAAABM=",
        "AAAAAQAAAElDb21iaW5lcyBzaWduZXIgZGF0YSBhbmQgaXRzIHJlZmVyZW5jZSBjb3VudCBpbnRvIGEgc2luZ2xlIHN0b3JhZ2UgZW50cnkuAAAAAAAAAAAAAAtTaWduZXJFbnRyeQAAAAACAAAAME51bWJlciBvZiBjb250ZXh0IHJ1bGVzIHJlZmVyZW5jaW5nIHRoaXMgc2lnbmVyLgAAAAVjb3VudAAAAAAAAAQAAAApVGhlIHNpZ25lciBzdG9yZWQgaW4gdGhlIGdsb2JhbCByZWdpc3RyeS4AAAAAAAAGc2lnbmVyAAAAAAfQAAAABlNpZ25lcgAA",
        "AAAAAgAAAEBUeXBlcyBvZiBjb250ZXh0cyB0aGF0IGNhbiBiZSBhdXRob3JpemVkIGJ5IHNtYXJ0IGFjY291bnQgcnVsZXMuAAAAAAAAAA9Db250ZXh0UnVsZVR5cGUAAAAAAwAAAAAAAAAtRGVmYXVsdCBydWxlcyB0aGF0IGNhbiBhdXRob3JpemUgYW55IGNvbnRleHQuAAAAAAAAB0RlZmF1bHQAAAAAAQAAADBSdWxlcyBzcGVjaWZpYyB0byBjYWxsaW5nIGEgcGFydGljdWxhciBjb250cmFjdC4AAAAMQ2FsbENvbnRyYWN0AAAAAQAAABMAAAABAAAAQlJ1bGVzIHNwZWNpZmljIHRvIGNyZWF0aW5nIGEgY29udHJhY3Qgd2l0aCBhIHBhcnRpY3VsYXIgV0FTTSBoYXNoLgAAAAAADkNyZWF0ZUNvbnRyYWN0AAAAAAABAAAD7gAAACA=",
        "AAAAAQAAAJNDb21iaW5lcyBjb250ZXh0IHJ1bGUgbWV0YWRhdGEsIHNpZ25lciBJRHMsIGFuZCBwb2xpY3kgYWRkcmVzc2VzIGludG8gYQpzaW5nbGUgc3RvcmFnZSBlbnRyeSwgcmVkdWNpbmcgcGVyc2lzdGVudCByZWFkcyBwZXIgYXV0aCBjaGVjayBmcm9tIDMgdG8gMS4AAAAAAAAAABBDb250ZXh0UnVsZUVudHJ5AAAABQAAAClUaGUgdHlwZSBvZiBjb250ZXh0IHRoaXMgcnVsZSBhcHBsaWVzIHRvLgAAAAAAAAxjb250ZXh0X3R5cGUAAAfQAAAAD0NvbnRleHRSdWxlVHlwZQAAAAApSHVtYW4tcmVhZGFibGUgbmFtZSBmb3IgdGhlIGNvbnRleHQgcnVsZS4AAAAAAAAEbmFtZQAAABAAAAAjUG9saWN5IElEcyByZWZlcmVuY2VkIGJ5IHRoaXMgcnVsZS4AAAAACnBvbGljeV9pZHMAAAAAA+oAAAAEAAAAKkdsb2JhbCBzaWduZXIgSURzIHJlZmVyZW5jZWQgYnkgdGhpcyBydWxlLgAAAAAACnNpZ25lcl9pZHMAAAAAA+oAAAAEAAAAJE9wdGlvbmFsIGV4cGlyYXRpb24gbGVkZ2VyIHNlcXVlbmNlLgAAAAt2YWxpZF91bnRpbAAAAAPoAAAABA==",
        "AAAAAgAAACRTdG9yYWdlIGtleXMgZm9yIHNtYXJ0IGFjY291bnQgZGF0YS4AAAAAAAAAFlNtYXJ0QWNjb3VudFN0b3JhZ2VLZXkAAAAAAAkAAAABAAAAlVN0b3JhZ2Uga2V5IGZvciBjb21iaW5lZCBjb250ZXh0IHJ1bGUgZGF0YS4KTWFwcyBjb250ZXh0IHJ1bGUgSUQgdG8gYENvbnRleHRSdWxlRW50cnlgIChzaWduZXIgSURzLCBwb2xpY2llcywgYW5kCm1ldGFkYXRhIHN0b3JlZCBpbiBhIHNpbmdsZSBlbnRyeSkuAAAAAAAAD0NvbnRleHRSdWxlRGF0YQAAAAABAAAABAAAAAAAAAAzU3RvcmFnZSBrZXkgZm9yIHRoZSBuZXh0IGF2YWlsYWJsZSBjb250ZXh0IHJ1bGUgSUQuAAAAAAZOZXh0SWQAAAAAAAAAAAAyU3RvcmFnZSBrZXkgZm9yIHRoZSBjb3VudCBvZiBhY3RpdmUgY29udGV4dCBydWxlcy4AAAAAAAVDb3VudAAAAAAAAAEAAABnU3RvcmFnZSBrZXkgZm9yIGdsb2JhbCBzaWduZXIgZGF0YS4KTWFwcyBzaWduZXIgSUQgdG8gYFNpZ25lckVudHJ5YCAoc3RvcmVkIG9uY2UsIHJlZmVyZW5jZWQgYnkgcnVsZXMpLgAAAAAKU2lnbmVyRGF0YQAAAAAAAQAAAAQAAAABAAAAYFN0b3JhZ2Uga2V5IGZvciBzaWduZXIgbG9va3VwIGJ5IGhhc2guCk1hcHMgYHNoYTI1NihTaWduZXIgWERSKWAgdG8gc2lnbmVyIElEIGZvciBkZWR1cGxpY2F0aW9uLgAAAAxTaWduZXJMb29rdXAAAAABAAAD7gAAACAAAAAAAAAAT1N0b3JhZ2Uga2V5IGZvciB0aGUgbmV4dCBhdmFpbGFibGUgZ2xvYmFsIHNpZ25lciBJRCAobW9ub3RvbmljYWxseQppbmNyZWFzaW5nKS4AAAAADE5leHRTaWduZXJJZAAAAAEAAABEU3RvcmFnZSBrZXkgZm9yIGdsb2JhbCBwb2xpY3kgZGF0YS4KTWFwcyBwb2xpY3kgSUQgdG8gYFBvbGljeUVudHJ5YC4AAAAKUG9saWN5RGF0YQAAAAAAAQAAAAQAAAABAAAAY1N0b3JhZ2Uga2V5IGZvciBwb2xpY3kgbG9va3VwIGJ5IGFkZHJlc3MuCk1hcHMgcG9saWN5IGBBZGRyZXNzYCB0byBpdHMgcG9saWN5IElEIGZvciBkZWR1cGxpY2F0aW9uLgAAAAAMUG9saWN5TG9va3VwAAAAAQAAABMAAAAAAAAAT1N0b3JhZ2Uga2V5IGZvciB0aGUgbmV4dCBhdmFpbGFibGUgZ2xvYmFsIHBvbGljeSBJRCAobW9ub3RvbmljYWxseQppbmNyZWFzaW5nKS4AAAAADE5leHRQb2xpY3lJZA==",
        "AAAAAQAAADBJbmRpdmlkdWFsIHNwZW5kaW5nIGVudHJ5IGZvciB0cmFja2luZyBwdXJwb3Nlcy4AAAAAAAAADVNwZW5kaW5nRW50cnkAAAAAAAACAAAAJVRoZSBhbW91bnQgc3BlbnQgaW4gdGhpcyB0cmFuc2FjdGlvbi4AAAAAAAAGYW1vdW50AAAAAAALAAAAM1RoZSBsZWRnZXIgc2VxdWVuY2Ugd2hlbiB0aGlzIHRyYW5zYWN0aW9uIG9jY3VycmVkLgAAAAAPbGVkZ2VyX3NlcXVlbmNlAAAAAAQ=",
        "AAAAAQAAADdJbnRlcm5hbCBzdG9yYWdlIHN0cnVjdHVyZSBmb3Igc3BlbmRpbmcgbGltaXQgdHJhY2tpbmcuAAAAAAAAAAARU3BlbmRpbmdMaW1pdERhdGEAAAAAAAAEAAAAMENhY2hlZCB0b3RhbCBvZiBhbGwgYW1vdW50cyBpbiBzcGVuZGluZ19oaXN0b3J5LgAAABJjYWNoZWRfdG90YWxfc3BlbnQAAAAAAAsAAAA8VGhlIHBlcmlvZCBpbiBsZWRnZXJzIG92ZXIgd2hpY2ggdGhlIHNwZW5kaW5nIGxpbWl0IGFwcGxpZXMuAAAADnBlcmlvZF9sZWRnZXJzAAAAAAAEAAAAPUhpc3Rvcnkgb2Ygc3BlbmRpbmcgdHJhbnNhY3Rpb25zIHdpdGggdGhlaXIgbGVkZ2VyIHNlcXVlbmNlcy4AAAAAAAAQc3BlbmRpbmdfaGlzdG9yeQAAA+oAAAfQAAAADVNwZW5kaW5nRW50cnkAAAAAAAAiVGhlIHNwZW5kaW5nIGxpbWl0IGZvciB0aGUgcGVyaW9kLgAAAAAADnNwZW5kaW5nX2xpbWl0AAAAAAAL",
        "AAAABAAAADFFcnJvciBjb2RlcyBmb3Igc3BlbmRpbmcgbGltaXQgcG9saWN5IG9wZXJhdGlvbnMuAAAAAAAAAAAAABJTcGVuZGluZ0xpbWl0RXJyb3IAAAAAAAgAAABCVGhlIHNtYXJ0IGFjY291bnQgZG9lcyBub3QgaGF2ZSBhIHNwZW5kaW5nIGxpbWl0IHBvbGljeSBpbnN0YWxsZWQuAAAAAAAYU21hcnRBY2NvdW50Tm90SW5zdGFsbGVkAAAMlAAAACVUaGUgc3BlbmRpbmcgbGltaXQgaGFzIGJlZW4gZXhjZWVkZWQuAAAAAAAAFVNwZW5kaW5nTGltaXRFeGNlZWRlZAAAAAAADJUAAAAoVGhlIHNwZW5kaW5nIGxpbWl0IG9yIHBlcmlvZCBpcyBpbnZhbGlkLgAAABRJbnZhbGlkTGltaXRPclBlcmlvZAAADJYAAAAuVGhlIHRyYW5zYWN0aW9uIGlzIG5vdCBhbGxvd2VkIGJ5IHRoaXMgcG9saWN5LgAAAAAACk5vdEFsbG93ZWQAAAAADJcAAAAyVGhlIHNwZW5kaW5nIGhpc3RvcnkgaGFzIHJlYWNoZWQgbWF4aW11bSBjYXBhY2l0eS4AAAAAABdIaXN0b3J5Q2FwYWNpdHlFeGNlZWRlZAAAAAyYAAAAQlRoZSBjb250ZXh0IHJ1bGUgZm9yIHRoZSBzbWFydCBhY2NvdW50IGhhcyBiZWVuIGFscmVhZHkgaW5zdGFsbGVkLgAAAAAAEEFscmVhZHlJbnN0YWxsZWQAAAyZAAAAIFRoZSB0cmFuc2ZlciBhbW91bnQgaXMgbmVnYXRpdmUuAAAADExlc3NUaGFuWmVybwAADJoAAAA1T25seSB0aGUgYENhbGxDb250cmFjdGAgY29udGV4dCBydWxlIHR5cGUgaXMgYWxsb3dlZC4AAAAAAAAXT25seUNhbGxDb250cmFjdEFsbG93ZWQAAAAMmw==",
        "AAAABQAAADdFdmVudCBlbWl0dGVkIHdoZW4gdGhlIHNwZW5kaW5nIGxpbWl0IHZhbHVlIGlzIGNoYW5nZWQuAAAAAAAAAAAUU3BlbmRpbmdMaW1pdENoYW5nZWQAAAABAAAAFnNwZW5kaW5nX2xpbWl0X2NoYW5nZWQAAAAAAAMAAAAAAAAADXNtYXJ0X2FjY291bnQAAAAAAAATAAAAAQAAAAAAAAAPY29udGV4dF9ydWxlX2lkAAAAAAQAAAAAAAAAAAAAAA5zcGVuZGluZ19saW1pdAAAAAAACwAAAAAAAAAC",
        "AAAABQAAADdFdmVudCBlbWl0dGVkIHdoZW4gYSBzcGVuZGluZyBsaW1pdCBwb2xpY3kgaXMgZW5mb3JjZWQuAAAAAAAAAAAVU3BlbmRpbmdMaW1pdEVuZm9yY2VkAAAAAAAAAQAAABdzcGVuZGluZ19saW1pdF9lbmZvcmNlZAAAAAAFAAAAAAAAAA1zbWFydF9hY2NvdW50AAAAAAAAEwAAAAEAAAAAAAAAB2NvbnRleHQAAAAH0AAAAAdDb250ZXh0AAAAAAAAAAAAAAAAD2NvbnRleHRfcnVsZV9pZAAAAAAEAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAAAAAAVdG90YWxfc3BlbnRfaW5fcGVyaW9kAAAAAAAACwAAAAAAAAAC",
        "AAAABQAAADhFdmVudCBlbWl0dGVkIHdoZW4gYSBzcGVuZGluZyBsaW1pdCBwb2xpY3kgaXMgaW5zdGFsbGVkLgAAAAAAAAAWU3BlbmRpbmdMaW1pdEluc3RhbGxlZAAAAAAAAQAAABhzcGVuZGluZ19saW1pdF9pbnN0YWxsZWQAAAAEAAAAAAAAAA1zbWFydF9hY2NvdW50AAAAAAAAEwAAAAEAAAAAAAAAD2NvbnRleHRfcnVsZV9pZAAAAAAEAAAAAAAAAAAAAAAOc3BlbmRpbmdfbGltaXQAAAAAAAsAAAAAAAAAAAAAAA5wZXJpb2RfbGVkZ2VycwAAAAAABAAAAAAAAAAC",
        "AAAAAgAAACxTdG9yYWdlIGtleXMgZm9yIHNwZW5kaW5nIGxpbWl0IHBvbGljeSBkYXRhLgAAAAAAAAAXU3BlbmRpbmdMaW1pdFN0b3JhZ2VLZXkAAAAAAQAAAAEAAABEU3RvcmFnZSBrZXkgZm9yIHNwZW5kaW5nIGxpbWl0IGRhdGEgb2YgYSBzbWFydCBhY2NvdW50IGNvbnRleHQgcnVsZS4AAAAOQWNjb3VudENvbnRleHQAAAAAAAIAAAATAAAABA==",
        "AAAABQAAADpFdmVudCBlbWl0dGVkIHdoZW4gYSBzcGVuZGluZyBsaW1pdCBwb2xpY3kgaXMgdW5pbnN0YWxsZWQuAAAAAAAAAAAAGFNwZW5kaW5nTGltaXRVbmluc3RhbGxlZAAAAAEAAAAac3BlbmRpbmdfbGltaXRfdW5pbnN0YWxsZWQAAAAAAAIAAAAAAAAADXNtYXJ0X2FjY291bnQAAAAAAAATAAAAAQAAAAAAAAAPY29udGV4dF9ydWxlX2lkAAAAAAQAAAAAAAAAAg==",
        "AAAAAQAAADZJbnN0YWxsYXRpb24gcGFyYW1ldGVycyBmb3IgdGhlIHNwZW5kaW5nIGxpbWl0IHBvbGljeS4AAAAAAAAAAAAaU3BlbmRpbmdMaW1pdEFjY291bnRQYXJhbXMAAAAAAAIAAAA8VGhlIHBlcmlvZCBpbiBsZWRnZXJzIG92ZXIgd2hpY2ggdGhlIHNwZW5kaW5nIGxpbWl0IGFwcGxpZXMuAAAADnBlcmlvZF9sZWRnZXJzAAAAAAAEAAAATlRoZSBtYXhpbXVtIGFtb3VudCB0aGF0IGNhbiBiZSBzcGVudCB3aXRoaW4gdGhlIHNwZWNpZmllZCBwZXJpb2QgKGluCnN0cm9vcHMpLgAAAAAADnNwZW5kaW5nX2xpbWl0AAAAAAAL",
        "AAAABQAAADlFdmVudCBlbWl0dGVkIHdoZW4gYSBzaW1wbGUgdGhyZXNob2xkIHBvbGljeSBpcyBlbmZvcmNlZC4AAAAAAAAAAAAADlNpbXBsZUVuZm9yY2VkAAAAAAABAAAAD3NpbXBsZV9lbmZvcmNlZAAAAAAEAAAAAAAAAA1zbWFydF9hY2NvdW50AAAAAAAAEwAAAAEAAAAAAAAAB2NvbnRleHQAAAAH0AAAAAdDb250ZXh0AAAAAAAAAAAAAAAAD2NvbnRleHRfcnVsZV9pZAAAAAAEAAAAAAAAAAAAAAAVYXV0aGVudGljYXRlZF9zaWduZXJzAAAAAAAD6gAAB9AAAAAGU2lnbmVyAAAAAAAAAAAAAg==",
        "AAAABQAAADpFdmVudCBlbWl0dGVkIHdoZW4gYSBzaW1wbGUgdGhyZXNob2xkIHBvbGljeSBpcyBpbnN0YWxsZWQuAAAAAAAAAAAAD1NpbXBsZUluc3RhbGxlZAAAAAABAAAAEHNpbXBsZV9pbnN0YWxsZWQAAAADAAAAAAAAAA1zbWFydF9hY2NvdW50AAAAAAAAEwAAAAEAAAAAAAAAD2NvbnRleHRfcnVsZV9pZAAAAAAEAAAAAAAAAAAAAAAJdGhyZXNob2xkAAAAAAAABAAAAAAAAAAC",
        "AAAABQAAADxFdmVudCBlbWl0dGVkIHdoZW4gYSBzaW1wbGUgdGhyZXNob2xkIHBvbGljeSBpcyB1bmluc3RhbGxlZC4AAAAAAAAAEVNpbXBsZVVuaW5zdGFsbGVkAAAAAAAAAQAAABJzaW1wbGVfdW5pbnN0YWxsZWQAAAAAAAIAAAAAAAAADXNtYXJ0X2FjY291bnQAAAAAAAATAAAAAQAAAAAAAAAPY29udGV4dF9ydWxlX2lkAAAAAAQAAAAAAAAAAg==",
        "AAAABAAAADNFcnJvciBjb2RlcyBmb3Igc2ltcGxlIHRocmVzaG9sZCBwb2xpY3kgb3BlcmF0aW9ucy4AAAAAAAAAABRTaW1wbGVUaHJlc2hvbGRFcnJvcgAAAAQAAABEVGhlIHNtYXJ0IGFjY291bnQgZG9lcyBub3QgaGF2ZSBhIHNpbXBsZSB0aHJlc2hvbGQgcG9saWN5IGluc3RhbGxlZC4AAAAYU21hcnRBY2NvdW50Tm90SW5zdGFsbGVkAAAMgAAAAD9XaGVuIHRocmVzaG9sZCBpcyAwIG9yIGV4Y2VlZHMgdGhlIG51bWJlciBvZiBhdmFpbGFibGUgc2lnbmVycy4AAAAAEEludmFsaWRUaHJlc2hvbGQAAAyBAAAALlRoZSB0cmFuc2FjdGlvbiBpcyBub3QgYWxsb3dlZCBieSB0aGlzIHBvbGljeS4AAAAAAApOb3RBbGxvd2VkAAAAAAyCAAAAQlRoZSBjb250ZXh0IHJ1bGUgZm9yIHRoZSBzbWFydCBhY2NvdW50IGhhcyBiZWVuIGFscmVhZHkgaW5zdGFsbGVkLgAAAAAAEEFscmVhZHlJbnN0YWxsZWQAAAyD",
        "AAAABQAAAElFdmVudCBlbWl0dGVkIHdoZW4gdGhlIHRocmVzaG9sZCBvZiBhIHNpbXBsZSB0aHJlc2hvbGQgcG9saWN5IGlzIGNoYW5nZWQuAAAAAAAAAAAAABZTaW1wbGVUaHJlc2hvbGRDaGFuZ2VkAAAAAAABAAAAGHNpbXBsZV90aHJlc2hvbGRfY2hhbmdlZAAAAAMAAAAAAAAADXNtYXJ0X2FjY291bnQAAAAAAAATAAAAAQAAAAAAAAAPY29udGV4dF9ydWxlX2lkAAAAAAQAAAAAAAAAAAAAAAl0aHJlc2hvbGQAAAAAAAAEAAAAAAAAAAI=",
        "AAAAAgAAAC5TdG9yYWdlIGtleXMgZm9yIHNpbXBsZSB0aHJlc2hvbGQgcG9saWN5IGRhdGEuAAAAAAAAAAAAGVNpbXBsZVRocmVzaG9sZFN0b3JhZ2VLZXkAAAAAAAABAAAAAQAAAAAAAAAOQWNjb3VudENvbnRleHQAAAAAAAIAAAATAAAABA==",
        "AAAAAQAAADhJbnN0YWxsYXRpb24gcGFyYW1ldGVycyBmb3IgdGhlIHNpbXBsZSB0aHJlc2hvbGQgcG9saWN5LgAAAAAAAAAcU2ltcGxlVGhyZXNob2xkQWNjb3VudFBhcmFtcwAAAAEAAAA5VGhlIG1pbmltdW0gbnVtYmVyIG9mIHNpZ25lcnMgcmVxdWlyZWQgZm9yIGF1dGhvcml6YXRpb24uAAAAAAAACXRocmVzaG9sZAAAAAAAAAQ=",
        "AAAABQAAADtFdmVudCBlbWl0dGVkIHdoZW4gYSB3ZWlnaHRlZCB0aHJlc2hvbGQgcG9saWN5IGlzIGVuZm9yY2VkLgAAAAAAAAAAEFdlaWdodGVkRW5mb3JjZWQAAAABAAAAEXdlaWdodGVkX2VuZm9yY2VkAAAAAAAABAAAAAAAAAANc21hcnRfYWNjb3VudAAAAAAAABMAAAABAAAAAAAAAAdjb250ZXh0AAAAB9AAAAAHQ29udGV4dAAAAAAAAAAAAAAAAA9jb250ZXh0X3J1bGVfaWQAAAAABAAAAAAAAAAAAAAAFWF1dGhlbnRpY2F0ZWRfc2lnbmVycwAAAAAAA+oAAAfQAAAABlNpZ25lcgAAAAAAAAAAAAI=",
        "AAAABQAAADxFdmVudCBlbWl0dGVkIHdoZW4gYSB3ZWlnaHRlZCB0aHJlc2hvbGQgcG9saWN5IGlzIGluc3RhbGxlZC4AAAAAAAAAEVdlaWdodGVkSW5zdGFsbGVkAAAAAAAAAQAAABJ3ZWlnaHRlZF9pbnN0YWxsZWQAAAAAAAQAAAAAAAAADXNtYXJ0X2FjY291bnQAAAAAAAATAAAAAQAAAAAAAAAPY29udGV4dF9ydWxlX2lkAAAAAAQAAAAAAAAAAAAAAAl0aHJlc2hvbGQAAAAAAAAEAAAAAAAAAAAAAAAOc2lnbmVyX3dlaWdodHMAAAAAA+wAAAfQAAAABlNpZ25lcgAAAAAABAAAAAAAAAAC",
        "AAAABQAAAD5FdmVudCBlbWl0dGVkIHdoZW4gYSB3ZWlnaHRlZCB0aHJlc2hvbGQgcG9saWN5IGlzIHVuaW5zdGFsbGVkLgAAAAAAAAAAABNXZWlnaHRlZFVuaW5zdGFsbGVkAAAAAAEAAAAUd2VpZ2h0ZWRfdW5pbnN0YWxsZWQAAAACAAAAAAAAAA1zbWFydF9hY2NvdW50AAAAAAAAEwAAAAEAAAAAAAAAD2NvbnRleHRfcnVsZV9pZAAAAAAEAAAAAAAAAAI=",
        "AAAABAAAADVFcnJvciBjb2RlcyBmb3Igd2VpZ2h0ZWQgdGhyZXNob2xkIHBvbGljeSBvcGVyYXRpb25zLgAAAAAAAAAAAAAWV2VpZ2h0ZWRUaHJlc2hvbGRFcnJvcgAAAAAABQAAAEZUaGUgc21hcnQgYWNjb3VudCBkb2VzIG5vdCBoYXZlIGEgd2VpZ2h0ZWQgdGhyZXNob2xkIHBvbGljeSBpbnN0YWxsZWQuAAAAAAAYU21hcnRBY2NvdW50Tm90SW5zdGFsbGVkAAAMigAAAB9UaGUgdGhyZXNob2xkIHZhbHVlIGlzIGludmFsaWQuAAAAABBJbnZhbGlkVGhyZXNob2xkAAAMiwAAAChBIG1hdGhlbWF0aWNhbCBvcGVyYXRpb24gd291bGQgb3ZlcmZsb3cuAAAADE1hdGhPdmVyZmxvdwAADIwAAAAuVGhlIHRyYW5zYWN0aW9uIGlzIG5vdCBhbGxvd2VkIGJ5IHRoaXMgcG9saWN5LgAAAAAACk5vdEFsbG93ZWQAAAAADI0AAABCVGhlIGNvbnRleHQgcnVsZSBmb3IgdGhlIHNtYXJ0IGFjY291bnQgaGFzIGJlZW4gYWxyZWFkeSBpbnN0YWxsZWQuAAAAAAAQQWxyZWFkeUluc3RhbGxlZAAADI4=",
        "AAAABQAAAEtFdmVudCBlbWl0dGVkIHdoZW4gdGhlIHRocmVzaG9sZCBvZiBhIHdlaWdodGVkIHRocmVzaG9sZCBwb2xpY3kgaXMgY2hhbmdlZC4AAAAAAAAAABhXZWlnaHRlZFRocmVzaG9sZENoYW5nZWQAAAABAAAAGndlaWdodGVkX3RocmVzaG9sZF9jaGFuZ2VkAAAAAAADAAAAAAAAAA1zbWFydF9hY2NvdW50AAAAAAAAEwAAAAEAAAAAAAAAD2NvbnRleHRfcnVsZV9pZAAAAAAEAAAAAAAAAAAAAAAJdGhyZXNob2xkAAAAAAAABAAAAAAAAAAC",
        "AAAAAgAAADBTdG9yYWdlIGtleXMgZm9yIHdlaWdodGVkIHRocmVzaG9sZCBwb2xpY3kgZGF0YS4AAAAAAAAAG1dlaWdodGVkVGhyZXNob2xkU3RvcmFnZUtleQAAAAABAAAAAQAAAKtTdG9yYWdlIGtleSBmb3IgdGhlIHRocmVzaG9sZCB2YWx1ZSBhbmQgc2lnbmVyIHdlaWdodHMgb2YgYSBzbWFydAphY2NvdW50IGNvbnRleHQgcnVsZS4gTWFwcyB0byBhIGBXZWlnaHRlZFRocmVzaG9sZEFjY291bnRQYXJhbXNgCmNvbnRhaW5pbmcgdGhyZXNob2xkIGFuZCBzaWduZXIgd2VpZ2h0cy4AAAAADkFjY291bnRDb250ZXh0AAAAAAACAAAAEwAAAAQ=",
        "AAAABQAAAE1FdmVudCBlbWl0dGVkIHdoZW4gYSBzaWduZXIgd2VpZ2h0IGlzIGNoYW5nZWQgaW4gYSB3ZWlnaHRlZCB0aHJlc2hvbGQKcG9saWN5LgAAAAAAAAAAAAAbV2VpZ2h0ZWRTaWduZXJXZWlnaHRDaGFuZ2VkAAAAAAEAAAAed2VpZ2h0ZWRfc2lnbmVyX3dlaWdodF9jaGFuZ2VkAAAAAAAEAAAAAAAAAA1zbWFydF9hY2NvdW50AAAAAAAAEwAAAAEAAAAAAAAAD2NvbnRleHRfcnVsZV9pZAAAAAAEAAAAAAAAAAAAAAAGc2lnbmVyAAAAAAfQAAAABlNpZ25lcgAAAAAAAAAAAAAAAAAGd2VpZ2h0AAAAAAAEAAAAAAAAAAI=",
        "AAAAAQAAADpJbnN0YWxsYXRpb24gcGFyYW1ldGVycyBmb3IgdGhlIHdlaWdodGVkIHRocmVzaG9sZCBwb2xpY3kuAAAAAAAAAAAAHldlaWdodGVkVGhyZXNob2xkQWNjb3VudFBhcmFtcwAAAAAAAgAAAC9NYXBwaW5nIG9mIHNpZ25lcnMgdG8gdGhlaXIgcmVzcGVjdGl2ZSB3ZWlnaHRzLgAAAAAOc2lnbmVyX3dlaWdodHMAAAAAA+wAAAfQAAAABlNpZ25lcgAAAAAABAAAADRUaGUgbWluaW11bSB0b3RhbCB3ZWlnaHQgcmVxdWlyZWQgZm9yIGF1dGhvcml6YXRpb24uAAAACXRocmVzaG9sZAAAAAAAAAQ=",
        "AAAABAAAADFFcnJvciB0eXBlcyBmb3IgV2ViQXV0aG4gdmVyaWZpY2F0aW9uIG9wZXJhdGlvbnMuAAAAAAAAAAAAAA1XZWJBdXRobkVycm9yAAAAAAAACgAAADlUaGUgc2lnbmF0dXJlIHBheWxvYWQgaXMgaW52YWxpZCBvciBoYXMgaW5jb3JyZWN0IGZvcm1hdC4AAAAAAAAXU2lnbmF0dXJlUGF5bG9hZEludmFsaWQAAAAMJgAAADNUaGUgY2xpZW50IGRhdGEgZXhjZWVkcyB0aGUgbWF4aW11bSBhbGxvd2VkIGxlbmd0aC4AAAAAEUNsaWVudERhdGFUb29Mb25nAAAAAAAMJwAAACZGYWlsZWQgdG8gcGFyc2UgSlNPTiBmcm9tIGNsaWVudCBkYXRhLgAAAAAADkpzb25QYXJzZUVycm9yAAAAAAwoAAAANFRoZSB0eXBlIGZpZWxkIGluIGNsaWVudCBkYXRhIGlzIG5vdCAid2ViYXV0aG4uZ2V0Ii4AAAAQVHlwZUZpZWxkSW52YWxpZAAADCkAAAA7VGhlIGNoYWxsZW5nZSBpbiBjbGllbnQgZGF0YSBkb2VzIG5vdCBtYXRjaCBleHBlY3RlZCB2YWx1ZS4AAAAAEENoYWxsZW5nZUludmFsaWQAAAwqAAAANlRoZSBhdXRoZW50aWNhdG9yIGRhdGEgZm9ybWF0IGlzIGludmFsaWQgb3IgdG9vIHNob3J0LgAAAAAAFUF1dGhEYXRhRm9ybWF0SW52YWxpZAAAAAAADCsAAAA8VGhlIFVzZXIgUHJlc2VudCAoVVApIGJpdCBpcyBub3Qgc2V0IGluIGF1dGhlbnRpY2F0b3IgZmxhZ3MuAAAAEFByZXNlbnRCaXROb3RTZXQAAAwsAAAAPVRoZSBVc2VyIFZlcmlmaWVkIChVVikgYml0IGlzIG5vdCBzZXQgaW4gYXV0aGVudGljYXRvciBmbGFncy4AAAAAAAARVmVyaWZpZWRCaXROb3RTZXQAAAAAAAwtAAAAP0ludmFsaWQgcmVsYXRpb25zaGlwIGJldHdlZW4gQmFja3VwIEVsaWdpYmlsaXR5IGFuZCBTdGF0ZSBiaXRzLgAAAAAfQmFja3VwRWxpZ2liaWxpdHlBbmRTdGF0ZU5vdFNldAAAAAwuAAAAQlRoZSBwcm92aWRlZCBrZXkgZGF0YSBkb2VzIG5vdCBjb250YWluIGEgdmFsaWQgNjUtYnl0ZSBwdWJsaWMga2V5LgAAAAAADktleURhdGFJbnZhbGlkAAAAAAwv",
        "AAAAAQAAAMhXZWJBdXRobiBzaWduYXR1cmUgZGF0YSBzdHJ1Y3R1cmUgY29udGFpbmluZyBhbGwgY29tcG9uZW50cyBuZWVkZWQgZm9yCnZlcmlmaWNhdGlvbi4KClRoaXMgc3RydWN0dXJlIGVuY2Fwc3VsYXRlcyB0aGUgc2lnbmF0dXJlIGFuZCBhc3NvY2lhdGVkIGRhdGEgZ2VuZXJhdGVkCmR1cmluZyBhIFdlYkF1dGhuIGF1dGhlbnRpY2F0aW9uIGNlcmVtb255LgAAAAAAAAAPV2ViQXV0aG5TaWdEYXRhAAAAAAMAAAAyUmF3IGF1dGhlbnRpY2F0b3IgZGF0YSBmcm9tIHRoZSBXZWJBdXRobiByZXNwb25zZS4AAAAAABJhdXRoZW50aWNhdG9yX2RhdGEAAAAAAA4AAAAwUmF3IGNsaWVudCBkYXRhIEpTT04gZnJvbSB0aGUgV2ViQXV0aG4gcmVzcG9uc2UuAAAAC2NsaWVudF9kYXRhAAAAAA4AAAA1VGhlIGNyeXB0b2dyYXBoaWMgc2lnbmF0dXJlICg2NCBieXRlcyBmb3Igc2VjcDI1NnIxKS4AAAAAAAAJc2lnbmF0dXJlAAAAAAAD7gAAAEA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    config: this.txFromJSON<Option<RecoveryConfig>>,
        enroll: this.txFromJSON<null>,
        enforce: this.txFromJSON<null>,
        install: this.txFromJSON<null>,
        revoked: this.txFromJSON<Array<Buffer>>,
        uninstall: this.txFromJSON<null>,
        config_hash: this.txFromJSON<Option<Buffer>>,
        get_attempt: this.txFromJSON<Option<Attempt>>,
        has_pending: this.txFromJSON<boolean>,
        begin_attempt: this.txFromJSON<u64>,
        submit_zk_proof: this.txFromJSON<null>,
        submit_zk_cancel: this.txFromJSON<null>,
        completion_granted: this.txFromJSON<boolean>,
        submit_guardian_cancel: this.txFromJSON<null>,
        submit_guardian_approval: this.txFromJSON<null>
  }
}