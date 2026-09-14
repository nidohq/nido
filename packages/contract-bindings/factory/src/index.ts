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
   * Construct and simulate a admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * admin-sep's default, plus one load-bearing line: CLEAR the cached
   * account-wasm hash. `account_wasm_hash` caches `sha256(embedded
   * wasm)` in instance storage after the first `create_account`; an
   * in-place upgrade swaps the embedded bytes but — without this — the
   * STALE cached hash survives and every subsequent `create_account`
   * deploys the OLD account wasm. (Found upgrading the testnet factory
   * in the apply_doc spike. A factory upgraded from a build that
   * predates this override must call `refresh_account_wasm_hash` once
   * after the upgrade — the upgrade call itself still runs the old code.)
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_c_address transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_c_address: ({salt}: {salt: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a recovery_pool transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The current recovery-pool override, or `None` if unset. `None` is the
   * default and production state: with no override, `resolve_recovery`
   * resolves `"zk-recovery"` from the registry exactly as before this
   * override existed.
   */
  recovery_pool: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a create_account transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deploy an account contract and add its initial passkey signer. Legacy
   * entry point, kept for existing callers -- routes through the exact
   * same deploy+genesis-insert path as `create_account_v2`, using a
   * DETERMINISTIC DUMMY commitment (`dummy_commitment`) instead of a real
   * one. This is the anonymity-set property (M2 Task 5): every account
   * this factory creates gets exactly one genesis leaf inserted into the
   * recovery pool, atomically with its own deployment, whether or not its
   * owner actually enrolled in ZK recovery -- so an observer of the pool
   * (or of the factory's transaction shapes) cannot distinguish an
   * enrolled account from a non-enrolled one.
   */
  create_account: ({salt, key}: {salt: Buffer, key: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a pinned_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The pinned `verifier` address, or `None` if unpinned. `None` is the
   * default (pre-B2 / testnet) state: `resolve("verifier")` resolves from
   * the registry. When `Some`, the registry is bypassed for that name.
   */
  pinned_verifier: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a create_account_v2 transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deploy an account contract, add its initial passkey signer, AND
   * insert `commitment` as its genesis leaf in the recovery pool --
   * atomically with the deploy, in the same transaction (M2 Task 5). If
   * the insert fails (pool unresolvable, tree full, wrong `commitment`,
   * ...) the whole call reverts, so there is never an account without a
   * leaf, nor a leaf without an account. Returns the deployed account's
   * address, which is always `get_c_address(salt)` -- the deterministic
   * address depends only on the deployer (this factory) and `salt`, never
   * on the constructor args or the genesis insert added here.
   */
  create_account_v2: ({salt, key, commitment}: {salt: Buffer, key: Buffer, commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_recovery_pool transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set (or rotate) an admin-only override for the recovery-pool/
   * controller address, bypassing the registry's `"zk-recovery"`
   * resolution (see `resolve_recovery`). Intended for a preview/staging
   * factory instance that needs to point at an isolated preview pool
   * without touching the production registry mapping every other factory
   * instance shares. Requires the current admin's auth -- this is a
   * powerful knob: it changes which contract becomes every newly-created
   * account's recovery controller, and which contract receives the
   * genesis `insert` cross-call in `deploy_and_insert`.
   */
  set_recovery_pool: ({pool}: {pool: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_registry_pins transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pin the `verifier` and `zk-recovery` addresses (plan B2). After this,
   * every `resolve("verifier")` / `resolve("zk-recovery")` (i.e. every
   * `create_account`/`create_account_v2`) returns exactly these addresses
   * DIRECTLY, without consulting the registry at all -- taking the registry
   * off the runtime critical path and closing the "compromised/repointed
   * registry silently routes new accounts to attacker contracts" hole
   * (`resolve` trusted the registry unconditionally before this). Because
   * the registry is bypassed, a later repoint cannot reroute NOR block new
   * accounts; the registry remains authoritative only for unpinned names
   * and for off-chain discovery. Both are set together because a cutover
   * pins both at once from `DEPLOYED.md`; call again to re-pin after a
   * deliberate verifier/controller upgrade. Requires the current admin's
   * auth. NOTE: the `zk-recovery` pin is superseded by the admin-set
   * `set_recovery_pool` override, which is checked first (an explicit,
   * separately-audited admin choice -- see `resolve_recovery`).
   */
  set_registry_pins: ({verifier, zk_recovery}: {verifier: string, zk_recovery: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a pinned_zk_recovery transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The pinned expected `zk-recovery` address, or `None` if unpinned.
   */
  pinned_zk_recovery: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a refresh_account_wasm_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Recompute and store the embedded account-wasm hash, returning it.
   * Admin-gated companion to the `upgrade` override above: after
   * in-place-upgrading a factory whose OLD code predates that override,
   * the stale cache survives (the upgrade transaction runs the old
   * code); calling this once afterwards repairs it. Harmless any other
   * time — it just refreshes the cache with the freshly computed value.
   */
  refresh_account_wasm_hash: (options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin}: {admin: string},
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
    return ContractClient.deploy({admin}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAAFYWRtaW4AAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAlJhZG1pbi1zZXAncyBkZWZhdWx0LCBwbHVzIG9uZSBsb2FkLWJlYXJpbmcgbGluZTogQ0xFQVIgdGhlIGNhY2hlZAphY2NvdW50LXdhc20gaGFzaC4gYGFjY291bnRfd2FzbV9oYXNoYCBjYWNoZXMgYHNoYTI1NihlbWJlZGRlZAp3YXNtKWAgaW4gaW5zdGFuY2Ugc3RvcmFnZSBhZnRlciB0aGUgZmlyc3QgYGNyZWF0ZV9hY2NvdW50YDsgYW4KaW4tcGxhY2UgdXBncmFkZSBzd2FwcyB0aGUgZW1iZWRkZWQgYnl0ZXMgYnV0IOKAlCB3aXRob3V0IHRoaXMg4oCUIHRoZQpTVEFMRSBjYWNoZWQgaGFzaCBzdXJ2aXZlcyBhbmQgZXZlcnkgc3Vic2VxdWVudCBgY3JlYXRlX2FjY291bnRgCmRlcGxveXMgdGhlIE9MRCBhY2NvdW50IHdhc20uIChGb3VuZCB1cGdyYWRpbmcgdGhlIHRlc3RuZXQgZmFjdG9yeQppbiB0aGUgYXBwbHlfZG9jIHNwaWtlLiBBIGZhY3RvcnkgdXBncmFkZWQgZnJvbSBhIGJ1aWxkIHRoYXQKcHJlZGF0ZXMgdGhpcyBvdmVycmlkZSBtdXN0IGNhbGwgYHJlZnJlc2hfYWNjb3VudF93YXNtX2hhc2hgIG9uY2UKYWZ0ZXIgdGhlIHVwZ3JhZGUg4oCUIHRoZSB1cGdyYWRlIGNhbGwgaXRzZWxmIHN0aWxsIHJ1bnMgdGhlIG9sZCBjb2RlLikAAAAAAAd1cGdyYWRlAAAAAAEAAAAAAAAADW5ld193YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAA=",
        "AAAAAAAAAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAANZ2V0X2NfYWRkcmVzcwAAAAAAAAEAAAAAAAAABHNhbHQAAAPuAAAAIAAAAAEAAAAT",
        "AAAAAAAAANxUaGUgY3VycmVudCByZWNvdmVyeS1wb29sIG92ZXJyaWRlLCBvciBgTm9uZWAgaWYgdW5zZXQuIGBOb25lYCBpcyB0aGUKZGVmYXVsdCBhbmQgcHJvZHVjdGlvbiBzdGF0ZTogd2l0aCBubyBvdmVycmlkZSwgYHJlc29sdmVfcmVjb3ZlcnlgCnJlc29sdmVzIGAiemstcmVjb3ZlcnkiYCBmcm9tIHRoZSByZWdpc3RyeSBleGFjdGx5IGFzIGJlZm9yZSB0aGlzCm92ZXJyaWRlIGV4aXN0ZWQuAAAADXJlY292ZXJ5X3Bvb2wAAAAAAAAAAAAAAQAAA+gAAAAT",
        "AAAAAAAAAopEZXBsb3kgYW4gYWNjb3VudCBjb250cmFjdCBhbmQgYWRkIGl0cyBpbml0aWFsIHBhc3NrZXkgc2lnbmVyLiBMZWdhY3kKZW50cnkgcG9pbnQsIGtlcHQgZm9yIGV4aXN0aW5nIGNhbGxlcnMgLS0gcm91dGVzIHRocm91Z2ggdGhlIGV4YWN0CnNhbWUgZGVwbG95K2dlbmVzaXMtaW5zZXJ0IHBhdGggYXMgYGNyZWF0ZV9hY2NvdW50X3YyYCwgdXNpbmcgYQpERVRFUk1JTklTVElDIERVTU1ZIGNvbW1pdG1lbnQgKGBkdW1teV9jb21taXRtZW50YCkgaW5zdGVhZCBvZiBhIHJlYWwKb25lLiBUaGlzIGlzIHRoZSBhbm9ueW1pdHktc2V0IHByb3BlcnR5IChNMiBUYXNrIDUpOiBldmVyeSBhY2NvdW50CnRoaXMgZmFjdG9yeSBjcmVhdGVzIGdldHMgZXhhY3RseSBvbmUgZ2VuZXNpcyBsZWFmIGluc2VydGVkIGludG8gdGhlCnJlY292ZXJ5IHBvb2wsIGF0b21pY2FsbHkgd2l0aCBpdHMgb3duIGRlcGxveW1lbnQsIHdoZXRoZXIgb3Igbm90IGl0cwpvd25lciBhY3R1YWxseSBlbnJvbGxlZCBpbiBaSyByZWNvdmVyeSAtLSBzbyBhbiBvYnNlcnZlciBvZiB0aGUgcG9vbAoob3Igb2YgdGhlIGZhY3RvcnkncyB0cmFuc2FjdGlvbiBzaGFwZXMpIGNhbm5vdCBkaXN0aW5ndWlzaCBhbgplbnJvbGxlZCBhY2NvdW50IGZyb20gYSBub24tZW5yb2xsZWQgb25lLgAAAAAADmNyZWF0ZV9hY2NvdW50AAAAAAACAAAAAAAAAARzYWx0AAAD7gAAACAAAAAAAAAAA2tleQAAAAPuAAAAQQAAAAEAAAAT",
        "AAAAAAAAAMxUaGUgcGlubmVkIGB2ZXJpZmllcmAgYWRkcmVzcywgb3IgYE5vbmVgIGlmIHVucGlubmVkLiBgTm9uZWAgaXMgdGhlCmRlZmF1bHQgKHByZS1CMiAvIHRlc3RuZXQpIHN0YXRlOiBgcmVzb2x2ZSgidmVyaWZpZXIiKWAgcmVzb2x2ZXMgZnJvbQp0aGUgcmVnaXN0cnkuIFdoZW4gYFNvbWVgLCB0aGUgcmVnaXN0cnkgaXMgYnlwYXNzZWQgZm9yIHRoYXQgbmFtZS4AAAAPcGlubmVkX3ZlcmlmaWVyAAAAAAAAAAABAAAD6AAAABM=",
        "AAAAAAAAAlNEZXBsb3kgYW4gYWNjb3VudCBjb250cmFjdCwgYWRkIGl0cyBpbml0aWFsIHBhc3NrZXkgc2lnbmVyLCBBTkQKaW5zZXJ0IGBjb21taXRtZW50YCBhcyBpdHMgZ2VuZXNpcyBsZWFmIGluIHRoZSByZWNvdmVyeSBwb29sIC0tCmF0b21pY2FsbHkgd2l0aCB0aGUgZGVwbG95LCBpbiB0aGUgc2FtZSB0cmFuc2FjdGlvbiAoTTIgVGFzayA1KS4gSWYKdGhlIGluc2VydCBmYWlscyAocG9vbCB1bnJlc29sdmFibGUsIHRyZWUgZnVsbCwgd3JvbmcgYGNvbW1pdG1lbnRgLAouLi4pIHRoZSB3aG9sZSBjYWxsIHJldmVydHMsIHNvIHRoZXJlIGlzIG5ldmVyIGFuIGFjY291bnQgd2l0aG91dCBhCmxlYWYsIG5vciBhIGxlYWYgd2l0aG91dCBhbiBhY2NvdW50LiBSZXR1cm5zIHRoZSBkZXBsb3llZCBhY2NvdW50J3MKYWRkcmVzcywgd2hpY2ggaXMgYWx3YXlzIGBnZXRfY19hZGRyZXNzKHNhbHQpYCAtLSB0aGUgZGV0ZXJtaW5pc3RpYwphZGRyZXNzIGRlcGVuZHMgb25seSBvbiB0aGUgZGVwbG95ZXIgKHRoaXMgZmFjdG9yeSkgYW5kIGBzYWx0YCwgbmV2ZXIKb24gdGhlIGNvbnN0cnVjdG9yIGFyZ3Mgb3IgdGhlIGdlbmVzaXMgaW5zZXJ0IGFkZGVkIGhlcmUuAAAAABFjcmVhdGVfYWNjb3VudF92MgAAAAAAAAMAAAAAAAAABHNhbHQAAAPuAAAAIAAAAAAAAAADa2V5AAAAA+4AAABBAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAEAAAAT",
        "AAAAAAAAAjxTZXQgKG9yIHJvdGF0ZSkgYW4gYWRtaW4tb25seSBvdmVycmlkZSBmb3IgdGhlIHJlY292ZXJ5LXBvb2wvCmNvbnRyb2xsZXIgYWRkcmVzcywgYnlwYXNzaW5nIHRoZSByZWdpc3RyeSdzIGAiemstcmVjb3ZlcnkiYApyZXNvbHV0aW9uIChzZWUgYHJlc29sdmVfcmVjb3ZlcnlgKS4gSW50ZW5kZWQgZm9yIGEgcHJldmlldy9zdGFnaW5nCmZhY3RvcnkgaW5zdGFuY2UgdGhhdCBuZWVkcyB0byBwb2ludCBhdCBhbiBpc29sYXRlZCBwcmV2aWV3IHBvb2wKd2l0aG91dCB0b3VjaGluZyB0aGUgcHJvZHVjdGlvbiByZWdpc3RyeSBtYXBwaW5nIGV2ZXJ5IG90aGVyIGZhY3RvcnkKaW5zdGFuY2Ugc2hhcmVzLiBSZXF1aXJlcyB0aGUgY3VycmVudCBhZG1pbidzIGF1dGggLS0gdGhpcyBpcyBhCnBvd2VyZnVsIGtub2I6IGl0IGNoYW5nZXMgd2hpY2ggY29udHJhY3QgYmVjb21lcyBldmVyeSBuZXdseS1jcmVhdGVkCmFjY291bnQncyByZWNvdmVyeSBjb250cm9sbGVyLCBhbmQgd2hpY2ggY29udHJhY3QgcmVjZWl2ZXMgdGhlCmdlbmVzaXMgYGluc2VydGAgY3Jvc3MtY2FsbCBpbiBgZGVwbG95X2FuZF9pbnNlcnRgLgAAABFzZXRfcmVjb3ZlcnlfcG9vbAAAAAAAAAEAAAAAAAAABHBvb2wAAAATAAAAAA==",
        "AAAAAAAAA/xQaW4gdGhlIGB2ZXJpZmllcmAgYW5kIGB6ay1yZWNvdmVyeWAgYWRkcmVzc2VzIChwbGFuIEIyKS4gQWZ0ZXIgdGhpcywKZXZlcnkgYHJlc29sdmUoInZlcmlmaWVyIilgIC8gYHJlc29sdmUoInprLXJlY292ZXJ5IilgIChpLmUuIGV2ZXJ5CmBjcmVhdGVfYWNjb3VudGAvYGNyZWF0ZV9hY2NvdW50X3YyYCkgcmV0dXJucyBleGFjdGx5IHRoZXNlIGFkZHJlc3NlcwpESVJFQ1RMWSwgd2l0aG91dCBjb25zdWx0aW5nIHRoZSByZWdpc3RyeSBhdCBhbGwgLS0gdGFraW5nIHRoZSByZWdpc3RyeQpvZmYgdGhlIHJ1bnRpbWUgY3JpdGljYWwgcGF0aCBhbmQgY2xvc2luZyB0aGUgImNvbXByb21pc2VkL3JlcG9pbnRlZApyZWdpc3RyeSBzaWxlbnRseSByb3V0ZXMgbmV3IGFjY291bnRzIHRvIGF0dGFja2VyIGNvbnRyYWN0cyIgaG9sZQooYHJlc29sdmVgIHRydXN0ZWQgdGhlIHJlZ2lzdHJ5IHVuY29uZGl0aW9uYWxseSBiZWZvcmUgdGhpcykuIEJlY2F1c2UKdGhlIHJlZ2lzdHJ5IGlzIGJ5cGFzc2VkLCBhIGxhdGVyIHJlcG9pbnQgY2Fubm90IHJlcm91dGUgTk9SIGJsb2NrIG5ldwphY2NvdW50czsgdGhlIHJlZ2lzdHJ5IHJlbWFpbnMgYXV0aG9yaXRhdGl2ZSBvbmx5IGZvciB1bnBpbm5lZCBuYW1lcwphbmQgZm9yIG9mZi1jaGFpbiBkaXNjb3ZlcnkuIEJvdGggYXJlIHNldCB0b2dldGhlciBiZWNhdXNlIGEgY3V0b3ZlcgpwaW5zIGJvdGggYXQgb25jZSBmcm9tIGBERVBMT1lFRC5tZGA7IGNhbGwgYWdhaW4gdG8gcmUtcGluIGFmdGVyIGEKZGVsaWJlcmF0ZSB2ZXJpZmllci9jb250cm9sbGVyIHVwZ3JhZGUuIFJlcXVpcmVzIHRoZSBjdXJyZW50IGFkbWluJ3MKYXV0aC4gTk9URTogdGhlIGB6ay1yZWNvdmVyeWAgcGluIGlzIHN1cGVyc2VkZWQgYnkgdGhlIGFkbWluLXNldApgc2V0X3JlY292ZXJ5X3Bvb2xgIG92ZXJyaWRlLCB3aGljaCBpcyBjaGVja2VkIGZpcnN0IChhbiBleHBsaWNpdCwKc2VwYXJhdGVseS1hdWRpdGVkIGFkbWluIGNob2ljZSAtLSBzZWUgYHJlc29sdmVfcmVjb3ZlcnlgKS4AAAARc2V0X3JlZ2lzdHJ5X3BpbnMAAAAAAAACAAAAAAAAAAh2ZXJpZmllcgAAABMAAAAAAAAAC3prX3JlY292ZXJ5AAAAABMAAAAA",
        "AAAAAAAAAEFUaGUgcGlubmVkIGV4cGVjdGVkIGB6ay1yZWNvdmVyeWAgYWRkcmVzcywgb3IgYE5vbmVgIGlmIHVucGlubmVkLgAAAAAAABJwaW5uZWRfemtfcmVjb3ZlcnkAAAAAAAAAAAABAAAD6AAAABM=",
        "AAAAAAAAAYpSZWNvbXB1dGUgYW5kIHN0b3JlIHRoZSBlbWJlZGRlZCBhY2NvdW50LXdhc20gaGFzaCwgcmV0dXJuaW5nIGl0LgpBZG1pbi1nYXRlZCBjb21wYW5pb24gdG8gdGhlIGB1cGdyYWRlYCBvdmVycmlkZSBhYm92ZTogYWZ0ZXIKaW4tcGxhY2UtdXBncmFkaW5nIGEgZmFjdG9yeSB3aG9zZSBPTEQgY29kZSBwcmVkYXRlcyB0aGF0IG92ZXJyaWRlLAp0aGUgc3RhbGUgY2FjaGUgc3Vydml2ZXMgKHRoZSB1cGdyYWRlIHRyYW5zYWN0aW9uIHJ1bnMgdGhlIG9sZApjb2RlKTsgY2FsbGluZyB0aGlzIG9uY2UgYWZ0ZXJ3YXJkcyByZXBhaXJzIGl0LiBIYXJtbGVzcyBhbnkgb3RoZXIKdGltZSDigJQgaXQganVzdCByZWZyZXNoZXMgdGhlIGNhY2hlIHdpdGggdGhlIGZyZXNobHkgY29tcHV0ZWQgdmFsdWUuAAAAAAAZcmVmcmVzaF9hY2NvdW50X3dhc21faGFzaAAAAAAAAAAAAAABAAAD7gAAACA=",
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
    admin: this.txFromJSON<string>,
        upgrade: this.txFromJSON<null>,
        set_admin: this.txFromJSON<null>,
        get_c_address: this.txFromJSON<string>,
        recovery_pool: this.txFromJSON<Option<string>>,
        create_account: this.txFromJSON<string>,
        pinned_verifier: this.txFromJSON<Option<string>>,
        create_account_v2: this.txFromJSON<string>,
        set_recovery_pool: this.txFromJSON<null>,
        set_registry_pins: this.txFromJSON<null>,
        pinned_zk_recovery: this.txFromJSON<Option<string>>,
        refresh_account_wasm_hash: this.txFromJSON<Buffer>
  }
}