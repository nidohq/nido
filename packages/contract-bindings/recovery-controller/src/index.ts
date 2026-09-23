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




export const Errors = {
  1: {message:"AlreadyEnrolled"},
  2: {message:"NotEnrolled"},
  /**
   * `enroll`: `GuardianOnly` mode must not set `verifier`/`zk_pool`, or
   * `ZkOnly`/`Combined` must set them and `ZkOnly` must NOT set
   * `guardians` — the HARD mode/machinery match.
   */
  3: {message:"ModeConfigMismatch"},
  /**
   * `enroll`: `threshold` is 0 or exceeds `guardians.len()`.
   */
  4: {message:"InvalidThreshold"},
  /**
   * `enroll`: `pending_activity_policy` is the unimplemented `Restrict`
   * placeholder (no default; this is not a default, it is a refusal).
   */
  5: {message:"UnresolvedPolicyBranch"},
  /**
   * `begin_attempt`: a live (non-terminal, non-expired) attempt already
   * exists — `docs/recovery/TRANSITION_SPEC.md`'s "no silent supersede".
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
  24: {message:"RecoveryExpired"},
  /**
   * `reconfigure`: blocked while `has_pending(account)` is true — same
   * guard `enroll` would need if it could be called twice.
   */
  25: {message:"ReconfigurePendingBlocked"},
  /**
   * `reconfigure`: the `(existing.mode, new_config.mode)` pair is not one
   * of the two allowed additive transitions (`GuardianOnly -> Combined`,
   * `ZkOnly -> Combined`), or the transition doesn't strictly ADD the
   * missing factor's fields while leaving the existing factor's fields
   * untouched.
   */
  26: {message:"ReconfigureNotAdditive"},
  /**
   * `reconfigure`: a field other than the mode/machinery-being-added
   * differs from the currently-stored config — reconfigure only ever
   * adds a missing evidence factor, never touches identity/baseline/
   * timing.
   */
  27: {message:"ReconfigureFieldMismatch"},
  /**
   * `reconfigure` (`Profile::Protected` only): fewer than
   * `existing.guardian_threshold` DISTINCT, currently-enrolled guardians
   * nested-authorized this exact reconfigure call.
   */
  28: {message:"ReconfigureEvidenceInsufficient"},
  /**
   * `reconfigure` (`Profile::Protected`, existing mode `ZkOnly` only):
   * refused, not implemented — see the crate doc comment's "Known
   * limits" for exactly why a ZK reconfigure-evidence path needs a new
   * circuit binding this crate does not add.
   */
  29: {message:"ReconfigureZkEvidenceUnsupported"}
}


/**
 * A single recovery attempt's full lifecycle record — the reference model
 * is `collecting-evidence -> authorized-pending -> {completed, cancelled}`;
 * "expired" is a DERIVED predicate, not a stored state — see `lib.rs
 * ::is_live`, mirroring `TRANSITION_SPEC.md`'s "readiness may be derived
 * from time rather than stored as another state".
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
 * Routine recovery-CONFIGURATION change authority: `Loss` needs only the
 * account's own auth to `reconfigure`; `Protected` additionally needs the
 * currently-enrolled factor's evidence (see `contract.rs::reconfigure` and
 * the crate doc comment's "Known limits"). Retained on `RecoveryConfig`
 * because it is part of the account's reviewable commitment.
 */
export type Profile = {tag: "Loss", values: void} | {tag: "Protected", values: void};

/**
 * Which evidence factor(s) an account's recovery requires. `GuardianOnly`
 * is a HARD requirement: it must not require ANY ZK machinery — no secret,
 * no Merkle witness, no proof. Enforced at `enroll` (see `lib.rs`), not
 * just documented here.
 */
export type AuthMode = {tag: "GuardianOnly", values: void} | {tag: "ZkOnly", values: void} | {tag: "Combined", values: void};

export type AttemptState = {tag: "CollectingEvidence", values: void} | {tag: "AuthorizedPending", values: void} | {tag: "Completed", values: void} | {tag: "Cancelled", values: void};

/**
 * Which target-document construction rule an attempt uses (see
 * `docs/recovery/TRANSITION_SPEC.md`). Encoded as the circuit/commitment's
 * numeric `action` too — see `lib.rs::action_code`.
 */
export type RecoveryAction = {tag: "LostKey", values: void} | {tag: "Compromise", values: void};


/**
 * Recovery configuration for one account — the reviewable
 * recovery-configuration commitment: mode, profile, guardian
 * identities/quorum, verifier identity, baseline commitment. Fixed at
 * enrollment and, after that, mutable only through `reconfigure`'s narrow
 * additive path (see `contract.rs::reconfigure` and the crate doc
 * comment's "Known limits"). NOT embedded in the account's own Perch
 * policy document — this controller keeps recovery configuration entirely
 * in its own storage, so an account's document canonical bytes are
 * UNCHANGED by enrolling in recovery (see `lib.rs` tests
 * `enrolling_does_not_touch_the_account_doc`).
 * 
 * `reconfigure` only ever adds a missing evidence factor — it explicitly
 * refuses any change to `version` (`ReconfigureFieldMismatch`), so
 * `version` currently only ever reads `1`. It remains a real `u32` field
 * (not a constant) so a future, broader reconfigure path could bump it
 * without an ABI change, giving the `ProposalCommitment.config_version` /
 * circuit `cfg_version` fields a real value to b
 */
export interface RecoveryConfig {
  /**
 * The approved baseline document's canonical hash.
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
 * convention) — part of the "network identity" commitment field.
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
 * The action tag baked into a `ProposalCommitment` and, for ZK evidence,
 * into the circuit's `auth_hash` (via
 * `nido_zk_recovery::hash::compute_auth_hash`'s `action` parameter) — this
 * is cancellation-domain separation: a `Cancel` commitment is structurally
 * and cryptographically distinct from the `LostKey`/`Compromise` commitment
 * it targets, so initiation evidence can never double as cancellation
 * evidence.
 */
export type CommitmentAction = {tag: "LostKey", values: void} | {tag: "Compromise", values: void} | {tag: "Cancel", values: void};




/**
 * The exact proposal-commitment field list. `network` is
 * `sha256(config.network_passphrase)` (32 bytes) rather than the raw
 * passphrase, matching the circuit's `npass_hi/lo` convention.
 * `baseline_or_source_id` is `config.baseline_doc_hash` for `Compromise`,
 * or the caller-supplied live-doc snapshot hash for `LostKey` ("current"
 * means a defined source snapshot, captured once at `begin_attempt` and
 * never recomputed).
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
 * Deliberately deferred, NO default. Mirrors
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
 * Represents different types of signers in the smart account system.
 */
export type Signer = {tag: "Delegated", values: readonly [string]} | {tag: "External", values: readonly [string, Buffer]};


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
export type ContextRuleType = {tag: "Default", values: void} | {tag: "CallContract", values: readonly [string]} | {tag: "CreateContract", values: readonly [Buffer]};

export interface Client {
  /**
   * Construct and simulate a config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  config: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<RecoveryConfig>>>

  /**
   * Construct and simulate a enroll transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One-shot per account, self-authed. Validates the HARD mode/machinery
   * match (`GuardianOnly` MUST NOT configure any ZK address; `ZkOnly`
   * MUST NOT configure guardians; `Combined` needs both), a sane
   * guardian threshold, and refuses the unimplemented
   * `PendingActivityPolicy::Restrict` (no default — a refusal, not a
   * silent substitution).
   * 
   * `RecoveryConfig` is not fully immutable after enrollment —
   * `reconfigure` (below) allows one narrow, strictly additive mutation
   * (see its doc comment and the crate doc comment's "Known limits"). It
   * never allows changing `baseline_doc_hash`
   * (`Error::ReconfigureFieldMismatch` refuses any such attempt), which
   * is what makes the property "a stolen admin key must not be able to
   * refresh the baseline" hold: there is no path, legitimate or
   * otherwise, that can change the baseline once enrolled.
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
   * always encodes to the same bytes). This satisfies the property that
   * the document commitment must cover all authority-bearing recovery
   * configuration, WITHOUT embedding recovery configuration in the
   * account's own Perch policy document — see the crate doc comment's
   * "Known limits" for exactly why that embedding is blocked by the
   * DEPLOYED, pinned `perch-doc-compiler`'s wire protocol (an external
   * dependency this contract does not control), not by a gap in this
   * contract. `None` if `account` is not enrolled.
   */
  config_hash: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a get_attempt transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_attempt: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Attempt>>>

  /**
   * Construct and simulate a has_pending transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * View cross-called by the smart account's `guard_no_pending`
   * (`contracts/smart-account/src/contract.rs`), exactly like
   * `nido-recovery-doc-completion`'s `has_pending`. Governed by
   * `config.pending_activity_policy` — see
   * `PendingActivityPolicy`'s doc for what `Freeze`/`Continue` each mean.
   * An account with NO enrollment (never called `enroll`) trivially has
   * no pending — this must not panic for an unenrolled account, since the
   * smart account cross-calls it unconditionally whenever ANY controller
   * is installed as `recovery_controller`.
   */
  has_pending: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a reconfigure transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Changes an ALREADY-enrolled account's config — the ONE allowed
   * mutation, replacing the "no reconfigure entry point" limit this
   * crate previously carried (see the crate doc comment's "Known
   * limits" for the full design rationale and its remaining bound: no
   * ZK reconfigure-evidence path).
   * 
   * Only two transitions are accepted, and ONLY as strict additions:
   * `GuardianOnly -> Combined` (adds `verifier`/`zk_pool`, `guardians`/
   * `guardian_threshold` untouched) or `ZkOnly -> Combined` (adds
   * `guardians`/`guardian_threshold`, `verifier`/`zk_pool` untouched).
   * Every other field of `RecoveryConfig` must byte-for-byte equal the
   * stored config, or this panics `ReconfigureFieldMismatch` —
   * reconfigure only ever adds a missing evidence factor, never touches
   * identity/baseline/timing. This is the "configuration consistency"
   * property: a live attempt's frozen commitment can never be silently
   * reinterpreted by a later config change, because nothing the
   * commitment binds to is ever allowed to change here.
   * 
   * Blocked while `has_pending(accou
   */
  reconfigure: ({account, new_config, guardian_evidence}: {account: string, new_config: RecoveryConfig, guardian_evidence: Array<string>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

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
   * (`BaselineMismatch` otherwise): compromise recovery restores the
   * approved BASELINE plus replacements, never the live (possibly
   * attacker-modified) document. `action == LostKey` accepts any
   * `source_or_baseline_hash` — the CALLER captures the live document's
   * current hash as the fixed source snapshot at this exact moment
   * ("current" means a defined source snap
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
   * Parity view (mirrors `nido-recovery-doc-completion`'s /
   * `nido-zk-recovery`'s identically-named view): always `false`. This
   * controller only wires Variant A (gating the account's EXISTING
   * `apply_doc`), never the account's raw `add_context_rule` completion
   * vehicle — the smart account's guard cross-calls this unconditionally
   * whenever this controller is installed, so it must exist.
   */
  completion_granted: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a submit_guardian_cancel transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Guardian cancellation evidence (own action domain). Distinct storage
   * (`CancelTally`) from initiation's
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
   * at all (the HARD "no ZK machinery for `GuardianOnly`" requirement is
   * symmetric: `ZkOnly` correspondingly has no guardian machinery to
   * accept an approval into).
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
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAHQAAAAAAAAAPQWxyZWFkeUVucm9sbGVkAAAAAAEAAAAAAAAAC05vdEVucm9sbGVkAAAAAAIAAACuYGVucm9sbGA6IGBHdWFyZGlhbk9ubHlgIG1vZGUgbXVzdCBub3Qgc2V0IGB2ZXJpZmllcmAvYHprX3Bvb2xgLCBvcgpgWmtPbmx5YC9gQ29tYmluZWRgIG11c3Qgc2V0IHRoZW0gYW5kIGBaa09ubHlgIG11c3QgTk9UIHNldApgZ3VhcmRpYW5zYCDigJQgdGhlIEhBUkQgbW9kZS9tYWNoaW5lcnkgbWF0Y2guAAAAAAASTW9kZUNvbmZpZ01pc21hdGNoAAAAAAADAAAAOGBlbnJvbGxgOiBgdGhyZXNob2xkYCBpcyAwIG9yIGV4Y2VlZHMgYGd1YXJkaWFucy5sZW4oKWAuAAAAEEludmFsaWRUaHJlc2hvbGQAAAAEAAAAhWBlbnJvbGxgOiBgcGVuZGluZ19hY3Rpdml0eV9wb2xpY3lgIGlzIHRoZSB1bmltcGxlbWVudGVkIGBSZXN0cmljdGAKcGxhY2Vob2xkZXIgKG5vIGRlZmF1bHQ7IHRoaXMgaXMgbm90IGEgZGVmYXVsdCwgaXQgaXMgYSByZWZ1c2FsKS4AAAAAAAAWVW5yZXNvbHZlZFBvbGljeUJyYW5jaAAAAAAABQAAAIpgYmVnaW5fYXR0ZW1wdGA6IGEgbGl2ZSAobm9uLXRlcm1pbmFsLCBub24tZXhwaXJlZCkgYXR0ZW1wdCBhbHJlYWR5CmV4aXN0cyDigJQgYGRvY3MvcmVjb3ZlcnkvVFJBTlNJVElPTl9TUEVDLm1kYCdzICJubyBzaWxlbnQgc3VwZXJzZWRlIi4AAAAAABRBdHRlbXB0QWxyZWFkeUFjdGl2ZQAAAAYAAABqYGJlZ2luX2F0dGVtcHRgOiBgQ29tcHJvbWlzZWAgYWN0aW9uJ3MgYHNvdXJjZV9vcl9iYXNlbGluZV9oYXNoYCBkaWQKbm90IGVxdWFsIGBjb25maWcuYmFzZWxpbmVfZG9jX2hhc2hgLgAAAAAAEEJhc2VsaW5lTWlzbWF0Y2gAAAAHAAAAmWBiZWdpbl9hdHRlbXB0YDogYSBkZWNsYXJlZCBgcmVwbGFjZWRfY3JlZGVudGlhbF9pZGAgaXMgYWxyZWFkeSBpbgpgUmV2b2tlZENyZWRlbnRpYWxzYCDigJQgcmV2aXZpbmcgYSBjcmVkZW50aWFsIGEgcHJpb3IgcmVjb3ZlcnkgcmVtb3ZlZAoocHJvcGVydHkgMTApLgAAAAAAABhSZXZva2VkQ3JlZGVudGlhbFJldml2ZWQAAAAIAAAAgWBzdWJtaXRfZ3VhcmRpYW5fYXBwcm92YWxgL2BzdWJtaXRfemtfcHJvb2ZgIChhbmQgdGhlaXIgYF9jYW5jZWxgCmNvdW50ZXJwYXJ0cyk6IHRoZSBhY2NvdW50J3MgbW9kZSBkb2VzIG5vdCBpbmNsdWRlIHRoaXMgZmFjdG9yLgAAAAAAAAxNb2RlTWlzbWF0Y2gAAAAJAAAAM05vIGxpdmUgYXR0ZW1wdCB3aXRoIHRoaXMgaWQgaW4gdGhlIGV4cGVjdGVkIHN0YXRlLgAAAAANTm9TdWNoQXR0ZW1wdAAAAAAAAAoAAABHYHN1Ym1pdF9ndWFyZGlhbl9hcHByb3ZhbGA6IGNhbGxlciBpcyBub3QgaW4gdGhlIGVucm9sbGVkIGd1YXJkaWFuCnNldC4AAAAADE5vdEFHdWFyZGlhbgAAAAsAAABVYHN1Ym1pdF9ndWFyZGlhbl9hcHByb3ZhbGA6IHRoaXMgZ3VhcmRpYW4gYWxyZWFkeSBhcHByb3ZlZCB0aGlzCmF0dGVtcHQvY2FuY2VsbGF0aW9uLgAAAAAAABFEdXBsaWNhdGVBcHByb3ZhbAAAAAAAAAwAAABoYHN1Ym1pdF96a19wcm9vZmAvY2FuY2VsOiB0aGUgc3VibWl0dGVkIE1lcmtsZSByb290IGlzIG5vdCBhIGtub3duCmhpc3RvcmljYWwgcm9vdCBvZiB0aGUgZW5yb2xsZWQgcG9vbC4AAAALVW5rbm93blJvb3QAAAAADQAAAGJgc3VibWl0X3prX3Byb29mYC9jYW5jZWw6IG51bGxpZmllciBhbHJlYWR5IGBTcGVudGAsIG9yIGBSZXNlcnZlZGAgYnkKYSBESUZGRVJFTlQgYWNjb3VudC9hdHRlbXB0LgAAAAAAFE51bGxpZmllclVuYXZhaWxhYmxlAAAADgAAADpgc3VibWl0X3prX3Byb29mYC9jYW5jZWw6IHRoZSB2ZXJpZmllciByZWplY3RlZCB0aGUgcHJvb2YuAAAAAAASVmVyaWZpY2F0aW9uRmFpbGVkAAAAAAAPAAAAJmBjYW5jZWxfKmA6IG5vIGxpdmUgYXR0ZW1wdCB0byBjYW5jZWwuAAAAAAAJTm9QZW5kaW5nAAAAAAAAEAAAAJZgY2FuY2VsXypgOiBgbWF4X2NhbmNlbHNgIGFscmVhZHkgcmVhY2hlZCBmb3IgdGhpcyBhY2NvdW50IChtaXJyb3JzCmBuaWRvLXprLXJlY292ZXJ5YCdzIGNhbmNlbCBjYXAg4oCUIGJvdW5kcyBncmllZmluZyB2aWEgcmVwZWF0ZWQKaW5pdGlhdGUvY2FuY2VsKS4AAAAAABBDYW5jZWxDYXBSZWFjaGVkAAAAEQAAAH5gUG9saWN5OjplbmZvcmNlYDogd3JvbmcgYGZuX25hbWVgL2FyZy1zaGFwZSwgb3Igc3VibWl0dGVkIGRvYydzIGhhc2gKZG9lc24ndCBtYXRjaCB0aGUgYXR0ZW1wdCdzIGNvbW1pdHRlZCBgdGFyZ2V0X2RvY19oYXNoYC4AAAAAAA9Db250ZXh0TWlzbWF0Y2gAAAAAEgAAAAAAAAAMUnVsZU1pc21hdGNoAAAAEwAAAAAAAAAMTm90SW5zdGFsbGVkAAAAFAAAAAAAAAAQQWxyZWFkeUluc3RhbGxlZAAAABUAAACKYHVuaW5zdGFsbGAgYWx3YXlzIHJlZnVzZXMg4oCUIHNlZSBgbGliLnJzYCdzIGRvYyBjb21tZW50IChzYW1lCnJlZW50cmFuY3kgYXJndW1lbnQgYXMgYG5pZG8temstcmVjb3ZlcnlgL2BuaWRvLXJlY292ZXJ5LWRvYy1jb21wbGV0aW9uYCkuAAAAAAAMVW5hdXRob3JpemVkAAAAFgAAAAAAAAASVGltZWxvY2tOb3RFbGFwc2VkAAAAAAAXAAAAAAAAAA9SZWNvdmVyeUV4cGlyZWQAAAAAGAAAAHtgcmVjb25maWd1cmVgOiBibG9ja2VkIHdoaWxlIGBoYXNfcGVuZGluZyhhY2NvdW50KWAgaXMgdHJ1ZSDigJQgc2FtZQpndWFyZCBgZW5yb2xsYCB3b3VsZCBuZWVkIGlmIGl0IGNvdWxkIGJlIGNhbGxlZCB0d2ljZS4AAAAAGVJlY29uZmlndXJlUGVuZGluZ0Jsb2NrZWQAAAAAAAAZAAABGmByZWNvbmZpZ3VyZWA6IHRoZSBgKGV4aXN0aW5nLm1vZGUsIG5ld19jb25maWcubW9kZSlgIHBhaXIgaXMgbm90IG9uZQpvZiB0aGUgdHdvIGFsbG93ZWQgYWRkaXRpdmUgdHJhbnNpdGlvbnMgKGBHdWFyZGlhbk9ubHkgLT4gQ29tYmluZWRgLApgWmtPbmx5IC0+IENvbWJpbmVkYCksIG9yIHRoZSB0cmFuc2l0aW9uIGRvZXNuJ3Qgc3RyaWN0bHkgQUREIHRoZQptaXNzaW5nIGZhY3RvcidzIGZpZWxkcyB3aGlsZSBsZWF2aW5nIHRoZSBleGlzdGluZyBmYWN0b3IncyBmaWVsZHMKdW50b3VjaGVkLgAAAAAAFlJlY29uZmlndXJlTm90QWRkaXRpdmUAAAAAABoAAADMYHJlY29uZmlndXJlYDogYSBmaWVsZCBvdGhlciB0aGFuIHRoZSBtb2RlL21hY2hpbmVyeS1iZWluZy1hZGRlZApkaWZmZXJzIGZyb20gdGhlIGN1cnJlbnRseS1zdG9yZWQgY29uZmlnIOKAlCByZWNvbmZpZ3VyZSBvbmx5IGV2ZXIKYWRkcyBhIG1pc3NpbmcgZXZpZGVuY2UgZmFjdG9yLCBuZXZlciB0b3VjaGVzIGlkZW50aXR5L2Jhc2VsaW5lLwp0aW1pbmcuAAAAGFJlY29uZmlndXJlRmllbGRNaXNtYXRjaAAAABsAAACpYHJlY29uZmlndXJlYCAoYFByb2ZpbGU6OlByb3RlY3RlZGAgb25seSk6IGZld2VyIHRoYW4KYGV4aXN0aW5nLmd1YXJkaWFuX3RocmVzaG9sZGAgRElTVElOQ1QsIGN1cnJlbnRseS1lbnJvbGxlZCBndWFyZGlhbnMKbmVzdGVkLWF1dGhvcml6ZWQgdGhpcyBleGFjdCByZWNvbmZpZ3VyZSBjYWxsLgAAAAAAAB9SZWNvbmZpZ3VyZUV2aWRlbmNlSW5zdWZmaWNpZW50AAAAABwAAADuYHJlY29uZmlndXJlYCAoYFByb2ZpbGU6OlByb3RlY3RlZGAsIGV4aXN0aW5nIG1vZGUgYFprT25seWAgb25seSk6CnJlZnVzZWQsIG5vdCBpbXBsZW1lbnRlZCDigJQgc2VlIHRoZSBjcmF0ZSBkb2MgY29tbWVudCdzICJLbm93bgpsaW1pdHMiIGZvciBleGFjdGx5IHdoeSBhIFpLIHJlY29uZmlndXJlLWV2aWRlbmNlIHBhdGggbmVlZHMgYSBuZXcKY2lyY3VpdCBiaW5kaW5nIHRoaXMgY3JhdGUgZG9lcyBub3QgYWRkLgAAAAAAIFJlY29uZmlndXJlWmtFdmlkZW5jZVVuc3VwcG9ydGVkAAAAHQ==",
        "AAAAAQAAAU9BIHNpbmdsZSByZWNvdmVyeSBhdHRlbXB0J3MgZnVsbCBsaWZlY3ljbGUgcmVjb3JkIOKAlCB0aGUgcmVmZXJlbmNlIG1vZGVsCmlzIGBjb2xsZWN0aW5nLWV2aWRlbmNlIC0+IGF1dGhvcml6ZWQtcGVuZGluZyAtPiB7Y29tcGxldGVkLCBjYW5jZWxsZWR9YDsKImV4cGlyZWQiIGlzIGEgREVSSVZFRCBwcmVkaWNhdGUsIG5vdCBhIHN0b3JlZCBzdGF0ZSDigJQgc2VlIGBsaWIucnMKOjppc19saXZlYCwgbWlycm9yaW5nIGBUUkFOU0lUSU9OX1NQRUMubWRgJ3MgInJlYWRpbmVzcyBtYXkgYmUgZGVyaXZlZApmcm9tIHRpbWUgcmF0aGVyIHRoYW4gc3RvcmVkIGFzIGFub3RoZXIgc3RhdGUiLgAAAAAAAAAAB0F0dGVtcHQAAAAACwAAAAAAAAAGYWN0aW9uAAAAAAfQAAAADlJlY292ZXJ5QWN0aW9uAAAAAAAAAAAACmNvbW1pdG1lbnQAAAAAB9AAAAASUHJvcG9zYWxDb21taXRtZW50AAAAAAAAAAAACmNyZWF0ZWRfYXQAAAAAAAYAAAAAAAAAEGV4ZWN1dGFibGVfYWZ0ZXIAAAPoAAAABgAAAAAAAAAKZXhwaXJlc19hdAAAAAAD6AAAAAYAAAAAAAAAEmd1YXJkaWFuX2FwcHJvdmFscwAAAAAD6gAAABMAAAAAAAAAAmlkAAAAAAAGAAAAvENyZWRlbnRpYWwgaWRzIHRoZSB0YXJnZXQgZG9jdW1lbnQgcmVwbGFjZXMgKGNsaWVudC1kZWNsYXJlZCDigJQgc2VlCnRoZSBjcmF0ZSBkb2MgY29tbWVudCdzICJLbm93biBsaW1pdHMiIG9uIHdoeSB0aGlzIGlzIGEgZGVjbGFyZWQKYm9va2tlZXBpbmcgaW5wdXQsIG5vdCBhbiBvbi1jaGFpbi12ZXJpZmllZCBkb2MgZGlmZikuAAAAF3JlcGxhY2VkX2NyZWRlbnRpYWxfaWRzAAAAA+oAAAPuAAAAIAAAAAAAAAAFc3RhdGUAAAAAAAfQAAAADEF0dGVtcHRTdGF0ZQAAAAAAAAAMemtfbnVsbGlmaWVyAAAD6AAAA+4AAAAgAAAAAAAAAAt6a192ZXJpZmllZAAAAAAB",
        "AAAAAgAAAVhSb3V0aW5lIHJlY292ZXJ5LUNPTkZJR1VSQVRJT04gY2hhbmdlIGF1dGhvcml0eTogYExvc3NgIG5lZWRzIG9ubHkgdGhlCmFjY291bnQncyBvd24gYXV0aCB0byBgcmVjb25maWd1cmVgOyBgUHJvdGVjdGVkYCBhZGRpdGlvbmFsbHkgbmVlZHMgdGhlCmN1cnJlbnRseS1lbnJvbGxlZCBmYWN0b3IncyBldmlkZW5jZSAoc2VlIGBjb250cmFjdC5yczo6cmVjb25maWd1cmVgIGFuZAp0aGUgY3JhdGUgZG9jIGNvbW1lbnQncyAiS25vd24gbGltaXRzIikuIFJldGFpbmVkIG9uIGBSZWNvdmVyeUNvbmZpZ2AKYmVjYXVzZSBpdCBpcyBwYXJ0IG9mIHRoZSBhY2NvdW50J3MgcmV2aWV3YWJsZSBjb21taXRtZW50LgAAAAAAAAAHUHJvZmlsZQAAAAACAAAAAAAAAAAAAAAETG9zcwAAAAAAAAAAAAAACVByb3RlY3RlZAAAAA==",
        "AAAAAgAAAO5XaGljaCBldmlkZW5jZSBmYWN0b3IocykgYW4gYWNjb3VudCdzIHJlY292ZXJ5IHJlcXVpcmVzLiBgR3VhcmRpYW5Pbmx5YAppcyBhIEhBUkQgcmVxdWlyZW1lbnQ6IGl0IG11c3Qgbm90IHJlcXVpcmUgQU5ZIFpLIG1hY2hpbmVyeSDigJQgbm8gc2VjcmV0LApubyBNZXJrbGUgd2l0bmVzcywgbm8gcHJvb2YuIEVuZm9yY2VkIGF0IGBlbnJvbGxgIChzZWUgYGxpYi5yc2ApLCBub3QKanVzdCBkb2N1bWVudGVkIGhlcmUuAAAAAAAAAAAACEF1dGhNb2RlAAAAAwAAAAAAAAAAAAAADEd1YXJkaWFuT25seQAAAAAAAAAAAAAABlprT25seQAAAAAAAAAAAAAAAAAIQ29tYmluZWQ=",
        "AAAAAgAAAAAAAAAAAAAADEF0dGVtcHRTdGF0ZQAAAAQAAAAAAAAAAAAAABJDb2xsZWN0aW5nRXZpZGVuY2UAAAAAAAAAAAAAAAAAEUF1dGhvcml6ZWRQZW5kaW5nAAAAAAAAAAAAAAAAAAAJQ29tcGxldGVkAAAAAAAAAAAAAAAAAAAJQ2FuY2VsbGVkAAAA",
        "AAAAAgAAALlXaGljaCB0YXJnZXQtZG9jdW1lbnQgY29uc3RydWN0aW9uIHJ1bGUgYW4gYXR0ZW1wdCB1c2VzIChzZWUKYGRvY3MvcmVjb3ZlcnkvVFJBTlNJVElPTl9TUEVDLm1kYCkuIEVuY29kZWQgYXMgdGhlIGNpcmN1aXQvY29tbWl0bWVudCdzCm51bWVyaWMgYGFjdGlvbmAgdG9vIOKAlCBzZWUgYGxpYi5yczo6YWN0aW9uX2NvZGVgLgAAAAAAAAAAAAAOUmVjb3ZlcnlBY3Rpb24AAAAAAAIAAAAAAAAAAAAAAAdMb3N0S2V5AAAAAAAAAAAAAAAACkNvbXByb21pc2UAAA==",
        "AAAAAQAABABSZWNvdmVyeSBjb25maWd1cmF0aW9uIGZvciBvbmUgYWNjb3VudCDigJQgdGhlIHJldmlld2FibGUKcmVjb3ZlcnktY29uZmlndXJhdGlvbiBjb21taXRtZW50OiBtb2RlLCBwcm9maWxlLCBndWFyZGlhbgppZGVudGl0aWVzL3F1b3J1bSwgdmVyaWZpZXIgaWRlbnRpdHksIGJhc2VsaW5lIGNvbW1pdG1lbnQuIEZpeGVkIGF0CmVucm9sbG1lbnQgYW5kLCBhZnRlciB0aGF0LCBtdXRhYmxlIG9ubHkgdGhyb3VnaCBgcmVjb25maWd1cmVgJ3MgbmFycm93CmFkZGl0aXZlIHBhdGggKHNlZSBgY29udHJhY3QucnM6OnJlY29uZmlndXJlYCBhbmQgdGhlIGNyYXRlIGRvYwpjb21tZW50J3MgIktub3duIGxpbWl0cyIpLiBOT1QgZW1iZWRkZWQgaW4gdGhlIGFjY291bnQncyBvd24gUGVyY2gKcG9saWN5IGRvY3VtZW50IOKAlCB0aGlzIGNvbnRyb2xsZXIga2VlcHMgcmVjb3ZlcnkgY29uZmlndXJhdGlvbiBlbnRpcmVseQppbiBpdHMgb3duIHN0b3JhZ2UsIHNvIGFuIGFjY291bnQncyBkb2N1bWVudCBjYW5vbmljYWwgYnl0ZXMgYXJlClVOQ0hBTkdFRCBieSBlbnJvbGxpbmcgaW4gcmVjb3ZlcnkgKHNlZSBgbGliLnJzYCB0ZXN0cwpgZW5yb2xsaW5nX2RvZXNfbm90X3RvdWNoX3RoZV9hY2NvdW50X2RvY2ApLgoKYHJlY29uZmlndXJlYCBvbmx5IGV2ZXIgYWRkcyBhIG1pc3NpbmcgZXZpZGVuY2UgZmFjdG9yIOKAlCBpdCBleHBsaWNpdGx5CnJlZnVzZXMgYW55IGNoYW5nZSB0byBgdmVyc2lvbmAgKGBSZWNvbmZpZ3VyZUZpZWxkTWlzbWF0Y2hgKSwgc28KYHZlcnNpb25gIGN1cnJlbnRseSBvbmx5IGV2ZXIgcmVhZHMgYDFgLiBJdCByZW1haW5zIGEgcmVhbCBgdTMyYCBmaWVsZAoobm90IGEgY29uc3RhbnQpIHNvIGEgZnV0dXJlLCBicm9hZGVyIHJlY29uZmlndXJlIHBhdGggY291bGQgYnVtcCBpdAp3aXRob3V0IGFuIEFCSSBjaGFuZ2UsIGdpdmluZyB0aGUgYFByb3Bvc2FsQ29tbWl0bWVudC5jb25maWdfdmVyc2lvbmAgLwpjaXJjdWl0IGBjZmdfdmVyc2lvbmAgZmllbGRzIGEgcmVhbCB2YWx1ZSB0byBiAAAAAAAAAA5SZWNvdmVyeUNvbmZpZwAAAAAADQAAALVUaGUgYXBwcm92ZWQgYmFzZWxpbmUgZG9jdW1lbnQncyBjYW5vbmljYWwgaGFzaC4KYENvbXByb21pc2VgIGF0dGVtcHRzIE1VU1QgdGFyZ2V0IGBiYXNlbGluZV9kb2NfaGFzaGAgcGx1cwpyZXBsYWNlbWVudHMg4oCUIG5ldmVyIHRoZSBsaXZlIGRvY3VtZW50IOKAlCBlbmZvcmNlZCBhdCBgYmVnaW5fYXR0ZW1wdGAuAAAAAAAAEWJhc2VsaW5lX2RvY19oYXNoAAAAAAAD7gAAACAAAAAAAAAACmRlbGF5X3NlY3MAAAAAAAYAAAAAAAAAC2V4cGlyeV9zZWNzAAAAAAYAAAAAAAAAEmd1YXJkaWFuX3RocmVzaG9sZAAAAAAABAAAAPZOb24tZW1wdHkgKHdpdGggYGd1YXJkaWFuX3RocmVzaG9sZGAgaW4gYDEuLj1ndWFyZGlhbnMubGVuKClgKSBmb3IKYEd1YXJkaWFuT25seWAvYENvbWJpbmVkYDsgTVVTVCBiZSBlbXB0eSBmb3IgYFprT25seWAuIEZsYXR0ZW5lZCBmcm9tCmEgW2BHdWFyZGlhblNldGBdIHJhdGhlciB0aGFuIHN0b3JpbmcgYE9wdGlvbjxHdWFyZGlhblNldD5gIGRpcmVjdGx5CuKAlCBzZWUgdGhhdCB0eXBlJ3MgZG9jIGNvbW1lbnQgZm9yIHdoeS4AAAAAAAlndWFyZGlhbnMAAAAAAAPqAAAAEwAAAAAAAAALbWF4X2NhbmNlbHMAAAAABAAAAAAAAAAEbW9kZQAAB9AAAAAIQXV0aE1vZGUAAADAUmF3IG5ldHdvcmsgcGFzc3BocmFzZSBieXRlcyAodGhpcyBjb250cmFjdCBzaGEyNTYncyBpdCBpbnRlcm5hbGx5LAptaXJyb3JpbmcgYG5pZG9femtfcmVjb3Zlcnk6Omhhc2g6OmNvbXB1dGVfYXV0aF9oYXNoYCdzIG93bgpjb252ZW50aW9uKSDigJQgcGFydCBvZiB0aGUgIm5ldHdvcmsgaWRlbnRpdHkiIGNvbW1pdG1lbnQgZmllbGQuAAAAEm5ldHdvcmtfcGFzc3BocmFzZQAAAAAADgAAAAAAAAAXcGVuZGluZ19hY3Rpdml0eV9wb2xpY3kAAAAH0AAAABVQZW5kaW5nQWN0aXZpdHlQb2xpY3kAAAAAAAAAAAAAB3Byb2ZpbGUAAAAH0AAAAAdQcm9maWxlAAAAAQlUaGUgYG5pZG8tcmVjb3ZlcnktdmVyaWZpZXJgIChjb25zdHJ1Y3Rvcmxlc3MsIFZLLWJha2VkLWluKSBpbnN0YW5jZQp0aGlzIGFjY291bnQncyBaSyBldmlkZW5jZSBtdXN0IHZlcmlmeSBhZ2FpbnN0LiBSZXF1aXJlZCBmb3IKYFprT25seWAvYENvbWJpbmVkYDsgTVVTVCBiZSBhYnNlbnQgZm9yIGBHdWFyZGlhbk9ubHlgICh0aGUgSEFSRCAibm8KWksgbWFjaGluZXJ5IiByZXF1aXJlbWVudCDigJQgc2VlIGBBdXRoTW9kZTo6R3VhcmRpYW5Pbmx5YCdzIGRvYykuAAAAAAAACHZlcmlmaWVyAAAD6AAAABMAAAAAAAAAB3ZlcnNpb24AAAAABAAAAM1UaGUgYG5pZG8temstcmVjb3ZlcnlgIE1lcmtsZSBwb29sIHRoaXMgYWNjb3VudCdzIGVucm9sbG1lbnQgc2VjcmV0CndhcyBpbnNlcnRlZCBpbnRvIChgWmtSZWNvdmVyeUNsaWVudDo6aW5zZXJ0X2ZvcmAsIGNhbGxlZCBieSB0aGUKQ0xJRU5UIGF0IGVucm9sbG1lbnQsIG5vdCBieSB0aGlzIGNvbnRyYWN0KS4gUmVxdWlyZWQgaWZmIGB2ZXJpZmllcmAKaXMuAAAAAAAAB3prX3Bvb2wAAAAD6AAAABM=",
        "AAAAAgAAAZZUaGUgYWN0aW9uIHRhZyBiYWtlZCBpbnRvIGEgYFByb3Bvc2FsQ29tbWl0bWVudGAgYW5kLCBmb3IgWksgZXZpZGVuY2UsCmludG8gdGhlIGNpcmN1aXQncyBgYXV0aF9oYXNoYCAodmlhCmBuaWRvX3prX3JlY292ZXJ5OjpoYXNoOjpjb21wdXRlX2F1dGhfaGFzaGAncyBgYWN0aW9uYCBwYXJhbWV0ZXIpIOKAlCB0aGlzCmlzIGNhbmNlbGxhdGlvbi1kb21haW4gc2VwYXJhdGlvbjogYSBgQ2FuY2VsYCBjb21taXRtZW50IGlzIHN0cnVjdHVyYWxseQphbmQgY3J5cHRvZ3JhcGhpY2FsbHkgZGlzdGluY3QgZnJvbSB0aGUgYExvc3RLZXlgL2BDb21wcm9taXNlYCBjb21taXRtZW50Cml0IHRhcmdldHMsIHNvIGluaXRpYXRpb24gZXZpZGVuY2UgY2FuIG5ldmVyIGRvdWJsZSBhcyBjYW5jZWxsYXRpb24KZXZpZGVuY2UuAAAAAAAAAAAAEENvbW1pdG1lbnRBY3Rpb24AAAADAAAAAAAAAAAAAAAHTG9zdEtleQAAAAAAAAAAAAAAAApDb21wcm9taXNlAAAAAAAAAAAAAAAAAAZDYW5jZWwAAA==",
        "AAAABQAAAAAAAAAAAAAAEFJlY292ZXJ5Q2FuY2VsZWQAAAABAAAAEXJlY292ZXJ5X2NhbmNlbGVkAAAAAAAAAgAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAKYXR0ZW1wdF9pZAAAAAAABgAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAEVJlY292ZXJ5Q29tcGxldGVkAAAAAAAAAQAAABJyZWNvdmVyeV9jb21wbGV0ZWQAAAAAAAMAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAAAAAAAAAAAAAA90YXJnZXRfZG9jX2hhc2gAAAAD7gAAACAAAAAAAAAAAg==",
        "AAAAAQAAAZ5UaGUgZXhhY3QgcHJvcG9zYWwtY29tbWl0bWVudCBmaWVsZCBsaXN0LiBgbmV0d29ya2AgaXMKYHNoYTI1Nihjb25maWcubmV0d29ya19wYXNzcGhyYXNlKWAgKDMyIGJ5dGVzKSByYXRoZXIgdGhhbiB0aGUgcmF3CnBhc3NwaHJhc2UsIG1hdGNoaW5nIHRoZSBjaXJjdWl0J3MgYG5wYXNzX2hpL2xvYCBjb252ZW50aW9uLgpgYmFzZWxpbmVfb3Jfc291cmNlX2lkYCBpcyBgY29uZmlnLmJhc2VsaW5lX2RvY19oYXNoYCBmb3IgYENvbXByb21pc2VgLApvciB0aGUgY2FsbGVyLXN1cHBsaWVkIGxpdmUtZG9jIHNuYXBzaG90IGhhc2ggZm9yIGBMb3N0S2V5YCAoImN1cnJlbnQiCm1lYW5zIGEgZGVmaW5lZCBzb3VyY2Ugc25hcHNob3QsIGNhcHR1cmVkIG9uY2UgYXQgYGJlZ2luX2F0dGVtcHRgIGFuZApuZXZlciByZWNvbXB1dGVkKS4AAAAAAAAAAAASUHJvcG9zYWxDb21taXRtZW50AAAAAAAJAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAABmFjdGlvbgAAAAAH0AAAABBDb21taXRtZW50QWN0aW9uAAAAAAAAAAphdHRlbXB0X2lkAAAAAAAGAAAAAAAAABViYXNlbGluZV9vcl9zb3VyY2VfaWQAAAAAAAPuAAAAIAAAAAAAAAAOY29uZmlnX3ZlcnNpb24AAAAAAAQAAAAAAAAADWNvbnRyb2xsZXJfaWQAAAAAAAATAAAAAAAAAApkZWxheV9zZWNzAAAAAAAGAAAAAAAAAAduZXR3b3JrAAAAA+4AAAAgAAAAAAAAAA90YXJnZXRfZG9jX2hhc2gAAAAD7gAAACA=",
        "AAAABQAAAAAAAAAAAAAAElJlY292ZXJ5QXV0aG9yaXplZAAAAAAAAQAAABNyZWNvdmVyeV9hdXRob3JpemVkAAAAAAMAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAAAAAAAAAAAAABBleGVjdXRhYmxlX2FmdGVyAAAABgAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAFFJlY292ZXJ5QXR0ZW1wdEJlZ3VuAAAAAQAAABZyZWNvdmVyeV9hdHRlbXB0X2JlZ3VuAAAAAAADAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAAAAAAAAphdHRlbXB0X2lkAAAAAAAGAAAAAAAAAAAAAAAPdGFyZ2V0X2RvY19oYXNoAAAAA+4AAAAgAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAFFJlY292ZXJ5UmVjb25maWd1cmVkAAAAAQAAABVyZWNvdmVyeV9yZWNvbmZpZ3VyZWQAAAAAAAACAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAAAAAAAAhuZXdfbW9kZQAAB9AAAAAIQXV0aE1vZGUAAAAAAAAAAg==",
        "AAAAAgAAA05EZWxpYmVyYXRlbHkgZGVmZXJyZWQsIE5PIGRlZmF1bHQuIE1pcnJvcnMKYFRSQU5TSVRJT05fU1BFQy5tZGAncyB0aHJlZS13YXkgYHBlbmRpbmdBY3Rpdml0eVBvbGljeWAgZW51bSBleGFjdGx5CihpbmNsdWRpbmcgdGhlIHN5bWJvbGljLCBkZWxpYmVyYXRlbHktdW5pbXBsZW1lbnRlZCB0aGlyZCBicmFuY2gpIHNvIHRoZQoibm8gZGVmYXVsdCIgcHJvcGVydHkgaXMgYSByZWFsLCB0ZXN0YWJsZSByZWZ1c2FsIHJhdGhlciB0aGFuIGEgdHlwZSB0aGF0CnNpbXBseSBvbWl0cyB0aGUgdW5yZXNvbHZlZCBvcHRpb24uIGBGcmVlemVgL2BDb250aW51ZWAgYXJlIHJlYWwgYW5kCnRlc3RlZDsgYFJlc3RyaWN0YCBpcyBhY2NlcHRlZCBieSB0aGUgVFlQRSBidXQgUkVKRUNURUQgYnkgYGVucm9sbGAKKGBFcnJvcjo6VW5yZXNvbHZlZFBvbGljeUJyYW5jaGApIOKAlCBhbiBhY2NvdW50IGNhbiBiZSBvZmZlcmVkIHRoZSBjaG9pY2UKYW5kIHNlZSBpdCBleHBsaWNpdGx5IHJlZnVzZWQsIGV4YWN0bHkgbGlrZQpgcGFja2FnZXMvcmVjb3Zlcnktc3BlYy9zcmMvbW9kZWwudHNgJ3MgYHJlc3RyaWN0YC9gb3RoZXJgIGJyYW5jaGVzCnRocm93aW5nIGBVTlJFU09MVkVEX1BPTElDWV9CUkFOQ0hgIHdpdGggbm8gYGRlZmF1bHQ6YCBjYXNlLiBTZWUgdGhlCmNyYXRlIGRvYyBjb21tZW50J3MgIktub3duIGxpbWl0cyIgZm9yIHdoYXQgYFRSQU5TSVRJT05fU1BFQy5tZGAncwpzZXBhcmF0ZSBgcG9saWN5V3JpdGVDb25mbGljdFBvbGljeWAgYXhpcyAoYGludmFsaWRhdGUtYXR0ZW1wdGAgdnMKYGJsb2NrYCkgd291bGQgYWRkIG9uIHRvcCBvZiB0aGlzIOKAlCBub3QgaW1wbGVtZW50ZWQgaGVyZS4AAAAAAAAAAAAVUGVuZGluZ0FjdGl2aXR5UG9saWN5AAAAAAAAAwAAAAAAAACzT3JkaW5hcnkgYGFwcGx5X2RvY2AgY2FsbHMgYXJlIGJsb2NrZWQgKGBoYXNfcGVuZGluZ2AgcmVwb3J0cyBgdHJ1ZWApCndoaWxlIGEgbGl2ZSBhdHRlbXB0IGV4aXN0cyBmb3IgdGhlIGFjY291bnQsIGV4YWN0bHkgbGlrZQpgbmlkby1yZWNvdmVyeS1kb2MtY29tcGxldGlvbmAncyBgRnJlZXplYCBiZWhhdmlvci4AAAAABkZyZWV6ZQAAAAAAAAAAAStPcmRpbmFyeSBgYXBwbHlfZG9jYCBjYWxscyBhcmUgTkVWRVIgYmxvY2tlZCBieSBhIGxpdmUgYXR0ZW1wdAooYGhhc19wZW5kaW5nYCBhbHdheXMgcmVwb3J0cyBgZmFsc2VgKSDigJQgYSBjb21wcm9taXNlZCBhZG1pbiBjYW4ga2VlcApyZXdyaXRpbmcgdGhlIGRvY3VtZW50IHVudGlsIGEgcmVjb3ZlcnkgYWN0dWFsbHkgY29tcGxldGVzLiBUaGlzIGlzCmFuIGFjY2VwdGVkIHJpc2s7IGNob29zaW5nIGl0IGlzIGFuIGV4cGxpY2l0LCBpbmZvcm1lZCBjaG9pY2UgbWFkZSBhdAplbnJvbGxtZW50LCBub3QgYSBkZWZhdWx0LgAAAAAIQ29udGludWUAAAAAAAABG1N5bWJvbGljIHBsYWNlaG9sZGVyIGZvciBhIGNhcGFiaWxpdHktc2NvcGVkIHJlc3RyaWN0aW9uIHRoYXQgImNhbgpwcmVzZXJ2ZSBlc3NlbnRpYWwgYWN0aXZpdHkgd2hpbGUgbGltaXRpbmcgc3BlY2lmaWMgcmlza3MiLgpVbmltcGxlbWVudGVkLCBkZWxpYmVyYXRlbHkg4oCUIGBlbnJvbGxgIHJlZnVzZXMgdGhpcyB2YWx1ZSB3aXRoCmBFcnJvcjo6VW5yZXNvbHZlZFBvbGljeUJyYW5jaGAgcmF0aGVyIHRoYW4gc2lsZW50bHkgdHJlYXRpbmcgaXQgYXMKYEZyZWV6ZWAgb3IgYENvbnRpbnVlYC4AAAAACFJlc3RyaWN0",
        "AAAAAAAAAAAAAAAGY29uZmlnAAAAAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAD6AAAB9AAAAAOUmVjb3ZlcnlDb25maWcAAA==",
        "AAAAAAAAAzlPbmUtc2hvdCBwZXIgYWNjb3VudCwgc2VsZi1hdXRoZWQuIFZhbGlkYXRlcyB0aGUgSEFSRCBtb2RlL21hY2hpbmVyeQptYXRjaCAoYEd1YXJkaWFuT25seWAgTVVTVCBOT1QgY29uZmlndXJlIGFueSBaSyBhZGRyZXNzOyBgWmtPbmx5YApNVVNUIE5PVCBjb25maWd1cmUgZ3VhcmRpYW5zOyBgQ29tYmluZWRgIG5lZWRzIGJvdGgpLCBhIHNhbmUKZ3VhcmRpYW4gdGhyZXNob2xkLCBhbmQgcmVmdXNlcyB0aGUgdW5pbXBsZW1lbnRlZApgUGVuZGluZ0FjdGl2aXR5UG9saWN5OjpSZXN0cmljdGAgKG5vIGRlZmF1bHQg4oCUIGEgcmVmdXNhbCwgbm90IGEKc2lsZW50IHN1YnN0aXR1dGlvbikuCgpgUmVjb3ZlcnlDb25maWdgIGlzIG5vdCBmdWxseSBpbW11dGFibGUgYWZ0ZXIgZW5yb2xsbWVudCDigJQKYHJlY29uZmlndXJlYCAoYmVsb3cpIGFsbG93cyBvbmUgbmFycm93LCBzdHJpY3RseSBhZGRpdGl2ZSBtdXRhdGlvbgooc2VlIGl0cyBkb2MgY29tbWVudCBhbmQgdGhlIGNyYXRlIGRvYyBjb21tZW50J3MgIktub3duIGxpbWl0cyIpLiBJdApuZXZlciBhbGxvd3MgY2hhbmdpbmcgYGJhc2VsaW5lX2RvY19oYXNoYAooYEVycm9yOjpSZWNvbmZpZ3VyZUZpZWxkTWlzbWF0Y2hgIHJlZnVzZXMgYW55IHN1Y2ggYXR0ZW1wdCksIHdoaWNoCmlzIHdoYXQgbWFrZXMgdGhlIHByb3BlcnR5ICJhIHN0b2xlbiBhZG1pbiBrZXkgbXVzdCBub3QgYmUgYWJsZSB0bwpyZWZyZXNoIHRoZSBiYXNlbGluZSIgaG9sZDogdGhlcmUgaXMgbm8gcGF0aCwgbGVnaXRpbWF0ZSBvcgpvdGhlcndpc2UsIHRoYXQgY2FuIGNoYW5nZSB0aGUgYmFzZWxpbmUgb25jZSBlbnJvbGxlZC4AAAAAAAAGZW5yb2xsAAAAAAACAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAABmNvbmZpZwAAAAAH0AAAAA5SZWNvdmVyeUNvbmZpZwAAAAAAAA==",
        "AAAAAAAAA7JUaGUgY29tcGxldGlvbiBnYXRlIOKAlCBWYXJpYW50IEEgb25seSAoYGRvY3MvcmVjb3Zlcnkvc3RhZ2UyLWZpbmRpbmdzLm1kYCdzCnJlY29tbWVuZGF0aW9uKS4gT3JkZXJlZCBjaGVja3MgbWlycm9yCmBuaWRvLXJlY292ZXJ5LWRvYy1jb21wbGV0aW9uOjpQb2xpY3k6OmVuZm9yY2VgIGV4YWN0bHkgKHRoYXQKZG9jdW1lbnQncyDCpzMgY2FsbC1vcmRlcmluZyBhbmFseXNpcyBhcHBsaWVzIHZlcmJhdGltOiBgZW5mb3JjZWAgcnVucwpkdXJpbmcgdGhlIGNvbXBsZXRpbmcgY2FsbCdzIE9XTiBgX19jaGVja19hdXRoYCwgQkVGT1JFIGl0cyBib2R5LCBzbwpjb25zdW1pbmcgdGhlIGF0dGVtcHQgSEVSRSBpcyB3aGF0IG1ha2VzIGBoYXNfcGVuZGluZ2AgcmVhZCBgZmFsc2VgCmZvciB0aGF0IHNhbWUgY2FsbCdzIGJvZHktdGltZSBndWFyZCBjaGVjaywgd2l0aCBubyBzZXBhcmF0ZQpjb21wbGV0aW9uLWdyYW50IGJyaWRnZSBuZWVkZWQpOgoxLiBgY29udGV4dF9ydWxlLmlkYCBtYXRjaGVzIHRoZSBpZCB0aGlzIHBvbGljeSB3YXMgaW5zdGFsbGVkIHVuZGVyLgoyLiBBIGxpdmUgYXR0ZW1wdCBleGlzdHMsIGlzIGBBdXRob3JpemVkUGVuZGluZ2AsIGl0cyB0aW1lbG9jayBoYXMKZWxhcHNlZCwgYW5kIGl0IGlzIG5vdCBleHBpcmVkLgozLiBgY29udGV4dGAgaXMgYSBzZWxmLWNhbGwgdG8gYGFwcGx5X2RvY2Agd2l0aCBleGFjdGx5IG9uZSBgQnl0ZXNgCmFyZ3VtZW50IHdob3NlIHNoYTI1NiBlcXVhbHMgYGF0dGVtcHQuY29tbWl0bWVudC50YXJnZXRfZG9jX2hhc2hgLgo0LiBDb25zdW1lOiBtYXJrIGBDb21wbGV0ZWRgLCBhcHBlbmQgYHJlcGxhY2VkX2NyZWRlbnRpYWxfaWRzYCB0bwpgUmV2b2tlZENyZWRlbnRpYWxzYCAocHJvcGVydHkgMTAgYm9va2tlZXBpbmcpLCBzcGVuZCB0aGUgWksKbnVsbGlmaWVyIGlmIG9uZSB3YXMgcmVzZXJ2ZWQsIGVtaXQuAAAAAAAHZW5mb3JjZQAAAAAEAAAAAAAAAAdjb250ZXh0AAAAB9AAAAAHQ29udGV4dAAAAAAAAAAAFWF1dGhlbnRpY2F0ZWRfc2lnbmVycwAAAAAAA+oAAAfQAAAABlNpZ25lcgAAAAAAAAAAAAxjb250ZXh0X3J1bGUAAAfQAAAAC0NvbnRleHRSdWxlAAAAAAAAAAANc21hcnRfYWNjb3VudAAAAAAAABMAAAAA",
        "AAAAAAAAARpJZGVudGljYWwgc2hhcGUgdG8gYG5pZG8tcmVjb3ZlcnktZG9jLWNvbXBsZXRpb246OlBvbGljeTo6aW5zdGFsbGAg4oCUCnNhbWUgc3RvbGVuLXBhc3NrZXktcmVwb2ludCBoYXJkZW5pbmcgKGBBbHJlYWR5SW5zdGFsbGVkYCBndWFyZCwgc2VlCnRoYXQgY3JhdGUncyBkb2MgY29tbWVudCBmb3IgdGhlIGZ1bGwgcmVlbnRyYW5jeSBhcmd1bWVudCk6IHplcm8tc2lnbmVyLApgQ2FsbENvbnRyYWN0KHNtYXJ0X2FjY291bnQpYC1zY29wZWQgcnVsZSBvbmx5LCBvbmUtc2hvdCBwZXIgYWNjb3VudC4AAAAAAAdpbnN0YWxsAAAAAAMAAAAAAAAADmluc3RhbGxfcGFyYW1zAAAAAAfQAAAAFVJlY292ZXJ5SW5zdGFsbFBhcmFtcwAAAAAAAAAAAAAMY29udGV4dF9ydWxlAAAH0AAAAAtDb250ZXh0UnVsZQAAAAAAAAAADXNtYXJ0X2FjY291bnQAAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAHcmV2b2tlZAAAAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAD6gAAA+4AAAAg",
        "AAAAAAAAAblVTkNPTkRJVElPTkFMTFkgUkVGVVNFUyDigJQgaWRlbnRpY2FsIHJlZW50cmFuY3ktc2FmZXR5IGFyZ3VtZW50IGFzCmBuaWRvLXprLXJlY292ZXJ5YC9gbmlkby1yZWNvdmVyeS1kb2MtY29tcGxldGlvbjo6UG9saWN5Ojp1bmluc3RhbGxgCihzZWUgZWl0aGVyJ3MgZG9jIGNvbW1lbnQpOiBmcm9tIGluc2lkZSB0aGUgYWNjb3VudCdzIG93bgpgcmVtb3ZlX2NvbnRleHRfcnVsZWAvYHJlbW92ZV9wb2xpY3lgLCBubyBjcm9zcy1jYWxsIGJhY2sgaW50byB0aGUKYWNjb3VudCBjYW4gZGlzdGluZ3Vpc2ggYSBsZWdpdGltYXRlIHRlYXJkb3duIGZyb20gYSB0aGllZidzIGZvcmdlZApkaXJlY3QgY2FsbCwgc28gYm90aCBhcmUgcmVmdXNlZDsgdGhlIGxlZ2l0aW1hdGUgcGF0aCBzdGlsbCBzdWNjZWVkcwp2aWEgT1oncyBgdHJ5X3VuaW5zdGFsbGAgcGFuaWMtc3dhbGxvd2luZy4AAAAAAAAJdW5pbnN0YWxsAAAAAAAAAgAAAAAAAAAMY29udGV4dF9ydWxlAAAH0AAAAAtDb250ZXh0UnVsZQAAAAAAAAAADXNtYXJ0X2FjY291bnQAAAAAAAATAAAAAA==",
        "AAAAAQAAAZFJbnN0YWxsIHBhcmFtZXRlcnMgZm9yIHRoaXMgYFBvbGljeWAg4oCUIHN0cnVjdHVyYWxseSBpZGVudGljYWwgdG8KYG5pZG8tcmVjb3ZlcnktZG9jLWNvbXBsZXRpb246OkRvY1JlY292ZXJ5SW5zdGFsbFBhcmFtc2AgLwpgbmlkby16ay1yZWNvdmVyeTo6WmtSZWNvdmVyeUluc3RhbGxQYXJhbXNgIChgeyB2ZXJzaW9uOiB1MzIgfWApLCBzbyB0aGUKYWNjb3VudCdzIGV4aXN0aW5nIGNvbnN0cnVjdG9yL2BlbnJvbGxfemtfcmVjb3ZlcnlgIGluc3RhbGwgcGF0aCBkZWNvZGVzCmludG8gdGhpcyB0eXBlIHVuY2hhbmdlZCAoc2VlIHRoYXQgY3JhdGUncyBkb2MgY29tbWVudCBmb3Igd2h5IOKAlApgI1tjb250cmFjdHR5cGVdYCBzdHJ1Y3RzIGVuY29kZSBzdHJ1Y3R1cmFsbHksIG5vdCBub21pbmFsbHkpLgAAAAAAAAAAAAAVUmVjb3ZlcnlJbnN0YWxsUGFyYW1zAAAAAAAAAQAAAAAAAAAHdmVyc2lvbgAAAAAE",
        "AAAAAAAAAshBIHJldmlld2FibGUsIG9uLWNoYWluLWNvbXB1dGFibGUgY29tbWl0bWVudCB0byBgYWNjb3VudGAncyBlbnJvbGxlZApgUmVjb3ZlcnlDb25maWdgIOKAlCBgc2hhMjU2KHhkcihjb25maWcpKWAsIFNvcm9iYW4ncyBvd24gYFRvWGRyYApzZXJpYWxpemF0aW9uIChkZXRlcm1pbmlzdGljIGZvciBhIGdpdmVuIHZhbHVlOiBzYW1lIGBSZWNvdmVyeUNvbmZpZ2AKYWx3YXlzIGVuY29kZXMgdG8gdGhlIHNhbWUgYnl0ZXMpLiBUaGlzIHNhdGlzZmllcyB0aGUgcHJvcGVydHkgdGhhdAp0aGUgZG9jdW1lbnQgY29tbWl0bWVudCBtdXN0IGNvdmVyIGFsbCBhdXRob3JpdHktYmVhcmluZyByZWNvdmVyeQpjb25maWd1cmF0aW9uLCBXSVRIT1VUIGVtYmVkZGluZyByZWNvdmVyeSBjb25maWd1cmF0aW9uIGluIHRoZQphY2NvdW50J3Mgb3duIFBlcmNoIHBvbGljeSBkb2N1bWVudCDigJQgc2VlIHRoZSBjcmF0ZSBkb2MgY29tbWVudCdzCiJLbm93biBsaW1pdHMiIGZvciBleGFjdGx5IHdoeSB0aGF0IGVtYmVkZGluZyBpcyBibG9ja2VkIGJ5IHRoZQpERVBMT1lFRCwgcGlubmVkIGBwZXJjaC1kb2MtY29tcGlsZXJgJ3Mgd2lyZSBwcm90b2NvbCAoYW4gZXh0ZXJuYWwKZGVwZW5kZW5jeSB0aGlzIGNvbnRyYWN0IGRvZXMgbm90IGNvbnRyb2wpLCBub3QgYnkgYSBnYXAgaW4gdGhpcwpjb250cmFjdC4gYE5vbmVgIGlmIGBhY2NvdW50YCBpcyBub3QgZW5yb2xsZWQuAAAAC2NvbmZpZ19oYXNoAAAAAAEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAPoAAAD7gAAACA=",
        "AAAAAAAAAAAAAAALZ2V0X2F0dGVtcHQAAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAA+gAAAfQAAAAB0F0dGVtcHQA",
        "AAAAAAAAAhhWaWV3IGNyb3NzLWNhbGxlZCBieSB0aGUgc21hcnQgYWNjb3VudCdzIGBndWFyZF9ub19wZW5kaW5nYAooYGNvbnRyYWN0cy9zbWFydC1hY2NvdW50L3NyYy9jb250cmFjdC5yc2ApLCBleGFjdGx5IGxpa2UKYG5pZG8tcmVjb3ZlcnktZG9jLWNvbXBsZXRpb25gJ3MgYGhhc19wZW5kaW5nYC4gR292ZXJuZWQgYnkKYGNvbmZpZy5wZW5kaW5nX2FjdGl2aXR5X3BvbGljeWAg4oCUIHNlZQpgUGVuZGluZ0FjdGl2aXR5UG9saWN5YCdzIGRvYyBmb3Igd2hhdCBgRnJlZXplYC9gQ29udGludWVgIGVhY2ggbWVhbi4KQW4gYWNjb3VudCB3aXRoIE5PIGVucm9sbG1lbnQgKG5ldmVyIGNhbGxlZCBgZW5yb2xsYCkgdHJpdmlhbGx5IGhhcwpubyBwZW5kaW5nIOKAlCB0aGlzIG11c3Qgbm90IHBhbmljIGZvciBhbiB1bmVucm9sbGVkIGFjY291bnQsIHNpbmNlIHRoZQpzbWFydCBhY2NvdW50IGNyb3NzLWNhbGxzIGl0IHVuY29uZGl0aW9uYWxseSB3aGVuZXZlciBBTlkgY29udHJvbGxlcgppcyBpbnN0YWxsZWQgYXMgYHJlY292ZXJ5X2NvbnRyb2xsZXJgLgAAAAtoYXNfcGVuZGluZwAAAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAAAQ==",
        "AAAAAAAABABDaGFuZ2VzIGFuIEFMUkVBRFktZW5yb2xsZWQgYWNjb3VudCdzIGNvbmZpZyDigJQgdGhlIE9ORSBhbGxvd2VkCm11dGF0aW9uLCByZXBsYWNpbmcgdGhlICJubyByZWNvbmZpZ3VyZSBlbnRyeSBwb2ludCIgbGltaXQgdGhpcwpjcmF0ZSBwcmV2aW91c2x5IGNhcnJpZWQgKHNlZSB0aGUgY3JhdGUgZG9jIGNvbW1lbnQncyAiS25vd24KbGltaXRzIiBmb3IgdGhlIGZ1bGwgZGVzaWduIHJhdGlvbmFsZSBhbmQgaXRzIHJlbWFpbmluZyBib3VuZDogbm8KWksgcmVjb25maWd1cmUtZXZpZGVuY2UgcGF0aCkuCgpPbmx5IHR3byB0cmFuc2l0aW9ucyBhcmUgYWNjZXB0ZWQsIGFuZCBPTkxZIGFzIHN0cmljdCBhZGRpdGlvbnM6CmBHdWFyZGlhbk9ubHkgLT4gQ29tYmluZWRgIChhZGRzIGB2ZXJpZmllcmAvYHprX3Bvb2xgLCBgZ3VhcmRpYW5zYC8KYGd1YXJkaWFuX3RocmVzaG9sZGAgdW50b3VjaGVkKSBvciBgWmtPbmx5IC0+IENvbWJpbmVkYCAoYWRkcwpgZ3VhcmRpYW5zYC9gZ3VhcmRpYW5fdGhyZXNob2xkYCwgYHZlcmlmaWVyYC9gemtfcG9vbGAgdW50b3VjaGVkKS4KRXZlcnkgb3RoZXIgZmllbGQgb2YgYFJlY292ZXJ5Q29uZmlnYCBtdXN0IGJ5dGUtZm9yLWJ5dGUgZXF1YWwgdGhlCnN0b3JlZCBjb25maWcsIG9yIHRoaXMgcGFuaWNzIGBSZWNvbmZpZ3VyZUZpZWxkTWlzbWF0Y2hgIOKAlApyZWNvbmZpZ3VyZSBvbmx5IGV2ZXIgYWRkcyBhIG1pc3NpbmcgZXZpZGVuY2UgZmFjdG9yLCBuZXZlciB0b3VjaGVzCmlkZW50aXR5L2Jhc2VsaW5lL3RpbWluZy4gVGhpcyBpcyB0aGUgImNvbmZpZ3VyYXRpb24gY29uc2lzdGVuY3kiCnByb3BlcnR5OiBhIGxpdmUgYXR0ZW1wdCdzIGZyb3plbiBjb21taXRtZW50IGNhbiBuZXZlciBiZSBzaWxlbnRseQpyZWludGVycHJldGVkIGJ5IGEgbGF0ZXIgY29uZmlnIGNoYW5nZSwgYmVjYXVzZSBub3RoaW5nIHRoZQpjb21taXRtZW50IGJpbmRzIHRvIGlzIGV2ZXIgYWxsb3dlZCB0byBjaGFuZ2UgaGVyZS4KCkJsb2NrZWQgd2hpbGUgYGhhc19wZW5kaW5nKGFjY291AAAAC3JlY29uZmlndXJlAAAAAAMAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAKbmV3X2NvbmZpZwAAAAAH0AAAAA5SZWNvdmVyeUNvbmZpZwAAAAAAAAAAABFndWFyZGlhbl9ldmlkZW5jZQAAAAAAA+oAAAATAAAAAA==",
        "AAAAAAAABABPcGVucyBhIG5ldyByZWNvdmVyeSBhdHRlbXB0IChgVFJBTlNJVElPTl9TUEVDLm1kYCdzIGBiZWdpbkF0dGVtcHRgKS4KUEVSTUlTU0lPTkxFU1Mg4oCUIG5vIGByZXF1aXJlX2F1dGhgIGF0IGFsbDogZGVjbGFyaW5nIGludGVudCBjYXJyaWVzCm5vIGF1dGhvcml0eSBieSBpdHNlbGYsIHJlYWwgZ2F0aW5nIGhhcHBlbnMgYXQgZXZpZGVuY2UtZHJpdmVuCnByb21vdGlvbiAoYHN1Ym1pdF9ndWFyZGlhbl9hcHByb3ZhbGAvYHN1Ym1pdF96a19wcm9vZmApLiBSZWZ1c2VzCihgQXR0ZW1wdEFscmVhZHlBY3RpdmVgKSBpZiBhIExJVkUgYXR0ZW1wdCBhbHJlYWR5IGV4aXN0cyAoIm5vIHNpbGVudApzdXBlcnNlZGUiKSDigJQgYnV0IGlmIHRoZSBleGlzdGluZyBhdHRlbXB0IGlzIHN0YWxlIChleHBpcmVkLApgQ29sbGVjdGluZ0V2aWRlbmNlYCBwYXN0IGl0cyBkZWFkbGluZSwgb3IgdGVybWluYWwpLCBpdCBpcyByZXBsYWNlZCwKcmVsZWFzaW5nIGFueSBudWxsaWZpZXIgcmVzZXJ2YXRpb24gaXQgaGVsZCBmaXJzdCAobWlycm9ycwpgbmlkby16ay1yZWNvdmVyeTo6aW5pdGlhdGVfcmVjb3ZlcnlgJ3Mgc3RhbGUtcGVuZGluZy1zdXBlcnNlZGUKc3RlcCkuCgpgYWN0aW9uID09IENvbXByb21pc2VgIE1VU1QgdGFyZ2V0IGBjb25maWcuYmFzZWxpbmVfZG9jX2hhc2hgCihgQmFzZWxpbmVNaXNtYXRjaGAgb3RoZXJ3aXNlKTogY29tcHJvbWlzZSByZWNvdmVyeSByZXN0b3JlcyB0aGUKYXBwcm92ZWQgQkFTRUxJTkUgcGx1cyByZXBsYWNlbWVudHMsIG5ldmVyIHRoZSBsaXZlIChwb3NzaWJseQphdHRhY2tlci1tb2RpZmllZCkgZG9jdW1lbnQuIGBhY3Rpb24gPT0gTG9zdEtleWAgYWNjZXB0cyBhbnkKYHNvdXJjZV9vcl9iYXNlbGluZV9oYXNoYCDigJQgdGhlIENBTExFUiBjYXB0dXJlcyB0aGUgbGl2ZSBkb2N1bWVudCdzCmN1cnJlbnQgaGFzaCBhcyB0aGUgZml4ZWQgc291cmNlIHNuYXBzaG90IGF0IHRoaXMgZXhhY3QgbW9tZW50CigiY3VycmVudCIgbWVhbnMgYSBkZWZpbmVkIHNvdXJjZSBzbmFwAAAADWJlZ2luX2F0dGVtcHQAAAAAAAAFAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAABmFjdGlvbgAAAAAH0AAAAA5SZWNvdmVyeUFjdGlvbgAAAAAAAAAAAA90YXJnZXRfZG9jX2hhc2gAAAAD7gAAACAAAAAAAAAAF3NvdXJjZV9vcl9iYXNlbGluZV9oYXNoAAAAA+4AAAAgAAAAAAAAABdyZXBsYWNlZF9jcmVkZW50aWFsX2lkcwAAAAPqAAAD7gAAACAAAAABAAAABg==",
        "AAAAAAAAAd1QRVJNSVNTSU9OTEVTUyBjYWxsZXIg4oCUIHRoZSBwcm9vZiBpdHNlbGYgaXMgdGhlIGF1dGhvcml6YXRpb24gKG1pcnJvcnMKYG5pZG8temstcmVjb3Zlcnk6OmluaXRpYXRlX3JlY292ZXJ5YDogbm8gYHJlcXVpcmVfYXV0aGAsIHRoZSBlbnRpcmUKc2VjdXJpdHkgcHJvcGVydHkgaXMgInRoZSBwcm9vZiB2ZXJpZmllcyBhZ2FpbnN0IGFuIGBhdXRoX2hhc2hgIHRoaXMKY29udHJhY3QgcmVjb21wdXRlcyBmcm9tIGl0cyBvd24ga25vd24gc3RhdGUiLCBzbyBub3RoaW5nIGlzIGdhaW5lZApieSBBTFNPIHJlcXVpcmluZyBhIHNpZ25hdHVyZSBmcm9tIHdob2V2ZXIgaGFwcGVucyB0byByZWxheSB0aGUKcHJvb2Ygb24tY2hhaW4pLiBSZWNvbXB1dGVzIGBhdXRoX2hhc2hgIGZyb20gYGF0dGVtcHQuY29tbWl0bWVudGAncwpPV04gZmllbGRzIChuZXZlciB0cnVzdHMgYSBjYWxsZXItc3VwcGxpZWQgaGFzaCkgdmlhIGB6azo6dmVyaWZ5YC4AAAAAAAAPc3VibWl0X3prX3Byb29mAAAAAAUAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAKYXR0ZW1wdF9pZAAAAAAABgAAAAAAAAAEcm9vdAAAA+4AAAAgAAAAAAAAAAludWxsaWZpZXIAAAAAAAPuAAAAIAAAAAAAAAAFcHJvb2YAAAAAAAAOAAAAAA==",
        "AAAAAAAAAT5aSyBjYW5jZWxsYXRpb24gZXZpZGVuY2Ug4oCUIFBFUk1JU1NJT05MRVNTIGNhbGxlciAoc2FtZSByZWFzb25pbmcgYXMKYHN1Ym1pdF96a19wcm9vZmApLiBUaGUgcHJvb2YncyBgYXV0aF9oYXNoYCBiaW5kcyBgYWN0aW9uID0gQ2FuY2VsYAoodmlhIGB6azo6YWN0aW9uX2NvZGVgKSwgc28gYSBjYW5jZWxsYXRpb24gcHJvb2YgY2FuIE5FVkVSIGJlIHJldXNlZAphcyBpbml0aWF0aW9uIGV2aWRlbmNlIG9yIHZpY2UgdmVyc2Eg4oCUIGNyeXB0b2dyYXBoaWMgZG9tYWluCnNlcGFyYXRpb24sIG5vdCBqdXN0IGEgc3RvcmFnZS1sYXlvdXQgc2VwYXJhdGlvbi4AAAAAABBzdWJtaXRfemtfY2FuY2VsAAAABQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAAphdHRlbXB0X2lkAAAAAAAGAAAAAAAAAARyb290AAAD7gAAACAAAAAAAAAACW51bGxpZmllcgAAAAAAA+4AAAAgAAAAAAAAAAVwcm9vZgAAAAAAAA4AAAAA",
        "AAAAAAAAAX1QYXJpdHkgdmlldyAobWlycm9ycyBgbmlkby1yZWNvdmVyeS1kb2MtY29tcGxldGlvbmAncyAvCmBuaWRvLXprLXJlY292ZXJ5YCdzIGlkZW50aWNhbGx5LW5hbWVkIHZpZXcpOiBhbHdheXMgYGZhbHNlYC4gVGhpcwpjb250cm9sbGVyIG9ubHkgd2lyZXMgVmFyaWFudCBBIChnYXRpbmcgdGhlIGFjY291bnQncyBFWElTVElORwpgYXBwbHlfZG9jYCksIG5ldmVyIHRoZSBhY2NvdW50J3MgcmF3IGBhZGRfY29udGV4dF9ydWxlYCBjb21wbGV0aW9uCnZlaGljbGUg4oCUIHRoZSBzbWFydCBhY2NvdW50J3MgZ3VhcmQgY3Jvc3MtY2FsbHMgdGhpcyB1bmNvbmRpdGlvbmFsbHkKd2hlbmV2ZXIgdGhpcyBjb250cm9sbGVyIGlzIGluc3RhbGxlZCwgc28gaXQgbXVzdCBleGlzdC4AAAAAAAASY29tcGxldGlvbl9ncmFudGVkAAAAAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAAAQ==",
        "AAAAAAAAAOFHdWFyZGlhbiBjYW5jZWxsYXRpb24gZXZpZGVuY2UgKG93biBhY3Rpb24gZG9tYWluKS4gRGlzdGluY3Qgc3RvcmFnZQooYENhbmNlbFRhbGx5YCkgZnJvbSBpbml0aWF0aW9uJ3MKYEF0dGVtcHQ6Omd1YXJkaWFuX2FwcHJvdmFsc2A6IGEgZ3VhcmRpYW4gd2hvIGFwcHJvdmVkIElOSVRJQVRJT04gaGFzCmFwcHJvdmVkIG5vdGhpbmcgYWJvdXQgQ0FOQ0VMTEFUSU9OLCBhbmQgdmljZSB2ZXJzYS4AAAAAAAAWc3VibWl0X2d1YXJkaWFuX2NhbmNlbAAAAAAAAwAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAAphdHRlbXB0X2lkAAAAAAAGAAAAAAAAAAhndWFyZGlhbgAAABMAAAAA",
        "AAAAAAAAAaVgZ3VhcmRpYW5gIG11c3QgYHJlcXVpcmVfYXV0aGAgKHJlYWwgU29yb2JhbiBhdXRob3JpemF0aW9uIOKAlCB0aGUKZ3VhcmRpYW4ncyBvd24gc2lnbmF0dXJlKSBhbmQgYmUgYSBtZW1iZXIgb2YgdGhlIGVucm9sbGVkCmBHdWFyZGlhblNldGAuIEEgYEd1YXJkaWFuT25seWAvYENvbWJpbmVkYCBhY2NvdW50IG9ubHkg4oCUIGBaa09ubHlgCnJlamVjdHMgd2l0aCBgTW9kZU1pc21hdGNoYCwgc2luY2UgaXQgZW5yb2xsZWQgd2l0aCBubyBndWFyZGlhbiBzZXQKYXQgYWxsICh0aGUgSEFSRCAibm8gWksgbWFjaGluZXJ5IGZvciBgR3VhcmRpYW5Pbmx5YCIgcmVxdWlyZW1lbnQgaXMKc3ltbWV0cmljOiBgWmtPbmx5YCBjb3JyZXNwb25kaW5nbHkgaGFzIG5vIGd1YXJkaWFuIG1hY2hpbmVyeSB0bwphY2NlcHQgYW4gYXBwcm92YWwgaW50bykuAAAAAAAAGHN1Ym1pdF9ndWFyZGlhbl9hcHByb3ZhbAAAAAMAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAKYXR0ZW1wdF9pZAAAAAAABgAAAAAAAAAIZ3VhcmRpYW4AAAATAAAAAA==",
        "AAAAAgAAAONDb250ZXh0IG9mIGEgc2luZ2xlIGF1dGhvcml6ZWQgY2FsbCBwZXJmb3JtZWQgYnkgYW4gYWRkcmVzcy4KCkN1c3RvbSBhY2NvdW50IGNvbnRyYWN0cyB0aGF0IGltcGxlbWVudCBgX19jaGVja19hdXRoYCBzcGVjaWFsIGZ1bmN0aW9uCnJlY2VpdmUgYSBsaXN0IG9mIGBDb250ZXh0YCB2YWx1ZXMgY29ycmVzcG9uZGluZyB0byBhbGwgdGhlIGNhbGxzIHRoYXQKbmVlZCB0byBiZSBhdXRob3JpemVkLgAAAAAAAAAAB0NvbnRleHQAAAAAAwAAAAEAAAAUQ29udHJhY3QgaW52b2NhdGlvbi4AAAAIQ29udHJhY3QAAAABAAAH0AAAAA9Db250cmFjdENvbnRleHQAAAAAAQAAAD1Db250cmFjdCB0aGF0IGhhcyBhIGNvbnN0cnVjdG9yIHdpdGggbm8gYXJndW1lbnRzIGlzIGNyZWF0ZWQuAAAAAAAAFENyZWF0ZUNvbnRyYWN0SG9zdEZuAAAAAQAAB9AAAAAbQ3JlYXRlQ29udHJhY3RIb3N0Rm5Db250ZXh0AAAAAAEAAABEQ29udHJhY3QgdGhhdCBoYXMgYSBjb25zdHJ1Y3RvciB3aXRoIDEgb3IgbW9yZSBhcmd1bWVudHMgaXMgY3JlYXRlZC4AAAAcQ3JlYXRlQ29udHJhY3RXaXRoQ3Rvckhvc3RGbgAAAAEAAAfQAAAAKkNyZWF0ZUNvbnRyYWN0V2l0aENvbnN0cnVjdG9ySG9zdEZuQ29udGV4dAAA",
        "AAAAAQAAAL1BdXRob3JpemF0aW9uIGNvbnRleHQgb2YgYSBzaW5nbGUgY29udHJhY3QgY2FsbC4KClRoaXMgc3RydWN0IGNvcnJlc3BvbmRzIHRvIGEgYHJlcXVpcmVfYXV0aF9mb3JfYXJnc2AgY2FsbCBmb3IgYW4gYWRkcmVzcwpmcm9tIGBjb250cmFjdGAgZnVuY3Rpb24gd2l0aCBgZm5fbmFtZWAgbmFtZSBhbmQgYGFyZ3NgIGFyZ3VtZW50cy4AAAAAAAAAAAAAD0NvbnRyYWN0Q29udGV4dAAAAAADAAAAAAAAAARhcmdzAAAD6gAAAAAAAAAAAAAACGNvbnRyYWN0AAAAEwAAAAAAAAAHZm5fbmFtZQAAAAAR",
        "AAAAAgAAAF9Db250cmFjdCBleGVjdXRhYmxlIHVzZWQgZm9yIGNyZWF0aW5nIGEgbmV3IGNvbnRyYWN0IGFuZCB1c2VkIGluCmBDcmVhdGVDb250cmFjdEhvc3RGbkNvbnRleHRgLgAAAAAAAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAQAAAAEAAAAAAAAABFdhc20AAAABAAAD7gAAACA=",
        "AAAAAQAAAHZBdXRob3JpemF0aW9uIGNvbnRleHQgZm9yIGBjcmVhdGVfY29udHJhY3RgIGhvc3QgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEKbmV3IGNvbnRyYWN0IG9uIGJlaGFsZiBvZiBhdXRob3JpemVyIGFkZHJlc3MuAAAAAAAAAAAAG0NyZWF0ZUNvbnRyYWN0SG9zdEZuQ29udGV4dAAAAAACAAAAAAAAAApleGVjdXRhYmxlAAAAAAfQAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAAAAAARzYWx0AAAD7gAAACA=",
        "AAAAAQAAANZBdXRob3JpemF0aW9uIGNvbnRleHQgZm9yIGBjcmVhdGVfY29udHJhY3RgIGhvc3QgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEKbmV3IGNvbnRyYWN0IG9uIGJlaGFsZiBvZiBhdXRob3JpemVyIGFkZHJlc3MuClRoaXMgaXMgdGhlIHNhbWUgYXMgYENyZWF0ZUNvbnRyYWN0SG9zdEZuQ29udGV4dGAsIGJ1dCBhbHNvIGhhcwpjb250cmFjdCBjb25zdHJ1Y3RvciBhcmd1bWVudHMuAAAAAAAAAAAAKkNyZWF0ZUNvbnRyYWN0V2l0aENvbnN0cnVjdG9ySG9zdEZuQ29udGV4dAAAAAAAAwAAAAAAAAAQY29uc3RydWN0b3JfYXJncwAAA+oAAAAAAAAAAAAAAApleGVjdXRhYmxlAAAAAAfQAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAAAAAARzYWx0AAAD7gAAACA=",
        "AAAAAgAAAEJSZXByZXNlbnRzIGRpZmZlcmVudCB0eXBlcyBvZiBzaWduZXJzIGluIHRoZSBzbWFydCBhY2NvdW50IHN5c3RlbS4AAAAAAAAAAAAGU2lnbmVyAAAAAAACAAAAAQAAAD1BIGRlbGVnYXRlZCBzaWduZXIgdGhhdCB1c2VzIGJ1aWx0LWluIHNpZ25hdHVyZSB2ZXJpZmljYXRpb24uAAAAAAAACURlbGVnYXRlZAAAAAAAAAEAAAATAAAAAQAAAHJBbiBleHRlcm5hbCBzaWduZXIgd2l0aCBjdXN0b20gdmVyaWZpY2F0aW9uIGxvZ2ljLgpDb250YWlucyB0aGUgdmVyaWZpZXIgY29udHJhY3QgYWRkcmVzcyBhbmQgdGhlIHB1YmxpYyBrZXkgZGF0YS4AAAAAAAhFeHRlcm5hbAAAAAIAAAATAAAADg==",
        "AAAAAQAAADxBIGNvbXBsZXRlIGNvbnRleHQgcnVsZSBkZWZpbmluZyBhdXRob3JpemF0aW9uIHJlcXVpcmVtZW50cy4AAAAAAAAAC0NvbnRleHRSdWxlAAAAAAgAAAApVGhlIHR5cGUgb2YgY29udGV4dCB0aGlzIHJ1bGUgYXBwbGllcyB0by4AAAAAAAAMY29udGV4dF90eXBlAAAH0AAAAA9Db250ZXh0UnVsZVR5cGUAAAAAJ1VuaXF1ZSBpZGVudGlmaWVyIGZvciB0aGUgY29udGV4dCBydWxlLgAAAAACaWQAAAAAAAQAAAApSHVtYW4tcmVhZGFibGUgbmFtZSBmb3IgdGhlIGNvbnRleHQgcnVsZS4AAAAAAAAEbmFtZQAAABAAAAAwTGlzdCBvZiBwb2xpY3kgY29udHJhY3RzIHRoYXQgbXVzdCBiZSBzYXRpc2ZpZWQuAAAACHBvbGljaWVzAAAD6gAAABMAAABKR2xvYmFsIHJlZ2lzdHJ5IElEcyBmb3IgZWFjaCBwb2xpY3ksIHBvc2l0aW9uYWxseSBhbGlnbmVkIHdpdGgKYHBvbGljaWVzYC4AAAAAAApwb2xpY3lfaWRzAAAAAAPqAAAABAAAAElHbG9iYWwgcmVnaXN0cnkgSURzIGZvciBlYWNoIHNpZ25lciwgcG9zaXRpb25hbGx5IGFsaWduZWQgd2l0aApgc2lnbmVyc2AuAAAAAAAACnNpZ25lcl9pZHMAAAAAA+oAAAAEAAAAKExpc3Qgb2Ygc2lnbmVycyBhdXRob3JpemVkIGJ5IHRoaXMgcnVsZS4AAAAHc2lnbmVycwAAAAPqAAAH0AAAAAZTaWduZXIAAAAAADFPcHRpb25hbCBleHBpcmF0aW9uIGxlZGdlciBzZXF1ZW5jZSBmb3IgdGhlIHJ1bGUuAAAAAAAAC3ZhbGlkX3VudGlsAAAAA+gAAAAE",
        "AAAAAgAAAEBUeXBlcyBvZiBjb250ZXh0cyB0aGF0IGNhbiBiZSBhdXRob3JpemVkIGJ5IHNtYXJ0IGFjY291bnQgcnVsZXMuAAAAAAAAAA9Db250ZXh0UnVsZVR5cGUAAAAAAwAAAAAAAAAtRGVmYXVsdCBydWxlcyB0aGF0IGNhbiBhdXRob3JpemUgYW55IGNvbnRleHQuAAAAAAAAB0RlZmF1bHQAAAAAAQAAADBSdWxlcyBzcGVjaWZpYyB0byBjYWxsaW5nIGEgcGFydGljdWxhciBjb250cmFjdC4AAAAMQ2FsbENvbnRyYWN0AAAAAQAAABMAAAABAAAAQlJ1bGVzIHNwZWNpZmljIHRvIGNyZWF0aW5nIGEgY29udHJhY3Qgd2l0aCBhIHBhcnRpY3VsYXIgV0FTTSBoYXNoLgAAAAAADkNyZWF0ZUNvbnRyYWN0AAAAAAABAAAD7gAAACA=" ]),
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
        reconfigure: this.txFromJSON<null>,
        begin_attempt: this.txFromJSON<u64>,
        submit_zk_proof: this.txFromJSON<null>,
        submit_zk_cancel: this.txFromJSON<null>,
        completion_granted: this.txFromJSON<boolean>,
        submit_guardian_cancel: this.txFromJSON<null>,
        submit_guardian_approval: this.txFromJSON<null>
  }
}