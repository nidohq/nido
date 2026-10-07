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
 * Constants of the deployed account wasm a wallet checks before it builds
 * anything for this account: what [`PerchSmartAccount::capabilities`]
 * returns.
 */
export interface AccountCapabilities {
  /**
 * How a document is applied: `one_tx`, one `apply_doc` transaction.
 */
apply_modes: Array<string>;
  /**
 * What a signer signs: `oz_rule_ids`, OZ's
 * `sha256(signature_payload || context_rule_ids.to_xdr())`.
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
   * Construct and simulate a infra transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Every shared contract this account pins at build time.
   */
  infra: (options?: MethodOptions) => Promise<AssembledTransaction<InfraPins>>

  /**
   * Construct and simulate a renew transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend the account's instance, applied document, and the named
   * revoked-set and enrolled-id entries to the network maximum.
   * Permissionless; changes no meaning.
   */
  renew: ({fingerprints, enrollment_ids}: {fingerprints: Array<Buffer>, enrollment_ids: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

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
   * tells A -> B -> A apart.
   */
  revision: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a apply_doc transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Apply a policy document — **the only way authorization changes**.
   * The two shared, immutable infra contracts (the stateless doc compiler
   * and the interpreter) are derived from the build-time-pinned
   * [`stateless_registry`] (see [`infra`]), never passed in. Replaces the
   * entire rule set atomically and returns the canonical `doc_hash`.
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
   * With `expected_revision`, the call refuses with `StaleRevision`
   * unless the account is still at that [`Self::revision`], so a document
   * prepared against one configuration never overwrit
   */
  apply_doc: ({doc_json, approval_valid_until, expected_revision}: {doc_json: Buffer, approval_valid_until: u32, expected_revision: Option<u64>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a is_revoked transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Whether a credential fingerprint is permanently revoked.
   */
  is_revoked: ({fingerprint}: {fingerprint: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a applied_doc transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The applied document's canonical bytes, or `None` before the first
   * `apply_doc`. `sha256` of them is [`Self::applied_doc_hash`].
   */
  applied_doc: (options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

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
   * Construct and simulate a configuration transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Everything rule selection and signing need, read at one ledger, with
   * the revision it belongs to.
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
   * Every context rule the account has installed, with its OZ id. The
   * document's rules are matched against these by `apply_doc`.
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
   * `None` if only the constructor's admin rule exists. Anyone can check
   * installed == reviewed.
   */
  applied_doc_hash: (options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a get_context_rule transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * See [`Self::get_context_rules_count`].
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
   * Construct and simulate a get_context_rules_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
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
        "AAAAAAAAAJ5FeHRlbmQgdGhlIGFjY291bnQncyBpbnN0YW5jZSwgYXBwbGllZCBkb2N1bWVudCwgYW5kIHRoZSBuYW1lZApyZXZva2VkLXNldCBhbmQgZW5yb2xsZWQtaWQgZW50cmllcyB0byB0aGUgbmV0d29yayBtYXhpbXVtLgpQZXJtaXNzaW9ubGVzczsgY2hhbmdlcyBubyBtZWFuaW5nLgAAAAAABXJlbmV3AAAAAAAAAgAAAAAAAAAMZmluZ2VycHJpbnRzAAAD6gAAA+4AAAAgAAAAAAAAAA5lbnJvbGxtZW50X2lkcwAAAAAD6gAAA+4AAAAgAAAAAA==",
        "AAAAAAAAAVdDYWxsIGB0YXJnZXRfZm5gIG9uIGB0YXJnZXRgIGFzIHRoaXMgYWNjb3VudCAodGhlIGFjY291bnQgYmVjb21lcwp0aGUgaW52b2tlciwgc28gYHRhcmdldGAncyBgcmVxdWlyZV9hdXRoYCBvZiB0aGlzIGFjY291bnQgcGFzc2VzKS4KUmVxdWlyZXMgdGhlIGFjY291bnQncyBhdXRob3JpemF0aW9uIG9mIHRoaXMgZXhhY3QgY2FsbC4gUmVmdXNlcyB0aGUKaW52b2tlci1vbmx5IGhvb2sgbmFtZXM6IG90aGVyd2lzZSB3aG9ldmVyIGNhbiBhdXRob3JpemUgYGV4ZWN1dGVgCmNvdWxkIHJlYWNoIGEgY29udHJvbGxlciwgcG9saWN5LCBvciBwb29sIGhvb2sgYXMgdGhlIGFjY291bnQKKHNwZWMgwqcxNSkuAAAAAAdleGVjdXRlAAAAAAMAAAAAAAAABnRhcmdldAAAAAAAEwAAAAAAAAAJdGFyZ2V0X2ZuAAAAAAAAEQAAAAAAAAALdGFyZ2V0X2FyZ3MAAAAD6gAAAAAAAAABAAAD6QAAAAAAAAfQAAAAEVBlcmNoQWNjb3VudEVycm9yAAAA",
        "AAAAAAAAAG1UaGUgYXBwbGllZCBkb2N1bWVudCdzIGNhbm9uaWNhbCBieXRlcyB3aXRoIHRoZSByZXZpc2lvbiB0aGV5IGJlbG9uZwp0bzsgYE5vbmVgIGJlZm9yZSB0aGUgZmlyc3QgYGFwcGx5X2RvY2AuAAAAAAAACGRvY3VtZW50AAAAAAAAAAEAAAPtAAAAAgAAAAYAAAPoAAAADg==",
        "AAAAAAAAAXxJbnZva2VyLW9ubHk6IHRoZSBhZG9wdGVkIGNvbnRyb2xsZXIgc2V0cyAoYGZyb3plbl91bnRpbCA+IDBgKSBvcgpjbGVhcnMgKGAwYCkgdGhlIGBQcm90ZWN0ZWRgIGZyZWV6ZSBmb3IgYGF0dGVtcHRfaWRgLiBUaGUgYWNjb3VudAptaXJyb3JzIHRoZSBmcmVlemUgcmF0aGVyIHRoYW4gYXNraW5nIHRoZSBjb250cm9sbGVyIGZyb20KYF9fY2hlY2tfYXV0aGAsIGJlY2F1c2UgYW4gYWNjb3VudCBhcHByb3ZpbmcgYXMgYSBndWFyZGlhbiB0aHJvdWdoCnRoZSBzYW1lIGNvbnRyb2xsZXIgaW5zdGFuY2UgcnVucyBgX19jaGVja19hdXRoYCB3aGlsZSB0aGF0CmNvbnRyb2xsZXIgaXMgb24gdGhlIGNhbGwgc3RhY2ssIGFuZCB0aGUgaG9zdCByZWZ1c2VzIHJlLWVudHJ5LgAAAAhyY3ZfZ2F0ZQAAAAIAAAAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAAAAAAAADGZyb3plbl91bnRpbAAAAAQAAAABAAAD6QAAAAIAAAfQAAAAEVBlcmNoQWNjb3VudEVycm9yAAAA",
        "AAAAAAAAAWZUaGUgY29uZmlndXJhdGlvbiByZXZpc2lvbjogMCBhZnRlciB0aGUgY29uc3RydWN0b3IsIGFkdmFuY2VkIGJ5IG9uZQppbiBldmVyeSBzdWNjZXNzZnVsIGBhcHBseV9kb2NgICh3aGF0ZXZlciBpdCBjaGFuZ2VzLCBhIHJlLWFwcGx5IG9mCnRoZSBzYW1lIGRvY3VtZW50IGluY2x1ZGVkKSBhbmQgZXZlcnkgZXhlY3V0ZWQgdXBncmFkZS4gRnJlZXplCmNoYW5nZXMsIHJlY292ZXJ5IGF0dGVtcHRzLCBldmlkZW5jZSwgYW5kIGNhbmNlbGxhdGlvbnMgZG8gbm90CmFkdmFuY2UgaXQuIE5ldmVyIGRlY3JlYXNlcyBhbmQgbmV2ZXIgcmVwZWF0cywgc28gdW5saWtlIGBkb2NfaGFzaGAgaXQKdGVsbHMgQSAtPiBCIC0+IEEgYXBhcnQuAAAAAAAIcmV2aXNpb24AAAAAAAAAAQAAAAY=",
        "AAAAAAAABABBcHBseSBhIHBvbGljeSBkb2N1bWVudCDigJQgKip0aGUgb25seSB3YXkgYXV0aG9yaXphdGlvbiBjaGFuZ2VzKiouClRoZSB0d28gc2hhcmVkLCBpbW11dGFibGUgaW5mcmEgY29udHJhY3RzICh0aGUgc3RhdGVsZXNzIGRvYyBjb21waWxlcgphbmQgdGhlIGludGVycHJldGVyKSBhcmUgZGVyaXZlZCBmcm9tIHRoZSBidWlsZC10aW1lLXBpbm5lZApbYHN0YXRlbGVzc19yZWdpc3RyeWBdIChzZWUgW2BpbmZyYWBdKSwgbmV2ZXIgcGFzc2VkIGluLiBSZXBsYWNlcyB0aGUKZW50aXJlIHJ1bGUgc2V0IGF0b21pY2FsbHkgYW5kIHJldHVybnMgdGhlIGNhbm9uaWNhbCBgZG9jX2hhc2hgLgoKQXV0aG9yaXplZCBieSB0aGUgb3duZXIgKGFueSBvcmRpbmFyeSBydWxlIHNjb3BlZCB0byB0aGUgYWNjb3VudCksCm9yLCBmb3IgYSByZWNvdmVyeSBjb21wbGV0aW9uIG9ubHksIGJ5IHRoZSB6ZXJvLXNpZ25lciByZWNvdmVyeSBydWxlCndob3NlIGNvbnRyb2xsZXIgY2hlY2tzIHRoZSBleGFjdCB0YXJnZXQuIE9uIGFuIGFjY291bnQgd2l0aCBhbgphZG9wdGVkIGNvbnRyb2xsZXIsIHRoZSBjb250cm9sbGVyJ3MgYHJjdl9zeW5jYCBjbGFzc2lmaWVzIHRoZSBjYWxsCmJlZm9yZSBhbnkgcnVsZSBjaGFuZ2VzIGFuZCByZWZ1c2VzIHdoYXQgdGhlIHByb2ZpbGUgZG9lcyBub3QgYWxsb3cKKGBkb2NzL3JlY292ZXJ5L3NwZWMubWRgIMKnMTApLiBgYXBwcm92YWxfdmFsaWRfdW50aWxgIGlzIHRoZQpmcmVzaG5lc3MgYm91bmQgYSBgUHJvdGVjdGVkYCByZWNvbmZpZ3VyYXRpb24ncyByZWNvcmRlZCBhcHByb3ZhbHMKd2VyZSBnaXZlbiBmb3I7IGl0IGlzIGlnbm9yZWQgb3RoZXJ3aXNlLgoKV2l0aCBgZXhwZWN0ZWRfcmV2aXNpb25gLCB0aGUgY2FsbCByZWZ1c2VzIHdpdGggYFN0YWxlUmV2aXNpb25gCnVubGVzcyB0aGUgYWNjb3VudCBpcyBzdGlsbCBhdCB0aGF0IFtgU2VsZjo6cmV2aXNpb25gXSwgc28gYSBkb2N1bWVudApwcmVwYXJlZCBhZ2FpbnN0IG9uZSBjb25maWd1cmF0aW9uIG5ldmVyIG92ZXJ3cml0AAAACWFwcGx5X2RvYwAAAAAAAAMAAAAAAAAACGRvY19qc29uAAAADgAAAAAAAAAUYXBwcm92YWxfdmFsaWRfdW50aWwAAAAEAAAAAAAAABFleHBlY3RlZF9yZXZpc2lvbgAAAAAAA+gAAAAGAAAAAQAAA+kAAAPuAAAAIAAAB9AAAAARUGVyY2hBY2NvdW50RXJyb3IAAAA=",
        "AAAAAAAAADhXaGV0aGVyIGEgY3JlZGVudGlhbCBmaW5nZXJwcmludCBpcyBwZXJtYW5lbnRseSByZXZva2VkLgAAAAppc19yZXZva2VkAAAAAAABAAAAAAAAAAtmaW5nZXJwcmludAAAAAPuAAAAIAAAAAEAAAAB",
        "AAAAAAAAAH9UaGUgYXBwbGllZCBkb2N1bWVudCdzIGNhbm9uaWNhbCBieXRlcywgb3IgYE5vbmVgIGJlZm9yZSB0aGUgZmlyc3QKYGFwcGx5X2RvY2AuIGBzaGEyNTZgIG9mIHRoZW0gaXMgW2BTZWxmOjphcHBsaWVkX2RvY19oYXNoYF0uAAAAAAthcHBsaWVkX2RvYwAAAAAAAAAAAQAAA+gAAAAO",
        "AAAAAAAAAAAAAAAMX19jaGVja19hdXRoAAAAAwAAAAAAAAARc2lnbmF0dXJlX3BheWxvYWQAAAAAAAPuAAAAIAAAAAAAAAAKc2lnbmF0dXJlcwAAAAAH0AAAAAtBdXRoUGF5bG9hZAAAAAAAAAAADWF1dGhfY29udGV4dHMAAAAAAAPqAAAH0AAAAAdDb250ZXh0AAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAI9Db25zdGFudHMgb2YgdGhpcyBhY2NvdW50J3Mgd2FzbTogaW50ZXJmYWNlIGFuZCBzbmFwc2hvdCB2ZXJzaW9ucywKdGhlIGRvY3VtZW50IGlkZW50aXR5IGFuZCBhdXRob3JpemF0aW9uIGRpZ2VzdCBzY2hlbWVzLCBhbmQgdGhlIGFwcGx5Cm1vZGVzLgAAAAAMY2FwYWJpbGl0aWVzAAAAAAAAAAEAAAfQAAAAE0FjY291bnRDYXBhYmlsaXRpZXMA",
        "AAAAAAAAADFUaGUgZG9jIGNvbXBpbGVyIHRoaXMgYWNjb3VudCBwaW5zIGF0IGJ1aWxkIHRpbWUuAAAAAAAADGRvY19jb21waWxlcgAAAAAAAAABAAAAEw==",
        "AAAAAAAAAGtEZXBsb3ktdGltZSBydWxlIDA6IHRoZSBhZG1pbiBzaWduZXJzIG1heSBtYW5hZ2UgdGhpcyBhY2NvdW50IChpLmUuCmNhbGwgYGFwcGx5X2RvY2ApIOKAlCBhbmQgbm90aGluZyBlbHNlLgAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAEAAAAAAAAADWFkbWluX3NpZ25lcnMAAAAAAAPqAAAH0AAAAAZTaWduZXIAAAAAAAA=",
        "AAAAAAAAAGBFdmVyeXRoaW5nIHJ1bGUgc2VsZWN0aW9uIGFuZCBzaWduaW5nIG5lZWQsIHJlYWQgYXQgb25lIGxlZGdlciwgd2l0aAp0aGUgcmV2aXNpb24gaXQgYmVsb25ncyB0by4AAAANY29uZmlndXJhdGlvbgAAAAAAAAAAAAABAAAH0AAAABRBY2NvdW50Q29uZmlndXJhdGlvbg==",
        "AAAAAAAAAHpUaGUgYFByb3RlY3RlZGAgZnJlZXplLCBpZiBvbmUgd2FzIHNldCBhbmQgaGFzIG5vdCBiZWVuIGNsZWFyZWQuIEl0CmlzIGluIGZvcmNlIHdoaWxlIHRoZSBjdXJyZW50IGxlZGdlciBpcyBiZWxvdyBgdW50aWxgLgAAAAAADXJlY292ZXJ5X2dhdGUAAAAAAAAAAAAAAQAAA+gAAAfQAAAACkZyZWV6ZUdhdGUAAA==",
        "AAAAAAAAADBDYW5jZWwgdGhlIHBlbmRpbmcgdXBncmFkZS4gT3duZXIgYXV0aG9yaXphdGlvbi4AAAAOY2FuY2VsX3VwZ3JhZGUAAAAAAAAAAAABAAAD6QAAAAIAAAfQAAAAEVBlcmNoQWNjb3VudEVycm9yAAAA",
        "AAAAAAAAADZXaGV0aGVyIHRoaXMgYWNjb3VudCBldmVyIGVucm9sbGVkIGEgWksgZW5yb2xsbWVudCBpZC4AAAAAAA5pc19lbnJvbGxlZF9pZAAAAAAAAQAAAAAAAAANZW5yb2xsbWVudF9pZAAAAAAAA+4AAAAgAAAAAQAAAAE=",
        "AAAAAAAAAGtBIGBMb3NzYCBvd25lcidzIGNhbmNlbGxhdGlvbiBvZiBhIHJlY292ZXJ5IGF0dGVtcHQgKHNwZWMgVDcpLiBUaGUKY29udHJvbGxlciByZWZ1c2VzIGl0IHVuZGVyIGBQcm90ZWN0ZWRgLgAAAAAPY2FuY2VsX3JlY292ZXJ5AAAAAAEAAAAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAAABAAAD6QAAAAIAAAfQAAAAEVBlcmNoQWNjb3VudEVycm9yAAAA",
        "AAAAAAAAAuVFeGVjdXRlIHRoZSBwZW5kaW5nIHVwZ3JhZGUgb25jZSBpdHMgZGVsYXkgaGFzIGVsYXBzZWQuIE93bmVyCmF1dGhvcml6YXRpb24uIElmIHRoZSByZWNvdmVyeSBnZW5lcmF0aW9uIG1vdmVkIHNpbmNlIHNjaGVkdWxpbmcKKGFueSBlbnJvbGxtZW50LCByZWNvbmZpZ3VyYXRpb24sIHJlbW92YWwsIGNvbnRyb2xsZXIgc3dpdGNoLApjb21wbGV0ZWQgcmVjb3ZlcnksIG9yIGV4ZWN1dGVkIHVwZ3JhZGUpLCB0aGUgcmVxdWVzdCBpcyBzdGFsZSBhbmQKdGhlIGNhbGwgcmVmdXNlcyB3aXRoIGBTdGFsZVVwZ3JhZGVgLiBUaGUgcmVmdXNhbCBsZWF2ZXMgdGhlIHJlcXVlc3QKaW4gcGxhY2UsIHNpbmNlIGEgZmFpbGVkIGludm9jYXRpb24ga2VlcHMgbm9uZSBvZiBpdHMgd3JpdGVzOyBpdCBjYW4KbmV2ZXIgZXhlY3V0ZSwgYmVjYXVzZSB0aGUgZ2VuZXJhdGlvbiBuZXZlciBkZWNyZWFzZXMsIGFuZCBzdGF5cwp1bnRpbCBgc2NoZWR1bGVfdXBncmFkZWAgcmVwbGFjZXMgaXQsIGBjYW5jZWxfdXBncmFkZWAgcmVtb3ZlcyBpdCwgb3IKYSBjb21wbGV0aW9uIGNsZWFycyBpdC4gT3RoZXJ3aXNlIHRoZSBjb250cm9sbGVyLCBpZiBvbmUgaXMgYWRvcHRlZCwKY2hlY2tzIGl0cyBlcG9jaCBhbmQgYnVtcHMgaXQgKHJlZnVzaW5nIGR1cmluZyBhbiBhdXRob3JpemVkCmF0dGVtcHQpLCB0aGUgZ2VuZXJhdGlvbiBhZHZhbmNlcywgYW5kIHRoZSBXYXNtIGlzIHJlcGxhY2VkIGFmdGVyCnRoaXMgaW52b2NhdGlvbi4AAAAAAAAPZXhlY3V0ZV91cGdyYWRlAAAAAAEAAAAAAAAACnJlcXVlc3RfaWQAAAAAAAYAAAABAAAD6QAAAAIAAAfQAAAAEVBlcmNoQWNjb3VudEVycm9yAAAA",
        "AAAAAAAAAHxFdmVyeSBjb250ZXh0IHJ1bGUgdGhlIGFjY291bnQgaGFzIGluc3RhbGxlZCwgd2l0aCBpdHMgT1ogaWQuIFRoZQpkb2N1bWVudCdzIHJ1bGVzIGFyZSBtYXRjaGVkIGFnYWluc3QgdGhlc2UgYnkgYGFwcGx5X2RvY2AuAAAAD2luc3RhbGxlZF9ydWxlcwAAAAAAAAAAAQAAA+oAAAfQAAAADUluc3RhbGxlZFJ1bGUAAAA=",
        "AAAAAAAAAB5UaGUgc2NoZWR1bGVkIHVwZ3JhZGUsIGlmIGFueS4AAAAAAA9wZW5kaW5nX3VwZ3JhZGUAAAAAAAAAAAEAAAPoAAAH0AAAAA5VcGdyYWRlUmVxdWVzdAAA",
        "AAAAAAAAAKFUaGUgY2Fub25pY2FsIGBkb2NfaGFzaGAgb2YgdGhlIGN1cnJlbnRseSBhcHBsaWVkIHBvbGljeSBkb2N1bWVudCwgb3IKYE5vbmVgIGlmIG9ubHkgdGhlIGNvbnN0cnVjdG9yJ3MgYWRtaW4gcnVsZSBleGlzdHMuIEFueW9uZSBjYW4gY2hlY2sKaW5zdGFsbGVkID09IHJldmlld2VkLgAAAAAAABBhcHBsaWVkX2RvY19oYXNoAAAAAAAAAAEAAAPoAAAD7gAAACA=",
        "AAAAAAAAACZTZWUgW2BTZWxmOjpnZXRfY29udGV4dF9ydWxlc19jb3VudGBdLgAAAAAAEGdldF9jb250ZXh0X3J1bGUAAAABAAAAAAAAAA9jb250ZXh0X3J1bGVfaWQAAAAABAAAAAEAAAfQAAAAC0NvbnRleHRSdWxlAA==",
        "AAAAAAAAAZZTY2hlZHVsZSBhbiB1cGdyYWRlIHRvIGB3YXNtX2hhc2hgLCBleGVjdXRhYmxlIGFmdGVyCltgQUNDT1VOVF9VUEdSQURFX0RFTEFZX0xFREdFUlNgXSAoc3BlYyDCpzEyKS4gT3duZXIgYXV0aG9yaXphdGlvbjsKdW5kZXIgYFByb3RlY3RlZGAgYWxzbyB0aGUgY29uZGl0aW9uJ3MgcmVjb3JkZWQgYXBwcm92YWwgb2YKYFVwZ3JhZGUgeyByZXF1ZXN0X2lkLCB3YXNtX2hhc2ggfWAgZnJlc2ggdW50aWwKYGFwcHJvdmFsX3ZhbGlkX3VudGlsYCAoYG5leHRfdXBncmFkZV9yZXF1ZXN0X2lkYCBuYW1lcyB0aGUgaWQgdG8KYXBwcm92ZSkuIFJlZnVzZWQgd2hpbGUgYSByZWNvdmVyeSBhdHRlbXB0IGlzIGF1dGhvcml6ZWQuIFJlcGxhY2VzIGFueQplYXJsaWVyIHJlcXVlc3QuIFJldHVybnMgdGhlIHJlcXVlc3QgaWQuAAAAAAAQc2NoZWR1bGVfdXBncmFkZQAAAAIAAAAAAAAACXdhc21faGFzaAAAAAAAA+4AAAAgAAAAAAAAABRhcHByb3ZhbF92YWxpZF91bnRpbAAAAAQAAAABAAAD6QAAAAYAAAfQAAAAEVBlcmNoQWNjb3VudEVycm9yAAAA",
        "AAAAAAAAAChUaGUgYWRvcHRlZCByZWNvdmVyeSBjb250cm9sbGVyLCBpZiBhbnkuAAAAE3JlY292ZXJ5X2NvbnRyb2xsZXIAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAC5UaGUgYWNjb3VudCdzIHJlY292ZXJ5IGdlbmVyYXRpb24gKHNwZWMgwqcxMikuAAAAAAATcmVjb3ZlcnlfZ2VuZXJhdGlvbgAAAAAAAAAAAQAAAAY=",
        "AAAAAAAAAHhSZWFkLW9ubHkgcnVsZSBzdXJmYWNlLCByZS1leHBvc2VkIGhlcmUgYmVjYXVzZSBgU21hcnRBY2NvdW50YCBpdHNlbGYKaXMgZGVsaWJlcmF0ZWx5IG5vdCBleHBvcnRlZCBieSBkb2Mtb25seSBhY2NvdW50cy4AAAAXZ2V0X2NvbnRleHRfcnVsZXNfY291bnQAAAAAAAAAAAEAAAAE",
        "AAAAAAAAAFNUaGUgaWQgdGhlIG5leHQgYHNjaGVkdWxlX3VwZ3JhZGVgIHdpbGwgYXNzaWduOiB3aGF0IGBQcm90ZWN0ZWRgCmFwcHJvdmVycyBhcHByb3ZlLgAAAAAXbmV4dF91cGdyYWRlX3JlcXVlc3RfaWQAAAAAAAAAAAEAAAAG",
        "AAAAAQAAAmFPbmUgcGVuZGluZyBhY2NvdW50IHVwZ3JhZGUgKHNwZWMgwqcxMikuCgpTdGFsZW5lc3MgaXMganVkZ2VkIGFnYWluc3QgdGhlIGFjY291bnQncyBvd24gKipyZWNvdmVyeSBnZW5lcmF0aW9uKiosIGEKYHU2NGAgdGhlIGFjY291bnQga2VlcHMgaW4gaXRzIG93biBzdG9yYWdlLiBJdCBzdGFydHMgYXQgMCBhbmQgaXMgbmV2ZXIKcmVzZXQuIEl0IGFkdmFuY2VzIG9uIGV2ZXJ5IGByY3Zfc3luY2Agb3V0Y29tZSBvdGhlciB0aGFuIGBVbmNoYW5nZWRgCihgY29udHJvbGxlcjo6U3luY091dGNvbWU6OmJ1bXBzX2dlbmVyYXRpb25gKSBhbmQgb24gZXZlcnkgZXhlY3V0ZWQKdXBncmFkZS4KClRoZSBjb250cm9sbGVyJ3MgZXBvY2ggY2Fubm90IHBsYXkgdGhpcyByb2xlLiBJdCBiZWxvbmdzIHRvIG9uZQpjb250cm9sbGVyIGFuZCBkb2VzIG5vdCBleGlzdCB3aGlsZSB0aGUgYWNjb3VudCBpcyB1bmVucm9sbGVkLCBzbyBhCnJlcXVlc3Qgc2NoZWR1bGVkIHVuZW5yb2xsZWQgd291bGQgc3Vydml2ZSBlbnJvbGxpbmcgcmVjb3ZlcnkgYW5kCnJlbW92aW5nIGl0IGFnYWluOiB0aGUgZmluYWwgc3RhdGUgaGFzIG5vIGNvbnRyb2xsZXIsIGp1c3QgYXMgYXQKc2NoZWR1bGluZy4AAAAAAAAAAAAADlVwZ3JhZGVSZXF1ZXN0AAAAAAAFAAAAlVRoZSBhZG9wdGVkIGNvbnRyb2xsZXIncyBlcG9jaCB3aGVuIHNjaGVkdWxlZCwgaWYgYSBjb250cm9sbGVyIHdhcwphZG9wdGVkLiBQYXNzZWQgYmFjayBhcyBgVXBncmFkZVN0ZXA6OkV4ZWN1dGVgIHNvIHRoZSBjb250cm9sbGVyIGNhbgpjaGVjayBpdCB0b28uAAAAAAAAEGNvbnRyb2xsZXJfZXBvY2gAAAPoAAAABgAAADJUaGUgZmlyc3QgbGVkZ2VyIGF0IHdoaWNoIHRoZSByZXF1ZXN0IG1heSBleGVjdXRlLgAAAAAADWV4ZWN1dGFibGVfYXQAAAAAAAAEAAAAQVRoZSBhY2NvdW50J3MgcmVjb3ZlcnkgZ2VuZXJhdGlvbiB3aGVuIHRoZSByZXF1ZXN0IHdhcyBzY2hlZHVsZWQuAAAAAAAACmdlbmVyYXRpb24AAAAAAAYAAAAaUGVyLWFjY291bnQsIG5ldmVyIHJldXNlZC4AAAAAAApyZXF1ZXN0X2lkAAAAAAAGAAAAJFRoZSBleGFjdCBXYXNtIHRoZSBhY2NvdW50IHdpbGwgcnVuLgAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIA==",
        "AAAAAQAAAINUaGUgc2hhcmVkIGluZnJhIGFuIGFjY291bnQgcmVzb2x2ZXMsIHBpbm5lZCB3aGVuIGl0IHdhcyBidWlsdCAoc2VlCltgaW5mcmFgXSk6IHdoYXQgYSBkZXBsb3ltZW50IGNoZWNrIGNvbXBhcmVzIHdpdGggaXRzIG1hbmlmZXN0LgAAAAAAAAAACUluZnJhUGlucwAAAAAAAAMAAAAAAAAADGRvY19jb21waWxlcgAAABMAAAAAAAAAC2ludGVycHJldGVyAAAAABMAAAAAAAAADnNwZW5kaW5nX2xpbWl0AAAAAAAT",
        "AAAAAQAAALtUaGUgYFByb3RlY3RlZGAgZnJlZXplLCBtaXJyb3JlZCBmcm9tIHRoZSBhZG9wdGVkIGNvbnRyb2xsZXIgdGhyb3VnaApbYFBlcmNoU21hcnRBY2NvdW50OjpyY3ZfZ2F0ZWBdOiB3aGlsZSBgbGVkZ2VyIDwgdW50aWxgLCB0aGUgYWNjb3VudAphdXRob3JpemVzIG5vdGhpbmcgYnV0IGBhdHRlbXB0X2lkYCdzIGNvbXBsZXRpb24uAAAAAAAAAAAKRnJlZXplR2F0ZQAAAAAAAgAAAAAAAAAKYXR0ZW1wdF9pZAAAAAAABgAAACZUaGUgYXV0aG9yaXplZCBhdHRlbXB0J3MgYGV4cGlyZXNfYXRgLgAAAAAABXVudGlsAAAAAAAABA==",
        "AAAABQAAAT1FbWl0dGVkIGFmdGVyIGEgZG9jdW1lbnQgaXMgYXBwbGllZDogdGhlIG5ldyBjYW5vbmljYWwgYGRvY19oYXNoYCwgdGhlCmNvbmZpZ3VyYXRpb24gcmV2aXNpb24gaXQgd2FzIGFwcGxpZWQgYXQsIGFuZCB3aGF0IGNoYW5nZWQgaW4gdGhlIHJ1bGUKc2V0LiBUaGUgcnVsZSwgc2lnbmVyLCBhbmQgcG9saWN5IG11dGF0aW9ucyBlbWl0IG5vdGhpbmcgdGhlbXNlbHZlcyAoT1oncwpgX25vX2V2ZW50c2AgdmFyaWFudHMpLCBzbyB0aGlzIGlzIHRoZSB3aG9sZSByZWNvcmQgb2YgdGhlIGNoYW5nZTsKYGFwcGxpZWRfZG9jYCBzZXJ2ZXMgdGhlIGRvY3VtZW50LgAAAAAAAAAAAAAKRG9jQXBwbGllZAAAAAAAAQAAAAtkb2NfYXBwbGllZAAAAAAJAAAAAAAAAAhkb2NfaGFzaAAAA+4AAAAgAAAAAQAAAAAAAAAIcmV2aXNpb24AAAAGAAAAAAAAAAAAAAALcnVsZXNfYWRkZWQAAAAABAAAAAAAAAAAAAAADXJ1bGVzX3JlbW92ZWQAAAAAAAAEAAAAAAAAAAAAAAAMcnVsZXNfZWRpdGVkAAAABAAAAAAAAAAAAAAADXNpZ25lcnNfYWRkZWQAAAAAAAAEAAAAAAAAAAAAAAAPc2lnbmVyc19yZW1vdmVkAAAAAAQAAAAAAAAAAAAAAA5wb2xpY2llc19hZGRlZAAAAAAABAAAAAAAAAAAAAAAEHBvbGljaWVzX3JlbW92ZWQAAAAEAAAAAAAAAAI=",
        "AAAABQAAAFhFbWl0dGVkIHdoZW4gdGhlIGFkb3B0ZWQgY29udHJvbGxlciBzZXRzIChgdW50aWwgPiAwYCkgb3IgY2xlYXJzIHRoZQpgUHJvdGVjdGVkYCBmcmVlemUuAAAAAAAAAA1GcmVlemVDaGFuZ2VkAAAAAAAAAQAAAA5mcmVlemVfY2hhbmdlZAAAAAAAAgAAAAAAAAAKYXR0ZW1wdF9pZAAAAAAABgAAAAAAAAAAAAAABXVudGlsAAAAAAAABAAAAAAAAAAC",
        "AAAABQAAAIhFbWl0dGVkIHdoZW4gYSBzY2hlZHVsZWQgdXBncmFkZSBpcyBkcm9wcGVkOiBjYW5jZWxsZWQsIHJlcGxhY2VkIGJ5IGEKbmV3ZXIgcmVxdWVzdCwgZm91bmQgc3RhbGUgYXQgZXhlY3V0aW9uLCBvciBjbGVhcmVkIGJ5IGEgcmVjb3ZlcnkuAAAAAAAAAA5VcGdyYWRlRHJvcHBlZAAAAAAAAQAAAA91cGdyYWRlX2Ryb3BwZWQAAAAAAQAAAAAAAAAKcmVxdWVzdF9pZAAAAAAABgAAAAEAAAAC",
        "AAAABQAAACFFbWl0dGVkIHdoZW4gYW4gdXBncmFkZSBleGVjdXRlcy4AAAAAAAAAAAAAD1VwZ3JhZGVFeGVjdXRlZAAAAAABAAAAEHVwZ3JhZGVfZXhlY3V0ZWQAAAACAAAAAAAAAApyZXF1ZXN0X2lkAAAAAAAGAAAAAQAAAAAAAAAJd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAAAAAAAg==",
        "AAAABQAAACVFbWl0dGVkIHdoZW4gYW4gdXBncmFkZSBpcyBzY2hlZHVsZWQuAAAAAAAAAAAAABBVcGdyYWRlU2NoZWR1bGVkAAAAAQAAABF1cGdyYWRlX3NjaGVkdWxlZAAAAAAAAAMAAAAAAAAACnJlcXVlc3RfaWQAAAAAAAYAAAABAAAAAAAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAAAAAAADWV4ZWN1dGFibGVfYXQAAAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAADhFbWl0dGVkIHdoZW4gYSByZWNvdmVyeSBjb21wbGV0aW9uIHJldm9rZXMgYSBjcmVkZW50aWFsLgAAAAAAAAARQ3JlZGVudGlhbFJldm9rZWQAAAAAAAABAAAAEmNyZWRlbnRpYWxfcmV2b2tlZAAAAAAAAQAAAAAAAAALZmluZ2VycHJpbnQAAAAD7gAAACAAAAABAAAAAg==",
        "AAAAAQAAAJRDb25zdGFudHMgb2YgdGhlIGRlcGxveWVkIGFjY291bnQgd2FzbSBhIHdhbGxldCBjaGVja3MgYmVmb3JlIGl0IGJ1aWxkcwphbnl0aGluZyBmb3IgdGhpcyBhY2NvdW50OiB3aGF0IFtgUGVyY2hTbWFydEFjY291bnQ6OmNhcGFiaWxpdGllc2BdCnJldHVybnMuAAAAAAAAABNBY2NvdW50Q2FwYWJpbGl0aWVzAAAAAAUAAABBSG93IGEgZG9jdW1lbnQgaXMgYXBwbGllZDogYG9uZV90eGAsIG9uZSBgYXBwbHlfZG9jYCB0cmFuc2FjdGlvbi4AAAAAAAALYXBwbHlfbW9kZXMAAAAD6gAAABEAAABiV2hhdCBhIHNpZ25lciBzaWduczogYG96X3J1bGVfaWRzYCwgT1oncwpgc2hhMjU2KHNpZ25hdHVyZV9wYXlsb2FkIHx8IGNvbnRleHRfcnVsZV9pZHMudG9feGRyKCkpYC4AAAAAAAthdXRoX2RpZ2VzdAAAAAARAAAAXUhvdyB0aGUgYXBwbGllZCBgZG9jX2hhc2hgIGlzIGNvbXB1dGVkOiBgY2Fub25fdjFgLCBgc2hhMjU2YCBvZiB0aGUKQ0FOT04gdjEgY2Fub25pY2FsIGJ5dGVzLgAAAAAAAAxkb2NfaWRlbnRpdHkAAAARAAAAFltgSU5URVJGQUNFX1ZFUlNJT05gXS4AAAAAABFpbnRlcmZhY2VfdmVyc2lvbgAAAAAAAAQAAAAVW2BTTkFQU0hPVF9WRVJTSU9OYF0uAAAAAAAAEHNuYXBzaG90X3ZlcnNpb24AAAAE",
        "AAAAAQAAAHJFdmVyeXRoaW5nIHJ1bGUgc2VsZWN0aW9uIGFuZCBzaWduaW5nIG5lZWQsIHJlYWQgYXQgb25lIGxlZGdlcjogd2hhdApbYFBlcmNoU21hcnRBY2NvdW50Ojpjb25maWd1cmF0aW9uYF0gcmV0dXJucy4AAAAAAAAAAAAUQWNjb3VudENvbmZpZ3VyYXRpb24AAAAIAAAARFRoZSBhcHBsaWVkIGRvY3VtZW50J3MgYGRvY19oYXNoYCwgb3IgYE5vbmVgIGJlZm9yZSB0aGUgZmlyc3QgYXBwbHkuAAAACGRvY19oYXNoAAAD6AAAA+4AAAAgAAAAuFRoZSBgUHJvdGVjdGVkYCBmcmVlemU6IHplcm8gb3Igb25lIGVudHJpZXMgKGEgYFZlY2AgYmVjYXVzZQpgI1tjb250cmFjdHR5cGVdYCBoYXMgbm8gY29udmVyc2lvbiBmb3IgYE9wdGlvbmAgb2YgYSBjdXN0b20gc3RydWN0KS4KSXQgaXMgaW4gZm9yY2Ugd2hpbGUgdGhlIGxlZGdlciBpcyBiZWxvdyBpdHMgYHVudGlsYC4AAAAEZ2F0ZQAAA+oAAAfQAAAACkZyZWV6ZUdhdGUAAAAAAAAAAAAFaW5mcmEAAAAAAAfQAAAACUluZnJhUGlucwAAAAAAAAAAAAATcmVjb3ZlcnlfY29udHJvbGxlcgAAAAPoAAAAEwAAAAAAAAATcmVjb3ZlcnlfZ2VuZXJhdGlvbgAAAAAGAAAAO1RoZSB6ZXJvLXNpZ25lciByZWNvdmVyeSBydWxlJ3MgT1ogaWQsIGlmIG9uZSBpcyBpbnN0YWxsZWQuAAAAAA1yZWNvdmVyeV9ydWxlAAAAAAAD6AAAAAQAAAA4VGhlIGNvbmZpZ3VyYXRpb24gcmV2aXNpb24gZXZlcnkgb3RoZXIgZmllbGQgYmVsb25ncyB0by4AAAAIcmV2aXNpb24AAAAGAAAALUV2ZXJ5IGluc3RhbGxlZCBjb250ZXh0IHJ1bGUsIHdpdGggaXRzIE9aIGlkLgAAAAAAAAVydWxlcwAAAAAAA+oAAAfQAAAADUluc3RhbGxlZFJ1bGUAAAA=",
        "AAAAAQAAAC1PbmUgY29udGV4dCBydWxlIGFzIHRoZSBhY2NvdW50IGluc3RhbGxlZCBpdC4AAAAAAAAAAAAADUluc3RhbGxlZFJ1bGUAAAAAAAAHAAAAAAAAAAxjb250ZXh0X3R5cGUAAAfQAAAAD0NvbnRleHRSdWxlVHlwZQAAAAAXVGhlIE9aIGNvbnRleHQtcnVsZSBpZC4AAAAAAmlkAAAAAAAEAAAAAAAAAARuYW1lAAAAEAAAAAAAAAAIcG9saWNpZXMAAAPqAAAH0AAAAA9JbnN0YWxsZWRQb2xpY3kAAAAAtFRoZSB6ZXJvLXNpZ25lciByZWNvdmVyeSBydWxlLiBEb2N1bWVudCBydWxlcyBhcmUgbWF0Y2hlZCBieSBuYW1lOwp0aGUgcmVjb3ZlcnkgcnVsZSBieSB0aGlzIGZsYWcsIHNvIGEgZG9jdW1lbnQgcnVsZSB0aGF0IGhhcHBlbnMgdG8gYmUKbmFtZWQgYHJlY292ZXJ5YCBpcyBuZXZlciBjb25mdXNlZCB3aXRoIGl0LgAAAAhyZWNvdmVyeQAAAAEAAAAAAAAAB3NpZ25lcnMAAAAD6gAAB9AAAAAGU2lnbmVyAAAAAAAAAAAAC3ZhbGlkX3VudGlsAAAAA+gAAAAE",
        "AAAAAQAAAClPbmUgcG9saWN5IGF0dGFjaGVkIHRvIGFuIGluc3RhbGxlZCBydWxlLgAAAAAAAAAAAAAPSW5zdGFsbGVkUG9saWN5AAAAAAIAAACfYHNoYTI1NmAgb2YgdGhlIGluc3RhbGwgcGFyYW1ldGVycycgWERSLiBBIHBvbGljeSB3aG9zZSBwYXJhbWV0ZXJzCmNoYW5nZSBpcyB1bmluc3RhbGxlZCBhbmQgaW5zdGFsbGVkIGFnYWluOyBvbmUgd2hvc2UgcGFyYW1ldGVycyBhcmUKdW5jaGFuZ2VkIGlzIGxlZnQgYWxvbmUuAAAAAAZwYXJhbXMAAAAAA+4AAAAgAAAAAAAAAAZwb2xpY3kAAAAAABM=",
        "AAAAAgAAAONDb250ZXh0IG9mIGEgc2luZ2xlIGF1dGhvcml6ZWQgY2FsbCBwZXJmb3JtZWQgYnkgYW4gYWRkcmVzcy4KCkN1c3RvbSBhY2NvdW50IGNvbnRyYWN0cyB0aGF0IGltcGxlbWVudCBgX19jaGVja19hdXRoYCBzcGVjaWFsIGZ1bmN0aW9uCnJlY2VpdmUgYSBsaXN0IG9mIGBDb250ZXh0YCB2YWx1ZXMgY29ycmVzcG9uZGluZyB0byBhbGwgdGhlIGNhbGxzIHRoYXQKbmVlZCB0byBiZSBhdXRob3JpemVkLgAAAAAAAAAAB0NvbnRleHQAAAAAAwAAAAEAAAAUQ29udHJhY3QgaW52b2NhdGlvbi4AAAAIQ29udHJhY3QAAAABAAAH0AAAAA9Db250cmFjdENvbnRleHQAAAAAAQAAAD1Db250cmFjdCB0aGF0IGhhcyBhIGNvbnN0cnVjdG9yIHdpdGggbm8gYXJndW1lbnRzIGlzIGNyZWF0ZWQuAAAAAAAAFENyZWF0ZUNvbnRyYWN0SG9zdEZuAAAAAQAAB9AAAAAbQ3JlYXRlQ29udHJhY3RIb3N0Rm5Db250ZXh0AAAAAAEAAABEQ29udHJhY3QgdGhhdCBoYXMgYSBjb25zdHJ1Y3RvciB3aXRoIDEgb3IgbW9yZSBhcmd1bWVudHMgaXMgY3JlYXRlZC4AAAAcQ3JlYXRlQ29udHJhY3RXaXRoQ3Rvckhvc3RGbgAAAAEAAAfQAAAAKkNyZWF0ZUNvbnRyYWN0V2l0aENvbnN0cnVjdG9ySG9zdEZuQ29udGV4dAAA",
        "AAAAAQAAAL1BdXRob3JpemF0aW9uIGNvbnRleHQgb2YgYSBzaW5nbGUgY29udHJhY3QgY2FsbC4KClRoaXMgc3RydWN0IGNvcnJlc3BvbmRzIHRvIGEgYHJlcXVpcmVfYXV0aF9mb3JfYXJnc2AgY2FsbCBmb3IgYW4gYWRkcmVzcwpmcm9tIGBjb250cmFjdGAgZnVuY3Rpb24gd2l0aCBgZm5fbmFtZWAgbmFtZSBhbmQgYGFyZ3NgIGFyZ3VtZW50cy4AAAAAAAAAAAAAD0NvbnRyYWN0Q29udGV4dAAAAAADAAAAAAAAAARhcmdzAAAD6gAAAAAAAAAAAAAACGNvbnRyYWN0AAAAEwAAAAAAAAAHZm5fbmFtZQAAAAAR",
        "AAAAAgAAAF9Db250cmFjdCBleGVjdXRhYmxlIHVzZWQgZm9yIGNyZWF0aW5nIGEgbmV3IGNvbnRyYWN0IGFuZCB1c2VkIGluCmBDcmVhdGVDb250cmFjdEhvc3RGbkNvbnRleHRgLgAAAAAAAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAQAAAAEAAAAAAAAABFdhc20AAAABAAAD7gAAACA=",
        "AAAAAQAAAHZBdXRob3JpemF0aW9uIGNvbnRleHQgZm9yIGBjcmVhdGVfY29udHJhY3RgIGhvc3QgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEKbmV3IGNvbnRyYWN0IG9uIGJlaGFsZiBvZiBhdXRob3JpemVyIGFkZHJlc3MuAAAAAAAAAAAAG0NyZWF0ZUNvbnRyYWN0SG9zdEZuQ29udGV4dAAAAAACAAAAAAAAAApleGVjdXRhYmxlAAAAAAfQAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAAAAAARzYWx0AAAD7gAAACA=",
        "AAAAAQAAANZBdXRob3JpemF0aW9uIGNvbnRleHQgZm9yIGBjcmVhdGVfY29udHJhY3RgIGhvc3QgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEKbmV3IGNvbnRyYWN0IG9uIGJlaGFsZiBvZiBhdXRob3JpemVyIGFkZHJlc3MuClRoaXMgaXMgdGhlIHNhbWUgYXMgYENyZWF0ZUNvbnRyYWN0SG9zdEZuQ29udGV4dGAsIGJ1dCBhbHNvIGhhcwpjb250cmFjdCBjb25zdHJ1Y3RvciBhcmd1bWVudHMuAAAAAAAAAAAAKkNyZWF0ZUNvbnRyYWN0V2l0aENvbnN0cnVjdG9ySG9zdEZuQ29udGV4dAAAAAAAAwAAAAAAAAAQY29uc3RydWN0b3JfYXJncwAAA+oAAAAAAAAAAAAAAApleGVjdXRhYmxlAAAAAAfQAAAAEkNvbnRyYWN0RXhlY3V0YWJsZQAAAAAAAAAAAARzYWx0AAAD7gAAACA=",
        "AAAABQAAACtFdmVudCBlbWl0dGVkIHdoZW4gYSBjb250ZXh0IHJ1bGUgaXMgYWRkZWQuAAAAAAAAAAAQQ29udGV4dFJ1bGVBZGRlZAAAAAEAAAASY29udGV4dF9ydWxlX2FkZGVkAAAAAAAGAAAAAAAAAA9jb250ZXh0X3J1bGVfaWQAAAAABAAAAAEAAAAAAAAABG5hbWUAAAAQAAAAAAAAAAAAAAAMY29udGV4dF90eXBlAAAH0AAAAA9Db250ZXh0UnVsZVR5cGUAAAAAAAAAAAAAAAALdmFsaWRfdW50aWwAAAAD6AAAAAQAAAAAAAAAAAAAAApzaWduZXJfaWRzAAAAAAPqAAAABAAAAAAAAAAAAAAACnBvbGljeV9pZHMAAAAAA+oAAAAEAAAAAAAAAAI=",
        "AAAABQAAAEFFdmVudCBlbWl0dGVkIHdoZW4gYSBwb2xpY3kgaXMgcmVnaXN0ZXJlZCBpbiB0aGUgZ2xvYmFsIHJlZ2lzdHJ5LgAAAAAAAAAAAAAQUG9saWN5UmVnaXN0ZXJlZAAAAAEAAAARcG9saWN5X3JlZ2lzdGVyZWQAAAAAAAACAAAAAAAAAAlwb2xpY3lfaWQAAAAAAAAEAAAAAQAAAAAAAAAGcG9saWN5AAAAAAATAAAAAAAAAAI=",
        "AAAABQAAAEFFdmVudCBlbWl0dGVkIHdoZW4gYSBzaWduZXIgaXMgcmVnaXN0ZXJlZCBpbiB0aGUgZ2xvYmFsIHJlZ2lzdHJ5LgAAAAAAAAAAAAAQU2lnbmVyUmVnaXN0ZXJlZAAAAAEAAAARc2lnbmVyX3JlZ2lzdGVyZWQAAAAAAAACAAAAAAAAAAlzaWduZXJfaWQAAAAAAAAEAAAAAQAAAAAAAAAGc2lnbmVyAAAAAAfQAAAABlNpZ25lcgAAAAAAAAAAAAI=",
        "AAAABAAAAClFcnJvciBjb2RlcyBmb3Igc21hcnQgYWNjb3VudCBvcGVyYXRpb25zLgAAAAAAAAAAAAARU21hcnRBY2NvdW50RXJyb3IAAAAAAAAQAAAAKlRoZSBzcGVjaWZpZWQgY29udGV4dCBydWxlIGRvZXMgbm90IGV4aXN0LgAAAAAAE0NvbnRleHRSdWxlTm90Rm91bmQAAAALuAAAADpUaGUgcHJvdmlkZWQgY29udGV4dCBjYW5ub3QgYmUgdmFsaWRhdGVkIGFnYWluc3QgYW55IHJ1bGUuAAAAAAASVW52YWxpZGF0ZWRDb250ZXh0AAAAAAu6AAAAJ0V4dGVybmFsIHNpZ25hdHVyZSB2ZXJpZmljYXRpb24gZmFpbGVkLgAAAAAaRXh0ZXJuYWxWZXJpZmljYXRpb25GYWlsZWQAAAAAC7sAAAA1Q29udGV4dCBydWxlIG11c3QgaGF2ZSBhdCBsZWFzdCBvbmUgc2lnbmVyIG9yIHBvbGljeS4AAAAAAAAUTm9TaWduZXJzQW5kUG9saWNpZXMAAAu8AAAAKVRoZSB2YWxpZF91bnRpbCB0aW1lc3RhbXAgaXMgaW4gdGhlIHBhc3QuAAAAAAAADlBhc3RWYWxpZFVudGlsAAAAAAu9AAAAI1RoZSBzcGVjaWZpZWQgc2lnbmVyIHdhcyBub3QgZm91bmQuAAAAAA5TaWduZXJOb3RGb3VuZAAAAAALvgAAAC5UaGUgc2lnbmVyIGFscmVhZHkgZXhpc3RzIGluIHRoZSBjb250ZXh0IHJ1bGUuAAAAAAAPRHVwbGljYXRlU2lnbmVyAAAAC78AAAAjVGhlIHNwZWNpZmllZCBwb2xpY3kgd2FzIG5vdCBmb3VuZC4AAAAADlBvbGljeU5vdEZvdW5kAAAAAAvAAAAALlRoZSBwb2xpY3kgYWxyZWFkeSBleGlzdHMgaW4gdGhlIGNvbnRleHQgcnVsZS4AAAAAAA9EdXBsaWNhdGVQb2xpY3kAAAALwQAAACVUb28gbWFueSBzaWduZXJzIGluIHRoZSBjb250ZXh0IHJ1bGUuAAAAAAAADlRvb01hbnlTaWduZXJzAAAAAAvCAAAAJlRvbyBtYW55IHBvbGljaWVzIGluIHRoZSBjb250ZXh0IHJ1bGUuAAAAAAAPVG9vTWFueVBvbGljaWVzAAAAC8MAAACGQW4gaW50ZXJuYWwgSUQgY291bnRlciAoY29udGV4dCBydWxlLCBzaWduZXIsIG9yIHBvbGljeSkgaGFzIHJlYWNoZWQKaXRzIG1heGltdW0gdmFsdWUgKGB1MzI6Ok1BWGApIGFuZCBjYW5ub3QgYmUgaW5jcmVtZW50ZWQgZnVydGhlci4AAAAAAAxNYXRoT3ZlcmZsb3cAAAvEAAAAOkV4dGVybmFsIHNpZ25lciBrZXkgZGF0YSBleGNlZWRzIHRoZSBtYXhpbXVtIGFsbG93ZWQgc2l6ZS4AAAAAAA9LZXlEYXRhVG9vTGFyZ2UAAAALxQAAADxjb250ZXh0X3J1bGVfaWRzIGxlbmd0aCBkb2VzIG5vdCBtYXRjaCBhdXRoX2NvbnRleHRzIGxlbmd0aC4AAAAcQ29udGV4dFJ1bGVJZHNMZW5ndGhNaXNtYXRjaAAAC8YAAAA1Q29udGV4dCBydWxlIG5hbWUgZXhjZWVkcyB0aGUgbWF4aW11bSBhbGxvd2VkIGxlbmd0aC4AAAAAAAALTmFtZVRvb0xvbmcAAAALxwAAAENBIHNpZ25lciBpbiBgQXV0aFBheWxvYWRgIGlzIG5vdCBwYXJ0IG9mIGFueSBzZWxlY3RlZCBjb250ZXh0IHJ1bGUuAAAAABJVbmF1dGhvcml6ZWRTaWduZXIAAAAAC8g=",
        "AAAAAgAAAEJSZXByZXNlbnRzIGRpZmZlcmVudCB0eXBlcyBvZiBzaWduZXJzIGluIHRoZSBzbWFydCBhY2NvdW50IHN5c3RlbS4AAAAAAAAAAAAGU2lnbmVyAAAAAAACAAAAAQAAAD1BIGRlbGVnYXRlZCBzaWduZXIgdGhhdCB1c2VzIGJ1aWx0LWluIHNpZ25hdHVyZSB2ZXJpZmljYXRpb24uAAAAAAAACURlbGVnYXRlZAAAAAAAAAEAAAATAAAAAQAAAHJBbiBleHRlcm5hbCBzaWduZXIgd2l0aCBjdXN0b20gdmVyaWZpY2F0aW9uIGxvZ2ljLgpDb250YWlucyB0aGUgdmVyaWZpZXIgY29udHJhY3QgYWRkcmVzcyBhbmQgdGhlIHB1YmxpYyBrZXkgZGF0YS4AAAAAAAhFeHRlcm5hbAAAAAIAAAATAAAADg==",
        "AAAAAQAABABUaGUgYXV0aG9yaXphdGlvbiBwYXlsb2FkIHBhc3NlZCB0byBgX19jaGVja19hdXRoYCwgYnVuZGxpbmcgY3J5cHRvZ3JhcGhpYwpwcm9vZnMgd2l0aCBjb250ZXh0IHJ1bGUgc2VsZWN0aW9uLgoKVGhpcyBzdHJ1Y3QgY2FycmllcyB0d28gZGlzdGluY3QgcGllY2VzIG9mIGluZm9ybWF0aW9uIHRoYXQgYXJlIGJvdGgKcmVxdWlyZWQgZm9yIGF1dGhvcml6YXRpb24gYnV0IGNhbm5vdCBiZSBkZXJpdmVkIGZyb20gZWFjaCBvdGhlcjoKCi0gYHNpZ25lcnNgIG1hcHMgZWFjaCBbYFNpZ25lcmBdIHRvIGl0cyByYXcgc2lnbmF0dXJlIGJ5dGVzLCBwcm92aWRpbmcKY3J5cHRvZ3JhcGhpYyBwcm9vZiB0aGF0IHRoZSBzaWduZXIgYWN0dWFsbHkgc2lnbmVkIHRoZSB0cmFuc2FjdGlvbgpwYXlsb2FkLiBBIGNvbnRleHQgcnVsZSBzdG9yZXMgd2hpY2ggc2lnbmVyICppZGVudGl0aWVzKiBhcmUgYXV0aG9yaXplZAoodmlhIGBzaWduZXJfaWRzYCksIGJ1dCB0aGUgcnVsZSBkb2VzIG5vdCBjb250YWluIHRoZSBzaWduYXR1cmVzCnRoZW1zZWx2ZXMg4oCUIHRob3NlIG11c3QgYmUgc3VwcGxpZWQgaGVyZS4KCi0gYGNvbnRleHRfcnVsZV9pZHNgIHRlbGxzIHRoZSBzeXN0ZW0gd2hpY2ggcnVsZSB0byB2YWxpZGF0ZSBmb3IgZWFjaCBhdXRoCmNvbnRleHQuIEJlY2F1c2UgbXVsdGlwbGUgcnVsZXMgY2FuIGV4aXN0IGZvciB0aGUgc2FtZSBjb250ZXh0IHR5cGUsIHRoZQpjYWxsZXIgbXVzdCBleHBsaWNpdGx5IHNlbGVjdCBvbmUgcGVyIGNvbnRleHQgcmF0aGVyIHRoYW4gcmVseWluZyBvbgphdXRvLWRpc2NvdmVyeS4gRWFjaCBlbnRyeSBpcyBhbGlnbmVkIGJ5IGluZGV4IHdpdGggdGhlIGBhdXRoX2NvbnRleHRzYApwYXNzZWQgdG8gYF9fY2hlY2tfYXV0aGAuCgpUaGUgbGVuZ3RoIG9mIGBjb250ZXh0X3J1bGVfaWRzYCBtdXN0IGVxdWFsIHRoZSBudW1iZXIgb2YgYXV0aCBjb250ZXh0czsKYSBtaXNtYXRjaCBpcyByZWplY3RlZCB3aXRoCltgU21hcnRBY2NvdW50RXJyb3I6OkNvbnRleHRSdWxlSWRzTGVuAAAAAAAAAAtBdXRoUGF5bG9hZAAAAAACAAAAPFBlci1jb250ZXh0IHJ1bGUgSURzLCBhbGlnbmVkIGJ5IGluZGV4IHdpdGggYGF1dGhfY29udGV4dHNgLgAAABBjb250ZXh0X3J1bGVfaWRzAAAD6gAAAAQAAAAlU2lnbmF0dXJlIGRhdGEgbWFwcGVkIHRvIGVhY2ggc2lnbmVyLgAAAAAAAAdzaWduZXJzAAAAA+wAAAfQAAAABlNpZ25lcgAAAAAADg==",
        "AAAAAQAAADxBIGNvbXBsZXRlIGNvbnRleHQgcnVsZSBkZWZpbmluZyBhdXRob3JpemF0aW9uIHJlcXVpcmVtZW50cy4AAAAAAAAAC0NvbnRleHRSdWxlAAAAAAgAAAApVGhlIHR5cGUgb2YgY29udGV4dCB0aGlzIHJ1bGUgYXBwbGllcyB0by4AAAAAAAAMY29udGV4dF90eXBlAAAH0AAAAA9Db250ZXh0UnVsZVR5cGUAAAAAJ1VuaXF1ZSBpZGVudGlmaWVyIGZvciB0aGUgY29udGV4dCBydWxlLgAAAAACaWQAAAAAAAQAAAApSHVtYW4tcmVhZGFibGUgbmFtZSBmb3IgdGhlIGNvbnRleHQgcnVsZS4AAAAAAAAEbmFtZQAAABAAAAAwTGlzdCBvZiBwb2xpY3kgY29udHJhY3RzIHRoYXQgbXVzdCBiZSBzYXRpc2ZpZWQuAAAACHBvbGljaWVzAAAD6gAAABMAAABKR2xvYmFsIHJlZ2lzdHJ5IElEcyBmb3IgZWFjaCBwb2xpY3ksIHBvc2l0aW9uYWxseSBhbGlnbmVkIHdpdGgKYHBvbGljaWVzYC4AAAAAAApwb2xpY3lfaWRzAAAAAAPqAAAABAAAAElHbG9iYWwgcmVnaXN0cnkgSURzIGZvciBlYWNoIHNpZ25lciwgcG9zaXRpb25hbGx5IGFsaWduZWQgd2l0aApgc2lnbmVyc2AuAAAAAAAACnNpZ25lcl9pZHMAAAAAA+oAAAAEAAAAKExpc3Qgb2Ygc2lnbmVycyBhdXRob3JpemVkIGJ5IHRoaXMgcnVsZS4AAAAHc2lnbmVycwAAAAPqAAAH0AAAAAZTaWduZXIAAAAAADFPcHRpb25hbCBleHBpcmF0aW9uIGxlZGdlciBzZXF1ZW5jZSBmb3IgdGhlIHJ1bGUuAAAAAAAAC3ZhbGlkX3VudGlsAAAAA+gAAAAE",
        "AAAAAgAAAEBUeXBlcyBvZiBjb250ZXh0cyB0aGF0IGNhbiBiZSBhdXRob3JpemVkIGJ5IHNtYXJ0IGFjY291bnQgcnVsZXMuAAAAAAAAAA9Db250ZXh0UnVsZVR5cGUAAAAAAwAAAAAAAAAtRGVmYXVsdCBydWxlcyB0aGF0IGNhbiBhdXRob3JpemUgYW55IGNvbnRleHQuAAAAAAAAB0RlZmF1bHQAAAAAAQAAADBSdWxlcyBzcGVjaWZpYyB0byBjYWxsaW5nIGEgcGFydGljdWxhciBjb250cmFjdC4AAAAMQ2FsbENvbnRyYWN0AAAAAQAAABMAAAABAAAAQlJ1bGVzIHNwZWNpZmljIHRvIGNyZWF0aW5nIGEgY29udHJhY3Qgd2l0aCBhIHBhcnRpY3VsYXIgV0FTTSBoYXNoLgAAAAAADkNyZWF0ZUNvbnRyYWN0AAAAAAABAAAD7gAAACA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    infra: this.txFromJSON<InfraPins>,
        renew: this.txFromJSON<null>,
        execute: this.txFromJSON<Result<any>>,
        document: this.txFromJSON<readonly [u64, Option<Buffer>]>,
        rcv_gate: this.txFromJSON<Result<void>>,
        revision: this.txFromJSON<u64>,
        apply_doc: this.txFromJSON<Result<Buffer>>,
        is_revoked: this.txFromJSON<boolean>,
        applied_doc: this.txFromJSON<Option<Buffer>>,
        capabilities: this.txFromJSON<AccountCapabilities>,
        doc_compiler: this.txFromJSON<string>,
        configuration: this.txFromJSON<AccountConfiguration>,
        recovery_gate: this.txFromJSON<Option<FreezeGate>>,
        cancel_upgrade: this.txFromJSON<Result<void>>,
        is_enrolled_id: this.txFromJSON<boolean>,
        cancel_recovery: this.txFromJSON<Result<void>>,
        execute_upgrade: this.txFromJSON<Result<void>>,
        installed_rules: this.txFromJSON<Array<InstalledRule>>,
        pending_upgrade: this.txFromJSON<Option<UpgradeRequest>>,
        applied_doc_hash: this.txFromJSON<Option<Buffer>>,
        get_context_rule: this.txFromJSON<ContextRule>,
        schedule_upgrade: this.txFromJSON<Result<u64>>,
        recovery_controller: this.txFromJSON<Option<string>>,
        recovery_generation: this.txFromJSON<u64>,
        get_context_rules_count: this.txFromJSON<u32>,
        next_upgrade_request_id: this.txFromJSON<u64>
  }
}