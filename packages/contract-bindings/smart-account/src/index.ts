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
 * Nido-specific errors for the in-account recovery guard (M2 Task 4).
 * Separate from OZ's `SmartAccountError` (which this crate does not own
 * and cannot append to) -- these are raised via `panic_with_error!` from
 * the `SmartAccount` trait methods below, which return concrete types
 * (`ContextRule`/`u32`/`()`), not `Result`, exactly like
 * `nido-zk-recovery`'s `RecoveryError` is raised from `controller.rs`'s
 * non-`Result`-returning entry points.
 */
export const NidoSmartAccountError = {
  /**
   * A mutating op (`remove_signer`/`remove_context_rule`/`remove_policy`/
   * `update_context_rule_valid_until`) was attempted while a LIVE
   * recovery is pending for this account (spec §3.2) -- blocks a thief
   * holding a stolen passkey from evicting the recovery mechanism or the
   * legitimate signer mid-recovery.
   */
  1: {message:"RecoveryPendingBlocked"},
  /**
   * A direct `remove_context_rule(recovery_rule_id)`,
   * `add_policy(recovery_rule_id, ..)`, `remove_policy(recovery_rule_id,
   * ..)`, or `update_context_rule_valid_until(recovery_rule_id, ..)` was
   * attempted -- the recovery rule's existence AND its policy set and
   * validity window can only change via
   * `initiate_recovery_rule_removal`/`execute_recovery_rule_removal`
   * (the announce-then-execute path below). Applies unconditionally,
   * even with no pending, so a thief cannot delete the rule outright, nor
   * neuter it in place (expire it via `valid_until`, or poison/strip its
   * policies) to bypass the removal delay.
   */
  2: {message:"RecoveryRuleProtected"},
  /**
   * `execute_recovery_rule_removal` was called without a prior
   * `initiate_recovery_rule_removal`.
   */
  3: {message:"RemovalNotAnnounced"},
  /**
   * `execute_recovery_rule_removal` was called before the announced
   * 7-day delay elapsed.
   */
  4: {message:"RemovalDelayNotElapsed"},
  /**
   * `initiate_recovery_rule_removal`/`execute_recovery_rule_removal` was
   * called on an account constructed with `recovery_controller: None` --
   * there is no recovery rule to remove.
   */
  5: {message:"NoRecoveryConfigured"},
  /**
   * `enroll_zk_recovery` (M2 Task 6's migration path) was called on an
   * account that already has a recovery rule installed -- either from
   * construction (`Some(recovery_controller)`) or a prior
   * `enroll_zk_recovery` call. To swap controllers, remove the existing
   * rule first via `initiate_recovery_rule_removal`/
   * `execute_recovery_rule_removal`, then enroll again.
   */
  6: {message:"RecoveryAlreadyEnrolled"},
  /**
   * `upgrade` (the immediate path) was called on an account that HAS a
   * recovery rule installed. Such accounts must upgrade via the
   * announce-then-execute path (`initiate_upgrade` -> 7-day delay ->
   * `execute_upgrade`), for the same reason `remove_context_rule` on the
   * recovery rule is `RecoveryRuleProtected`: otherwise `upgrade` would be a
   * zero-delay escape hatch letting a stolen passkey swap in a wasm with no
   * recovery rule and permanently lock out the owner, bypassing both the
   * 7-day removal timelock and the unconditional rule-protection checks.
   * Accounts with NO recovery rule keep the immediate `upgrade` path.
   */
  7: {message:"UpgradeRequiresTimelock"},
  /**
   * `execute_upgrade` was called without a prior `initiate_upgrade` (or it
   * was already consumed by a successful execute).
   */
  8: {message:"UpgradeNotAnnounced"},
  /**
   * `execute_upgrade` was called before the announced 7-day delay elapsed.
   */
  9: {message:"UpgradeDelayNotElapsed"},
  /**
   * The document carries a cumulative spend cap. Hybrid apply_doc refuses
   * capped docs rather than installing a rule WEAKER than reviewed (the
   * cap's stateful policy address is registry-resolved SDK-side, not
   * derivable in-contract). Capped docs install via the SDK's per-rule
   * `buildDocInstallTxs` path instead.
   */
  10: {message:"DocCapUnsupported"},
  /**
   * Compiler: the submitted document bytes are not UTF-8.
   */
  11: {message:"DocNotUtf8"},
  /**
   * Compiler: the document failed fail-closed parsing.
   */
  12: {message:"DocParse"},
  /**
   * Compiler: the document failed semantic validation.
   */
  13: {message:"DocInvalid"},
  /**
   * Compiler: the document names no network, or one that is not this
   * chain.
   */
  14: {message:"DocWrongNetwork"},
  /**
   * Compiler: the document cannot be lowered to rules.
   */
  15: {message:"DocCompile"},
  /**
   * The doc-compiler cross-call failed outright (no contract at the
   * derived address, or a host trap). Fail closed.
   */
  16: {message:"DocCompilerUnreachable"}
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
export type ContextRuleType = {tag: "Default", values: void} | {tag: "CallContract", values: readonly [string]} | {tag: "CreateContract", values: readonly [Buffer]};

export interface Client {
  /**
   * Construct and simulate a execute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  execute: ({target, target_fn, target_args}: {target: string, target_fn: string, target_args: Array<any>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Upgrade this account's own wasm to `new_wasm_hash` (an
   * already-installed wasm hash). Governed by the account's OWN auth --
   * the same `current_contract_address().require_auth()` gate as every
   * other account mutation, so it is subject to the account's signing
   * policy exactly like `add_signer`/`remove_signer`/etc. (no separate
   * admin key: the account IS its own admin).
   * 
   * TWO guards, both defending the recovery mechanism against a stolen
   * passkey:
   * - `guard_no_pending`: an upgrade is BLOCKED while a recovery is
   * pending.
   * - If a recovery rule is installed, the IMMEDIATE path is REFUSED
   * (`UpgradeRequiresTimelock`). Otherwise `upgrade` would be a
   * zero-delay escape hatch around the protected recovery rule: a thief
   * could `upgrade` to a wasm that omits the rule and permanently lock
   * out the owner, bypassing the 7-day `initiate/execute_recovery_rule_removal`
   * timelock and the unconditional `RecoveryRuleProtected` checks
   * (`remove_signer`/`remove_context_rule`/`remove_policy`/
   * `update_context_rule_valid_until` are all guarded for t
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a apply_doc transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Apply a perch policy document — HYBRID: manages only the rules a
   * previous `apply_doc` installed (diffed out and replaced atomically);
   * the default passkey rule, the recovery rule, and rules from the
   * legacy mutators are untouched. Compilation (parse/validate/
   * network-bind/canonical `doc_hash`) happens in perch's shared
   * stateless doc-compiler contract, cross-called at its pinned derived
   * address. Stores the canonical `doc_hash`, emits the full doc JSON as
   * a `DocApplied` event, and returns the hash.
   * 
   * Same auth model as every other account mutation (the account's own
   * signing policy), and the same recovery-pending guard as the four
   * guarded mutating ops — apply_doc REMOVES rules, so an in-flight
   * recovery must block it for exactly the reasons documented on
   * `remove_context_rule`.
   */
  apply_doc: ({doc_json}: {doc_json: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a add_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add_policy: ({context_rule_id, policy, install_param}: {context_rule_id: u32, policy: string, install_param: any}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a add_signer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add_signer: ({context_rule_id, signer}: {context_rule_id: u32, signer: Signer}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a doc_rule_ids transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The context-rule ids installed by the last successful `apply_doc`
   * (empty if none) — the doc-managed subset of this account's rules,
   * used by the SDK's `readPolicy` parity check.
   */
  doc_rule_ids: (options?: MethodOptions) => Promise<AssembledTransaction<Array<u32>>>

  /**
   * Construct and simulate a remove_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  remove_policy: ({context_rule_id, policy_id}: {context_rule_id: u32, policy_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a remove_signer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  remove_signer: ({context_rule_id, signer_id}: {context_rule_id: u32, signer_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a execute_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Step 2: performs the announced upgrade once the 7-day delay has elapsed.
   * Requires this account's own auth again. Panics `UpgradeNotAnnounced` if
   * `initiate_upgrade` was never called (or was already consumed),
   * `UpgradeDelayNotElapsed` before the announced timestamp, and
   * `RecoveryPendingBlocked` if a recovery became pending during the delay
   * window (re-checked here, not just at announce time -- so an owner's
   * genuine in-flight recovery blocks a thief's announced upgrade). Mirrors
   * `execute_recovery_rule_removal`.
   */
  execute_upgrade: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a add_context_rule transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add_context_rule: ({context_type, name, valid_until, signers, policies}: {context_type: ContextRuleType, name: string, valid_until: Option<u32>, signers: Array<Signer>, policies: Map<string, any>}, options?: MethodOptions) => Promise<AssembledTransaction<ContextRule>>

  /**
   * Construct and simulate a applied_doc_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The canonical `doc_hash` of the currently applied policy document,
   * or `None` if no document has been applied. Anyone can check
   * installed == reviewed. Mirrors `PerchSmartAccount::applied_doc_hash`.
   */
  applied_doc_hash: (options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a get_context_rule transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_context_rule: ({context_rule_id}: {context_rule_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<ContextRule>>

  /**
   * Construct and simulate a initiate_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Step 1 of upgrading a RECOVERY-ENABLED account: announces the target
   * wasm hash and starts the same 7-day timer (`RECOVERY_REMOVAL_DELAY_SECS`)
   * that recovery-rule removal uses. Mirrors `initiate_recovery_rule_removal`:
   * a thief holding a stolen passkey COULD announce a malicious upgrade, but
   * the delay is the defense -- it gives the legitimate owner (or a monitor)
   * a real window to react, e.g. by initiating a genuine recovery, which then
   * blocks `execute_upgrade` via the same live-pending guard, or by
   * overwriting the announcement.
   * 
   * Requires this account's own auth. Panics `NoRecoveryConfigured` if the
   * account has no recovery rule (use the immediate `upgrade` instead), and
   * `RecoveryPendingBlocked` if a recovery is currently pending.
   */
  initiate_upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a recovery_rule_id transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The `u32` id of the zero-signer recovery `ContextRule` installed at
   * construction, or `None` if the account was constructed with
   * `recovery_controller: None`.
   */
  recovery_rule_id: (options?: MethodOptions) => Promise<AssembledTransaction<Option<u32>>>

  /**
   * Construct and simulate a enroll_zk_recovery transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * M2 Task 6 migration path: lets an account that was deployed WITHOUT a
   * recovery controller (constructor `recovery_controller: None`) opt
   * into ZK recovery afterwards, as a self-authorized, VISIBLE call --
   * unlike the invisible factory-genesis path (constructor
   * `Some(recovery_controller)`, which installs the rule inside the
   * deploy transaction itself, before the account address is ever
   * observed on-chain).
   * 
   * Requires this account's own auth
   * (`e.current_contract_address().require_auth()`) -- the same
   * self-auth model as `add_multisig_recovery`/
   * `initiate_recovery_rule_removal`: the account opts itself in, nobody
   * else can enroll it on the account's behalf.
   * 
   * Panics `RecoveryAlreadyEnrolled` if a recovery rule is already
   * installed (`recovery_rule_id()` is `Some`) -- either from
   * construction or a prior `enroll_zk_recovery` call. To swap
   * controllers, first remove the existing rule via
   * `initiate_recovery_rule_removal`/`execute_recovery_rule_removal`,
   * then enroll again.
   * 
   * On success, delegates to the same [`install_recovery_r
   */
  enroll_zk_recovery: ({recovery_controller}: {recovery_controller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a recovery_controller transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The recovery controller `Address` installed as the recovery rule's
   * policy at construction, or `None` if the account was constructed with
   * `recovery_controller: None`.
   */
  recovery_controller: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a remove_context_rule transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  remove_context_rule: ({context_rule_id}: {context_rule_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a add_multisig_recovery transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Install a social-recovery rule scoped to calls on this account, gated
   * by an M-of-N multisig policy.
   * 
   * Typed wrapper around `add_context_rule` that constructs the policies
   * map for the caller — the SDK doesn't need to wrestle with the
   * `Map<Address, Val>` install-param encoding (the generated TS bindings
   * would otherwise erase the install param to `any`).
   * 
   * The rule is scoped to `CallContract(self)` so it authorises calls
   * against the account's own methods (e.g. `add_signer`, `remove_signer`,
   * `add_context_rule`) — not external transfers.
   * 
   * # Arguments
   * 
   * * `name` - Human-readable rule name.
   * * `valid_until` - Optional expiration ledger sequence.
   * * `friends` - The signers authorised by the recovery rule.
   * * `multisig_policy` - Address of the deployed multisig policy contract.
   * * `threshold` - Number of `friends` signatures required (M).
   */
  add_multisig_recovery: ({name, valid_until, friends, multisig_policy, threshold}: {name: string, valid_until: Option<u32>, friends: Array<Signer>, multisig_policy: string, threshold: u32}, options?: MethodOptions) => Promise<AssembledTransaction<ContextRule>>

  /**
   * Construct and simulate a get_context_rules_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_context_rules_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a update_context_rule_name transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  update_context_rule_name: ({context_rule_id, name}: {context_rule_id: u32, name: string}, options?: MethodOptions) => Promise<AssembledTransaction<ContextRule>>

  /**
   * Construct and simulate a execute_recovery_rule_removal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Step 2: actually removes the recovery rule, once announced and the
   * 7-day delay has elapsed. Requires this account's own auth again.
   * 
   * Panics `RemovalNotAnnounced` if `initiate_recovery_rule_removal` was
   * never called (or was already consumed by a prior successful
   * execute). Panics `RemovalDelayNotElapsed` if called before the
   * announced timestamp. Panics `RecoveryPendingBlocked` if a recovery
   * became pending during the delay window (re-checked here, not just at
   * announce time). On success: removes the recovery `ContextRule` via
   * the raw OZ removal (bypassing this contract's own
   * `RecoveryRuleProtected` self-check, which only guards the
   * `SmartAccount::remove_context_rule` entry point below) and clears the
   * recovery instance-storage keys.
   */
  execute_recovery_rule_removal: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a initiate_recovery_rule_removal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Step 1 of opting out of recovery: announces intent to remove the
   * protected recovery rule and starts a 7-day timer
   * (`RECOVERY_REMOVAL_DELAY_SECS`) that `execute_recovery_rule_removal`
   * must wait out. This is the ONLY way to remove the recovery rule --
   * `remove_context_rule(recovery_rule_id)` always panics
   * `RecoveryRuleProtected` (see the `SmartAccount` impl below).
   * 
   * Requires this account's own auth (the `WebAuthn` passkey signer in
   * production). A thief holding a stolen passkey COULD call this, but
   * the 7-day delay is the defense: it gives the legitimate owner (or
   * anything monitoring the account) a real window to notice and react,
   * e.g. by initiating a genuine recovery, which then blocks
   * `execute_recovery_rule_removal` via the same live-pending guard the
   * four mutating ops use.
   * 
   * Panics `NoRecoveryConfigured` if this account has no recovery rule.
   * Panics `RecoveryPendingBlocked` if a recovery is currently pending
   * (announcing removal mid-recovery would let a thief race the
   * legitimate owner's in-flight recovery).
   */
  initiate_recovery_rule_removal: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_context_rule_valid_until transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  update_context_rule_valid_until: ({context_rule_id, valid_until}: {context_rule_id: u32, valid_until: Option<u32>}, options?: MethodOptions) => Promise<AssembledTransaction<ContextRule>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {signers, policies, recovery_controller}: {signers: Array<Signer>, policies: Map<string, any>, recovery_controller: Option<string>},
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
    return ContractClient.deploy({signers, policies, recovery_controller}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABQAAAe1FbWl0dGVkIG9uY2UgcGVyIHN1Y2Nlc3NmdWwgYGFwcGx5X2RvY2A6IHRoZSBjYW5vbmljYWwgYGRvY19oYXNoYCAodG9waWMsCnNvIGluZGV4ZXJzIGNhbiBmaWx0ZXIgYnkgZG9jdW1lbnQgaWRlbnRpdHkpIHBsdXMgdGhlIEZVTEwgc3VibWl0dGVkIGRvYwpKU09OIChkYXRhKSwgc28gdGhlIGRvY3VtZW50IGlzIHJlY292ZXJhYmxlIGZyb20gZXZlbnQgaGlzdG9yeSBhbG9uZS4gVGhlClNESyB2ZXJpZmllcyBhIHJlY292ZXJlZCBkb2MgYnkgY2Fub25pY2FsaXppbmcgaXQgY2xpZW50LXNpZGUgYW5kCmNvbXBhcmluZyBzaGEyNTYgYWdhaW5zdCB0aGUgU1RPUkVEIGhhc2gg4oCUIGZvcm1hdHRpbmcgb2YgdGhlIHN1Ym1pdHRlZApieXRlcyB0aGVyZWZvcmUgZG9lc24ndCBtYXR0ZXIsIHRob3VnaCBgYnVpbGRBcHBseURvY1R4YCBzdWJtaXRzIGNhbm9uaWNhbApieXRlcyBzbyB0aGUgZXZlbnQgY2FycmllcyB0aGUgY2Fub25pY2FsIGZvcm0gaW4gcHJhY3RpY2UuAAAAAAAAAAAAAApEb2NBcHBsaWVkAAAAAAABAAAAC2RvY19hcHBsaWVkAAAAAAIAAAAAAAAACGRvY19oYXNoAAAD7gAAACAAAAABAAAAAAAAAAhkb2NfanNvbgAAAA4AAAAAAAAAAg==",
        "AAAAAAAAAAAAAAAHZXhlY3V0ZQAAAAADAAAAAAAAAAZ0YXJnZXQAAAAAABMAAAAAAAAACXRhcmdldF9mbgAAAAAAABEAAAAAAAAAC3RhcmdldF9hcmdzAAAAA+oAAAAAAAAAAA==",
        "AAAAAAAABABVcGdyYWRlIHRoaXMgYWNjb3VudCdzIG93biB3YXNtIHRvIGBuZXdfd2FzbV9oYXNoYCAoYW4KYWxyZWFkeS1pbnN0YWxsZWQgd2FzbSBoYXNoKS4gR292ZXJuZWQgYnkgdGhlIGFjY291bnQncyBPV04gYXV0aCAtLQp0aGUgc2FtZSBgY3VycmVudF9jb250cmFjdF9hZGRyZXNzKCkucmVxdWlyZV9hdXRoKClgIGdhdGUgYXMgZXZlcnkKb3RoZXIgYWNjb3VudCBtdXRhdGlvbiwgc28gaXQgaXMgc3ViamVjdCB0byB0aGUgYWNjb3VudCdzIHNpZ25pbmcKcG9saWN5IGV4YWN0bHkgbGlrZSBgYWRkX3NpZ25lcmAvYHJlbW92ZV9zaWduZXJgL2V0Yy4gKG5vIHNlcGFyYXRlCmFkbWluIGtleTogdGhlIGFjY291bnQgSVMgaXRzIG93biBhZG1pbikuCgpUV08gZ3VhcmRzLCBib3RoIGRlZmVuZGluZyB0aGUgcmVjb3ZlcnkgbWVjaGFuaXNtIGFnYWluc3QgYSBzdG9sZW4KcGFzc2tleToKLSBgZ3VhcmRfbm9fcGVuZGluZ2A6IGFuIHVwZ3JhZGUgaXMgQkxPQ0tFRCB3aGlsZSBhIHJlY292ZXJ5IGlzCnBlbmRpbmcuCi0gSWYgYSByZWNvdmVyeSBydWxlIGlzIGluc3RhbGxlZCwgdGhlIElNTUVESUFURSBwYXRoIGlzIFJFRlVTRUQKKGBVcGdyYWRlUmVxdWlyZXNUaW1lbG9ja2ApLiBPdGhlcndpc2UgYHVwZ3JhZGVgIHdvdWxkIGJlIGEKemVyby1kZWxheSBlc2NhcGUgaGF0Y2ggYXJvdW5kIHRoZSBwcm90ZWN0ZWQgcmVjb3ZlcnkgcnVsZTogYSB0aGllZgpjb3VsZCBgdXBncmFkZWAgdG8gYSB3YXNtIHRoYXQgb21pdHMgdGhlIHJ1bGUgYW5kIHBlcm1hbmVudGx5IGxvY2sKb3V0IHRoZSBvd25lciwgYnlwYXNzaW5nIHRoZSA3LWRheSBgaW5pdGlhdGUvZXhlY3V0ZV9yZWNvdmVyeV9ydWxlX3JlbW92YWxgCnRpbWVsb2NrIGFuZCB0aGUgdW5jb25kaXRpb25hbCBgUmVjb3ZlcnlSdWxlUHJvdGVjdGVkYCBjaGVja3MKKGByZW1vdmVfc2lnbmVyYC9gcmVtb3ZlX2NvbnRleHRfcnVsZWAvYHJlbW92ZV9wb2xpY3lgLwpgdXBkYXRlX2NvbnRleHRfcnVsZV92YWxpZF91bnRpbGAgYXJlIGFsbCBndWFyZGVkIGZvciB0AAAAB3VwZ3JhZGUAAAAAAQAAAAAAAAANbmV3X3dhc21faGFzaAAAAAAAA+4AAAAgAAAAAA==",
        "AAAAAAAAAxBBcHBseSBhIHBlcmNoIHBvbGljeSBkb2N1bWVudCDigJQgSFlCUklEOiBtYW5hZ2VzIG9ubHkgdGhlIHJ1bGVzIGEKcHJldmlvdXMgYGFwcGx5X2RvY2AgaW5zdGFsbGVkIChkaWZmZWQgb3V0IGFuZCByZXBsYWNlZCBhdG9taWNhbGx5KTsKdGhlIGRlZmF1bHQgcGFzc2tleSBydWxlLCB0aGUgcmVjb3ZlcnkgcnVsZSwgYW5kIHJ1bGVzIGZyb20gdGhlCmxlZ2FjeSBtdXRhdG9ycyBhcmUgdW50b3VjaGVkLiBDb21waWxhdGlvbiAocGFyc2UvdmFsaWRhdGUvCm5ldHdvcmstYmluZC9jYW5vbmljYWwgYGRvY19oYXNoYCkgaGFwcGVucyBpbiBwZXJjaCdzIHNoYXJlZApzdGF0ZWxlc3MgZG9jLWNvbXBpbGVyIGNvbnRyYWN0LCBjcm9zcy1jYWxsZWQgYXQgaXRzIHBpbm5lZCBkZXJpdmVkCmFkZHJlc3MuIFN0b3JlcyB0aGUgY2Fub25pY2FsIGBkb2NfaGFzaGAsIGVtaXRzIHRoZSBmdWxsIGRvYyBKU09OIGFzCmEgYERvY0FwcGxpZWRgIGV2ZW50LCBhbmQgcmV0dXJucyB0aGUgaGFzaC4KClNhbWUgYXV0aCBtb2RlbCBhcyBldmVyeSBvdGhlciBhY2NvdW50IG11dGF0aW9uICh0aGUgYWNjb3VudCdzIG93bgpzaWduaW5nIHBvbGljeSksIGFuZCB0aGUgc2FtZSByZWNvdmVyeS1wZW5kaW5nIGd1YXJkIGFzIHRoZSBmb3VyCmd1YXJkZWQgbXV0YXRpbmcgb3BzIOKAlCBhcHBseV9kb2MgUkVNT1ZFUyBydWxlcywgc28gYW4gaW4tZmxpZ2h0CnJlY292ZXJ5IG11c3QgYmxvY2sgaXQgZm9yIGV4YWN0bHkgdGhlIHJlYXNvbnMgZG9jdW1lbnRlZCBvbgpgcmVtb3ZlX2NvbnRleHRfcnVsZWAuAAAACWFwcGx5X2RvYwAAAAAAAAEAAAAAAAAACGRvY19qc29uAAAADgAAAAEAAAPpAAAD7gAAACAAAAfQAAAAFU5pZG9TbWFydEFjY291bnRFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAKYWRkX3BvbGljeQAAAAAAAwAAAAAAAAAPY29udGV4dF9ydWxlX2lkAAAAAAQAAAAAAAAABnBvbGljeQAAAAAAEwAAAAAAAAANaW5zdGFsbF9wYXJhbQAAAAAAAAAAAAABAAAABA==",
        "AAAAAAAAAAAAAAAKYWRkX3NpZ25lcgAAAAAAAgAAAAAAAAAPY29udGV4dF9ydWxlX2lkAAAAAAQAAAAAAAAABnNpZ25lcgAAAAAH0AAAAAZTaWduZXIAAAAAAAEAAAAE",
        "AAAABAAAAbZOaWRvLXNwZWNpZmljIGVycm9ycyBmb3IgdGhlIGluLWFjY291bnQgcmVjb3ZlcnkgZ3VhcmQgKE0yIFRhc2sgNCkuClNlcGFyYXRlIGZyb20gT1oncyBgU21hcnRBY2NvdW50RXJyb3JgICh3aGljaCB0aGlzIGNyYXRlIGRvZXMgbm90IG93bgphbmQgY2Fubm90IGFwcGVuZCB0bykgLS0gdGhlc2UgYXJlIHJhaXNlZCB2aWEgYHBhbmljX3dpdGhfZXJyb3IhYCBmcm9tCnRoZSBgU21hcnRBY2NvdW50YCB0cmFpdCBtZXRob2RzIGJlbG93LCB3aGljaCByZXR1cm4gY29uY3JldGUgdHlwZXMKKGBDb250ZXh0UnVsZWAvYHUzMmAvYCgpYCksIG5vdCBgUmVzdWx0YCwgZXhhY3RseSBsaWtlCmBuaWRvLXprLXJlY292ZXJ5YCdzIGBSZWNvdmVyeUVycm9yYCBpcyByYWlzZWQgZnJvbSBgY29udHJvbGxlci5yc2Ancwpub24tYFJlc3VsdGAtcmV0dXJuaW5nIGVudHJ5IHBvaW50cy4AAAAAAAAAAAAVTmlkb1NtYXJ0QWNjb3VudEVycm9yAAAAAAAAEAAAASxBIG11dGF0aW5nIG9wIChgcmVtb3ZlX3NpZ25lcmAvYHJlbW92ZV9jb250ZXh0X3J1bGVgL2ByZW1vdmVfcG9saWN5YC8KYHVwZGF0ZV9jb250ZXh0X3J1bGVfdmFsaWRfdW50aWxgKSB3YXMgYXR0ZW1wdGVkIHdoaWxlIGEgTElWRQpyZWNvdmVyeSBpcyBwZW5kaW5nIGZvciB0aGlzIGFjY291bnQgKHNwZWMgwqczLjIpIC0tIGJsb2NrcyBhIHRoaWVmCmhvbGRpbmcgYSBzdG9sZW4gcGFzc2tleSBmcm9tIGV2aWN0aW5nIHRoZSByZWNvdmVyeSBtZWNoYW5pc20gb3IgdGhlCmxlZ2l0aW1hdGUgc2lnbmVyIG1pZC1yZWNvdmVyeS4AAAAWUmVjb3ZlcnlQZW5kaW5nQmxvY2tlZAAAAAAAAQAAAlVBIGRpcmVjdCBgcmVtb3ZlX2NvbnRleHRfcnVsZShyZWNvdmVyeV9ydWxlX2lkKWAsCmBhZGRfcG9saWN5KHJlY292ZXJ5X3J1bGVfaWQsIC4uKWAsIGByZW1vdmVfcG9saWN5KHJlY292ZXJ5X3J1bGVfaWQsCi4uKWAsIG9yIGB1cGRhdGVfY29udGV4dF9ydWxlX3ZhbGlkX3VudGlsKHJlY292ZXJ5X3J1bGVfaWQsIC4uKWAgd2FzCmF0dGVtcHRlZCAtLSB0aGUgcmVjb3ZlcnkgcnVsZSdzIGV4aXN0ZW5jZSBBTkQgaXRzIHBvbGljeSBzZXQgYW5kCnZhbGlkaXR5IHdpbmRvdyBjYW4gb25seSBjaGFuZ2UgdmlhCmBpbml0aWF0ZV9yZWNvdmVyeV9ydWxlX3JlbW92YWxgL2BleGVjdXRlX3JlY292ZXJ5X3J1bGVfcmVtb3ZhbGAKKHRoZSBhbm5vdW5jZS10aGVuLWV4ZWN1dGUgcGF0aCBiZWxvdykuIEFwcGxpZXMgdW5jb25kaXRpb25hbGx5LApldmVuIHdpdGggbm8gcGVuZGluZywgc28gYSB0aGllZiBjYW5ub3QgZGVsZXRlIHRoZSBydWxlIG91dHJpZ2h0LCBub3IKbmV1dGVyIGl0IGluIHBsYWNlIChleHBpcmUgaXQgdmlhIGB2YWxpZF91bnRpbGAsIG9yIHBvaXNvbi9zdHJpcCBpdHMKcG9saWNpZXMpIHRvIGJ5cGFzcyB0aGUgcmVtb3ZhbCBkZWxheS4AAAAAAAAVUmVjb3ZlcnlSdWxlUHJvdGVjdGVkAAAAAAAAAgAAAFxgZXhlY3V0ZV9yZWNvdmVyeV9ydWxlX3JlbW92YWxgIHdhcyBjYWxsZWQgd2l0aG91dCBhIHByaW9yCmBpbml0aWF0ZV9yZWNvdmVyeV9ydWxlX3JlbW92YWxgLgAAABNSZW1vdmFsTm90QW5ub3VuY2VkAAAAAAMAAABUYGV4ZWN1dGVfcmVjb3ZlcnlfcnVsZV9yZW1vdmFsYCB3YXMgY2FsbGVkIGJlZm9yZSB0aGUgYW5ub3VuY2VkCjctZGF5IGRlbGF5IGVsYXBzZWQuAAAAFlJlbW92YWxEZWxheU5vdEVsYXBzZWQAAAAAAAQAAACuYGluaXRpYXRlX3JlY292ZXJ5X3J1bGVfcmVtb3ZhbGAvYGV4ZWN1dGVfcmVjb3ZlcnlfcnVsZV9yZW1vdmFsYCB3YXMKY2FsbGVkIG9uIGFuIGFjY291bnQgY29uc3RydWN0ZWQgd2l0aCBgcmVjb3ZlcnlfY29udHJvbGxlcjogTm9uZWAgLS0KdGhlcmUgaXMgbm8gcmVjb3ZlcnkgcnVsZSB0byByZW1vdmUuAAAAAAAUTm9SZWNvdmVyeUNvbmZpZ3VyZWQAAAAFAAABY2BlbnJvbGxfemtfcmVjb3ZlcnlgIChNMiBUYXNrIDYncyBtaWdyYXRpb24gcGF0aCkgd2FzIGNhbGxlZCBvbiBhbgphY2NvdW50IHRoYXQgYWxyZWFkeSBoYXMgYSByZWNvdmVyeSBydWxlIGluc3RhbGxlZCAtLSBlaXRoZXIgZnJvbQpjb25zdHJ1Y3Rpb24gKGBTb21lKHJlY292ZXJ5X2NvbnRyb2xsZXIpYCkgb3IgYSBwcmlvcgpgZW5yb2xsX3prX3JlY292ZXJ5YCBjYWxsLiBUbyBzd2FwIGNvbnRyb2xsZXJzLCByZW1vdmUgdGhlIGV4aXN0aW5nCnJ1bGUgZmlyc3QgdmlhIGBpbml0aWF0ZV9yZWNvdmVyeV9ydWxlX3JlbW92YWxgLwpgZXhlY3V0ZV9yZWNvdmVyeV9ydWxlX3JlbW92YWxgLCB0aGVuIGVucm9sbCBhZ2Fpbi4AAAAAF1JlY292ZXJ5QWxyZWFkeUVucm9sbGVkAAAAAAYAAAJhYHVwZ3JhZGVgICh0aGUgaW1tZWRpYXRlIHBhdGgpIHdhcyBjYWxsZWQgb24gYW4gYWNjb3VudCB0aGF0IEhBUyBhCnJlY292ZXJ5IHJ1bGUgaW5zdGFsbGVkLiBTdWNoIGFjY291bnRzIG11c3QgdXBncmFkZSB2aWEgdGhlCmFubm91bmNlLXRoZW4tZXhlY3V0ZSBwYXRoIChgaW5pdGlhdGVfdXBncmFkZWAgLT4gNy1kYXkgZGVsYXkgLT4KYGV4ZWN1dGVfdXBncmFkZWApLCBmb3IgdGhlIHNhbWUgcmVhc29uIGByZW1vdmVfY29udGV4dF9ydWxlYCBvbiB0aGUKcmVjb3ZlcnkgcnVsZSBpcyBgUmVjb3ZlcnlSdWxlUHJvdGVjdGVkYDogb3RoZXJ3aXNlIGB1cGdyYWRlYCB3b3VsZCBiZSBhCnplcm8tZGVsYXkgZXNjYXBlIGhhdGNoIGxldHRpbmcgYSBzdG9sZW4gcGFzc2tleSBzd2FwIGluIGEgd2FzbSB3aXRoIG5vCnJlY292ZXJ5IHJ1bGUgYW5kIHBlcm1hbmVudGx5IGxvY2sgb3V0IHRoZSBvd25lciwgYnlwYXNzaW5nIGJvdGggdGhlCjctZGF5IHJlbW92YWwgdGltZWxvY2sgYW5kIHRoZSB1bmNvbmRpdGlvbmFsIHJ1bGUtcHJvdGVjdGlvbiBjaGVja3MuCkFjY291bnRzIHdpdGggTk8gcmVjb3ZlcnkgcnVsZSBrZWVwIHRoZSBpbW1lZGlhdGUgYHVwZ3JhZGVgIHBhdGguAAAAAAAAF1VwZ3JhZGVSZXF1aXJlc1RpbWVsb2NrAAAAAAcAAAB1YGV4ZWN1dGVfdXBncmFkZWAgd2FzIGNhbGxlZCB3aXRob3V0IGEgcHJpb3IgYGluaXRpYXRlX3VwZ3JhZGVgIChvciBpdAp3YXMgYWxyZWFkeSBjb25zdW1lZCBieSBhIHN1Y2Nlc3NmdWwgZXhlY3V0ZSkuAAAAAAAAE1VwZ3JhZGVOb3RBbm5vdW5jZWQAAAAACAAAAEZgZXhlY3V0ZV91cGdyYWRlYCB3YXMgY2FsbGVkIGJlZm9yZSB0aGUgYW5ub3VuY2VkIDctZGF5IGRlbGF5IGVsYXBzZWQuAAAAAAAWVXBncmFkZURlbGF5Tm90RWxhcHNlZAAAAAAACQAAATBUaGUgZG9jdW1lbnQgY2FycmllcyBhIGN1bXVsYXRpdmUgc3BlbmQgY2FwLiBIeWJyaWQgYXBwbHlfZG9jIHJlZnVzZXMKY2FwcGVkIGRvY3MgcmF0aGVyIHRoYW4gaW5zdGFsbGluZyBhIHJ1bGUgV0VBS0VSIHRoYW4gcmV2aWV3ZWQgKHRoZQpjYXAncyBzdGF0ZWZ1bCBwb2xpY3kgYWRkcmVzcyBpcyByZWdpc3RyeS1yZXNvbHZlZCBTREstc2lkZSwgbm90CmRlcml2YWJsZSBpbi1jb250cmFjdCkuIENhcHBlZCBkb2NzIGluc3RhbGwgdmlhIHRoZSBTREsncyBwZXItcnVsZQpgYnVpbGREb2NJbnN0YWxsVHhzYCBwYXRoIGluc3RlYWQuAAAAEURvY0NhcFVuc3VwcG9ydGVkAAAAAAAACgAAADVDb21waWxlcjogdGhlIHN1Ym1pdHRlZCBkb2N1bWVudCBieXRlcyBhcmUgbm90IFVURi04LgAAAAAAAApEb2NOb3RVdGY4AAAAAAALAAAAMkNvbXBpbGVyOiB0aGUgZG9jdW1lbnQgZmFpbGVkIGZhaWwtY2xvc2VkIHBhcnNpbmcuAAAAAAAIRG9jUGFyc2UAAAAMAAAAMkNvbXBpbGVyOiB0aGUgZG9jdW1lbnQgZmFpbGVkIHNlbWFudGljIHZhbGlkYXRpb24uAAAAAAAKRG9jSW52YWxpZAAAAAAADQAAAEdDb21waWxlcjogdGhlIGRvY3VtZW50IG5hbWVzIG5vIG5ldHdvcmssIG9yIG9uZSB0aGF0IGlzIG5vdCB0aGlzCmNoYWluLgAAAAAPRG9jV3JvbmdOZXR3b3JrAAAAAA4AAAAyQ29tcGlsZXI6IHRoZSBkb2N1bWVudCBjYW5ub3QgYmUgbG93ZXJlZCB0byBydWxlcy4AAAAAAApEb2NDb21waWxlAAAAAAAPAAAAblRoZSBkb2MtY29tcGlsZXIgY3Jvc3MtY2FsbCBmYWlsZWQgb3V0cmlnaHQgKG5vIGNvbnRyYWN0IGF0IHRoZQpkZXJpdmVkIGFkZHJlc3MsIG9yIGEgaG9zdCB0cmFwKS4gRmFpbCBjbG9zZWQuAAAAAAAWRG9jQ29tcGlsZXJVbnJlYWNoYWJsZQAAAAAAEA==",
        "AAAAAAAAAAAAAAAMX19jaGVja19hdXRoAAAAAwAAAAAAAAARc2lnbmF0dXJlX3BheWxvYWQAAAAAAAPuAAAAIAAAAAAAAAAKc2lnbmF0dXJlcwAAAAAH0AAAAAtBdXRoUGF5bG9hZAAAAAAAAAAADWF1dGhfY29udGV4dHMAAAAAAAPqAAAH0AAAAAdDb250ZXh0AAAAAAEAAAPpAAAAAgAAB9AAAAARU21hcnRBY2NvdW50RXJyb3IAAAA=",
        "AAAAAAAAALJUaGUgY29udGV4dC1ydWxlIGlkcyBpbnN0YWxsZWQgYnkgdGhlIGxhc3Qgc3VjY2Vzc2Z1bCBgYXBwbHlfZG9jYAooZW1wdHkgaWYgbm9uZSkg4oCUIHRoZSBkb2MtbWFuYWdlZCBzdWJzZXQgb2YgdGhpcyBhY2NvdW50J3MgcnVsZXMsCnVzZWQgYnkgdGhlIFNESydzIGByZWFkUG9saWN5YCBwYXJpdHkgY2hlY2suAAAAAAAMZG9jX3J1bGVfaWRzAAAAAAAAAAEAAAPqAAAABA==",
        "AAAAAAAAAqpJbml0aWFsaXplIHRoZSBzbWFydCBhY2NvdW50IHdpdGggYSBkZWZhdWx0IGNvbnRleHQgcnVsZS4KClR5cGljYWxseSBjYWxsZWQgd2l0aCBhIHNpbmdsZSBgV2ViQXV0aG5gIHBhc3NrZXkgc2lnbmVyIGR1cmluZwp0aGUgTmlkbyBhY2NvdW50IGNyZWF0aW9uIGZsb3cuCgojIEFyZ3VtZW50cwoKKiBgc2lnbmVyc2AgLSBJbml0aWFsIHNpZ25lcnMgKGUuZy4sIHBhc3NrZXkgdmlhIGBXZWJBdXRobmAgdmVyaWZpZXIpCiogYHBvbGljaWVzYCAtIE9wdGlvbmFsIHBvbGljaWVzIChlLmcuLCBzcGVuZGluZyBsaW1pdHMpCiogYHJlY292ZXJ5X2NvbnRyb2xsZXJgIC0gV2hlbiBgU29tZWAsIHRoZSBNMSBgbmlkby16ay1yZWNvdmVyeWAKY29udHJvbGxlciB0byBpbnN0YWxsIGFzIHRoaXMgYWNjb3VudCdzIHplcm8tc2lnbmVyCmBDYWxsQ29udHJhY3Qoc2VsZilgIHJlY292ZXJ5IHJ1bGUncyBwb2xpY3kgKHByb2R1Y3Rpb24gZmFjdG9yeQpkZXBsb3lzIGFsd2F5cyBwYXNzIGBTb21lYCwga2VlcGluZyB0aGUgYW5vbnltaXR5IHNldCB1bmlmb3JtKS4KYE5vbmVgIHNraXBzIHRoZSByZWNvdmVyeSBydWxlIGVudGlyZWx5IOKAlCB1c2VkIGJ5IHVucmVsYXRlZCB0ZXN0CmRlcGxveXMgYW5kIG5vbi1mYWN0b3J5IGNvbnN0cnVjdGlvbiBwYXRocyB0aGF0IGRvbid0IHdhbnQgdGhlCmV4dHJhIHJ1bGUuAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAMAAAAAAAAAB3NpZ25lcnMAAAAD6gAAB9AAAAAGU2lnbmVyAAAAAAAAAAAACHBvbGljaWVzAAAD7AAAABMAAAAAAAAAAAAAABNyZWNvdmVyeV9jb250cm9sbGVyAAAAA+gAAAATAAAAAA==",
        "AAAAAAAAAAAAAAANcmVtb3ZlX3BvbGljeQAAAAAAAAIAAAAAAAAAD2NvbnRleHRfcnVsZV9pZAAAAAAEAAAAAAAAAAlwb2xpY3lfaWQAAAAAAAAEAAAAAA==",
        "AAAAAAAAAAAAAAANcmVtb3ZlX3NpZ25lcgAAAAAAAAIAAAAAAAAAD2NvbnRleHRfcnVsZV9pZAAAAAAEAAAAAAAAAAlzaWduZXJfaWQAAAAAAAAEAAAAAA==",
        "AAAAAAAAAgBTdGVwIDI6IHBlcmZvcm1zIHRoZSBhbm5vdW5jZWQgdXBncmFkZSBvbmNlIHRoZSA3LWRheSBkZWxheSBoYXMgZWxhcHNlZC4KUmVxdWlyZXMgdGhpcyBhY2NvdW50J3Mgb3duIGF1dGggYWdhaW4uIFBhbmljcyBgVXBncmFkZU5vdEFubm91bmNlZGAgaWYKYGluaXRpYXRlX3VwZ3JhZGVgIHdhcyBuZXZlciBjYWxsZWQgKG9yIHdhcyBhbHJlYWR5IGNvbnN1bWVkKSwKYFVwZ3JhZGVEZWxheU5vdEVsYXBzZWRgIGJlZm9yZSB0aGUgYW5ub3VuY2VkIHRpbWVzdGFtcCwgYW5kCmBSZWNvdmVyeVBlbmRpbmdCbG9ja2VkYCBpZiBhIHJlY292ZXJ5IGJlY2FtZSBwZW5kaW5nIGR1cmluZyB0aGUgZGVsYXkKd2luZG93IChyZS1jaGVja2VkIGhlcmUsIG5vdCBqdXN0IGF0IGFubm91bmNlIHRpbWUgLS0gc28gYW4gb3duZXIncwpnZW51aW5lIGluLWZsaWdodCByZWNvdmVyeSBibG9ja3MgYSB0aGllZidzIGFubm91bmNlZCB1cGdyYWRlKS4gTWlycm9ycwpgZXhlY3V0ZV9yZWNvdmVyeV9ydWxlX3JlbW92YWxgLgAAAA9leGVjdXRlX3VwZ3JhZGUAAAAAAAAAAAA=",
        "AAAAAAAAAAAAAAAQYWRkX2NvbnRleHRfcnVsZQAAAAUAAAAAAAAADGNvbnRleHRfdHlwZQAAB9AAAAAPQ29udGV4dFJ1bGVUeXBlAAAAAAAAAAAEbmFtZQAAABAAAAAAAAAAC3ZhbGlkX3VudGlsAAAAA+gAAAAEAAAAAAAAAAdzaWduZXJzAAAAA+oAAAfQAAAABlNpZ25lcgAAAAAAAAAAAAhwb2xpY2llcwAAA+wAAAATAAAAAAAAAAEAAAfQAAAAC0NvbnRleHRSdWxlAA==",
        "AAAAAAAAAMRUaGUgY2Fub25pY2FsIGBkb2NfaGFzaGAgb2YgdGhlIGN1cnJlbnRseSBhcHBsaWVkIHBvbGljeSBkb2N1bWVudCwKb3IgYE5vbmVgIGlmIG5vIGRvY3VtZW50IGhhcyBiZWVuIGFwcGxpZWQuIEFueW9uZSBjYW4gY2hlY2sKaW5zdGFsbGVkID09IHJldmlld2VkLiBNaXJyb3JzIGBQZXJjaFNtYXJ0QWNjb3VudDo6YXBwbGllZF9kb2NfaGFzaGAuAAAAEGFwcGxpZWRfZG9jX2hhc2gAAAAAAAAAAQAAA+gAAAPuAAAAIA==",
        "AAAAAAAAAAAAAAAQZ2V0X2NvbnRleHRfcnVsZQAAAAEAAAAAAAAAD2NvbnRleHRfcnVsZV9pZAAAAAAEAAAAAQAAB9AAAAALQ29udGV4dFJ1bGUA",
        "AAAAAAAAAuBTdGVwIDEgb2YgdXBncmFkaW5nIGEgUkVDT1ZFUlktRU5BQkxFRCBhY2NvdW50OiBhbm5vdW5jZXMgdGhlIHRhcmdldAp3YXNtIGhhc2ggYW5kIHN0YXJ0cyB0aGUgc2FtZSA3LWRheSB0aW1lciAoYFJFQ09WRVJZX1JFTU9WQUxfREVMQVlfU0VDU2ApCnRoYXQgcmVjb3ZlcnktcnVsZSByZW1vdmFsIHVzZXMuIE1pcnJvcnMgYGluaXRpYXRlX3JlY292ZXJ5X3J1bGVfcmVtb3ZhbGA6CmEgdGhpZWYgaG9sZGluZyBhIHN0b2xlbiBwYXNza2V5IENPVUxEIGFubm91bmNlIGEgbWFsaWNpb3VzIHVwZ3JhZGUsIGJ1dAp0aGUgZGVsYXkgaXMgdGhlIGRlZmVuc2UgLS0gaXQgZ2l2ZXMgdGhlIGxlZ2l0aW1hdGUgb3duZXIgKG9yIGEgbW9uaXRvcikKYSByZWFsIHdpbmRvdyB0byByZWFjdCwgZS5nLiBieSBpbml0aWF0aW5nIGEgZ2VudWluZSByZWNvdmVyeSwgd2hpY2ggdGhlbgpibG9ja3MgYGV4ZWN1dGVfdXBncmFkZWAgdmlhIHRoZSBzYW1lIGxpdmUtcGVuZGluZyBndWFyZCwgb3IgYnkKb3ZlcndyaXRpbmcgdGhlIGFubm91bmNlbWVudC4KClJlcXVpcmVzIHRoaXMgYWNjb3VudCdzIG93biBhdXRoLiBQYW5pY3MgYE5vUmVjb3ZlcnlDb25maWd1cmVkYCBpZiB0aGUKYWNjb3VudCBoYXMgbm8gcmVjb3ZlcnkgcnVsZSAodXNlIHRoZSBpbW1lZGlhdGUgYHVwZ3JhZGVgIGluc3RlYWQpLCBhbmQKYFJlY292ZXJ5UGVuZGluZ0Jsb2NrZWRgIGlmIGEgcmVjb3ZlcnkgaXMgY3VycmVudGx5IHBlbmRpbmcuAAAAEGluaXRpYXRlX3VwZ3JhZGUAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA",
        "AAAAAAAAAJxUaGUgYHUzMmAgaWQgb2YgdGhlIHplcm8tc2lnbmVyIHJlY292ZXJ5IGBDb250ZXh0UnVsZWAgaW5zdGFsbGVkIGF0CmNvbnN0cnVjdGlvbiwgb3IgYE5vbmVgIGlmIHRoZSBhY2NvdW50IHdhcyBjb25zdHJ1Y3RlZCB3aXRoCmByZWNvdmVyeV9jb250cm9sbGVyOiBOb25lYC4AAAAQcmVjb3ZlcnlfcnVsZV9pZAAAAAAAAAABAAAD6AAAAAQ=",
        "AAAAAAAABABNMiBUYXNrIDYgbWlncmF0aW9uIHBhdGg6IGxldHMgYW4gYWNjb3VudCB0aGF0IHdhcyBkZXBsb3llZCBXSVRIT1VUIGEKcmVjb3ZlcnkgY29udHJvbGxlciAoY29uc3RydWN0b3IgYHJlY292ZXJ5X2NvbnRyb2xsZXI6IE5vbmVgKSBvcHQKaW50byBaSyByZWNvdmVyeSBhZnRlcndhcmRzLCBhcyBhIHNlbGYtYXV0aG9yaXplZCwgVklTSUJMRSBjYWxsIC0tCnVubGlrZSB0aGUgaW52aXNpYmxlIGZhY3RvcnktZ2VuZXNpcyBwYXRoIChjb25zdHJ1Y3RvcgpgU29tZShyZWNvdmVyeV9jb250cm9sbGVyKWAsIHdoaWNoIGluc3RhbGxzIHRoZSBydWxlIGluc2lkZSB0aGUKZGVwbG95IHRyYW5zYWN0aW9uIGl0c2VsZiwgYmVmb3JlIHRoZSBhY2NvdW50IGFkZHJlc3MgaXMgZXZlcgpvYnNlcnZlZCBvbi1jaGFpbikuCgpSZXF1aXJlcyB0aGlzIGFjY291bnQncyBvd24gYXV0aAooYGUuY3VycmVudF9jb250cmFjdF9hZGRyZXNzKCkucmVxdWlyZV9hdXRoKClgKSAtLSB0aGUgc2FtZQpzZWxmLWF1dGggbW9kZWwgYXMgYGFkZF9tdWx0aXNpZ19yZWNvdmVyeWAvCmBpbml0aWF0ZV9yZWNvdmVyeV9ydWxlX3JlbW92YWxgOiB0aGUgYWNjb3VudCBvcHRzIGl0c2VsZiBpbiwgbm9ib2R5CmVsc2UgY2FuIGVucm9sbCBpdCBvbiB0aGUgYWNjb3VudCdzIGJlaGFsZi4KClBhbmljcyBgUmVjb3ZlcnlBbHJlYWR5RW5yb2xsZWRgIGlmIGEgcmVjb3ZlcnkgcnVsZSBpcyBhbHJlYWR5Cmluc3RhbGxlZCAoYHJlY292ZXJ5X3J1bGVfaWQoKWAgaXMgYFNvbWVgKSAtLSBlaXRoZXIgZnJvbQpjb25zdHJ1Y3Rpb24gb3IgYSBwcmlvciBgZW5yb2xsX3prX3JlY292ZXJ5YCBjYWxsLiBUbyBzd2FwCmNvbnRyb2xsZXJzLCBmaXJzdCByZW1vdmUgdGhlIGV4aXN0aW5nIHJ1bGUgdmlhCmBpbml0aWF0ZV9yZWNvdmVyeV9ydWxlX3JlbW92YWxgL2BleGVjdXRlX3JlY292ZXJ5X3J1bGVfcmVtb3ZhbGAsCnRoZW4gZW5yb2xsIGFnYWluLgoKT24gc3VjY2VzcywgZGVsZWdhdGVzIHRvIHRoZSBzYW1lIFtgaW5zdGFsbF9yZWNvdmVyeV9yAAAAEmVucm9sbF96a19yZWNvdmVyeQAAAAAAAQAAAAAAAAATcmVjb3ZlcnlfY29udHJvbGxlcgAAAAATAAAAAA==",
        "AAAAAAAAAKVUaGUgcmVjb3ZlcnkgY29udHJvbGxlciBgQWRkcmVzc2AgaW5zdGFsbGVkIGFzIHRoZSByZWNvdmVyeSBydWxlJ3MKcG9saWN5IGF0IGNvbnN0cnVjdGlvbiwgb3IgYE5vbmVgIGlmIHRoZSBhY2NvdW50IHdhcyBjb25zdHJ1Y3RlZCB3aXRoCmByZWNvdmVyeV9jb250cm9sbGVyOiBOb25lYC4AAAAAAAATcmVjb3ZlcnlfY29udHJvbGxlcgAAAAAAAAAAAQAAA+gAAAAT",
        "AAAAAAAAAAAAAAATcmVtb3ZlX2NvbnRleHRfcnVsZQAAAAABAAAAAAAAAA9jb250ZXh0X3J1bGVfaWQAAAAABAAAAAA=",
        "AAAAAAAAA0ZJbnN0YWxsIGEgc29jaWFsLXJlY292ZXJ5IHJ1bGUgc2NvcGVkIHRvIGNhbGxzIG9uIHRoaXMgYWNjb3VudCwgZ2F0ZWQKYnkgYW4gTS1vZi1OIG11bHRpc2lnIHBvbGljeS4KClR5cGVkIHdyYXBwZXIgYXJvdW5kIGBhZGRfY29udGV4dF9ydWxlYCB0aGF0IGNvbnN0cnVjdHMgdGhlIHBvbGljaWVzCm1hcCBmb3IgdGhlIGNhbGxlciDigJQgdGhlIFNESyBkb2Vzbid0IG5lZWQgdG8gd3Jlc3RsZSB3aXRoIHRoZQpgTWFwPEFkZHJlc3MsIFZhbD5gIGluc3RhbGwtcGFyYW0gZW5jb2RpbmcgKHRoZSBnZW5lcmF0ZWQgVFMgYmluZGluZ3MKd291bGQgb3RoZXJ3aXNlIGVyYXNlIHRoZSBpbnN0YWxsIHBhcmFtIHRvIGBhbnlgKS4KClRoZSBydWxlIGlzIHNjb3BlZCB0byBgQ2FsbENvbnRyYWN0KHNlbGYpYCBzbyBpdCBhdXRob3Jpc2VzIGNhbGxzCmFnYWluc3QgdGhlIGFjY291bnQncyBvd24gbWV0aG9kcyAoZS5nLiBgYWRkX3NpZ25lcmAsIGByZW1vdmVfc2lnbmVyYCwKYGFkZF9jb250ZXh0X3J1bGVgKSDigJQgbm90IGV4dGVybmFsIHRyYW5zZmVycy4KCiMgQXJndW1lbnRzCgoqIGBuYW1lYCAtIEh1bWFuLXJlYWRhYmxlIHJ1bGUgbmFtZS4KKiBgdmFsaWRfdW50aWxgIC0gT3B0aW9uYWwgZXhwaXJhdGlvbiBsZWRnZXIgc2VxdWVuY2UuCiogYGZyaWVuZHNgIC0gVGhlIHNpZ25lcnMgYXV0aG9yaXNlZCBieSB0aGUgcmVjb3ZlcnkgcnVsZS4KKiBgbXVsdGlzaWdfcG9saWN5YCAtIEFkZHJlc3Mgb2YgdGhlIGRlcGxveWVkIG11bHRpc2lnIHBvbGljeSBjb250cmFjdC4KKiBgdGhyZXNob2xkYCAtIE51bWJlciBvZiBgZnJpZW5kc2Agc2lnbmF0dXJlcyByZXF1aXJlZCAoTSkuAAAAAAAVYWRkX211bHRpc2lnX3JlY292ZXJ5AAAAAAAABQAAAAAAAAAEbmFtZQAAABAAAAAAAAAAC3ZhbGlkX3VudGlsAAAAA+gAAAAEAAAAAAAAAAdmcmllbmRzAAAAA+oAAAfQAAAABlNpZ25lcgAAAAAAAAAAAA9tdWx0aXNpZ19wb2xpY3kAAAAAEwAAAAAAAAAJdGhyZXNob2xkAAAAAAAABAAAAAEAAAfQAAAAC0NvbnRleHRSdWxlAA==",
        "AAAAAAAAAAAAAAAXZ2V0X2NvbnRleHRfcnVsZXNfY291bnQAAAAAAAAAAAEAAAAE",
        "AAAAAAAAAAAAAAAYdXBkYXRlX2NvbnRleHRfcnVsZV9uYW1lAAAAAgAAAAAAAAAPY29udGV4dF9ydWxlX2lkAAAAAAQAAAAAAAAABG5hbWUAAAAQAAAAAQAAB9AAAAALQ29udGV4dFJ1bGUA",
        "AAAAAAAAAuFTdGVwIDI6IGFjdHVhbGx5IHJlbW92ZXMgdGhlIHJlY292ZXJ5IHJ1bGUsIG9uY2UgYW5ub3VuY2VkIGFuZCB0aGUKNy1kYXkgZGVsYXkgaGFzIGVsYXBzZWQuIFJlcXVpcmVzIHRoaXMgYWNjb3VudCdzIG93biBhdXRoIGFnYWluLgoKUGFuaWNzIGBSZW1vdmFsTm90QW5ub3VuY2VkYCBpZiBgaW5pdGlhdGVfcmVjb3ZlcnlfcnVsZV9yZW1vdmFsYCB3YXMKbmV2ZXIgY2FsbGVkIChvciB3YXMgYWxyZWFkeSBjb25zdW1lZCBieSBhIHByaW9yIHN1Y2Nlc3NmdWwKZXhlY3V0ZSkuIFBhbmljcyBgUmVtb3ZhbERlbGF5Tm90RWxhcHNlZGAgaWYgY2FsbGVkIGJlZm9yZSB0aGUKYW5ub3VuY2VkIHRpbWVzdGFtcC4gUGFuaWNzIGBSZWNvdmVyeVBlbmRpbmdCbG9ja2VkYCBpZiBhIHJlY292ZXJ5CmJlY2FtZSBwZW5kaW5nIGR1cmluZyB0aGUgZGVsYXkgd2luZG93IChyZS1jaGVja2VkIGhlcmUsIG5vdCBqdXN0IGF0CmFubm91bmNlIHRpbWUpLiBPbiBzdWNjZXNzOiByZW1vdmVzIHRoZSByZWNvdmVyeSBgQ29udGV4dFJ1bGVgIHZpYQp0aGUgcmF3IE9aIHJlbW92YWwgKGJ5cGFzc2luZyB0aGlzIGNvbnRyYWN0J3Mgb3duCmBSZWNvdmVyeVJ1bGVQcm90ZWN0ZWRgIHNlbGYtY2hlY2ssIHdoaWNoIG9ubHkgZ3VhcmRzIHRoZQpgU21hcnRBY2NvdW50OjpyZW1vdmVfY29udGV4dF9ydWxlYCBlbnRyeSBwb2ludCBiZWxvdykgYW5kIGNsZWFycyB0aGUKcmVjb3ZlcnkgaW5zdGFuY2Utc3RvcmFnZSBrZXlzLgAAAAAAAB1leGVjdXRlX3JlY292ZXJ5X3J1bGVfcmVtb3ZhbAAAAAAAAAAAAAAA",
        "AAAAAAAAA/lTdGVwIDEgb2Ygb3B0aW5nIG91dCBvZiByZWNvdmVyeTogYW5ub3VuY2VzIGludGVudCB0byByZW1vdmUgdGhlCnByb3RlY3RlZCByZWNvdmVyeSBydWxlIGFuZCBzdGFydHMgYSA3LWRheSB0aW1lcgooYFJFQ09WRVJZX1JFTU9WQUxfREVMQVlfU0VDU2ApIHRoYXQgYGV4ZWN1dGVfcmVjb3ZlcnlfcnVsZV9yZW1vdmFsYAptdXN0IHdhaXQgb3V0LiBUaGlzIGlzIHRoZSBPTkxZIHdheSB0byByZW1vdmUgdGhlIHJlY292ZXJ5IHJ1bGUgLS0KYHJlbW92ZV9jb250ZXh0X3J1bGUocmVjb3ZlcnlfcnVsZV9pZClgIGFsd2F5cyBwYW5pY3MKYFJlY292ZXJ5UnVsZVByb3RlY3RlZGAgKHNlZSB0aGUgYFNtYXJ0QWNjb3VudGAgaW1wbCBiZWxvdykuCgpSZXF1aXJlcyB0aGlzIGFjY291bnQncyBvd24gYXV0aCAodGhlIGBXZWJBdXRobmAgcGFzc2tleSBzaWduZXIgaW4KcHJvZHVjdGlvbikuIEEgdGhpZWYgaG9sZGluZyBhIHN0b2xlbiBwYXNza2V5IENPVUxEIGNhbGwgdGhpcywgYnV0CnRoZSA3LWRheSBkZWxheSBpcyB0aGUgZGVmZW5zZTogaXQgZ2l2ZXMgdGhlIGxlZ2l0aW1hdGUgb3duZXIgKG9yCmFueXRoaW5nIG1vbml0b3JpbmcgdGhlIGFjY291bnQpIGEgcmVhbCB3aW5kb3cgdG8gbm90aWNlIGFuZCByZWFjdCwKZS5nLiBieSBpbml0aWF0aW5nIGEgZ2VudWluZSByZWNvdmVyeSwgd2hpY2ggdGhlbiBibG9ja3MKYGV4ZWN1dGVfcmVjb3ZlcnlfcnVsZV9yZW1vdmFsYCB2aWEgdGhlIHNhbWUgbGl2ZS1wZW5kaW5nIGd1YXJkIHRoZQpmb3VyIG11dGF0aW5nIG9wcyB1c2UuCgpQYW5pY3MgYE5vUmVjb3ZlcnlDb25maWd1cmVkYCBpZiB0aGlzIGFjY291bnQgaGFzIG5vIHJlY292ZXJ5IHJ1bGUuClBhbmljcyBgUmVjb3ZlcnlQZW5kaW5nQmxvY2tlZGAgaWYgYSByZWNvdmVyeSBpcyBjdXJyZW50bHkgcGVuZGluZwooYW5ub3VuY2luZyByZW1vdmFsIG1pZC1yZWNvdmVyeSB3b3VsZCBsZXQgYSB0aGllZiByYWNlIHRoZQpsZWdpdGltYXRlIG93bmVyJ3MgaW4tZmxpZ2h0IHJlY292ZXJ5KS4AAAAAAAAeaW5pdGlhdGVfcmVjb3ZlcnlfcnVsZV9yZW1vdmFsAAAAAAAAAAAAAA==",
        "AAAAAAAAAAAAAAAfdXBkYXRlX2NvbnRleHRfcnVsZV92YWxpZF91bnRpbAAAAAACAAAAAAAAAA9jb250ZXh0X3J1bGVfaWQAAAAABAAAAAAAAAALdmFsaWRfdW50aWwAAAAD6AAAAAQAAAABAAAH0AAAAAtDb250ZXh0UnVsZQA=",
        "AAAAAgAAAONDb250ZXh0IG9mIGEgc2luZ2xlIGF1dGhvcml6ZWQgY2FsbCBwZXJmb3JtZWQgYnkgYW4gYWRkcmVzcy4KCkN1c3RvbSBhY2NvdW50IGNvbnRyYWN0cyB0aGF0IGltcGxlbWVudCBgX19jaGVja19hdXRoYCBzcGVjaWFsIGZ1bmN0aW9uCnJlY2VpdmUgYSBsaXN0IG9mIGBDb250ZXh0YCB2YWx1ZXMgY29ycmVzcG9uZGluZyB0byBhbGwgdGhlIGNhbGxzIHRoYXQKbmVlZCB0byBiZSBhdXRob3JpemVkLgAAAAAAAAAAB0NvbnRleHQAAAAAAwAAAAEAAAAUQ29udHJhY3QgaW52b2NhdGlvbi4AAAAIQ29udHJhY3QAAAABAAAH0AAAAA9Db250cmFjdENvbnRleHQAAAAAAQAAAD1Db250cmFjdCB0aGF0IGhhcyBhIGNvbnN0cnVjdG9yIHdpdGggbm8gYXJndW1lbnRzIGlzIGNyZWF0ZWQuAAAAAAAAFENyZWF0ZUNvbnRyYWN0SG9zdEZuAAAAAQAAB9AAAAAbQ3JlYXRlQ29udHJhY3RIb3N0Rm5Db250ZXh0AAAAAAEAAABEQ29udHJhY3QgdGhhdCBoYXMgYSBjb25zdHJ1Y3RvciB3aXRoIDEgb3IgbW9yZSBhcmd1bWVudHMgaXMgY3JlYXRlZC4AAAAcQ3JlYXRlQ29udHJhY3RXaXRoQ3Rvckhvc3RGbgAAAAEAAAfQAAAAKkNyZWF0ZUNvbnRyYWN0V2l0aENvbnN0cnVjdG9ySG9zdEZuQ29udGV4dAAA",
        "AAAAAQAAAL1BdXRob3JpemF0aW9uIGNvbnRleHQgb2YgYSBzaW5nbGUgY29udHJhY3QgY2FsbC4KClRoaXMgc3RydWN0IGNvcnJlc3BvbmRzIHRvIGEgYHJlcXVpcmVfYXV0aF9mb3JfYXJnc2AgY2FsbCBmb3IgYW4gYWRkcmVzcwpmcm9tIGBjb250cmFjdGAgZnVuY3Rpb24gd2l0aCBgZm5fbmFtZWAgbmFtZSBhbmQgYGFyZ3NgIGFyZ3VtZW50cy4AAAAAAAAAAAAAD0NvbnRyYWN0Q29udGV4dAAAAAADAAAAAAAAAARhcmdzAAAD6gAAAAAAAAAAAAAACGNvbnRyYWN0AAAAEwAAAAAAAAAHZm5fbmFtZQAAAAAR",
        "AAAAAgAAAF9Db250cmFjdCBleGVjdXRhYmxlIHVzZWQgZm9yIGNyZWF0aW5nIGEgbmV3IGNvbnRyYWN0IGFuZCB1c2VkIGluCmBDcmVhdGVDb250cmFjdEhvc3RGbkNvbnRleHRgLgAAAAAAAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAQAAAAEAAAAAAAAABFdhc20AAAABAAAD7gAAACA=",
        "AAAAAQAAAHZBdXRob3JpemF0aW9uIGNvbnRleHQgZm9yIGBjcmVhdGVfY29udHJhY3RgIGhvc3QgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEKbmV3IGNvbnRyYWN0IG9uIGJlaGFsZiBvZiBhdXRob3JpemVyIGFkZHJlc3MuAAAAAAAAAAAAG0NyZWF0ZUNvbnRyYWN0SG9zdEZuQ29udGV4dAAAAAACAAAAAAAAAApleGVjdXRhYmxlAAAAAAfQAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAAAAAARzYWx0AAAD7gAAACA=",
        "AAAAAQAAANZBdXRob3JpemF0aW9uIGNvbnRleHQgZm9yIGBjcmVhdGVfY29udHJhY3RgIGhvc3QgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEKbmV3IGNvbnRyYWN0IG9uIGJlaGFsZiBvZiBhdXRob3JpemVyIGFkZHJlc3MuClRoaXMgaXMgdGhlIHNhbWUgYXMgYENyZWF0ZUNvbnRyYWN0SG9zdEZuQ29udGV4dGAsIGJ1dCBhbHNvIGhhcwpjb250cmFjdCBjb25zdHJ1Y3RvciBhcmd1bWVudHMuAAAAAAAAAAAAKkNyZWF0ZUNvbnRyYWN0V2l0aENvbnN0cnVjdG9ySG9zdEZuQ29udGV4dAAAAAAAAwAAAAAAAAAQY29uc3RydWN0b3JfYXJncwAAA+oAAAAAAAAAAAAAAApleGVjdXRhYmxlAAAAAAfQAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAAAAAARzYWx0AAAD7gAAACA=",
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
        "AAAAAgAAAEBUeXBlcyBvZiBjb250ZXh0cyB0aGF0IGNhbiBiZSBhdXRob3JpemVkIGJ5IHNtYXJ0IGFjY291bnQgcnVsZXMuAAAAAAAAAA9Db250ZXh0UnVsZVR5cGUAAAAAAwAAAAAAAAAtRGVmYXVsdCBydWxlcyB0aGF0IGNhbiBhdXRob3JpemUgYW55IGNvbnRleHQuAAAAAAAAB0RlZmF1bHQAAAAAAQAAADBSdWxlcyBzcGVjaWZpYyB0byBjYWxsaW5nIGEgcGFydGljdWxhciBjb250cmFjdC4AAAAMQ2FsbENvbnRyYWN0AAAAAQAAABMAAAABAAAAQlJ1bGVzIHNwZWNpZmljIHRvIGNyZWF0aW5nIGEgY29udHJhY3Qgd2l0aCBhIHBhcnRpY3VsYXIgV0FTTSBoYXNoLgAAAAAADkNyZWF0ZUNvbnRyYWN0AAAAAAABAAAD7gAAACA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    execute: this.txFromJSON<null>,
        upgrade: this.txFromJSON<null>,
        apply_doc: this.txFromJSON<Result<Buffer>>,
        add_policy: this.txFromJSON<u32>,
        add_signer: this.txFromJSON<u32>,
        doc_rule_ids: this.txFromJSON<Array<u32>>,
        remove_policy: this.txFromJSON<null>,
        remove_signer: this.txFromJSON<null>,
        execute_upgrade: this.txFromJSON<null>,
        add_context_rule: this.txFromJSON<ContextRule>,
        applied_doc_hash: this.txFromJSON<Option<Buffer>>,
        get_context_rule: this.txFromJSON<ContextRule>,
        initiate_upgrade: this.txFromJSON<null>,
        recovery_rule_id: this.txFromJSON<Option<u32>>,
        enroll_zk_recovery: this.txFromJSON<null>,
        recovery_controller: this.txFromJSON<Option<string>>,
        remove_context_rule: this.txFromJSON<null>,
        add_multisig_recovery: this.txFromJSON<ContextRule>,
        get_context_rules_count: this.txFromJSON<u32>,
        update_context_rule_name: this.txFromJSON<ContextRule>,
        execute_recovery_rule_removal: this.txFromJSON<null>,
        initiate_recovery_rule_removal: this.txFromJSON<null>,
        update_context_rule_valid_until: this.txFromJSON<ContextRule>
  }
}