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

// Generated bindings reference `Context` but did not import it; we never
// call enforce/can_enforce from JS, so an alias to `unknown` suffices.
type Context = unknown;

export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




/**
 * Persistent storage key space. `Frontier`/`RootRing`/`RingHead`/
 * `NextIndex` are the depth-24 incremental-Merkle pool state (spec §3.4,
 * adapted from `mixer.rs`); `Nullifier`/`Pending`/`Cancels` are per-account
 * recovery state; `Installed` records which `ContextRule` id this
 * contract's `Policy` was installed under for a given account (spec §3.1);
 * `Config` is the immutable `RecoveryConfig`.
 */
export type RecoveryKey = {tag: "Frontier", values: void} | {tag: "NextIndex", values: void} | {tag: "RootRing", values: void} | {tag: "RingHead", values: void} | {tag: "Nullifier", values: readonly [Buffer]} | {tag: "Pending", values: readonly [string]} | {tag: "Installed", values: readonly [string]} | {tag: "Cancels", values: readonly [string]} | {tag: "Config", values: void} | {tag: "Nonce", values: readonly [string]} | {tag: "RateWindow", values: readonly [string]} | {tag: "LastCancel", values: readonly [string]};


/**
 * Contract error codes (spec §3.3 interface/checks, §3.1 completion
 * authority, §2.2/§2.3 leaf/nullifier invariants). Grouped by the module
 * that raises them; later M1 tasks will exercise most of these -- only the
 * enum shape is exercised by M1 Task 2's scaffold.
 */
export const RecoveryError = {
  21: {message:"TreeFull"},
  1: {message:"NonCanonicalCommitment"},
  2: {message:"PendingExists"},
  3: {message:"UnknownRoot"},
  4: {message:"NullifierReserved"},
  5: {message:"NullifierSpent"},
  6: {message:"InvalidNonce"},
  7: {message:"TimelockTooShort"},
  8: {message:"TimelockMismatch"},
  9: {message:"RateLimited"},
  10: {message:"VerificationFailed"},
  11: {message:"NoPending"},
  12: {message:"CancelCapReached"},
  13: {message:"CooldownActive"},
  14: {message:"RecoveryExpired"},
  15: {message:"TimelockNotElapsed"},
  16: {message:"ContextMismatch"},
  17: {message:"RuleMismatch"},
  18: {message:"NotInstalled"},
  19: {message:"AlreadyInstalled"},
  20: {message:"Unauthorized"},
  22: {message:"NullifierReservedElsewhere"}
}

/**
 * Lifecycle state of a nullifier (spec §2.3). Absent from storage means
 * "unused"; `Reserved(account)` means an `initiate_recovery` has revealed
 * it and it is bound to that account's pending record; `Spent` means a
 * `complete_recovery` or `burn_nullifier` has permanently consumed it.
 */
export type NullifierState = {tag: "Reserved", values: readonly [string]} | {tag: "Spent", values: void};


/**
 * Immutable-at-deploy configuration for the pool + controller (spec §3.3,
 * §3.4). `factory` is the only caller allowed to bind an arbitrary account
 * on `insert` (genesis authority); `verifier` is the `zk-verifier`
 * contract's address; `network_passphrase` is the raw (not pre-hashed)
 * network passphrase bytes -- `hash::compute_auth_hash` sha256's it
 * internally, exactly mirroring the circuit's `npass_hi`/`npass_lo`
 * derivation (`main.nr:40-42`), so `initiate_recovery` must recompute
 * `auth_hash` using the SAME passphrase bytes a proof's witness was
 * generated against; the remaining fields are the timelock/rate-limit
 * defaults (spec §3.3 "Defaults"). `webauthn_verifier` is appended by M1
 * Task 7 (`policy.rs`): the `WebAuthnVerifier` contract address that a
 * completed recovery's new signer must be `Signer::External`-bound to --
 * `PendingRecovery::new_pubkey` (spec §3.1) is only the raw P-256 public key
 * bytes, not a full `Signer`, so `Policy::enforce`'s args-gate needs this to
 * reconstruct the exact `Signer` it must match a
 */
export interface RecoveryConfig {
  completion_window_secs: u64;
  delay_secs: u64;
  factory: string;
  max_cancels: u32;
  network_passphrase: Buffer;
  timelock_floor_secs: u64;
  verifier: string;
  webauthn_verifier: string;
}


/**
 * A live timelocked recovery in flight for one account (spec §3.3
 * `initiate_recovery`). `new_pubkey` is staged, not yet installed; the
 * account's own `nullifier` reservation lives in `NullifierState`, not
 * here, so a cancel can release it without losing the pending record's
 * audit trail.
 */
export interface PendingRecovery {
  executable_after: u64;
  expires_at: u64;
  initiated_at: u64;
  new_pubkey: Buffer;
  nullifier: Buffer;
}






/**
 * Install parameters for the `ZkRecovery` completion `Policy` (spec §3.1,
 * M1 Task 7). The policy's enforcement behavior is fully determined by the
 * shared `RecoveryConfig` and the account's own `PendingRecovery` state, so
 * this carries no real configuration today -- `version` exists only to
 * mirror `multisig-policy`'s `AccountParams` shape (a non-trivial,
 * `FromVal`-decodable install-params type) and to leave room for future
 * versioning without changing the `Policy::install` signature.
 */
export interface ZkRecoveryInstallParams {
  version: u32;
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
   * Construct and simulate a next_nonce transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * View: the next nonce `initiate_recovery` will accept for `account`.
   */
  next_nonce: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a get_pending transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * View: the live-or-stale pending recovery record for `account`, if
   * any. Callers wanting strictly-live semantics should compare
   * `expires_at` against the current ledger timestamp themselves.
   */
  get_pending: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<PendingRecovery>>>

  /**
   * Construct and simulate a has_pending transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * View: `true` iff a LIVE pending recovery exists for `account` (has
   * NOT yet crossed `expires_at`). This is the cheap boolean signal the
   * smart-account in-account guard (spec §3.2,
   * `contracts/smart-account/src/contract.rs::guard_no_pending`)
   * cross-calls before allowing `remove_signer`/`remove_context_rule`/
   * `remove_policy`/`update_context_rule_valid_until` -- a plain `bool`
   * avoids needing to decode the full `PendingRecovery` struct
   * cross-contract just to check liveness. A pending past `expires_at` is
   * stale/supersedable (see `initiate_recovery`'s step 1 comment above)
   * and this returns `false` for it, exactly as if there were no pending
   * at all -- callers wanting the stale-or-live record itself should use
   * `get_pending` and compare `expires_at` themselves.
   */
  has_pending: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a cancels_used transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * View: how many cancels `account` has used against its `max_cancels`
   * cap (spec §2.4).
   */
  cancels_used: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a burn_nullifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The legitimate owner's proof-gated REVOKE for a (possibly leaked)
   * enrollment secret (spec §2.3): a REAL `action=3` proof of knowledge of
   * the secret behind `nullifier`'s Merkle leaf permanently spends it, so
   * a later `initiate_recovery` attempt with the same nullifier fails
   * `NullifierSpent` -- even one from an attacker who legitimately knows
   * the leaked secret. Requires BOTH `account`'s own auth AND the proof,
   * analogous to how `cancel_recovery` requires an `action=2` proof.
   * 
   * Why account-auth alone is not enough (the pre-fix shape of this
   * function): `nullifier` becomes PUBLIC the moment any
   * `initiate_recovery` reveals it as a proof public input, and a
   * `cancel_recovery` RELEASES its reservation while it stays public. So
   * after a legitimate cancel, ANY third party could call
   * `burn_nullifier(their_own_account, victim_nullifier)` and permanently
   * kill the victim's enrollment credential -- violating spec §2.3 ("a
   * cancel never burns the enrollment"). Since `nullifier` is public,
   * only PROVING knowledge of the secret beh
   */
  burn_nullifier: ({account, nonce, root, nullifier, proof}: {account: string, nonce: u64, root: Buffer, nullifier: Buffer, proof: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a cancel_recovery transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The legitimate owner's defense against a malicious/stale recovery in
   * flight (spec §2.4, §3.3): stops the pending recovery during its
   * timelock. Requires `account`'s own auth (the WebAuthn passkey signer
   * in production) -- exactly what an attacker who only knows a leaked
   * enrollment secret CANNOT provide, since a cancel does not consume
   * that secret's nullifier (it stays usable, only the pending record and
   * its nullifier RESERVATION are cleared).
   * 
   * Ordered checks, mirroring `initiate_recovery`'s style: (1) account
   * auth, (2) a live pending must exist, (3) the per-account cancel cap
   * must not be reached, (4) a 24h cooldown since the last successful
   * cancel must have elapsed, (5) `nonce` must be exactly one past the
   * stored value (bumped on success), (6) a REAL `action=2` proof -- with
   * the pubkey/timelock fields ZEROED per spec §2.4 -- must verify
   * against this call's own recomputed `auth_hash` and a known root.
   */
  cancel_recovery: ({account, nonce, root, nullifier, proof}: {account: string, nonce: u64, root: Buffer, nullifier: Buffer, proof: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a initiate_recovery transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Starts a timelocked recovery for `account` (spec §3.3, ordered
   * checks). Permissionless -- no `require_auth`. Returns
   * `executable_after`.
   */
  initiate_recovery: ({account, new_pubkey, nonce, timelock_secs, root, nullifier, proof}: {account: string, new_pubkey: Buffer, nonce: u64, timelock_secs: u32, root: Buffer, nullifier: Buffer, proof: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a insert transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * GENESIS insert: the factory creates `account` and, in the same
   * transaction, enrolls its recovery `commitment`. Only `config.factory`
   * may call this -- it is the sole authority permitted to assert an
   * arbitrary account binding, because it is the entity that just
   * created `account` and therefore knows the binding is legitimate
   * (spec's Task-4 genesis note). Returns the new leaf's index.
   */
  insert: ({account, commitment}: {account: string, commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a insert_for transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * MIGRATION/re-enroll insert: `account` authorizes its own visible
   * insert (e.g. adding a fresh recovery secret after rotating away from
   * a leaked one). Returns the new leaf's index.
   */
  insert_for: ({account, commitment}: {account: string, commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a next_index transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The number of leaves inserted so far.
   */
  next_index: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a current_root transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The current Merkle root over all inserted leaves (thin wrapper over
   * `merkle::current_root`, exposed for off-chain clients/later tasks).
   */
  current_root: (options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

  /**
   * Construct and simulate a is_known_root transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Whether `root` is still retained in the historic-root ring (or is the
   * empty-tree root).
   */
  is_known_root: ({root}: {root: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a enforce transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The M1 hard requirement: permits ONLY the exact intended
   * key-rotation, then consumes the pending recovery.
   * 
   * Ordered checks:
   * 1. `smart_account.require_auth()` -- blocks any invocation of
   * `enforce` that isn't itself part of the account's own auth
   * resolution (direct third-party calls to a policy contract's
   * `enforce` are meaningless anyway since only the account's
   * `__check_auth`/`do_check_auth` ever cross-calls it, but this
   * mirrors `multisig-policy`'s and OZ's `simple_threshold::enforce`
   * shape).
   * 2. `context_rule.id` must equal the id this policy was `install`ed
   * under for `smart_account` (`RuleMismatch` otherwise) -- rejects a
   * stale/different rule that happens to also reference this policy
   * contract.
   * 3. A live pending must exist for `smart_account`: absent ->
   * `NoPending`; `now < executable_after` -> `TimelockNotElapsed`;
   * `now >= expires_at` -> `RecoveryExpired`.
   * 4. THE GATE: `context` must be `Context::Contract` targeting
   * `smart_account` itself, with `fn_name == "add_context_rule"` and
   * EXACTLY 5 args (`add_context_
   */
  enforce: ({context, authenticated_signers, context_rule, smart_account}: {context: Context, authenticated_signers: Array<Signer>, context_rule: ContextRule, smart_account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a install transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Installs this contract as `smart_account`'s recovery completion
   * authority for `context_rule`, recording which rule id it was
   * installed under (`RecoveryKey::Installed`) -- `enforce` uses this to
   * reject being invoked for any OTHER rule the account might also have
   * pointed at this same policy contract address.
   * 
   * Requires the account's own auth (standard OZ `Policy::install`
   * contract, satisfied here via the "invoker contract auth" mechanism --
   * `install` is always cross-called from within the account's own
   * `add_context_rule`, so no separate signature is needed). Requires the
   * rule to be zero-signer (authorization comes solely from this policy,
   * spec §3.1) and scoped to `CallContract(smart_account)` (self only --
   * never a rule that could authorize calls against a DIFFERENT
   * contract).
   * 
   * # Stolen-passkey hardening (spec §3.1, the direct-call neuter fix)
   * 
   * `smart_account.require_auth()` alone is NOT a sufficient gate: a thief
   * holding a stolen WebAuthn passkey satisfies the account's Default rule,
   * so they can call this `ins
   */
  install: ({install_params, context_rule, smart_account}: {install_params: ZkRecoveryInstallParams, context_rule: ContextRule, smart_account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a uninstall transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * UNCONDITIONALLY REFUSES (spec §3.1, the direct-call neuter fix).
   * 
   * # Why refusing is the only reentrancy-safe choice
   * 
   * The pre-fix `uninstall` cleared `RecoveryKey::Installed(account)` on any
   * call gated solely by `smart_account.require_auth()`. A thief holding a
   * stolen WebAuthn passkey satisfies that, so a direct
   * `uninstall(any_rule, account)` (top-level, or via the account's
   * `execute`) cleared `Installed` while the account's recovery rule stayed
   * intact on-chain -- every future completion `enforce` then panics
   * `NotInstalled`, permanently neutering recovery, instantly, bypassing the
   * M2 in-account guard and the 7-day removal delay.
   * 
   * A discriminator that PASSES the legitimate teardown but FAILS a thief's
   * direct call is not achievable at this contract:
   * - The account's on-chain state (does the rule still reference this
   * controller? has removal been announced-and-elapsed?) is the only thing
   * that distinguishes them -- but `uninstall` is invoked from WITHIN the
   * account's own `remove_context_rule`/`remove_policy` (accou
   */
  uninstall: ({context_rule, smart_account}: {context_rule: ContextRule, smart_account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {factory, verifier, delay_secs, completion_window_secs, max_cancels, timelock_floor_secs, network_passphrase, webauthn_verifier}: {factory: string, verifier: string, delay_secs: u64, completion_window_secs: u64, max_cancels: u32, timelock_floor_secs: u64, network_passphrase: Buffer, webauthn_verifier: string},
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
    return ContractClient.deploy({factory, verifier, delay_secs, completion_window_secs, max_cancels, timelock_floor_secs, network_passphrase, webauthn_verifier}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAENWaWV3OiB0aGUgbmV4dCBub25jZSBgaW5pdGlhdGVfcmVjb3ZlcnlgIHdpbGwgYWNjZXB0IGZvciBgYWNjb3VudGAuAAAAAApuZXh0X25vbmNlAAAAAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAABg==",
        "AAAAAAAAALtWaWV3OiB0aGUgbGl2ZS1vci1zdGFsZSBwZW5kaW5nIHJlY292ZXJ5IHJlY29yZCBmb3IgYGFjY291bnRgLCBpZgphbnkuIENhbGxlcnMgd2FudGluZyBzdHJpY3RseS1saXZlIHNlbWFudGljcyBzaG91bGQgY29tcGFyZQpgZXhwaXJlc19hdGAgYWdhaW5zdCB0aGUgY3VycmVudCBsZWRnZXIgdGltZXN0YW1wIHRoZW1zZWx2ZXMuAAAAAAtnZXRfcGVuZGluZwAAAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAD6AAAB9AAAAAPUGVuZGluZ1JlY292ZXJ5AA==",
        "AAAAAAAAAvhWaWV3OiBgdHJ1ZWAgaWZmIGEgTElWRSBwZW5kaW5nIHJlY292ZXJ5IGV4aXN0cyBmb3IgYGFjY291bnRgIChoYXMKTk9UIHlldCBjcm9zc2VkIGBleHBpcmVzX2F0YCkuIFRoaXMgaXMgdGhlIGNoZWFwIGJvb2xlYW4gc2lnbmFsIHRoZQpzbWFydC1hY2NvdW50IGluLWFjY291bnQgZ3VhcmQgKHNwZWMgwqczLjIsCmBjb250cmFjdHMvc21hcnQtYWNjb3VudC9zcmMvY29udHJhY3QucnM6Omd1YXJkX25vX3BlbmRpbmdgKQpjcm9zcy1jYWxscyBiZWZvcmUgYWxsb3dpbmcgYHJlbW92ZV9zaWduZXJgL2ByZW1vdmVfY29udGV4dF9ydWxlYC8KYHJlbW92ZV9wb2xpY3lgL2B1cGRhdGVfY29udGV4dF9ydWxlX3ZhbGlkX3VudGlsYCAtLSBhIHBsYWluIGBib29sYAphdm9pZHMgbmVlZGluZyB0byBkZWNvZGUgdGhlIGZ1bGwgYFBlbmRpbmdSZWNvdmVyeWAgc3RydWN0CmNyb3NzLWNvbnRyYWN0IGp1c3QgdG8gY2hlY2sgbGl2ZW5lc3MuIEEgcGVuZGluZyBwYXN0IGBleHBpcmVzX2F0YCBpcwpzdGFsZS9zdXBlcnNlZGFibGUgKHNlZSBgaW5pdGlhdGVfcmVjb3ZlcnlgJ3Mgc3RlcCAxIGNvbW1lbnQgYWJvdmUpCmFuZCB0aGlzIHJldHVybnMgYGZhbHNlYCBmb3IgaXQsIGV4YWN0bHkgYXMgaWYgdGhlcmUgd2VyZSBubyBwZW5kaW5nCmF0IGFsbCAtLSBjYWxsZXJzIHdhbnRpbmcgdGhlIHN0YWxlLW9yLWxpdmUgcmVjb3JkIGl0c2VsZiBzaG91bGQgdXNlCmBnZXRfcGVuZGluZ2AgYW5kIGNvbXBhcmUgYGV4cGlyZXNfYXRgIHRoZW1zZWx2ZXMuAAAAC2hhc19wZW5kaW5nAAAAAAEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAAB",
        "AAAAAAAAAFVWaWV3OiBob3cgbWFueSBjYW5jZWxzIGBhY2NvdW50YCBoYXMgdXNlZCBhZ2FpbnN0IGl0cyBgbWF4X2NhbmNlbHNgCmNhcCAoc3BlYyDCpzIuNCkuAAAAAAAADGNhbmNlbHNfdXNlZAAAAAEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAAE",
        "AAAAAAAABABUaGUgbGVnaXRpbWF0ZSBvd25lcidzIHByb29mLWdhdGVkIFJFVk9LRSBmb3IgYSAocG9zc2libHkgbGVha2VkKQplbnJvbGxtZW50IHNlY3JldCAoc3BlYyDCpzIuMyk6IGEgUkVBTCBgYWN0aW9uPTNgIHByb29mIG9mIGtub3dsZWRnZSBvZgp0aGUgc2VjcmV0IGJlaGluZCBgbnVsbGlmaWVyYCdzIE1lcmtsZSBsZWFmIHBlcm1hbmVudGx5IHNwZW5kcyBpdCwgc28KYSBsYXRlciBgaW5pdGlhdGVfcmVjb3ZlcnlgIGF0dGVtcHQgd2l0aCB0aGUgc2FtZSBudWxsaWZpZXIgZmFpbHMKYE51bGxpZmllclNwZW50YCAtLSBldmVuIG9uZSBmcm9tIGFuIGF0dGFja2VyIHdobyBsZWdpdGltYXRlbHkga25vd3MKdGhlIGxlYWtlZCBzZWNyZXQuIFJlcXVpcmVzIEJPVEggYGFjY291bnRgJ3Mgb3duIGF1dGggQU5EIHRoZSBwcm9vZiwKYW5hbG9nb3VzIHRvIGhvdyBgY2FuY2VsX3JlY292ZXJ5YCByZXF1aXJlcyBhbiBgYWN0aW9uPTJgIHByb29mLgoKV2h5IGFjY291bnQtYXV0aCBhbG9uZSBpcyBub3QgZW5vdWdoICh0aGUgcHJlLWZpeCBzaGFwZSBvZiB0aGlzCmZ1bmN0aW9uKTogYG51bGxpZmllcmAgYmVjb21lcyBQVUJMSUMgdGhlIG1vbWVudCBhbnkKYGluaXRpYXRlX3JlY292ZXJ5YCByZXZlYWxzIGl0IGFzIGEgcHJvb2YgcHVibGljIGlucHV0LCBhbmQgYQpgY2FuY2VsX3JlY292ZXJ5YCBSRUxFQVNFUyBpdHMgcmVzZXJ2YXRpb24gd2hpbGUgaXQgc3RheXMgcHVibGljLiBTbwphZnRlciBhIGxlZ2l0aW1hdGUgY2FuY2VsLCBBTlkgdGhpcmQgcGFydHkgY291bGQgY2FsbApgYnVybl9udWxsaWZpZXIodGhlaXJfb3duX2FjY291bnQsIHZpY3RpbV9udWxsaWZpZXIpYCBhbmQgcGVybWFuZW50bHkKa2lsbCB0aGUgdmljdGltJ3MgZW5yb2xsbWVudCBjcmVkZW50aWFsIC0tIHZpb2xhdGluZyBzcGVjIMKnMi4zICgiYQpjYW5jZWwgbmV2ZXIgYnVybnMgdGhlIGVucm9sbG1lbnQiKS4gU2luY2UgYG51bGxpZmllcmAgaXMgcHVibGljLApvbmx5IFBST1ZJTkcga25vd2xlZGdlIG9mIHRoZSBzZWNyZXQgYmVoAAAADmJ1cm5fbnVsbGlmaWVyAAAAAAAFAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAABW5vbmNlAAAAAAAABgAAAAAAAAAEcm9vdAAAA+4AAAAgAAAAAAAAAAludWxsaWZpZXIAAAAAAAPuAAAAIAAAAAAAAAAFcHJvb2YAAAAAAAAOAAAAAA==",
        "AAAAAAAAA5JUaGUgbGVnaXRpbWF0ZSBvd25lcidzIGRlZmVuc2UgYWdhaW5zdCBhIG1hbGljaW91cy9zdGFsZSByZWNvdmVyeSBpbgpmbGlnaHQgKHNwZWMgwqcyLjQsIMKnMy4zKTogc3RvcHMgdGhlIHBlbmRpbmcgcmVjb3ZlcnkgZHVyaW5nIGl0cwp0aW1lbG9jay4gUmVxdWlyZXMgYGFjY291bnRgJ3Mgb3duIGF1dGggKHRoZSBXZWJBdXRobiBwYXNza2V5IHNpZ25lcgppbiBwcm9kdWN0aW9uKSAtLSBleGFjdGx5IHdoYXQgYW4gYXR0YWNrZXIgd2hvIG9ubHkga25vd3MgYSBsZWFrZWQKZW5yb2xsbWVudCBzZWNyZXQgQ0FOTk9UIHByb3ZpZGUsIHNpbmNlIGEgY2FuY2VsIGRvZXMgbm90IGNvbnN1bWUKdGhhdCBzZWNyZXQncyBudWxsaWZpZXIgKGl0IHN0YXlzIHVzYWJsZSwgb25seSB0aGUgcGVuZGluZyByZWNvcmQgYW5kCml0cyBudWxsaWZpZXIgUkVTRVJWQVRJT04gYXJlIGNsZWFyZWQpLgoKT3JkZXJlZCBjaGVja3MsIG1pcnJvcmluZyBgaW5pdGlhdGVfcmVjb3ZlcnlgJ3Mgc3R5bGU6ICgxKSBhY2NvdW50CmF1dGgsICgyKSBhIGxpdmUgcGVuZGluZyBtdXN0IGV4aXN0LCAoMykgdGhlIHBlci1hY2NvdW50IGNhbmNlbCBjYXAKbXVzdCBub3QgYmUgcmVhY2hlZCwgKDQpIGEgMjRoIGNvb2xkb3duIHNpbmNlIHRoZSBsYXN0IHN1Y2Nlc3NmdWwKY2FuY2VsIG11c3QgaGF2ZSBlbGFwc2VkLCAoNSkgYG5vbmNlYCBtdXN0IGJlIGV4YWN0bHkgb25lIHBhc3QgdGhlCnN0b3JlZCB2YWx1ZSAoYnVtcGVkIG9uIHN1Y2Nlc3MpLCAoNikgYSBSRUFMIGBhY3Rpb249MmAgcHJvb2YgLS0gd2l0aAp0aGUgcHVia2V5L3RpbWVsb2NrIGZpZWxkcyBaRVJPRUQgcGVyIHNwZWMgwqcyLjQgLS0gbXVzdCB2ZXJpZnkKYWdhaW5zdCB0aGlzIGNhbGwncyBvd24gcmVjb21wdXRlZCBgYXV0aF9oYXNoYCBhbmQgYSBrbm93biByb290LgAAAAAAD2NhbmNlbF9yZWNvdmVyeQAAAAAFAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAABW5vbmNlAAAAAAAABgAAAAAAAAAEcm9vdAAAA+4AAAAgAAAAAAAAAAludWxsaWZpZXIAAAAAAAPuAAAAIAAAAAAAAAAFcHJvb2YAAAAAAAAOAAAAAQAAAAQ=",
        "AAAAAAAAAIlTdGFydHMgYSB0aW1lbG9ja2VkIHJlY292ZXJ5IGZvciBgYWNjb3VudGAgKHNwZWMgwqczLjMsIG9yZGVyZWQKY2hlY2tzKS4gUGVybWlzc2lvbmxlc3MgLS0gbm8gYHJlcXVpcmVfYXV0aGAuIFJldHVybnMKYGV4ZWN1dGFibGVfYWZ0ZXJgLgAAAAAAABFpbml0aWF0ZV9yZWNvdmVyeQAAAAAAAAcAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAKbmV3X3B1YmtleQAAAAAD7gAAAEEAAAAAAAAABW5vbmNlAAAAAAAABgAAAAAAAAANdGltZWxvY2tfc2VjcwAAAAAAAAQAAAAAAAAABHJvb3QAAAPuAAAAIAAAAAAAAAAJbnVsbGlmaWVyAAAAAAAD7gAAACAAAAAAAAAABXByb29mAAAAAAAADgAAAAEAAAAG",
        "AAAAAAAAAX9HRU5FU0lTIGluc2VydDogdGhlIGZhY3RvcnkgY3JlYXRlcyBgYWNjb3VudGAgYW5kLCBpbiB0aGUgc2FtZQp0cmFuc2FjdGlvbiwgZW5yb2xscyBpdHMgcmVjb3ZlcnkgYGNvbW1pdG1lbnRgLiBPbmx5IGBjb25maWcuZmFjdG9yeWAKbWF5IGNhbGwgdGhpcyAtLSBpdCBpcyB0aGUgc29sZSBhdXRob3JpdHkgcGVybWl0dGVkIHRvIGFzc2VydCBhbgphcmJpdHJhcnkgYWNjb3VudCBiaW5kaW5nLCBiZWNhdXNlIGl0IGlzIHRoZSBlbnRpdHkgdGhhdCBqdXN0CmNyZWF0ZWQgYGFjY291bnRgIGFuZCB0aGVyZWZvcmUga25vd3MgdGhlIGJpbmRpbmcgaXMgbGVnaXRpbWF0ZQooc3BlYydzIFRhc2stNCBnZW5lc2lzIG5vdGUpLiBSZXR1cm5zIHRoZSBuZXcgbGVhZidzIGluZGV4LgAAAAAGaW5zZXJ0AAAAAAACAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAQAAAAQ=",
        "AAAAAAAAALJNSUdSQVRJT04vcmUtZW5yb2xsIGluc2VydDogYGFjY291bnRgIGF1dGhvcml6ZXMgaXRzIG93biB2aXNpYmxlCmluc2VydCAoZS5nLiBhZGRpbmcgYSBmcmVzaCByZWNvdmVyeSBzZWNyZXQgYWZ0ZXIgcm90YXRpbmcgYXdheSBmcm9tCmEgbGVha2VkIG9uZSkuIFJldHVybnMgdGhlIG5ldyBsZWFmJ3MgaW5kZXguAAAAAAAKaW5zZXJ0X2ZvcgAAAAAAAgAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAEAAAAE",
        "AAAAAAAAACVUaGUgbnVtYmVyIG9mIGxlYXZlcyBpbnNlcnRlZCBzbyBmYXIuAAAAAAAACm5leHRfaW5kZXgAAAAAAAAAAAABAAAABA==",
        "AAAAAAAAAIdUaGUgY3VycmVudCBNZXJrbGUgcm9vdCBvdmVyIGFsbCBpbnNlcnRlZCBsZWF2ZXMgKHRoaW4gd3JhcHBlciBvdmVyCmBtZXJrbGU6OmN1cnJlbnRfcm9vdGAsIGV4cG9zZWQgZm9yIG9mZi1jaGFpbiBjbGllbnRzL2xhdGVyIHRhc2tzKS4AAAAADGN1cnJlbnRfcm9vdAAAAAAAAAABAAAD7gAAACA=",
        "AAAAAAAAAHtTdG9yZXMgdGhlIGltbXV0YWJsZSBgUmVjb3ZlcnlDb25maWdgIChzcGVjIMKnMy4zICJEZWZhdWx0cyIpLiBNdXN0CnJ1biBvbmNlLCBhdCBkZXBsb3kgdGltZSwgYmVmb3JlIGFueSBvdGhlciBlbnRyeSBwb2ludC4AAAAADV9fY29uc3RydWN0b3IAAAAAAAAIAAAAAAAAAAdmYWN0b3J5AAAAABMAAAAAAAAACHZlcmlmaWVyAAAAEwAAAAAAAAAKZGVsYXlfc2VjcwAAAAAABgAAAAAAAAAWY29tcGxldGlvbl93aW5kb3dfc2VjcwAAAAAABgAAAAAAAAALbWF4X2NhbmNlbHMAAAAABAAAAAAAAAATdGltZWxvY2tfZmxvb3Jfc2VjcwAAAAAGAAAAAAAAABJuZXR3b3JrX3Bhc3NwaHJhc2UAAAAAAA4AAAAAAAAAEXdlYmF1dGhuX3ZlcmlmaWVyAAAAAAAAEwAAAAA=",
        "AAAAAAAAAFdXaGV0aGVyIGByb290YCBpcyBzdGlsbCByZXRhaW5lZCBpbiB0aGUgaGlzdG9yaWMtcm9vdCByaW5nIChvciBpcyB0aGUKZW1wdHktdHJlZSByb290KS4AAAAADWlzX2tub3duX3Jvb3QAAAAAAAABAAAAAAAAAARyb290AAAD7gAAACAAAAABAAAAAQ==",
        "AAAAAAAABABUaGUgTTEgaGFyZCByZXF1aXJlbWVudDogcGVybWl0cyBPTkxZIHRoZSBleGFjdCBpbnRlbmRlZAprZXktcm90YXRpb24sIHRoZW4gY29uc3VtZXMgdGhlIHBlbmRpbmcgcmVjb3ZlcnkuCgpPcmRlcmVkIGNoZWNrczoKMS4gYHNtYXJ0X2FjY291bnQucmVxdWlyZV9hdXRoKClgIC0tIGJsb2NrcyBhbnkgaW52b2NhdGlvbiBvZgpgZW5mb3JjZWAgdGhhdCBpc24ndCBpdHNlbGYgcGFydCBvZiB0aGUgYWNjb3VudCdzIG93biBhdXRoCnJlc29sdXRpb24gKGRpcmVjdCB0aGlyZC1wYXJ0eSBjYWxscyB0byBhIHBvbGljeSBjb250cmFjdCdzCmBlbmZvcmNlYCBhcmUgbWVhbmluZ2xlc3MgYW55d2F5IHNpbmNlIG9ubHkgdGhlIGFjY291bnQncwpgX19jaGVja19hdXRoYC9gZG9fY2hlY2tfYXV0aGAgZXZlciBjcm9zcy1jYWxscyBpdCwgYnV0IHRoaXMKbWlycm9ycyBgbXVsdGlzaWctcG9saWN5YCdzIGFuZCBPWidzIGBzaW1wbGVfdGhyZXNob2xkOjplbmZvcmNlYApzaGFwZSkuCjIuIGBjb250ZXh0X3J1bGUuaWRgIG11c3QgZXF1YWwgdGhlIGlkIHRoaXMgcG9saWN5IHdhcyBgaW5zdGFsbGBlZAp1bmRlciBmb3IgYHNtYXJ0X2FjY291bnRgIChgUnVsZU1pc21hdGNoYCBvdGhlcndpc2UpIC0tIHJlamVjdHMgYQpzdGFsZS9kaWZmZXJlbnQgcnVsZSB0aGF0IGhhcHBlbnMgdG8gYWxzbyByZWZlcmVuY2UgdGhpcyBwb2xpY3kKY29udHJhY3QuCjMuIEEgbGl2ZSBwZW5kaW5nIG11c3QgZXhpc3QgZm9yIGBzbWFydF9hY2NvdW50YDogYWJzZW50IC0+CmBOb1BlbmRpbmdgOyBgbm93IDwgZXhlY3V0YWJsZV9hZnRlcmAgLT4gYFRpbWVsb2NrTm90RWxhcHNlZGA7CmBub3cgPj0gZXhwaXJlc19hdGAgLT4gYFJlY292ZXJ5RXhwaXJlZGAuCjQuIFRIRSBHQVRFOiBgY29udGV4dGAgbXVzdCBiZSBgQ29udGV4dDo6Q29udHJhY3RgIHRhcmdldGluZwpgc21hcnRfYWNjb3VudGAgaXRzZWxmLCB3aXRoIGBmbl9uYW1lID09ICJhZGRfY29udGV4dF9ydWxlImAgYW5kCkVYQUNUTFkgNSBhcmdzIChgYWRkX2NvbnRleHRfAAAAB2VuZm9yY2UAAAAABAAAAAAAAAAHY29udGV4dAAAAAfQAAAAB0NvbnRleHQAAAAAAAAAABVhdXRoZW50aWNhdGVkX3NpZ25lcnMAAAAAAAPqAAAH0AAAAAZTaWduZXIAAAAAAAAAAAAMY29udGV4dF9ydWxlAAAH0AAAAAtDb250ZXh0UnVsZQAAAAAAAAAADXNtYXJ0X2FjY291bnQAAAAAAAATAAAAAA==",
        "AAAAAAAABABJbnN0YWxscyB0aGlzIGNvbnRyYWN0IGFzIGBzbWFydF9hY2NvdW50YCdzIHJlY292ZXJ5IGNvbXBsZXRpb24KYXV0aG9yaXR5IGZvciBgY29udGV4dF9ydWxlYCwgcmVjb3JkaW5nIHdoaWNoIHJ1bGUgaWQgaXQgd2FzCmluc3RhbGxlZCB1bmRlciAoYFJlY292ZXJ5S2V5OjpJbnN0YWxsZWRgKSAtLSBgZW5mb3JjZWAgdXNlcyB0aGlzIHRvCnJlamVjdCBiZWluZyBpbnZva2VkIGZvciBhbnkgT1RIRVIgcnVsZSB0aGUgYWNjb3VudCBtaWdodCBhbHNvIGhhdmUKcG9pbnRlZCBhdCB0aGlzIHNhbWUgcG9saWN5IGNvbnRyYWN0IGFkZHJlc3MuCgpSZXF1aXJlcyB0aGUgYWNjb3VudCdzIG93biBhdXRoIChzdGFuZGFyZCBPWiBgUG9saWN5OjppbnN0YWxsYApjb250cmFjdCwgc2F0aXNmaWVkIGhlcmUgdmlhIHRoZSAiaW52b2tlciBjb250cmFjdCBhdXRoIiBtZWNoYW5pc20gLS0KYGluc3RhbGxgIGlzIGFsd2F5cyBjcm9zcy1jYWxsZWQgZnJvbSB3aXRoaW4gdGhlIGFjY291bnQncyBvd24KYGFkZF9jb250ZXh0X3J1bGVgLCBzbyBubyBzZXBhcmF0ZSBzaWduYXR1cmUgaXMgbmVlZGVkKS4gUmVxdWlyZXMgdGhlCnJ1bGUgdG8gYmUgemVyby1zaWduZXIgKGF1dGhvcml6YXRpb24gY29tZXMgc29sZWx5IGZyb20gdGhpcyBwb2xpY3ksCnNwZWMgwqczLjEpIGFuZCBzY29wZWQgdG8gYENhbGxDb250cmFjdChzbWFydF9hY2NvdW50KWAgKHNlbGYgb25seSAtLQpuZXZlciBhIHJ1bGUgdGhhdCBjb3VsZCBhdXRob3JpemUgY2FsbHMgYWdhaW5zdCBhIERJRkZFUkVOVApjb250cmFjdCkuCgojIFN0b2xlbi1wYXNza2V5IGhhcmRlbmluZyAoc3BlYyDCpzMuMSwgdGhlIGRpcmVjdC1jYWxsIG5ldXRlciBmaXgpCgpgc21hcnRfYWNjb3VudC5yZXF1aXJlX2F1dGgoKWAgYWxvbmUgaXMgTk9UIGEgc3VmZmljaWVudCBnYXRlOiBhIHRoaWVmCmhvbGRpbmcgYSBzdG9sZW4gV2ViQXV0aG4gcGFzc2tleSBzYXRpc2ZpZXMgdGhlIGFjY291bnQncyBEZWZhdWx0IHJ1bGUsCnNvIHRoZXkgY2FuIGNhbGwgdGhpcyBgaW5zAAAAB2luc3RhbGwAAAAAAwAAAAAAAAAOaW5zdGFsbF9wYXJhbXMAAAAAB9AAAAAXWmtSZWNvdmVyeUluc3RhbGxQYXJhbXMAAAAAAAAAAAxjb250ZXh0X3J1bGUAAAfQAAAAC0NvbnRleHRSdWxlAAAAAAAAAAANc21hcnRfYWNjb3VudAAAAAAAABMAAAAA",
        "AAAAAAAABABVTkNPTkRJVElPTkFMTFkgUkVGVVNFUyAoc3BlYyDCpzMuMSwgdGhlIGRpcmVjdC1jYWxsIG5ldXRlciBmaXgpLgoKIyBXaHkgcmVmdXNpbmcgaXMgdGhlIG9ubHkgcmVlbnRyYW5jeS1zYWZlIGNob2ljZQoKVGhlIHByZS1maXggYHVuaW5zdGFsbGAgY2xlYXJlZCBgUmVjb3ZlcnlLZXk6Okluc3RhbGxlZChhY2NvdW50KWAgb24gYW55CmNhbGwgZ2F0ZWQgc29sZWx5IGJ5IGBzbWFydF9hY2NvdW50LnJlcXVpcmVfYXV0aCgpYC4gQSB0aGllZiBob2xkaW5nIGEKc3RvbGVuIFdlYkF1dGhuIHBhc3NrZXkgc2F0aXNmaWVzIHRoYXQsIHNvIGEgZGlyZWN0CmB1bmluc3RhbGwoYW55X3J1bGUsIGFjY291bnQpYCAodG9wLWxldmVsLCBvciB2aWEgdGhlIGFjY291bnQncwpgZXhlY3V0ZWApIGNsZWFyZWQgYEluc3RhbGxlZGAgd2hpbGUgdGhlIGFjY291bnQncyByZWNvdmVyeSBydWxlIHN0YXllZAppbnRhY3Qgb24tY2hhaW4gLS0gZXZlcnkgZnV0dXJlIGNvbXBsZXRpb24gYGVuZm9yY2VgIHRoZW4gcGFuaWNzCmBOb3RJbnN0YWxsZWRgLCBwZXJtYW5lbnRseSBuZXV0ZXJpbmcgcmVjb3ZlcnksIGluc3RhbnRseSwgYnlwYXNzaW5nIHRoZQpNMiBpbi1hY2NvdW50IGd1YXJkIGFuZCB0aGUgNy1kYXkgcmVtb3ZhbCBkZWxheS4KCkEgZGlzY3JpbWluYXRvciB0aGF0IFBBU1NFUyB0aGUgbGVnaXRpbWF0ZSB0ZWFyZG93biBidXQgRkFJTFMgYSB0aGllZidzCmRpcmVjdCBjYWxsIGlzIG5vdCBhY2hpZXZhYmxlIGF0IHRoaXMgY29udHJhY3Q6Ci0gVGhlIGFjY291bnQncyBvbi1jaGFpbiBzdGF0ZSAoZG9lcyB0aGUgcnVsZSBzdGlsbCByZWZlcmVuY2UgdGhpcwpjb250cm9sbGVyPyBoYXMgcmVtb3ZhbCBiZWVuIGFubm91bmNlZC1hbmQtZWxhcHNlZD8pIGlzIHRoZSBvbmx5IHRoaW5nCnRoYXQgZGlzdGluZ3Vpc2hlcyB0aGVtIC0tIGJ1dCBgdW5pbnN0YWxsYCBpcyBpbnZva2VkIGZyb20gV0lUSElOIHRoZQphY2NvdW50J3Mgb3duIGByZW1vdmVfY29udGV4dF9ydWxlYC9gcmVtb3ZlX3BvbGljeWAgKGFjY291AAAACXVuaW5zdGFsbAAAAAAAAAIAAAAAAAAADGNvbnRleHRfcnVsZQAAB9AAAAALQ29udGV4dFJ1bGUAAAAAAAAAAA1zbWFydF9hY2NvdW50AAAAAAAAEwAAAAA=",
        "AAAAAgAAAYdQZXJzaXN0ZW50IHN0b3JhZ2Uga2V5IHNwYWNlLiBgRnJvbnRpZXJgL2BSb290UmluZ2AvYFJpbmdIZWFkYC8KYE5leHRJbmRleGAgYXJlIHRoZSBkZXB0aC0yNCBpbmNyZW1lbnRhbC1NZXJrbGUgcG9vbCBzdGF0ZSAoc3BlYyDCpzMuNCwKYWRhcHRlZCBmcm9tIGBtaXhlci5yc2ApOyBgTnVsbGlmaWVyYC9gUGVuZGluZ2AvYENhbmNlbHNgIGFyZSBwZXItYWNjb3VudApyZWNvdmVyeSBzdGF0ZTsgYEluc3RhbGxlZGAgcmVjb3JkcyB3aGljaCBgQ29udGV4dFJ1bGVgIGlkIHRoaXMKY29udHJhY3QncyBgUG9saWN5YCB3YXMgaW5zdGFsbGVkIHVuZGVyIGZvciBhIGdpdmVuIGFjY291bnQgKHNwZWMgwqczLjEpOwpgQ29uZmlnYCBpcyB0aGUgaW1tdXRhYmxlIGBSZWNvdmVyeUNvbmZpZ2AuAAAAAAAAAAALUmVjb3ZlcnlLZXkAAAAADAAAAAAAAAAAAAAACEZyb250aWVyAAAAAAAAAAAAAAAJTmV4dEluZGV4AAAAAAAAAAAAAAAAAAAIUm9vdFJpbmcAAAAAAAAAAAAAAAhSaW5nSGVhZAAAAAEAAAAAAAAACU51bGxpZmllcgAAAAAAAAEAAAPuAAAAIAAAAAEAAAAAAAAAB1BlbmRpbmcAAAAAAQAAABMAAAABAAAAAAAAAAlJbnN0YWxsZWQAAAAAAAABAAAAEwAAAAEAAAAAAAAAB0NhbmNlbHMAAAAAAQAAABMAAAAAAAAAAAAAAAZDb25maWcAAAAAAAEAAAAAAAAABU5vbmNlAAAAAAAAAQAAABMAAAABAAAAAAAAAApSYXRlV2luZG93AAAAAAABAAAAEwAAAAEAAAAAAAAACkxhc3RDYW5jZWwAAAAAAAEAAAAT",
        "AAAABQAAAKlgaW5zZXJ0YC9gaW5zZXJ0X2ZvcmAgKHBvb2wucnMsIGxhdGVyIHRhc2spOiBhIG5ldyBsZWFmIGVudGVyZWQgdGhlIHRyZWUuCmBsZWFmYCBpcyB0aGUgb24tY2hhaW4td3JhcHBlZCBgc3RvcmVkYCB2YWx1ZSwgbm90IHRoZSBjbGllbnQtc3VwcGxpZWQKY29tbWl0bWVudCAoc3BlYyDCpzIuMikuAAAAAAAAAAAAAAxMZWFmSW5zZXJ0ZWQAAAABAAAADWxlYWZfaW5zZXJ0ZWQAAAAAAAACAAAAAAAAAAVpbmRleAAAAAAAAAQAAAABAAAAAAAAAARsZWFmAAAD7gAAACAAAAAAAAAAAg==",
        "AAAABAAAAQZDb250cmFjdCBlcnJvciBjb2RlcyAoc3BlYyDCpzMuMyBpbnRlcmZhY2UvY2hlY2tzLCDCpzMuMSBjb21wbGV0aW9uCmF1dGhvcml0eSwgwqcyLjIvwqcyLjMgbGVhZi9udWxsaWZpZXIgaW52YXJpYW50cykuIEdyb3VwZWQgYnkgdGhlIG1vZHVsZQp0aGF0IHJhaXNlcyB0aGVtOyBsYXRlciBNMSB0YXNrcyB3aWxsIGV4ZXJjaXNlIG1vc3Qgb2YgdGhlc2UgLS0gb25seSB0aGUKZW51bSBzaGFwZSBpcyBleGVyY2lzZWQgYnkgTTEgVGFzayAyJ3Mgc2NhZmZvbGQuAAAAAAAAAAAADVJlY292ZXJ5RXJyb3IAAAAAAAAWAAAAAAAAAAhUcmVlRnVsbAAAABUAAAAAAAAAFk5vbkNhbm9uaWNhbENvbW1pdG1lbnQAAAAAAAEAAAAAAAAADVBlbmRpbmdFeGlzdHMAAAAAAAACAAAAAAAAAAtVbmtub3duUm9vdAAAAAADAAAAAAAAABFOdWxsaWZpZXJSZXNlcnZlZAAAAAAAAAQAAAAAAAAADk51bGxpZmllclNwZW50AAAAAAAFAAAAAAAAAAxJbnZhbGlkTm9uY2UAAAAGAAAAAAAAABBUaW1lbG9ja1Rvb1Nob3J0AAAABwAAAAAAAAAQVGltZWxvY2tNaXNtYXRjaAAAAAgAAAAAAAAAC1JhdGVMaW1pdGVkAAAAAAkAAAAAAAAAElZlcmlmaWNhdGlvbkZhaWxlZAAAAAAACgAAAAAAAAAJTm9QZW5kaW5nAAAAAAAACwAAAAAAAAAQQ2FuY2VsQ2FwUmVhY2hlZAAAAAwAAAAAAAAADkNvb2xkb3duQWN0aXZlAAAAAAANAAAAAAAAAA9SZWNvdmVyeUV4cGlyZWQAAAAADgAAAAAAAAASVGltZWxvY2tOb3RFbGFwc2VkAAAAAAAPAAAAAAAAAA9Db250ZXh0TWlzbWF0Y2gAAAAAEAAAAAAAAAAMUnVsZU1pc21hdGNoAAAAEQAAAAAAAAAMTm90SW5zdGFsbGVkAAAAEgAAAAAAAAAQQWxyZWFkeUluc3RhbGxlZAAAABMAAAAAAAAADFVuYXV0aG9yaXplZAAAABQAAAAAAAAAGk51bGxpZmllclJlc2VydmVkRWxzZXdoZXJlAAAAAAAW",
        "AAAAAgAAARhMaWZlY3ljbGUgc3RhdGUgb2YgYSBudWxsaWZpZXIgKHNwZWMgwqcyLjMpLiBBYnNlbnQgZnJvbSBzdG9yYWdlIG1lYW5zCiJ1bnVzZWQiOyBgUmVzZXJ2ZWQoYWNjb3VudClgIG1lYW5zIGFuIGBpbml0aWF0ZV9yZWNvdmVyeWAgaGFzIHJldmVhbGVkCml0IGFuZCBpdCBpcyBib3VuZCB0byB0aGF0IGFjY291bnQncyBwZW5kaW5nIHJlY29yZDsgYFNwZW50YCBtZWFucyBhCmBjb21wbGV0ZV9yZWNvdmVyeWAgb3IgYGJ1cm5fbnVsbGlmaWVyYCBoYXMgcGVybWFuZW50bHkgY29uc3VtZWQgaXQuAAAAAAAAAA5OdWxsaWZpZXJTdGF0ZQAAAAAAAgAAAAEAAAAAAAAACFJlc2VydmVkAAAAAQAAABMAAAAAAAAAAAAAAAVTcGVudAAAAA==",
        "AAAAAQAABABJbW11dGFibGUtYXQtZGVwbG95IGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBwb29sICsgY29udHJvbGxlciAoc3BlYyDCpzMuMywKwqczLjQpLiBgZmFjdG9yeWAgaXMgdGhlIG9ubHkgY2FsbGVyIGFsbG93ZWQgdG8gYmluZCBhbiBhcmJpdHJhcnkgYWNjb3VudApvbiBgaW5zZXJ0YCAoZ2VuZXNpcyBhdXRob3JpdHkpOyBgdmVyaWZpZXJgIGlzIHRoZSBgemstdmVyaWZpZXJgCmNvbnRyYWN0J3MgYWRkcmVzczsgYG5ldHdvcmtfcGFzc3BocmFzZWAgaXMgdGhlIHJhdyAobm90IHByZS1oYXNoZWQpCm5ldHdvcmsgcGFzc3BocmFzZSBieXRlcyAtLSBgaGFzaDo6Y29tcHV0ZV9hdXRoX2hhc2hgIHNoYTI1NidzIGl0CmludGVybmFsbHksIGV4YWN0bHkgbWlycm9yaW5nIHRoZSBjaXJjdWl0J3MgYG5wYXNzX2hpYC9gbnBhc3NfbG9gCmRlcml2YXRpb24gKGBtYWluLm5yOjQwLTQyYCksIHNvIGBpbml0aWF0ZV9yZWNvdmVyeWAgbXVzdCByZWNvbXB1dGUKYGF1dGhfaGFzaGAgdXNpbmcgdGhlIFNBTUUgcGFzc3BocmFzZSBieXRlcyBhIHByb29mJ3Mgd2l0bmVzcyB3YXMKZ2VuZXJhdGVkIGFnYWluc3Q7IHRoZSByZW1haW5pbmcgZmllbGRzIGFyZSB0aGUgdGltZWxvY2svcmF0ZS1saW1pdApkZWZhdWx0cyAoc3BlYyDCpzMuMyAiRGVmYXVsdHMiKS4gYHdlYmF1dGhuX3ZlcmlmaWVyYCBpcyBhcHBlbmRlZCBieSBNMQpUYXNrIDcgKGBwb2xpY3kucnNgKTogdGhlIGBXZWJBdXRoblZlcmlmaWVyYCBjb250cmFjdCBhZGRyZXNzIHRoYXQgYQpjb21wbGV0ZWQgcmVjb3ZlcnkncyBuZXcgc2lnbmVyIG11c3QgYmUgYFNpZ25lcjo6RXh0ZXJuYWxgLWJvdW5kIHRvIC0tCmBQZW5kaW5nUmVjb3Zlcnk6Om5ld19wdWJrZXlgIChzcGVjIMKnMy4xKSBpcyBvbmx5IHRoZSByYXcgUC0yNTYgcHVibGljIGtleQpieXRlcywgbm90IGEgZnVsbCBgU2lnbmVyYCwgc28gYFBvbGljeTo6ZW5mb3JjZWAncyBhcmdzLWdhdGUgbmVlZHMgdGhpcyB0bwpyZWNvbnN0cnVjdCB0aGUgZXhhY3QgYFNpZ25lcmAgaXQgbXVzdCBtYXRjaCBhAAAAAAAAAA5SZWNvdmVyeUNvbmZpZwAAAAAACAAAAAAAAAAWY29tcGxldGlvbl93aW5kb3dfc2VjcwAAAAAABgAAAAAAAAAKZGVsYXlfc2VjcwAAAAAABgAAAAAAAAAHZmFjdG9yeQAAAAATAAAAAAAAAAttYXhfY2FuY2VscwAAAAAEAAAAAAAAABJuZXR3b3JrX3Bhc3NwaHJhc2UAAAAAAA4AAAAAAAAAE3RpbWVsb2NrX2Zsb29yX3NlY3MAAAAABgAAAAAAAAAIdmVyaWZpZXIAAAATAAAAAAAAABF3ZWJhdXRobl92ZXJpZmllcgAAAAAAABM=",
        "AAAAAQAAARxBIGxpdmUgdGltZWxvY2tlZCByZWNvdmVyeSBpbiBmbGlnaHQgZm9yIG9uZSBhY2NvdW50IChzcGVjIMKnMy4zCmBpbml0aWF0ZV9yZWNvdmVyeWApLiBgbmV3X3B1YmtleWAgaXMgc3RhZ2VkLCBub3QgeWV0IGluc3RhbGxlZDsgdGhlCmFjY291bnQncyBvd24gYG51bGxpZmllcmAgcmVzZXJ2YXRpb24gbGl2ZXMgaW4gYE51bGxpZmllclN0YXRlYCwgbm90CmhlcmUsIHNvIGEgY2FuY2VsIGNhbiByZWxlYXNlIGl0IHdpdGhvdXQgbG9zaW5nIHRoZSBwZW5kaW5nIHJlY29yZCdzCmF1ZGl0IHRyYWlsLgAAAAAAAAAPUGVuZGluZ1JlY292ZXJ5AAAAAAUAAAAAAAAAEGV4ZWN1dGFibGVfYWZ0ZXIAAAAGAAAAAAAAAApleHBpcmVzX2F0AAAAAAAGAAAAAAAAAAxpbml0aWF0ZWRfYXQAAAAGAAAAAAAAAApuZXdfcHVia2V5AAAAAAPuAAAAQQAAAAAAAAAJbnVsbGlmaWVyAAAAAAAD7gAAACA=",
        "AAAABQAAAYJgYnVybl9udWxsaWZpZXJgIChjb250cm9sbGVyLnJzKTogcHJvb2YtZ2F0ZWQgUkVWT0tFIChhbiBgYWN0aW9uPTNgIFpLCnByb29mIG9mIGtub3dsZWRnZSBvZiB0aGUgbnVsbGlmaWVyJ3Mgc2VjcmV0LCBwbHVzIGFjY291bnQgYXV0aCkgdGhhdApzcGVuZHMgYSAocG9zc2libHkgbGVha2VkKSBlbnJvbGxtZW50IHNlY3JldCdzIG51bGxpZmllciB3aXRob3V0IHdhaXRpbmcKb3V0IGEgc2VsZi1yZWNvdmVyeSAtLSBwcm9vZi1nYXRpbmcgKG5vdCBhY2NvdW50LWF1dGggYWxvbmUpIGlzIHdoYXQKcHJldmVudHMgYSB0aGlyZCBwYXJ0eSBmcm9tIGJ1cm5pbmcgYSB2aWN0aW0ncyBQVUJMSUMgbnVsbGlmaWVyIGFmdGVyIGEKbGVnaXRpbWF0ZSBjYW5jZWwgKHNwZWMgwqcyLjMpLgAAAAAAAAAAAA9OdWxsaWZpZXJCdXJuZWQAAAAAAQAAABBudWxsaWZpZXJfYnVybmVkAAAAAgAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAJbnVsbGlmaWVyAAAAAAAD7gAAACAAAAAAAAAAAg==",
        "AAAABQAAAC5gY2FuY2VsX3JlY292ZXJ5YCAoY29udHJvbGxlci5ycywgbGF0ZXIgdGFzaykuAAAAAAAAAAAAEFJlY292ZXJ5Q2FuY2VsZWQAAAABAAAAEXJlY292ZXJ5X2NhbmNlbGVkAAAAAAAAAgAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAMY2FuY2Vsc191c2VkAAAABAAAAAAAAAAC",
        "AAAABQAAAF9gUG9saWN5OjplbmZvcmNlYCBjb21wbGV0aW9uIChwb2xpY3kucnMsIGxhdGVyIHRhc2spOiB0aGUgbnVsbGlmaWVyIGlzCm5vdyBwZXJtYW5lbnRseSBgU3BlbnRgLgAAAAAAAAAAEVJlY292ZXJ5Q29tcGxldGVkAAAAAAAAAQAAABJyZWNvdmVyeV9jb21wbGV0ZWQAAAAAAAIAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAAAAAAACW51bGxpZmllcgAAAAAAA+4AAAAgAAAAAAAAAAI=",
        "AAAABQAAALFgaW5pdGlhdGVfcmVjb3ZlcnlgIChjb250cm9sbGVyLnJzLCBsYXRlciB0YXNrKS4gV2FsbGV0cyBzdXJmYWNlIHRoaXMgYXMKdGhlIGNhbmNlbC1vci1sb3NlIGFsYXJtIChzcGVjIMKnMy4zKTsgdGhlIG5ldyBwdWJrZXkgaXRzZWxmIGlzIG5vdAplbWl0dGVkIGluIHRoZSBjbGVhciwgb25seSBpdHMgaGFzaC4AAAAAAAAAAAAAEVJlY292ZXJ5SW5pdGlhdGVkAAAAAAAAAQAAABJyZWNvdmVyeV9pbml0aWF0ZWQAAAAAAAMAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAAAAAAAD25ld19wdWJrZXlfaGFzaAAAAAPuAAAAIAAAAAAAAAAAAAAAEGV4ZWN1dGFibGVfYWZ0ZXIAAAAGAAAAAAAAAAI=",
        "AAAAAQAAAeRJbnN0YWxsIHBhcmFtZXRlcnMgZm9yIHRoZSBgWmtSZWNvdmVyeWAgY29tcGxldGlvbiBgUG9saWN5YCAoc3BlYyDCpzMuMSwKTTEgVGFzayA3KS4gVGhlIHBvbGljeSdzIGVuZm9yY2VtZW50IGJlaGF2aW9yIGlzIGZ1bGx5IGRldGVybWluZWQgYnkgdGhlCnNoYXJlZCBgUmVjb3ZlcnlDb25maWdgIGFuZCB0aGUgYWNjb3VudCdzIG93biBgUGVuZGluZ1JlY292ZXJ5YCBzdGF0ZSwgc28KdGhpcyBjYXJyaWVzIG5vIHJlYWwgY29uZmlndXJhdGlvbiB0b2RheSAtLSBgdmVyc2lvbmAgZXhpc3RzIG9ubHkgdG8KbWlycm9yIGBtdWx0aXNpZy1wb2xpY3lgJ3MgYEFjY291bnRQYXJhbXNgIHNoYXBlIChhIG5vbi10cml2aWFsLApgRnJvbVZhbGAtZGVjb2RhYmxlIGluc3RhbGwtcGFyYW1zIHR5cGUpIGFuZCB0byBsZWF2ZSByb29tIGZvciBmdXR1cmUKdmVyc2lvbmluZyB3aXRob3V0IGNoYW5naW5nIHRoZSBgUG9saWN5OjppbnN0YWxsYCBzaWduYXR1cmUuAAAAAAAAABdaa1JlY292ZXJ5SW5zdGFsbFBhcmFtcwAAAAABAAAAAAAAAAd2ZXJzaW9uAAAAAAQ=",
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
    next_nonce: this.txFromJSON<u64>,
        get_pending: this.txFromJSON<Option<PendingRecovery>>,
        has_pending: this.txFromJSON<boolean>,
        cancels_used: this.txFromJSON<u32>,
        burn_nullifier: this.txFromJSON<null>,
        cancel_recovery: this.txFromJSON<u32>,
        initiate_recovery: this.txFromJSON<u64>,
        insert: this.txFromJSON<u32>,
        insert_for: this.txFromJSON<u32>,
        next_index: this.txFromJSON<u32>,
        current_root: this.txFromJSON<Buffer>,
        is_known_root: this.txFromJSON<boolean>,
        enforce: this.txFromJSON<null>,
        install: this.txFromJSON<null>,
        uninstall: this.txFromJSON<null>
  }
}