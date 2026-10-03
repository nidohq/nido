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
 * One lost-key or compromise recovery attempt (spec §6.3 T1).
 */
export interface Attempt {
  /**
 * `LostKey` or `Compromise`.
 */
action: RecoveryAction;
  /**
 * Set at authorization; `0` while collecting.
 */
authorized_at: u32;
  /**
 * Distinct enrolled guardians that approved the cancel statement.
 */
cancel_guardians: Array<string>;
  /**
 * The `Cancel` statement's freshness bound: never earlier than the
 * attempt's last live ledger.
 */
cancel_until: u32;
  /**
 * Whether a cancellation proof was accepted.
 */
cancel_zk: boolean;
  created_at: u32;
  /**
 * The epoch the attempt was opened under; it is dead under any other.
 */
epoch: u64;
  /**
 * Last ledger (inclusive) initiation evidence is accepted.
 */
evidence_deadline: u32;
  /**
 * First completable ledger; `0` while collecting.
 */
executable_after: u32;
  /**
 * First ledger the authorized attempt is no longer live; `0` while
 * collecting.
 */
expires_at: u32;
  /**
 * Distinct enrolled guardians that approved the initiation statement.
 */
guardians: Array<string>;
  /**
 * Per-account, never reused.
 */
id: u64;
  /**
 * `ReplacementSet::hash` of the declared replacements.
 */
replacements_hash: Buffer;
  /**
 * Lost-key: the applied document's hash at T1. Compromise: the
 * baseline's hash.
 */
source_doc_hash: Buffer;
  state: AttemptState;
  /**
 * The derived target's recovery `config_hash` (the current one, or the
 * current one with the declared ZK rotation).
 */
target_config_hash: Buffer;
  /**
 * The derived target's canonical hash.
 */
target_doc_hash: Buffer;
  /**
 * The nullifier of the initiation proof, once one was accepted. A
 * completion spends it.
 */
zk_nullifier: Option<Buffer>;
}


/**
 * What recovery currently restricts for an account (the controller's
 * `activity_gate` view, for clients; the account enforces the freeze from
 * its own mirror).
 */
export interface ActivityGate {
  /**
 * The authorized, live attempt, if any. While it is set, policy
 * changes and upgrades are refused in both profiles.
 */
authorized_attempt: Option<u64>;
  /**
 * `Protected` with an authorized attempt: the account authorizes
 * nothing but that attempt's completion.
 */
frozen: boolean;
  /**
 * The authorized attempt's `expires_at`; `0` when none is authorized.
 */
until: u32;
}

/**
 * An attempt's stored state. `Expired` and `Invalidated` are not states:
 * they are derived from the ledger, the account's epoch, and its
 * `invalidate_below` (see `contract::is_live`), so no transition can leave
 * them out of date.
 */
export type AttemptState = {tag: "Collecting", values: void} | {tag: "Authorized", values: void} | {tag: "Completed", values: void} | {tag: "Cancelled", values: void};


/**
 * Evidence recorded for one `Reconfigure` or `Upgrade` statement digest
 * (spec §5). Consumed by `rcv_sync`/`rcv_upgrade`, which rebuild the digest
 * from the change actually being made.
 */
export interface ChangeApproval {
  guardians: Array<string>;
  zk: boolean;
}

/**
 * Which evidence an attempt-bound submission counts toward.
 */
export enum EvidenceDomain {
  Initiate = 0,
  Cancel = 1,
}







/**
 * What `rcv_sync` did, so the account knows which of its own effects to
 * apply (spec §10).
 */
export type SyncOutcome = {tag: "Unchanged", values: void} | {tag: "Enrolled", values: void} | {tag: "Reconfigured", values: void} | {tag: "Removed", values: void} | {tag: "Completed", values: readonly [u64]};

/**
 * Which phase of an account upgrade `rcv_upgrade` is checking (spec §12).
 */
export type UpgradeStep = {tag: "Schedule", values: readonly [UpgradeSubject, u32]} | {tag: "Execute", values: readonly [u64]};

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
   * An attempt is authorized and live: begin, policy changes, and upgrades are refused until it completes, is cancelled, or expires.
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
   * The configuration is malformed (for example, the account is one of its own guardians, or the quorum is out of range).
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
   * The policy was attached to a context rule of the wrong shape.
   */
  30: {message:"MalformedContextRule"}
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
 * `sha256("perch/recovery/config" || canonical JSON of the recovery
 * member)`, computed by the doc compiler (spec §3.2). Configuration
 * identity: two compiled configurations with the same `config_hash` are
 * the same configuration.
 */
config_hash: Buffer;
  /**
 * The adopted controller instance.
 */
controller: string;
  delay_ledgers: u32;
  expiry_ledgers: u32;
  max_cancels: u32;
  mode: CompiledRecoveryMode;
  profile: RecoveryProfile;
  /**
 * Signer ids (not credential fingerprints) a recovery may replace, so
 * rotating a key does not change the configuration (#92).
 */
replaceable: Array<string>;
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
 * `sha256` of the canonical JSON of the enrolled document's `recovery`
 * section (`docs/recovery/spec.md` §3.2). Binds
 * the whole configuration: profile, mode, guardians, quorum, ZK
 * adapter/pool/enrollment, controller, baseline, replaceable signer
 * ids, and timing.
 */
config_hash: Buffer;
  /**
 * The controller's per-account configuration epoch. It increments on
 * every enrollment, reconfiguration, removal, and completed recovery, so
 * evidence produced under one epoch is dead under every later one.
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
  subject: StatementSubject;
  timing: StatementTiming;
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
   * Construct and simulate a epoch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The account's configuration epoch (spec §3.3).
   */
  epoch: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a renew transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend every persistent entry the account's recovery depends on to
   * the network maximum (spec T10). Permissionless; changes no meaning.
   */
  renew: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The account's configuration at this controller.
   */
  config: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<CompiledRecoveryConfig>>>

  /**
   * Construct and simulate a attempt transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * An attempt's stored record, live or not.
   */
  attempt: ({account, attempt_id}: {account: string, attempt_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Attempt>>>

  /**
   * Construct and simulate a enforce transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * T5: authorize the completing `apply_doc`. The recovery rule has no
   * signers, so this is the whole check: the context must be this
   * account's `apply_doc` of the authorized attempt's exact target bytes,
   * inside the completion window. It then leaves a marker that only the
   * same invocation's `rcv_sync` consumes.
   */
  enforce: ({context, authenticated_signers, context_rule, smart_account}: {context: Context, authenticated_signers: Array<Signer>, context_rule: ContextRule, smart_account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a install transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Bookkeeping only: `rcv_sync` already wrote the configuration, earlier
   * in the same `apply_doc`. Checks that the recovery rule has the
   * required shape and was installed for the stored configuration.
   */
  install: ({install_params, context_rule, smart_account}: {install_params: Buffer, context_rule: ContextRule, smart_account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a baseline transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The published content of the enrolled baseline, if any.
   */
  baseline: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a rcv_sync transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The recovery side of the account's `apply_doc` (spec §10). Called
   * before any context rule changes. Classifies the call as exactly one of
   * completion, no change, enrollment, reconfiguration, or removal, and
   * writes this controller's state for it.
   */
  rcv_sync: ({account, doc_hash, recovery, approval_valid_until}: {account: string, doc_hash: Buffer, recovery: Array<CompiledRecoveryConfig>, approval_valid_until: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<SyncOutcome>>>

  /**
   * Construct and simulate a statement transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The exact statement evidence for an attempt must sign or prove in
   * `domain`.
   */
  statement: ({account, attempt_id, domain}: {account: string, attempt_id: u64, domain: EvidenceDomain}, options?: MethodOptions) => Promise<AssembledTransaction<Result<RecoveryStatement>>>

  /**
   * Construct and simulate a submit_zk transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * T3: a ZK proof for an attempt's statement in `domain`.
   * Permissionless: the proof is the authorization.
   */
  submit_zk: ({account, attempt_id, domain, evidence}: {account: string, attempt_id: u64, domain: EvidenceDomain, evidence: ZkEvidence}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a uninstall transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Writes nothing: OZ discards `uninstall` failures, so it can gate
   * nothing, and removal is decided by `rcv_sync`. Invoker-only like every
   * hook, so no signature can call it either.
   */
  uninstall: ({context_rule, smart_account}: {context_rule: ContextRule, smart_account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a rcv_cancel transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * T7: a `Loss` owner cancels an attempt, through the account's
   * `cancel_recovery`. Never counted toward `max-cancels`.
   */
  rcv_cancel: ({account, attempt_id}: {account: string, attempt_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a rcv_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The controller's half of the account's upgrade entry points
   * (spec §12). Both steps are refused while an attempt is authorized.
   * `Schedule` checks the recorded condition under `Protected` and
   * returns the epoch the request binds; `Execute` refuses a request
   * recorded under another epoch, then bumps the epoch and returns the
   * new one.
   */
  rcv_upgrade: ({account, step}: {account: string, step: UpgradeStep}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a attempt_live transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Whether an attempt is live (spec §6.2).
   */
  attempt_live: ({account, attempt_id}: {account: string, attempt_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a activity_gate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * What recovery currently restricts for the account.
   */
  activity_gate: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<ActivityGate>>

  /**
   * Construct and simulate a approve_change transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One guardian's approval of a `Reconfigure` or `Upgrade` statement,
   * fresh until `valid_until`. Recorded by digest for the consuming
   * `rcv_sync`/`rcv_upgrade`.
   */
  approve_change: ({account, subject, valid_until, guardian}: {account: string, subject: StatementSubject, valid_until: u32, guardian: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a begin_lost_key transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * T1, lost-key: the target is the applied document with `replacements`
   * applied. Permissionless. Returns the attempt id.
   */
  begin_lost_key: ({account, replacements}: {account: string, replacements: ReplacementSet}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a change_evidence transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Recorded evidence for a change statement digest.
   */
  change_evidence: ({account, digest}: {account: string, digest: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<ChangeApproval>>

  /**
   * Construct and simulate a next_attempt_id transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The id the next `begin_*` will assign.
   */
  next_attempt_id: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a nullifier_spent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Whether `account` spent `nullifier` (spec §11).
   */
  nullifier_spent: ({account, nullifier}: {account: string, nullifier: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a renew_nullifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend a spent nullifier's record to the network maximum.
   */
  renew_nullifier: ({account, nullifier}: {account: string, nullifier: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a submit_guardian transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * T2: one guardian's approval of an attempt's statement in `domain`.
   * The guardian authorizes `require_auth_for_args((digest,))` for
   * exactly that statement.
   */
  submit_guardian: ({account, attempt_id, domain, guardian}: {account: string, attempt_id: u64, domain: EvidenceDomain, guardian: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a begin_compromise transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * T1, compromise: the target is the published baseline's signers and
   * rules, with the current recovery member and `replacements` applied.
   * Permissionless. Returns the attempt id.
   */
  begin_compromise: ({account, replacements}: {account: string, replacements: ReplacementSet}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a change_statement transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The exact statement a `Reconfigure` or `Upgrade` approval must sign
   * or prove.
   */
  change_statement: ({account, subject, valid_until}: {account: string, subject: StatementSubject, valid_until: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<RecoveryStatement>>>

  /**
   * Construct and simulate a publish_baseline transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Store the enrolled baseline's canonical bytes (spec §3.5).
   * Permissionless: `doc_json` must compile, through the account's own
   * compiler, to exactly the enrolled baseline hash and keep an admin
   * rule. Publishing changes no authority.
   */
  publish_baseline: ({account, doc_json}: {account: string, doc_json: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a submit_zk_change transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * A ZK proof for a `Reconfigure` or `Upgrade` statement, fresh until
   * `valid_until`. Permissionless. Does not spend the nullifier.
   */
  submit_zk_change: ({account, subject, valid_until, evidence}: {account: string, subject: StatementSubject, valid_until: u32, evidence: ZkEvidence}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
      new ContractSpec([ "AAAAAQAAADxPbmUgbG9zdC1rZXkgb3IgY29tcHJvbWlzZSByZWNvdmVyeSBhdHRlbXB0IChzcGVjIMKnNi4zIFQxKS4AAAAAAAAAB0F0dGVtcHQAAAAAEgAAABpgTG9zdEtleWAgb3IgYENvbXByb21pc2VgLgAAAAAABmFjdGlvbgAAAAAH0AAAAA5SZWNvdmVyeUFjdGlvbgAAAAAAK1NldCBhdCBhdXRob3JpemF0aW9uOyBgMGAgd2hpbGUgY29sbGVjdGluZy4AAAAADWF1dGhvcml6ZWRfYXQAAAAAAAAEAAAAP0Rpc3RpbmN0IGVucm9sbGVkIGd1YXJkaWFucyB0aGF0IGFwcHJvdmVkIHRoZSBjYW5jZWwgc3RhdGVtZW50LgAAAAAQY2FuY2VsX2d1YXJkaWFucwAAA+oAAAATAAAAXFRoZSBgQ2FuY2VsYCBzdGF0ZW1lbnQncyBmcmVzaG5lc3MgYm91bmQ6IG5ldmVyIGVhcmxpZXIgdGhhbiB0aGUKYXR0ZW1wdCdzIGxhc3QgbGl2ZSBsZWRnZXIuAAAADGNhbmNlbF91bnRpbAAAAAQAAAAqV2hldGhlciBhIGNhbmNlbGxhdGlvbiBwcm9vZiB3YXMgYWNjZXB0ZWQuAAAAAAAJY2FuY2VsX3prAAAAAAAAAQAAAAAAAAAKY3JlYXRlZF9hdAAAAAAABAAAAENUaGUgZXBvY2ggdGhlIGF0dGVtcHQgd2FzIG9wZW5lZCB1bmRlcjsgaXQgaXMgZGVhZCB1bmRlciBhbnkgb3RoZXIuAAAAAAVlcG9jaAAAAAAAAAYAAAA4TGFzdCBsZWRnZXIgKGluY2x1c2l2ZSkgaW5pdGlhdGlvbiBldmlkZW5jZSBpcyBhY2NlcHRlZC4AAAARZXZpZGVuY2VfZGVhZGxpbmUAAAAAAAAEAAAAL0ZpcnN0IGNvbXBsZXRhYmxlIGxlZGdlcjsgYDBgIHdoaWxlIGNvbGxlY3RpbmcuAAAAABBleGVjdXRhYmxlX2FmdGVyAAAABAAAAExGaXJzdCBsZWRnZXIgdGhlIGF1dGhvcml6ZWQgYXR0ZW1wdCBpcyBubyBsb25nZXIgbGl2ZTsgYDBgIHdoaWxlCmNvbGxlY3RpbmcuAAAACmV4cGlyZXNfYXQAAAAAAAQAAABDRGlzdGluY3QgZW5yb2xsZWQgZ3VhcmRpYW5zIHRoYXQgYXBwcm92ZWQgdGhlIGluaXRpYXRpb24gc3RhdGVtZW50LgAAAAAJZ3VhcmRpYW5zAAAAAAAD6gAAABMAAAAaUGVyLWFjY291bnQsIG5ldmVyIHJldXNlZC4AAAAAAAJpZAAAAAAABgAAADRgUmVwbGFjZW1lbnRTZXQ6Omhhc2hgIG9mIHRoZSBkZWNsYXJlZCByZXBsYWNlbWVudHMuAAAAEXJlcGxhY2VtZW50c19oYXNoAAAAAAAD7gAAACAAAABNTG9zdC1rZXk6IHRoZSBhcHBsaWVkIGRvY3VtZW50J3MgaGFzaCBhdCBUMS4gQ29tcHJvbWlzZTogdGhlCmJhc2VsaW5lJ3MgaGFzaC4AAAAAAAAPc291cmNlX2RvY19oYXNoAAAAA+4AAAAgAAAAAAAAAAVzdGF0ZQAAAAAAB9AAAAAMQXR0ZW1wdFN0YXRlAAAAcFRoZSBkZXJpdmVkIHRhcmdldCdzIHJlY292ZXJ5IGBjb25maWdfaGFzaGAgKHRoZSBjdXJyZW50IG9uZSwgb3IgdGhlCmN1cnJlbnQgb25lIHdpdGggdGhlIGRlY2xhcmVkIFpLIHJvdGF0aW9uKS4AAAASdGFyZ2V0X2NvbmZpZ19oYXNoAAAAAAPuAAAAIAAAACRUaGUgZGVyaXZlZCB0YXJnZXQncyBjYW5vbmljYWwgaGFzaC4AAAAPdGFyZ2V0X2RvY19oYXNoAAAAA+4AAAAgAAAAVVRoZSBudWxsaWZpZXIgb2YgdGhlIGluaXRpYXRpb24gcHJvb2YsIG9uY2Ugb25lIHdhcyBhY2NlcHRlZC4gQQpjb21wbGV0aW9uIHNwZW5kcyBpdC4AAAAAAAAMemtfbnVsbGlmaWVyAAAD6AAAA+4AAAAg",
        "AAAAAQAAAJtXaGF0IHJlY292ZXJ5IGN1cnJlbnRseSByZXN0cmljdHMgZm9yIGFuIGFjY291bnQgKHRoZSBjb250cm9sbGVyJ3MKYGFjdGl2aXR5X2dhdGVgIHZpZXcsIGZvciBjbGllbnRzOyB0aGUgYWNjb3VudCBlbmZvcmNlcyB0aGUgZnJlZXplIGZyb20KaXRzIG93biBtaXJyb3IpLgAAAAAAAAAADEFjdGl2aXR5R2F0ZQAAAAMAAABwVGhlIGF1dGhvcml6ZWQsIGxpdmUgYXR0ZW1wdCwgaWYgYW55LiBXaGlsZSBpdCBpcyBzZXQsIHBvbGljeQpjaGFuZ2VzIGFuZCB1cGdyYWRlcyBhcmUgcmVmdXNlZCBpbiBib3RoIHByb2ZpbGVzLgAAABJhdXRob3JpemVkX2F0dGVtcHQAAAAAA+gAAAAGAAAAZWBQcm90ZWN0ZWRgIHdpdGggYW4gYXV0aG9yaXplZCBhdHRlbXB0OiB0aGUgYWNjb3VudCBhdXRob3JpemVzCm5vdGhpbmcgYnV0IHRoYXQgYXR0ZW1wdCdzIGNvbXBsZXRpb24uAAAAAAAABmZyb3plbgAAAAAAAQAAAENUaGUgYXV0aG9yaXplZCBhdHRlbXB0J3MgYGV4cGlyZXNfYXRgOyBgMGAgd2hlbiBub25lIGlzIGF1dGhvcml6ZWQuAAAAAAV1bnRpbAAAAAAAAAQ=",
        "AAAAAgAAAOBBbiBhdHRlbXB0J3Mgc3RvcmVkIHN0YXRlLiBgRXhwaXJlZGAgYW5kIGBJbnZhbGlkYXRlZGAgYXJlIG5vdCBzdGF0ZXM6CnRoZXkgYXJlIGRlcml2ZWQgZnJvbSB0aGUgbGVkZ2VyLCB0aGUgYWNjb3VudCdzIGVwb2NoLCBhbmQgaXRzCmBpbnZhbGlkYXRlX2JlbG93YCAoc2VlIGBjb250cmFjdDo6aXNfbGl2ZWApLCBzbyBubyB0cmFuc2l0aW9uIGNhbiBsZWF2ZQp0aGVtIG91dCBvZiBkYXRlLgAAAAAAAAAMQXR0ZW1wdFN0YXRlAAAABAAAAAAAAAA3T3BlbmVkOyBjb2xsZWN0aW5nIGluaXRpYXRpb24gZXZpZGVuY2UuIEJsb2NrcyBub3RoaW5nLgAAAAAKQ29sbGVjdGluZwAAAAAAAAAAAD5UaGUgY29uZGl0aW9uIHdhcyBzYXRpc2ZpZWQ6IHRpbWVsb2NrLCB0aGVuIGNvbXBsZXRpb24gd2luZG93LgAAAAAACkF1dGhvcml6ZWQAAAAAAAAAAAAnQ29tcGxldGVkIGJ5IHRoZSBhY2NvdW50J3MgYGFwcGx5X2RvY2AuAAAAAAlDb21wbGV0ZWQAAAAAAAAAAAAAP0NhbmNlbGxlZCBieSBldmlkZW5jZSAoVDYpIG9yLCB1bmRlciBgTG9zc2AsIGJ5IHRoZSBvd25lciAoVDcpLgAAAAAJQ2FuY2VsbGVkAAAA",
        "AAAAAQAAALVFdmlkZW5jZSByZWNvcmRlZCBmb3Igb25lIGBSZWNvbmZpZ3VyZWAgb3IgYFVwZ3JhZGVgIHN0YXRlbWVudCBkaWdlc3QKKHNwZWMgwqc1KS4gQ29uc3VtZWQgYnkgYHJjdl9zeW5jYC9gcmN2X3VwZ3JhZGVgLCB3aGljaCByZWJ1aWxkIHRoZSBkaWdlc3QKZnJvbSB0aGUgY2hhbmdlIGFjdHVhbGx5IGJlaW5nIG1hZGUuAAAAAAAAAAAAAA5DaGFuZ2VBcHByb3ZhbAAAAAAAAgAAAAAAAAAJZ3VhcmRpYW5zAAAAAAAD6gAAABMAAAAAAAAAAnprAAAAAAAB",
        "AAAAAwAAADlXaGljaCBldmlkZW5jZSBhbiBhdHRlbXB0LWJvdW5kIHN1Ym1pc3Npb24gY291bnRzIHRvd2FyZC4AAAAAAAAAAAAADkV2aWRlbmNlRG9tYWluAAAAAAACAAAAO1RoZSBhdHRlbXB0J3Mgb3duIGBMb3N0S2V5YC9gQ29tcHJvbWlzZWAgc3RhdGVtZW50IChUMi1UNCkuAAAAAAhJbml0aWF0ZQAAAAAAAAAmVGhlIGF0dGVtcHQncyBgQ2FuY2VsYCBzdGF0ZW1lbnQgKFQ2KS4AAAAAAAZDYW5jZWwAAAAAAAE=",
        "AAAAAAAAAC9UaGUgYWNjb3VudCdzIGNvbmZpZ3VyYXRpb24gZXBvY2ggKHNwZWMgwqczLjMpLgAAAAAFZXBvY2gAAAAAAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAABg==",
        "AAAAAAAAAIZFeHRlbmQgZXZlcnkgcGVyc2lzdGVudCBlbnRyeSB0aGUgYWNjb3VudCdzIHJlY292ZXJ5IGRlcGVuZHMgb24gdG8KdGhlIG5ldHdvcmsgbWF4aW11bSAoc3BlYyBUMTApLiBQZXJtaXNzaW9ubGVzczsgY2hhbmdlcyBubyBtZWFuaW5nLgAAAAAABXJlbmV3AAAAAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAA==",
        "AAAAAAAAAC9UaGUgYWNjb3VudCdzIGNvbmZpZ3VyYXRpb24gYXQgdGhpcyBjb250cm9sbGVyLgAAAAAGY29uZmlnAAAAAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAD6AAAB9AAAAAWQ29tcGlsZWRSZWNvdmVyeUNvbmZpZwAA",
        "AAAABQAAABpUMTogYW4gYXR0ZW1wdCB3YXMgb3BlbmVkLgAAAAAAAAAAAAxBdHRlbXB0QmVndW4AAAABAAAADWF0dGVtcHRfYmVndW4AAAAAAAAEAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAAAAAAAAphdHRlbXB0X2lkAAAAAAAGAAAAAAAAAAAAAAAGYWN0aW9uAAAAAAfQAAAADlJlY292ZXJ5QWN0aW9uAAAAAAAAAAAAAAAAAA90YXJnZXRfZG9jX2hhc2gAAAAD7gAAACAAAAAAAAAAAg==",
        "AAAAAAAAAChBbiBhdHRlbXB0J3Mgc3RvcmVkIHJlY29yZCwgbGl2ZSBvciBub3QuAAAAB2F0dGVtcHQAAAAAAgAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAAphdHRlbXB0X2lkAAAAAAAGAAAAAQAAA+gAAAfQAAAAB0F0dGVtcHQA",
        "AAAAAAAAATFUNTogYXV0aG9yaXplIHRoZSBjb21wbGV0aW5nIGBhcHBseV9kb2NgLiBUaGUgcmVjb3ZlcnkgcnVsZSBoYXMgbm8Kc2lnbmVycywgc28gdGhpcyBpcyB0aGUgd2hvbGUgY2hlY2s6IHRoZSBjb250ZXh0IG11c3QgYmUgdGhpcwphY2NvdW50J3MgYGFwcGx5X2RvY2Agb2YgdGhlIGF1dGhvcml6ZWQgYXR0ZW1wdCdzIGV4YWN0IHRhcmdldCBieXRlcywKaW5zaWRlIHRoZSBjb21wbGV0aW9uIHdpbmRvdy4gSXQgdGhlbiBsZWF2ZXMgYSBtYXJrZXIgdGhhdCBvbmx5IHRoZQpzYW1lIGludm9jYXRpb24ncyBgcmN2X3N5bmNgIGNvbnN1bWVzLgAAAAAAAAdlbmZvcmNlAAAAAAQAAAAAAAAAB2NvbnRleHQAAAAH0AAAAAdDb250ZXh0AAAAAAAAAAAVYXV0aGVudGljYXRlZF9zaWduZXJzAAAAAAAD6gAAB9AAAAAGU2lnbmVyAAAAAAAAAAAADGNvbnRleHRfcnVsZQAAB9AAAAALQ29udGV4dFJ1bGUAAAAAAAAAAA1zbWFydF9hY2NvdW50AAAAAAAAEwAAAAA=",
        "AAAAAAAAAMNCb29ra2VlcGluZyBvbmx5OiBgcmN2X3N5bmNgIGFscmVhZHkgd3JvdGUgdGhlIGNvbmZpZ3VyYXRpb24sIGVhcmxpZXIKaW4gdGhlIHNhbWUgYGFwcGx5X2RvY2AuIENoZWNrcyB0aGF0IHRoZSByZWNvdmVyeSBydWxlIGhhcyB0aGUKcmVxdWlyZWQgc2hhcGUgYW5kIHdhcyBpbnN0YWxsZWQgZm9yIHRoZSBzdG9yZWQgY29uZmlndXJhdGlvbi4AAAAAB2luc3RhbGwAAAAAAwAAAAAAAAAOaW5zdGFsbF9wYXJhbXMAAAAAA+4AAAAgAAAAAAAAAAxjb250ZXh0X3J1bGUAAAfQAAAAC0NvbnRleHRSdWxlAAAAAAAAAAANc21hcnRfYWNjb3VudAAAAAAAABMAAAAA",
        "AAAABQAAAK9UOTogdGhlIGFjY291bnQncyBjb25maWd1cmF0aW9uIGF0IHRoaXMgY29udHJvbGxlciBjaGFuZ2VkIChlbnJvbGxlZCwKcmVjb25maWd1cmVkLCBvciByZW1vdmVkKSwgb3IgYW4gdXBncmFkZSBleGVjdXRlZC4gYGNvbmZpZ19oYXNoYCBpcyB0aGUKY29uZmlndXJhdGlvbiBub3cgc3RvcmVkLCBpZiBhbnkuAAAAAAAAAAANRXBvY2hBZHZhbmNlZAAAAAAAAAEAAAAOZXBvY2hfYWR2YW5jZWQAAAAAAAMAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAAAAAAABWVwb2NoAAAAAAAABgAAAAAAAAAAAAAAC2NvbmZpZ19oYXNoAAAAA+gAAAPuAAAAIAAAAAAAAAAC",
        "AAAAAAAAADdUaGUgcHVibGlzaGVkIGNvbnRlbnQgb2YgdGhlIGVucm9sbGVkIGJhc2VsaW5lLCBpZiBhbnkuAAAAAAhiYXNlbGluZQAAAAEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAPoAAAADg==",
        "AAAAAAAAAPRUaGUgcmVjb3Zlcnkgc2lkZSBvZiB0aGUgYWNjb3VudCdzIGBhcHBseV9kb2NgIChzcGVjIMKnMTApLiBDYWxsZWQKYmVmb3JlIGFueSBjb250ZXh0IHJ1bGUgY2hhbmdlcy4gQ2xhc3NpZmllcyB0aGUgY2FsbCBhcyBleGFjdGx5IG9uZSBvZgpjb21wbGV0aW9uLCBubyBjaGFuZ2UsIGVucm9sbG1lbnQsIHJlY29uZmlndXJhdGlvbiwgb3IgcmVtb3ZhbCwgYW5kCndyaXRlcyB0aGlzIGNvbnRyb2xsZXIncyBzdGF0ZSBmb3IgaXQuAAAACHJjdl9zeW5jAAAABAAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAAhkb2NfaGFzaAAAA+4AAAAgAAAAAAAAAAhyZWNvdmVyeQAAA+oAAAfQAAAAFkNvbXBpbGVkUmVjb3ZlcnlDb25maWcAAAAAAAAAAAAUYXBwcm92YWxfdmFsaWRfdW50aWwAAAAEAAAAAQAAA+kAAAfQAAAAC1N5bmNPdXRjb21lAAAAB9AAAAANUmVjb3ZlcnlFcnJvcgAAAA==",
        "AAAAAAAAAEtUaGUgZXhhY3Qgc3RhdGVtZW50IGV2aWRlbmNlIGZvciBhbiBhdHRlbXB0IG11c3Qgc2lnbiBvciBwcm92ZSBpbgpgZG9tYWluYC4AAAAACXN0YXRlbWVudAAAAAAAAAMAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAKYXR0ZW1wdF9pZAAAAAAABgAAAAAAAAAGZG9tYWluAAAAAAfQAAAADkV2aWRlbmNlRG9tYWluAAAAAAABAAAD6QAAB9AAAAARUmVjb3ZlcnlTdGF0ZW1lbnQAAAAAAAfQAAAADVJlY292ZXJ5RXJyb3IAAAA=",
        "AAAAAAAAAGZUMzogYSBaSyBwcm9vZiBmb3IgYW4gYXR0ZW1wdCdzIHN0YXRlbWVudCBpbiBgZG9tYWluYC4KUGVybWlzc2lvbmxlc3M6IHRoZSBwcm9vZiBpcyB0aGUgYXV0aG9yaXphdGlvbi4AAAAAAAlzdWJtaXRfemsAAAAAAAAEAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAAAAAAAABmRvbWFpbgAAAAAH0AAAAA5FdmlkZW5jZURvbWFpbgAAAAAAAAAAAAhldmlkZW5jZQAAB9AAAAAKWmtFdmlkZW5jZQAAAAAAAQAAA+kAAAACAAAH0AAAAA1SZWNvdmVyeUVycm9yAAAA",
        "AAAAAAAAALFXcml0ZXMgbm90aGluZzogT1ogZGlzY2FyZHMgYHVuaW5zdGFsbGAgZmFpbHVyZXMsIHNvIGl0IGNhbiBnYXRlCm5vdGhpbmcsIGFuZCByZW1vdmFsIGlzIGRlY2lkZWQgYnkgYHJjdl9zeW5jYC4gSW52b2tlci1vbmx5IGxpa2UgZXZlcnkKaG9vaywgc28gbm8gc2lnbmF0dXJlIGNhbiBjYWxsIGl0IGVpdGhlci4AAAAAAAAJdW5pbnN0YWxsAAAAAAAAAgAAAAAAAAAMY29udGV4dF9ydWxlAAAH0AAAAAtDb250ZXh0UnVsZQAAAAAAAAAADXNtYXJ0X2FjY291bnQAAAAAAAATAAAAAA==",
        "AAAAAAAAAHNUNzogYSBgTG9zc2Agb3duZXIgY2FuY2VscyBhbiBhdHRlbXB0LCB0aHJvdWdoIHRoZSBhY2NvdW50J3MKYGNhbmNlbF9yZWNvdmVyeWAuIE5ldmVyIGNvdW50ZWQgdG93YXJkIGBtYXgtY2FuY2Vsc2AuAAAAAApyY3ZfY2FuY2VsAAAAAAACAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAAABAAAD6QAAAAIAAAfQAAAADVJlY292ZXJ5RXJyb3IAAAA=",
        "AAAABQAAACBUNi9UNzogYW4gYXR0ZW1wdCB3YXMgY2FuY2VsbGVkLgAAAAAAAAAQQXR0ZW1wdENhbmNlbGxlZAAAAAEAAAARYXR0ZW1wdF9jYW5jZWxsZWQAAAAAAAADAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAAAAAAAAphdHRlbXB0X2lkAAAAAAAGAAAAAAAAADdXaGV0aGVyIHRoaXMgY2FuY2VsbGF0aW9uIGNvdW50ZWQgdG93YXJkIGBtYXgtY2FuY2Vsc2AuAAAAAAdjb3VudGVkAAAAAAEAAAAAAAAAAg==",
        "AAAAAAAAAUtUaGUgY29udHJvbGxlcidzIGhhbGYgb2YgdGhlIGFjY291bnQncyB1cGdyYWRlIGVudHJ5IHBvaW50cwooc3BlYyDCpzEyKS4gQm90aCBzdGVwcyBhcmUgcmVmdXNlZCB3aGlsZSBhbiBhdHRlbXB0IGlzIGF1dGhvcml6ZWQuCmBTY2hlZHVsZWAgY2hlY2tzIHRoZSByZWNvcmRlZCBjb25kaXRpb24gdW5kZXIgYFByb3RlY3RlZGAgYW5kCnJldHVybnMgdGhlIGVwb2NoIHRoZSByZXF1ZXN0IGJpbmRzOyBgRXhlY3V0ZWAgcmVmdXNlcyBhIHJlcXVlc3QKcmVjb3JkZWQgdW5kZXIgYW5vdGhlciBlcG9jaCwgdGhlbiBidW1wcyB0aGUgZXBvY2ggYW5kIHJldHVybnMgdGhlCm5ldyBvbmUuAAAAAAtyY3ZfdXBncmFkZQAAAAACAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAABHN0ZXAAAAfQAAAAC1VwZ3JhZGVTdGVwAAAAAAEAAAPpAAAABgAAB9AAAAANUmVjb3ZlcnlFcnJvcgAAAA==",
        "AAAABQAAAClUNDogYW4gYXR0ZW1wdCdzIGNvbmRpdGlvbiB3YXMgc2F0aXNmaWVkLgAAAAAAAAAAAAARQXR0ZW1wdEF1dGhvcml6ZWQAAAAAAAABAAAAEmF0dGVtcHRfYXV0aG9yaXplZAAAAAAABAAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAKYXR0ZW1wdF9pZAAAAAAABgAAAAAAAAAAAAAAEGV4ZWN1dGFibGVfYWZ0ZXIAAAAEAAAAAAAAAAAAAAAKZXhwaXJlc19hdAAAAAAABAAAAAAAAAAC",
        "AAAABQAAADRUNTogYW4gYXR0ZW1wdCBjb21wbGV0ZWQgYW5kIGl0cyB0YXJnZXQgd2FzIGFwcGxpZWQuAAAAAAAAABFSZWNvdmVyeUNvbXBsZXRlZAAAAAAAAAEAAAAScmVjb3ZlcnlfY29tcGxldGVkAAAAAAADAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAAAAAAAAphdHRlbXB0X2lkAAAAAAAGAAAAAAAAAAAAAAAPdGFyZ2V0X2RvY19oYXNoAAAAA+4AAAAgAAAAAAAAAAI=",
        "AAAAAAAAAChXaGV0aGVyIGFuIGF0dGVtcHQgaXMgbGl2ZSAoc3BlYyDCpzYuMikuAAAADGF0dGVtcHRfbGl2ZQAAAAIAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAKYXR0ZW1wdF9pZAAAAAAABgAAAAEAAAAB",
        "AAAAAAAAADJXaGF0IHJlY292ZXJ5IGN1cnJlbnRseSByZXN0cmljdHMgZm9yIHRoZSBhY2NvdW50LgAAAAAADWFjdGl2aXR5X2dhdGUAAAAAAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAH0AAAAAxBY3Rpdml0eUdhdGU=",
        "AAAAAAAAAJxPbmUgZ3VhcmRpYW4ncyBhcHByb3ZhbCBvZiBhIGBSZWNvbmZpZ3VyZWAgb3IgYFVwZ3JhZGVgIHN0YXRlbWVudCwKZnJlc2ggdW50aWwgYHZhbGlkX3VudGlsYC4gUmVjb3JkZWQgYnkgZGlnZXN0IGZvciB0aGUgY29uc3VtaW5nCmByY3Zfc3luY2AvYHJjdl91cGdyYWRlYC4AAAAOYXBwcm92ZV9jaGFuZ2UAAAAAAAQAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAHc3ViamVjdAAAAAfQAAAAEFN0YXRlbWVudFN1YmplY3QAAAAAAAAAC3ZhbGlkX3VudGlsAAAAAAQAAAAAAAAACGd1YXJkaWFuAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAANUmVjb3ZlcnlFcnJvcgAAAA==",
        "AAAAAAAAAHVUMSwgbG9zdC1rZXk6IHRoZSB0YXJnZXQgaXMgdGhlIGFwcGxpZWQgZG9jdW1lbnQgd2l0aCBgcmVwbGFjZW1lbnRzYAphcHBsaWVkLiBQZXJtaXNzaW9ubGVzcy4gUmV0dXJucyB0aGUgYXR0ZW1wdCBpZC4AAAAAAAAOYmVnaW5fbG9zdF9rZXkAAAAAAAIAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAMcmVwbGFjZW1lbnRzAAAH0AAAAA5SZXBsYWNlbWVudFNldAAAAAAAAQAAA+kAAAAGAAAH0AAAAA1SZWNvdmVyeUVycm9yAAAA",
        "AAAAAAAAADBSZWNvcmRlZCBldmlkZW5jZSBmb3IgYSBjaGFuZ2Ugc3RhdGVtZW50IGRpZ2VzdC4AAAAPY2hhbmdlX2V2aWRlbmNlAAAAAAIAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAGZGlnZXN0AAAAAAPuAAAAIAAAAAEAAAfQAAAADkNoYW5nZUFwcHJvdmFsAAA=",
        "AAAAAAAAACZUaGUgaWQgdGhlIG5leHQgYGJlZ2luXypgIHdpbGwgYXNzaWduLgAAAAAAD25leHRfYXR0ZW1wdF9pZAAAAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAABg==",
        "AAAAAAAAADBXaGV0aGVyIGBhY2NvdW50YCBzcGVudCBgbnVsbGlmaWVyYCAoc3BlYyDCpzExKS4AAAAPbnVsbGlmaWVyX3NwZW50AAAAAAIAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAJbnVsbGlmaWVyAAAAAAAD7gAAACAAAAABAAAAAQ==",
        "AAAAAAAAADlFeHRlbmQgYSBzcGVudCBudWxsaWZpZXIncyByZWNvcmQgdG8gdGhlIG5ldHdvcmsgbWF4aW11bS4AAAAAAAAPcmVuZXdfbnVsbGlmaWVyAAAAAAIAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAJbnVsbGlmaWVyAAAAAAAD7gAAACAAAAAA",
        "AAAAAAAAAJlUMjogb25lIGd1YXJkaWFuJ3MgYXBwcm92YWwgb2YgYW4gYXR0ZW1wdCdzIHN0YXRlbWVudCBpbiBgZG9tYWluYC4KVGhlIGd1YXJkaWFuIGF1dGhvcml6ZXMgYHJlcXVpcmVfYXV0aF9mb3JfYXJncygoZGlnZXN0LCkpYCBmb3IKZXhhY3RseSB0aGF0IHN0YXRlbWVudC4AAAAAAAAPc3VibWl0X2d1YXJkaWFuAAAAAAQAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAKYXR0ZW1wdF9pZAAAAAAABgAAAAAAAAAGZG9tYWluAAAAAAfQAAAADkV2aWRlbmNlRG9tYWluAAAAAAAAAAAACGd1YXJkaWFuAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAANUmVjb3ZlcnlFcnJvcgAAAA==",
        "AAAAAAAAAK5UMSwgY29tcHJvbWlzZTogdGhlIHRhcmdldCBpcyB0aGUgcHVibGlzaGVkIGJhc2VsaW5lJ3Mgc2lnbmVycyBhbmQKcnVsZXMsIHdpdGggdGhlIGN1cnJlbnQgcmVjb3ZlcnkgbWVtYmVyIGFuZCBgcmVwbGFjZW1lbnRzYCBhcHBsaWVkLgpQZXJtaXNzaW9ubGVzcy4gUmV0dXJucyB0aGUgYXR0ZW1wdCBpZC4AAAAAABBiZWdpbl9jb21wcm9taXNlAAAAAgAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAAxyZXBsYWNlbWVudHMAAAfQAAAADlJlcGxhY2VtZW50U2V0AAAAAAABAAAD6QAAAAYAAAfQAAAADVJlY292ZXJ5RXJyb3IAAAA=",
        "AAAAAAAAAE1UaGUgZXhhY3Qgc3RhdGVtZW50IGEgYFJlY29uZmlndXJlYCBvciBgVXBncmFkZWAgYXBwcm92YWwgbXVzdCBzaWduCm9yIHByb3ZlLgAAAAAAABBjaGFuZ2Vfc3RhdGVtZW50AAAAAwAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAAdzdWJqZWN0AAAAB9AAAAAQU3RhdGVtZW50U3ViamVjdAAAAAAAAAALdmFsaWRfdW50aWwAAAAABAAAAAEAAAPpAAAH0AAAABFSZWNvdmVyeVN0YXRlbWVudAAAAAAAB9AAAAANUmVjb3ZlcnlFcnJvcgAAAA==",
        "AAAAAAAAAOdTdG9yZSB0aGUgZW5yb2xsZWQgYmFzZWxpbmUncyBjYW5vbmljYWwgYnl0ZXMgKHNwZWMgwqczLjUpLgpQZXJtaXNzaW9ubGVzczogYGRvY19qc29uYCBtdXN0IGNvbXBpbGUsIHRocm91Z2ggdGhlIGFjY291bnQncyBvd24KY29tcGlsZXIsIHRvIGV4YWN0bHkgdGhlIGVucm9sbGVkIGJhc2VsaW5lIGhhc2ggYW5kIGtlZXAgYW4gYWRtaW4KcnVsZS4gUHVibGlzaGluZyBjaGFuZ2VzIG5vIGF1dGhvcml0eS4AAAAAEHB1Ymxpc2hfYmFzZWxpbmUAAAACAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAACGRvY19qc29uAAAADgAAAAEAAAPpAAAAAgAAB9AAAAANUmVjb3ZlcnlFcnJvcgAAAA==",
        "AAAAAAAAAH9BIFpLIHByb29mIGZvciBhIGBSZWNvbmZpZ3VyZWAgb3IgYFVwZ3JhZGVgIHN0YXRlbWVudCwgZnJlc2ggdW50aWwKYHZhbGlkX3VudGlsYC4gUGVybWlzc2lvbmxlc3MuIERvZXMgbm90IHNwZW5kIHRoZSBudWxsaWZpZXIuAAAAABBzdWJtaXRfemtfY2hhbmdlAAAABAAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAAdzdWJqZWN0AAAAB9AAAAAQU3RhdGVtZW50U3ViamVjdAAAAAAAAAALdmFsaWRfdW50aWwAAAAABAAAAAAAAAAIZXZpZGVuY2UAAAfQAAAAClprRXZpZGVuY2UAAAAAAAEAAAPpAAAAAgAAB9AAAAANUmVjb3ZlcnlFcnJvcgAAAA==",
        "AAAABQAAAEFFdmlkZW5jZSBmb3IgYSBgUmVjb25maWd1cmVgIG9yIGBVcGdyYWRlYCBzdGF0ZW1lbnQgd2FzIHJlY29yZGVkLgAAAAAAAAAAAAAWQ2hhbmdlRXZpZGVuY2VSZWNvcmRlZAAAAAAAAQAAABhjaGFuZ2VfZXZpZGVuY2VfcmVjb3JkZWQAAAACAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAAAAAAAAZkaWdlc3QAAAAAA+4AAAAgAAAAAAAAAAI=",
        "AAAAAgAAAFhXaGF0IGByY3Zfc3luY2AgZGlkLCBzbyB0aGUgYWNjb3VudCBrbm93cyB3aGljaCBvZiBpdHMgb3duIGVmZmVjdHMgdG8KYXBwbHkgKHNwZWMgwqcxMCkuAAAAAAAAAAtTeW5jT3V0Y29tZQAAAAAFAAAAAAAAAB9Ob3RoaW5nIGFib3V0IHJlY292ZXJ5IGNoYW5nZWQuAAAAAAlVbmNoYW5nZWQAAAAAAAAAAAAAMEEgY29uZmlndXJhdGlvbiB3YXMgZW5yb2xsZWQgYXQgdGhpcyBjb250cm9sbGVyLgAAAAhFbnJvbGxlZAAAAAAAAAAoVGhlIGVucm9sbGVkIGNvbmZpZ3VyYXRpb24gd2FzIHJlcGxhY2VkLgAAAAxSZWNvbmZpZ3VyZWQAAAAAAAAAdVRoZSBjb25maWd1cmF0aW9uIHdhcyByZW1vdmVkIGZyb20gdGhpcyBjb250cm9sbGVyIChyZWNvdmVyeQpyZW1vdmVkLCBvciB0aGUgYWNjb3VudCBzd2l0Y2hlZCB0byBhbm90aGVyIGNvbnRyb2xsZXIpLgAAAAAAAAdSZW1vdmVkAAAAAAEAAADqVGhlIGF1dGhvcml6ZWQgYXR0ZW1wdCB3aXRoIHRoaXMgaWQgY29tcGxldGVkIGluIHRoaXMgaW52b2NhdGlvbi4KVGhlIGFjY291bnQgaW5zZXJ0cyB0aGUgbmV3IGxlYWYgaWYgdGhlIGVucm9sbG1lbnQgaWQgY2hhbmdlZCwKcmVjb3JkcyB0aGUgZW5yb2xsbWVudCBpZCwgYXBwZW5kcyByZXZvY2F0aW9ucywgY2xlYXJzIGl0cyBwZW5kaW5nCnVwZ3JhZGUsIGFuZCBjbGVhcnMgaXRzIGZyZWV6ZSBtaXJyb3IuAAAAAAAJQ29tcGxldGVkAAAAAAAAAQAAAAY=",
        "AAAAAgAAAEhXaGljaCBwaGFzZSBvZiBhbiBhY2NvdW50IHVwZ3JhZGUgYHJjdl91cGdyYWRlYCBpcyBjaGVja2luZyAoc3BlYyDCpzEyKS4AAAAAAAAAC1VwZ3JhZGVTdGVwAAAAAAIAAAABAAAAlWBzY2hlZHVsZV91cGdyYWRlYDogcmVmdXNlIGR1cmluZyBhbiBhdXRob3JpemVkIHdpbmRvdzsgdW5kZXIKYFByb3RlY3RlZGAsIHJlcXVpcmUgcmVjb3JkZWQgYXBwcm92YWxzIG9mIHRoaXMgc3ViamVjdCB2YWxpZCB0aHJvdWdoCnRoZSBnaXZlbiBsZWRnZXIuAAAAAAAACFNjaGVkdWxlAAAAAgAAB9AAAAAOVXBncmFkZVN1YmplY3QAAAAAAAQAAAABAAAAhWBleGVjdXRlX3VwZ3JhZGVgIG9mIGEgcmVxdWVzdCByZWNvcmRlZCBhdCB0aGlzIGVwb2NoOiByZWZ1c2UgZHVyaW5nCmFuIGF1dGhvcml6ZWQgd2luZG93IG9yIGlmIHRoZSBlcG9jaCBtb3ZlZCwgdGhlbiBidW1wIHRoZSBlcG9jaC4AAAAAAAAHRXhlY3V0ZQAAAAABAAAABg==",
        "AAAABAAAAKFFdmVyeXRoaW5nIGEgcmVjb3ZlcnkgY29udHJvbGxlciBjYW4gcmVmdXNlLiBDb2RlcyBhcmUgc2VxdWVudGlhbCBmcm9tIDEKaW4gZGVjbGFyYXRpb24gb3JkZXIgYW5kIGFyZSB3aXJlIGZvcm1hdDogYXBwZW5kIG5ldyB2YXJpYW50cyBhdCB0aGUKZW5kLCBuZXZlciByZW9yZGVyLgAAAAAAAAAAAAANUmVjb3ZlcnlFcnJvcgAAAAAAAB4AAABBTm8gY29uZmlndXJhdGlvbiBpcyBlbnJvbGxlZCBmb3IgdGhpcyBhY2NvdW50IGF0IHRoaXMgY29udHJvbGxlci4AAAAAAAALTm90RW5yb2xsZWQAAAAAAQAAAIBBbiBhdHRlbXB0IGlzIGF1dGhvcml6ZWQgYW5kIGxpdmU6IGJlZ2luLCBwb2xpY3kgY2hhbmdlcywgYW5kIHVwZ3JhZGVzIGFyZSByZWZ1c2VkIHVudGlsIGl0IGNvbXBsZXRlcywgaXMgY2FuY2VsbGVkLCBvciBleHBpcmVzLgAAABFBdHRlbXB0QXV0aG9yaXplZAAAAAAAAAIAAAAvTm8gYXR0ZW1wdCB3aXRoIHRoaXMgaWQgZXhpc3RzIGZvciB0aGUgYWNjb3VudC4AAAAADU5vU3VjaEF0dGVtcHQAAAAAAAADAAAAY1RoZSBhdHRlbXB0IGlzIHRlcm1pbmFsLCBleHBpcmVkLCBmcm9tIGFuIG9sZGVyIGVwb2NoLCBvciBpbnZhbGlkYXRlZCBieSBhIHNpYmxpbmcncyBhdXRob3JpemF0aW9uLgAAAAAOQXR0ZW1wdE5vdExpdmUAAAAAAAQAAABASW5pdGlhdGlvbiBldmlkZW5jZSBmb3IgYW4gYXR0ZW1wdCB0aGF0IGlzIG5vIGxvbmdlciBjb2xsZWN0aW5nLgAAABRBdHRlbXB0Tm90Q29sbGVjdGluZwAAAAUAAAAlQ29tcGxldGlvbiBiZWZvcmUgYGV4ZWN1dGFibGVfYWZ0ZXJgLgAAAAAAABBOb3RFeGVjdXRhYmxlWWV0AAAABgAAAGZUaGUgY29tcGxldGlvbiBjb250ZXh0LCBvciB0aGUgY29tcGlsZWQgZG9jdW1lbnQgaGFzaCwgZG9lcyBub3QgbWF0Y2ggdGhlIGF1dGhvcml6ZWQgYXR0ZW1wdCdzIHRhcmdldC4AAAAAAAtXcm9uZ1RhcmdldAAAAAAHAAAAKFRoZSBhZGRyZXNzIGlzIG5vdCBhbiBlbnJvbGxlZCBndWFyZGlhbi4AAAAMTm90QUd1YXJkaWFuAAAACAAAADtUaGlzIGd1YXJkaWFuIG9yIGZhY3RvciBhbHJlYWR5IGNvdW50ZWQgZm9yIHRoaXMgc3RhdGVtZW50LgAAAAAOQWxyZWFkeUNvdW50ZWQAAAAAAAkAAAApVGhlIGVucm9sbGVkIG1vZGUgaGFzIG5vIGd1YXJkaWFuIGZhY3Rvci4AAAAAAAASTW9kZUhhc05vR3VhcmRpYW5zAAAAAAAKAAAAI1RoZSBlbnJvbGxlZCBtb2RlIGhhcyBubyBaSyBmYWN0b3IuAAAAAAtNb2RlSGFzTm9aawAAAAALAAAAPlRoZSBhZGFwdGVyIHJlZnVzZWQgdGhlIHByb29mIChpdHMgYFprQWRhcHRlckVycm9yYCBzYXlzIHdoeSkuAAAAAAASWmtFdmlkZW5jZVJlamVjdGVkAAAAAAAMAAAAH1RoZSBwcm9vZidzIG51bGxpZmllciBpcyBzcGVudC4AAAAADk51bGxpZmllclNwZW50AAAAAAANAAAAPlRoZSBzdGF0ZW1lbnQncyBmcmVzaG5lc3MgYm91bmQgaGFzIHBhc3NlZCBvciByZWFjaGVzIHRvbyBmYXIuAAAAAAAPRXZpZGVuY2VFeHBpcmVkAAAAAA4AAABHVGhlIHN0YXRlbWVudCBjYW5ub3QgYmUgZW5jb2RlZCAoYSBub24tY29udHJhY3QgYWNjb3VudCBvciBjb250cm9sbGVyKS4AAAAAEEludmFsaWRTdGF0ZW1lbnQAAAAPAAAAXVJlY29yZGVkIGFwcHJvdmFscyBkbyBub3Qgc2F0aXNmeSB0aGUgZW5yb2xsZWQgY29uZGl0aW9uIGZvciB0aGlzIHJlY29uZmlndXJhdGlvbiBvciB1cGdyYWRlLgAAAAAAAA9Db25kaXRpb25Ob3RNZXQAAAAAEAAAACdUaGUgYWNjb3VudCdzIGBtYXgtY2FuY2Vsc2AgaXMgdXNlZCB1cC4AAAAAEU1heENhbmNlbHNSZWFjaGVkAAAAAAAAEQAAADJPd25lciBjYW5jZWxsYXRpb24gaXMgb25seSBhdmFpbGFibGUgdW5kZXIgYExvc3NgLgAAAAAAEk93bmVyQ2FuY2VsUmVmdXNlZAAAAAAAEgAAAEJUaGUgcmVwbGFjZW1lbnQgc2V0IGJyZWFrcyBhIMKnNy4zIHJ1bGUsIG9yIGRlcml2YXRpb24gcmVmdXNlZCBpdC4AAAAAABNJbnZhbGlkUmVwbGFjZW1lbnRzAAAAABMAAAA6VGhlIHRhcmdldCBvciBhIHJlcGxhY2VtZW50IGNvbnRhaW5zIGEgcmV2b2tlZCBjcmVkZW50aWFsLgAAAAAAEUNyZWRlbnRpYWxSZXZva2VkAAAAAAAAFAAAADpUaGUgWksgZW5yb2xsbWVudCBpZCB3YXMgZW5yb2xsZWQgZm9yIHRoaXMgYWNjb3VudCBiZWZvcmUuAAAAAAASRW5yb2xsbWVudElkUmV1c2VkAAAAAAAVAAAALkNvbXByb21pc2UgcmVjb3Zlcnkgd2l0aCBubyBiYXNlbGluZSBlbnJvbGxlZC4AAAAAAApOb0Jhc2VsaW5lAAAAAAAWAAAAQENvbXByb21pc2UgcmVjb3ZlcnkgYmVmb3JlIHRoZSBiYXNlbGluZSdzIGNvbnRlbnQgd2FzIHB1Ymxpc2hlZC4AAAAUQmFzZWxpbmVOb3RQdWJsaXNoZWQAAAAXAAAAPlRoZSBwdWJsaXNoZWQgZG9jdW1lbnQgZG9lcyBub3QgaGFzaCB0byB0aGUgZW5yb2xsZWQgYmFzZWxpbmUuAAAAAAAQQmFzZWxpbmVNaXNtYXRjaAAAABgAAABTVGhlIGFkYXB0ZXIncyBjaXJjdWl0IGlkIG9yIHRyZWUgZGVwdGggZG9lcyBub3QgbWF0Y2ggdGhlIGVucm9sbGVkIGZhY3RvciBhbmQgcG9vbC4AAAAAEFprV2lyaW5nTWlzbWF0Y2gAAAAZAAAAMlRoZSBaSyBmYWN0b3IgY2hhbmdlZCB3aXRob3V0IGEgbmV3IGVucm9sbG1lbnQgaWQuAAAAAAAWWmtGYWN0b3JDaGFuZ2VkSW5QbGFjZQAAAAAAGgAAAHVUaGUgY29uZmlndXJhdGlvbiBpcyBtYWxmb3JtZWQgKGZvciBleGFtcGxlLCB0aGUgYWNjb3VudCBpcyBvbmUgb2YgaXRzIG93biBndWFyZGlhbnMsIG9yIHRoZSBxdW9ydW0gaXMgb3V0IG9mIHJhbmdlKS4AAAAAAAAUSW52YWxpZENvbmZpZ3VyYXRpb24AAAAbAAAAMUFuIHVwZ3JhZGUgcmVxdWVzdCByZWNvcmRlZCB1bmRlciBhbiBvbGRlciBlcG9jaC4AAAAAAAAMU3RhbGVVcGdyYWRlAAAAHAAAAC9BIGxlZGdlci1zZXF1ZW5jZSBjb21wdXRhdGlvbiBvdmVyZmxvd2VkIGB1MzJgLgAAAAAOTGVkZ2VyT3ZlcmZsb3cAAAAAAB0AAAA9VGhlIHBvbGljeSB3YXMgYXR0YWNoZWQgdG8gYSBjb250ZXh0IHJ1bGUgb2YgdGhlIHdyb25nIHNoYXBlLgAAAAAAABRNYWxmb3JtZWRDb250ZXh0UnVsZQAAAB4=",
        "AAAAAgAAAE5BIHNpZ25lciBjcmVkZW50aWFsLCBzaGFwZWQgbGlrZSBPWiBgc3RlbGxhcl9hY2NvdW50czo6c21hcnRfYWNjb3VudDo6U2lnbmVyYC4AAAAAAAAAAAAKQ3JlZGVudGlhbAAAAAAAAgAAAAEAAABsYFNpZ25lcjo6RGVsZWdhdGVkKGFkZHJlc3MpYDogYSBgRy4uLmAgb3IgYEMuLi5gIGFkZHJlc3MgdGhhdAphdXRoZW50aWNhdGVzIHRocm91Z2ggQ0FQLTAwNzEgZGVsZWdhdGVkIGF1dGguAAAACURlbGVnYXRlZAAAAAAAAAEAAAATAAAAAQAAAEhgU2lnbmVyOjpFeHRlcm5hbCh2ZXJpZmllciwga2V5KWA6IGEga2V5IGNoZWNrZWQgYnkgYSB2ZXJpZmllcgpjb250cmFjdC4AAAAIRXh0ZXJuYWwAAAACAAAAEwAAAA4=",
        "AAAAAQAAAGxPbmUgZGVzaWduYXRlZCBzaWduZXIgc2xvdCBhbmQgdGhlIGNyZWRlbnRpYWwgdGhhdCByZXBsYWNlcyB3aGF0ZXZlcgp0aGF0IHNsb3QgaG9sZHMgaW4gdGhlIHNvdXJjZSBkb2N1bWVudC4AAAAAAAAAC1JlcGxhY2VtZW50AAAAAAIAAAA4VGhlIGNyZWRlbnRpYWwgdGhlIHRhcmdldCBkb2N1bWVudCBnaXZlcyB0aGF0IHNpZ25lciBpZC4AAAAKY3JlZGVudGlhbAAAAAAH0AAAAApDcmVkZW50aWFsAAAAAABDQSBkb2N1bWVudCBzaWduZXIgaWQgbGlzdGVkIGluIHRoZSBlbnJvbGxlZCBgcmVjb3ZlcnkucmVwbGFjZWFibGVgLgAAAAAJc2lnbmVyX2lkAAAAAAAAEA==",
        "AAAAAQAAAVVBIFpLIGVucm9sbG1lbnQgYSByZWNvdmVyeSBjb21wbGV0aW9uIGluc3RhbGxzLgoKVGhlIGNvbW1pdG1lbnQgaXMgYm91bmQgaGVyZSwgbm90IG9ubHkgdGhlIGlkOiBjb21wbGV0aW9uIHJ1bnMgdW5kZXIgdGhlCnplcm8tc2lnbmVyIHJlY292ZXJ5IHJ1bGUsIHNvIG5vdGhpbmcgc2lnbnMgaXRzIGFyZ3VtZW50cywgYW5kIGEKY29tbWl0bWVudCBzdXBwbGllZCBvbmx5IGF0IGNvbXBsZXRpb24gY291bGQgYmUgc3dhcHBlZCBieSB3aG9ldmVyCnN1Ym1pdHMgdGhlIGNvbXBsZXRpbmcgdHJhbnNhY3Rpb24gZmlyc3Qg4oCUIGhhbmRpbmcgdGhlbSB0aGUgYWNjb3VudCdzCm5leHQgWksgZmFjdG9yLgAAAAAAAAAAAAAMWmtFbnJvbGxtZW50AAAAAgAAARlUaGUgbmV3IGxlYWYncyBpbm5lciBjb21taXRtZW50LCBgUG9zZWlkb24yKERPTV9MRUFGLCBzZWNyZXQpYC4KRGVyaXZhdGlvbiB3cml0ZXMgYGlkYCBhbmQgYGNvbW1pdG1lbnRgIGludG8gdGhlIHRhcmdldCBkb2N1bWVudCdzCnJlY292ZXJ5IHNlY3Rpb24sIHNvIHRoZSB0YXJnZXQgaGFzaCBiaW5kcyB0aGVtLCBhbmQgdGhlIGNvbXBsZXRpbmcKYGFwcGx5X2RvY2AgaW5zZXJ0cyB0aGUgbGVhZiBmcm9tIHRoZSBjb21waWxlZCB0YXJnZXQsIG5ldmVyIGZyb20gYQpjYWxsIGFyZ3VtZW50LgAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAE1UaGUgbmV3IGVucm9sbG1lbnQgaWQuIE11c3QgbmV2ZXIgaGF2ZSBiZWVuIGVucm9sbGVkIGZvciB0aGlzCmFjY291bnQgYmVmb3JlLgAAAAAAAAJpZAAAAAAD7gAAACA=",
        "AAAAAQAAAG9FdmVyeXRoaW5nIGEgYExvc3RLZXlgL2BDb21wcm9taXNlYCBhdHRlbXB0IGNoYW5nZXMgYWJvdXQgdGhlIHNvdXJjZQpkb2N1bWVudC4gU2VlIGBkb2NzL3JlY292ZXJ5L3NwZWMubWRgIMKnNy4AAAAAAAAAAA5SZXBsYWNlbWVudFNldAAAAAAAAgAAAHVTaWduZXIgcmVwbGFjZW1lbnRzIGluIHN0cmljdGx5IGFzY2VuZGluZyBgc2lnbmVyX2lkYCBieXRlIG9yZGVyCihzb3J0ZWQsIG5vIGR1cGxpY2F0ZXMpIOKAlCB0aGUgb25lIGNhbm9uaWNhbCBvcmRlci4AAAAAAAAHc2lnbmVycwAAAAPqAAAH0AAAAAtSZXBsYWNlbWVudAAAAAElVGhlIGZyZXNoIFpLIGVucm9sbG1lbnQgdGhlIGNvbXBsZXRpb24gaW5zdGFsbHMsIHJlcXVpcmVkIGV4YWN0bHkKd2hlbiB0aGUgZW5yb2xsZWQgbW9kZSBoYXMgYSBaSyBmYWN0b3IgKGEgWkstZXZpZGVuY2VkIGNvbXBsZXRpb24KY29uc3VtZXMgdGhlIGVucm9sbGVkIGNyZWRlbnRpYWwsIHNvIGl0IG11c3QgaW5zdGFsbCBhIGZyZXNoIG9uZSkuCkVtcHR5IG9yIG9uZSBlbnRyeSDigJQgYSBgVmVjYCBiZWNhdXNlIGAjW2NvbnRyYWN0dHlwZV1gIGNhbm5vdCBkZXJpdmUKYE9wdGlvbjxDdXN0b21TdHJ1Y3Q+YC4AAAAAAAANemtfZW5yb2xsbWVudAAAAAAAA+oAAAfQAAAADFprRW5yb2xsbWVudA==",
        "AAAAAQAAABpPbmUgWksgcHJvb2YgYXMgc3VibWl0dGVkLgAAAAAAAAAAAApaa0V2aWRlbmNlAAAAAAAEAAAAP1RoZSBjcmVkZW50aWFsJ3MgbnVsbGlmaWVyICh0aGUgY2lyY3VpdCdzIHNlY29uZCBwdWJsaWMgaW5wdXQpLgAAAAAJbnVsbGlmaWVyAAAAAAAD7gAAACAAAAAVVGhlIHNlcmlhbGl6ZWQgcHJvb2YuAAAAAAAABXByb29mAAAAAAAADgAAAGBUaGUgcm9vdCB0aGUgcHJvb2Ygd2FzIGdlbmVyYXRlZCBhZ2FpbnN0OyBtdXN0IGJlIGFjY2VwdGFibGUgdG8gdGhlCmVucm9sbGVkIHBvb2wgZm9yIGB0cmVlX2lkYC4AAAAEcm9vdAAAA+4AAAAgAAAALFRoZSBwb29sIHRyZWUgdGhlIHByb29mJ3MgTWVya2xlIHBhdGggaXMgaW4uAAAAB3RyZWVfaWQAAAAABA==",
        "AAAAAgAAAHdXaG8gbWF5IGNoYW5nZSB0aGUgcmVjb3ZlcnkgY29uZmlndXJhdGlvbiwgYW5kIHdoZXRoZXIgYW4gYXV0aG9yaXplZAphdHRlbXB0IGZyZWV6ZXMgb3JkaW5hcnkgYWN0aXZpdHkgKHNwZWMgwqcyLCDCpzkpLgAAAAAAAAAAD1JlY292ZXJ5UHJvZmlsZQAAAAACAAAAAAAAAHdPd25lciBhdXRob3JpemF0aW9uIGFsb25lIHJlY29uZmlndXJlczsgYWN0aXZpdHkgY29udGludWVzIHdoaWxlIGFuCmF0dGVtcHQgaXMgYXV0aG9yaXplZDsgdGhlIG93bmVyIGNhbiBhbHdheXMgY2FuY2VsLgAAAAAETG9zcwAAAAAAAABpUmVjb25maWd1cmF0aW9uIGFuZCB1cGdyYWRlcyBhbHNvIG5lZWQgdGhlIGVucm9sbGVkIGNvbmRpdGlvbjsgYW4KYXV0aG9yaXplZCBhdHRlbXB0IGZyZWV6ZXMgdGhlIGFjY291bnQuAAAAAAAACVByb3RlY3RlZAAAAA==",
        "AAAAAQAAACJUaGUgWksgZmFjdG9yIChzcGVjIMKnMy4xLCDCpzMuNCkuAAAAAAAAAAAAEENvbXBpbGVkWmtGYWN0b3IAAAAFAAAANFRoZSBjb25zdHJ1Y3Rvcmxlc3MgWksgYWRhcHRlciB0aGUgY29udHJvbGxlciBjYWxscy4AAAAHYWRhcHRlcgAAAAATAAAAVGBzaGEyNTZgIG9mIHRoZSBhZGFwdGVyJ3MgdmVyaWZpY2F0aW9uIGtleTsgbXVzdCBlcXVhbCB0aGUgYWRhcHRlcidzCmBjaXJjdWl0X2lkKClgLgAAAApjaXJjdWl0X2lkAAAAAAPuAAAAIAAAAHJUaGUgY3VycmVudCBjcmVkZW50aWFsJ3MgaW5uZXIgY29tbWl0bWVudCwgYFBvc2VpZG9uMihET01fTEVBRiwKc2VjcmV0KWAsIGZyb20gd2hpY2ggdGhlIGFjY291bnQgaW5zZXJ0cyB0aGUgbGVhZi4AAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAD9UaGUgY3VycmVudCBjcmVkZW50aWFsJ3MgaWQsIGJvdW5kIGludG8gaXRzIGxlYWYgYW5kIG51bGxpZmllci4AAAAADWVucm9sbG1lbnRfaWQAAAAAAAPuAAAAIAAAACxUaGUgbWVtYmVyc2hpcCBwb29sIHJvb3RzIGFyZSBhY2NlcHRlZCBmcm9tLgAAAARwb29sAAAAEw==",
        "AAAAAQAAABRUaGUgZ3VhcmRpYW4gZmFjdG9yLgAAAAAAAAATQ29tcGlsZWRHdWFyZGlhblNldAAAAAACAAAAQEd1YXJkaWFuIGFkZHJlc3NlcyAoYEcuLi5gIG9yIGBDLi4uYCksIG5ldmVyIHRoZSBhY2NvdW50IGl0c2VsZi4AAAAJZ3VhcmRpYW5zAAAAAAAD6gAAABMAAAAhYDEgPD0gcXVvcnVtIDw9IGd1YXJkaWFucy5sZW4oKWAuAAAAAAAABnF1b3J1bQAAAAAABA==",
        "AAAAAgAAACBXaGljaCBmYWN0b3JzIGEgc3RhdGVtZW50IG5lZWRzLgAAAAAAAAAUQ29tcGlsZWRSZWNvdmVyeU1vZGUAAAADAAAAAQAAAAAAAAAMR3VhcmRpYW5Pbmx5AAAAAQAAB9AAAAATQ29tcGlsZWRHdWFyZGlhblNldAAAAAABAAAAAAAAAAZaa09ubHkAAAAAAAEAAAfQAAAAEENvbXBpbGVkWmtGYWN0b3IAAAABAAAAAAAAAAhDb21iaW5lZAAAAAIAAAfQAAAAE0NvbXBpbGVkR3VhcmRpYW5TZXQAAAAH0AAAABBDb21waWxlZFprRmFjdG9y",
        "AAAAAQAAAB1BIGNvbXBpbGVkIGByZWNvdmVyeWAgbWVtYmVyLgAAAAAAAAAAAAAWQ29tcGlsZWRSZWNvdmVyeUNvbmZpZwAAAAAACQAAAFRUaGUgZW5yb2xsZWQgYmFzZWxpbmUncyBjYW5vbmljYWwgZG9jdW1lbnQgaGFzaCwgaWYgY29tcHJvbWlzZQpyZWNvdmVyeSBpcyBlbnJvbGxlZC4AAAAIYmFzZWxpbmUAAAPoAAAD7gAAACAAAADiYHNoYTI1NigicGVyY2gvcmVjb3ZlcnkvY29uZmlnIiB8fCBjYW5vbmljYWwgSlNPTiBvZiB0aGUgcmVjb3ZlcnkKbWVtYmVyKWAsIGNvbXB1dGVkIGJ5IHRoZSBkb2MgY29tcGlsZXIgKHNwZWMgwqczLjIpLiBDb25maWd1cmF0aW9uCmlkZW50aXR5OiB0d28gY29tcGlsZWQgY29uZmlndXJhdGlvbnMgd2l0aCB0aGUgc2FtZSBgY29uZmlnX2hhc2hgIGFyZQp0aGUgc2FtZSBjb25maWd1cmF0aW9uLgAAAAAAC2NvbmZpZ19oYXNoAAAAA+4AAAAgAAAAIFRoZSBhZG9wdGVkIGNvbnRyb2xsZXIgaW5zdGFuY2UuAAAACmNvbnRyb2xsZXIAAAAAABMAAAAAAAAADWRlbGF5X2xlZGdlcnMAAAAAAAAEAAAAAAAAAA5leHBpcnlfbGVkZ2VycwAAAAAABAAAAAAAAAALbWF4X2NhbmNlbHMAAAAABAAAAAAAAAAEbW9kZQAAB9AAAAAUQ29tcGlsZWRSZWNvdmVyeU1vZGUAAAAAAAAAB3Byb2ZpbGUAAAAH0AAAAA9SZWNvdmVyeVByb2ZpbGUAAAAAe1NpZ25lciBpZHMgKG5vdCBjcmVkZW50aWFsIGZpbmdlcnByaW50cykgYSByZWNvdmVyeSBtYXkgcmVwbGFjZSwgc28Kcm90YXRpbmcgYSBrZXkgZG9lcyBub3QgY2hhbmdlIHRoZSBjb25maWd1cmF0aW9uICgjOTIpLgAAAAALcmVwbGFjZWFibGUAAAAD6gAAABA=",
        "AAAAAgAAAEVXaGF0IGEgYFJlY29uZmlndXJlYCBzdGF0ZW1lbnQgY2hhbmdlcyB0aGUgZW5yb2xsZWQgY29uZmlndXJhdGlvbiB0by4AAAAAAAAAAAAADENvbmZpZ0NoYW5nZQAAAAIAAAAAAAAAIVJlbW92ZSByZWNvdmVyeSBmcm9tIHRoZSBhY2NvdW50LgAAAAAAAAZSZW1vdmUAAAAAAAEAAACLUmVwbGFjZSB0aGUgY29uZmlndXJhdGlvbiB3aXRoIHRoZSBvbmUgd2hvc2UKW2BDb25maWdCaW5kaW5nOjpjb25maWdfaGFzaGBdIGlzIHRoaXMgdmFsdWUgKHdoaWNoIG1heSBuYW1lIGEKZGlmZmVyZW50IGNvbnRyb2xsZXIgaW5zdGFuY2UpLgAAAAADU2V0AAAAAAEAAAPuAAAAIA==",
        "AAAAAQAAACRUaGUgc3ViamVjdCBvZiBhIGBDYW5jZWxgIHN0YXRlbWVudC4AAAAAAAAADUNhbmNlbFN1YmplY3QAAAAAAAACAAAAHFRoZSBhdHRlbXB0IGJlaW5nIGNhbmNlbGxlZC4AAAAKYXR0ZW1wdF9pZAAAAAAABgAAAHRUaGF0IGF0dGVtcHQncyBvd24gaW5pdGlhdGlvbiBzdGF0ZW1lbnQgZGlnZXN0LCBzbyBjYW5jZWxsYXRpb24KZXZpZGVuY2UgbmFtZXMgZXhhY3RseSBvbmUgcHJvcG9zYWwsIG5vdCBqdXN0IGFuIGlkLgAAABFhdHRlbXB0X3N0YXRlbWVudAAAAAAAA+4AAAAg",
        "AAAAAQAAADxUaGUgZW5yb2xsZWQgY29uZmlndXJhdGlvbiBhIHN0YXRlbWVudCBpcyBldmFsdWF0ZWQgYWdhaW5zdC4AAAAAAAAADUNvbmZpZ0JpbmRpbmcAAAAAAAACAAABBGBzaGEyNTZgIG9mIHRoZSBjYW5vbmljYWwgSlNPTiBvZiB0aGUgZW5yb2xsZWQgZG9jdW1lbnQncyBgcmVjb3ZlcnlgCnNlY3Rpb24gKGBkb2NzL3JlY292ZXJ5L3NwZWMubWRgIMKnMy4yKS4gQmluZHMKdGhlIHdob2xlIGNvbmZpZ3VyYXRpb246IHByb2ZpbGUsIG1vZGUsIGd1YXJkaWFucywgcXVvcnVtLCBaSwphZGFwdGVyL3Bvb2wvZW5yb2xsbWVudCwgY29udHJvbGxlciwgYmFzZWxpbmUsIHJlcGxhY2VhYmxlIHNpZ25lcgppZHMsIGFuZCB0aW1pbmcuAAAAC2NvbmZpZ19oYXNoAAAAA+4AAAAgAAAAylRoZSBjb250cm9sbGVyJ3MgcGVyLWFjY291bnQgY29uZmlndXJhdGlvbiBlcG9jaC4gSXQgaW5jcmVtZW50cyBvbgpldmVyeSBlbnJvbGxtZW50LCByZWNvbmZpZ3VyYXRpb24sIHJlbW92YWwsIGFuZCBjb21wbGV0ZWQgcmVjb3ZlcnksIHNvCmV2aWRlbmNlIHByb2R1Y2VkIHVuZGVyIG9uZSBlcG9jaCBpcyBkZWFkIHVuZGVyIGV2ZXJ5IGxhdGVyIG9uZS4AAAAAAAVlcG9jaAAAAAAAAAY=",
        "AAAAAQAAADNUaGUgc3ViamVjdCBvZiBhIGBMb3N0S2V5YCBvciBgQ29tcHJvbWlzZWAgYXR0ZW1wdC4AAAAAAAAAAA5BdHRlbXB0U3ViamVjdAAAAAAABAAAAD5UaGUgY29udHJvbGxlci1hc3NpZ25lZCwgcGVyLWFjY291bnQsIG5ldmVyLXJldXNlZCBhdHRlbXB0IGlkLgAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAABJW2BjcmF0ZTo6Y3JlZGVudGlhbDo6UmVwbGFjZW1lbnRTZXQ6Omhhc2hgXSBvZiB0aGUgZGVjbGFyZWQKcmVwbGFjZW1lbnRzLgAAAAAAABFyZXBsYWNlbWVudHNfaGFzaAAAAAAAA+4AAAAgAAAAo2BMb3N0S2V5YDogdGhlIGNhbm9uaWNhbCBoYXNoIG9mIHRoZSBhY2NvdW50J3MgYXBwbGllZCBkb2N1bWVudCB3aGVuCnRoZSBhdHRlbXB0IGJlZ2FuICh0aGUgYWdyZWVkIHNuYXBzaG90KS4gYENvbXByb21pc2VgOiB0aGUgZW5yb2xsZWQKYmFzZWxpbmUncyBjYW5vbmljYWwgaGFzaC4AAAAAD3NvdXJjZV9kb2NfaGFzaAAAAAPuAAAAIAAAAHxUaGUgY2Fub25pY2FsIGhhc2ggb2YgdGhlIHRhcmdldCBkb2N1bWVudCwgZGVyaXZlZCBvbi1jaGFpbiBmcm9tCnRoZSBzb3VyY2UgYW5kIHRoZSByZXBsYWNlbWVudCBzZXQg4oCUIG5ldmVyIGNhbGxlci1jaG9zZW4uAAAAD3RhcmdldF9kb2NfaGFzaAAAAAPuAAAAIA==",
        "AAAAAwAAAUpUaGUgYWN0aW9uIGRvbWFpbiBhIHN0YXRlbWVudCBhdXRob3JpemVzLiBFdmlkZW5jZSBmb3Igb25lIGFjdGlvbiBuZXZlcgpzYXRpc2ZpZXMgYW5vdGhlcjogdGhlIGFjdGlvbiBjb2RlIGlzIHRoZSBlbmNvZGluZydzIDI2dGggYnl0ZSBhbmQgc2VsZWN0cwp0aGUgc3ViamVjdCBsYXlvdXQsIHNvIHR3byBzdGF0ZW1lbnRzIHRoYXQgZGlmZmVyIG9ubHkgaW4gYWN0aW9uIGhhdmUKZGlmZmVyZW50IGRpZ2VzdHMgKGFuZCBkaWZmZXJlbnQgZW5jb2RlZCBsZW5ndGhzIGZvciBtb3N0IHBhaXJzKS4KClRoZSBudW1lcmljIGNvZGVzIGFyZSBwYXJ0IG9mIHRoZSB3aXJlIGZvcm1hdC4AAAAAAAAAAAAOUmVjb3ZlcnlBY3Rpb24AAAAAAAUAAABgTG9zdC1rZXkgcmVjb3Zlcnk6IHJlcGxhY2UgZGVzaWduYXRlZCBjcmVkZW50aWFscyBpbiBhbiBhZ3JlZWQKc25hcHNob3Qgb2YgdGhlIGN1cnJlbnQgZG9jdW1lbnQuAAAAB0xvc3RLZXkAAAAAAQAAAFlDb21wcm9taXNlIHJlY292ZXJ5OiByZXN0b3JlIHRoZSBlbnJvbGxlZCBiYXNlbGluZSwgd2l0aCBkZXNpZ25hdGVkCmNyZWRlbnRpYWxzIHJlcGxhY2VkLgAAAAAAAApDb21wcm9taXNlAAAAAAACAAAAHkNhbmNlbCBvbmUgaWRlbnRpZmllZCBhdHRlbXB0LgAAAAAABkNhbmNlbAAAAAAAAwAAAINDaGFuZ2Ugb3IgcmVtb3ZlIHRoZSBlbnJvbGxlZCByZWNvdmVyeSBjb25maWd1cmF0aW9uICh0aGUgZXZpZGVuY2UgYQpgUHJvdGVjdGVkYCBhY2NvdW50IG5lZWRzIGluIGFkZGl0aW9uIHRvIG93bmVyIGF1dGhvcml6YXRpb24pLgAAAAALUmVjb25maWd1cmUAAAAABAAAAHRBcHByb3ZlIG9uZSBzY2hlZHVsZWQgYWNjb3VudCB1cGdyYWRlICh0aGUgZXZpZGVuY2UgYSBgUHJvdGVjdGVkYAphY2NvdW50IG5lZWRzIGluIGFkZGl0aW9uIHRvIG93bmVyIGF1dGhvcml6YXRpb24pLgAAAAdVcGdyYWRlAAAAAAU=",
        "AAAAAQAAACZUaGUgc3ViamVjdCBvZiBhbiBgVXBncmFkZWAgc3RhdGVtZW50LgAAAAAAAAAAAA5VcGdyYWRlU3ViamVjdAAAAAAAAgAAADtUaGUgYWNjb3VudCdzIHBlci1hY2NvdW50LCBuZXZlci1yZXVzZWQgdXBncmFkZSByZXF1ZXN0IGlkLgAAAAAKcmVxdWVzdF9pZAAAAAAABgAAADxUaGUgZXhhY3QgV2FzbSBoYXNoIHRoZSBhY2NvdW50IHdvdWxkIHJ1biBhZnRlciB0aGUgdXBncmFkZS4AAAAJd2FzbV9oYXNoAAAAAAAD7gAAACA=",
        "AAAAAQAAACtUaW1pbmcgdGVybXMsIGFsbCBpbiBsZWRnZXItc2VxdWVuY2UgdW5pdHMuAAAAAAAAAAAPU3RhdGVtZW50VGltaW5nAAAAAAMAAABmVGhlIGVucm9sbGVkIGBkZWxheS1sZWRnZXJzYDogbGVkZ2VycyBiZXR3ZWVuIGFuIGF0dGVtcHQgYmVjb21pbmcKYXV0aG9yaXplZCBhbmQgYmVjb21pbmcgY29tcGxldGFibGUuAAAAAAANZGVsYXlfbGVkZ2VycwAAAAAAAAQAAADQVGhlIGVucm9sbGVkIGBleHBpcnktbGVkZ2Vyc2A6IHRoZSBldmlkZW5jZSB3aW5kb3cgZm9yIGEgY29sbGVjdGluZwphdHRlbXB0LCB0aGUgY29tcGxldGlvbiB3aW5kb3cgZm9yIGFuIGF1dGhvcml6ZWQgb25lLCBhbmQgdGhlIHVwcGVyCmJvdW5kIG9uIGhvdyBmYXIgYWhlYWQgYSBwcm92aWRlci1jaG9zZW4gYHZhbGlkX3VudGlsX2xlZGdlcmAgbWF5CnJlYWNoLgAAAA5leHBpcnlfbGVkZ2VycwAAAAAABAAAAapUaGUgbGFzdCBsZWRnZXIgc2VxdWVuY2UgKGluY2x1c2l2ZSkgYXQgd2hpY2ggdGhpcyBldmlkZW5jZSBtYXkgYmUKYWNjZXB0ZWQuIFRoZSBjb250cm9sbGVyIGZpeGVzIGl0IGZvciBhdHRlbXB0LWJvdW5kIGFjdGlvbnM6CmBMb3N0S2V5YC9gQ29tcHJvbWlzZWAgdXNlIHRoZSBhdHRlbXB0J3MgZXZpZGVuY2UgZGVhZGxpbmUsIGFuZApgQ2FuY2VsYCB0aGUgbGFzdCBsZWRnZXIgdGhlIGF0dGVtcHQgY291bGQgcG9zc2libHkgYmUgbGl2ZSwgc28KYXBwcm92YWxzIGNvbGxlY3RlZCBvdmVyIHNldmVyYWwgdHJhbnNhY3Rpb25zIGFsbCBzaWduIG9uZQpzdGF0ZW1lbnQuIEZvciBgUmVjb25maWd1cmVgL2BVcGdyYWRlYCB0aGUgZXZpZGVuY2UgcHJvdmlkZXIgY2hvb3NlcwppdCwgd2l0aGluIGBleHBpcnlfbGVkZ2Vyc2Agb2Ygc3VibWlzc2lvbi4AAAAAABJ2YWxpZF91bnRpbF9sZWRnZXIAAAAAAAQ=",
        "AAAAAgAAAJ1UaGUgYWN0aW9uLXNwZWNpZmljIHBhcnQgb2YgYSBzdGF0ZW1lbnQuIFRoZSB2YXJpYW50IGRldGVybWluZXMKW2BSZWNvdmVyeVN0YXRlbWVudDo6YWN0aW9uYF07IHRoZXJlIGlzIG5vIHNlcGFyYXRlIGFjdGlvbiBmaWVsZCB0aGF0CmNvdWxkIGRpc2FncmVlIHdpdGggaXQuAAAAAAAAAAAAABBTdGF0ZW1lbnRTdWJqZWN0AAAABQAAAAEAAAAAAAAAB0xvc3RLZXkAAAAAAQAAB9AAAAAOQXR0ZW1wdFN1YmplY3QAAAAAAAEAAAAAAAAACkNvbXByb21pc2UAAAAAAAEAAAfQAAAADkF0dGVtcHRTdWJqZWN0AAAAAAABAAAAAAAAAAZDYW5jZWwAAAAAAAEAAAfQAAAADUNhbmNlbFN1YmplY3QAAAAAAAABAAAAAAAAAAtSZWNvbmZpZ3VyZQAAAAABAAAH0AAAAAxDb25maWdDaGFuZ2UAAAABAAAAAAAAAAdVcGdyYWRlAAAAAAEAAAfQAAAADlVwZ3JhZGVTdWJqZWN0AAA=",
        "AAAAAQAAADBUaGUgb25lIHJlY292ZXJ5IHN0YXRlbWVudC4gU2VlIHRoZSBtb2R1bGUgZG9jcy4AAAAAAAAAEVJlY292ZXJ5U3RhdGVtZW50AAAAAAAABgAAADNUaGUgcmVjb3ZlcmluZyBhY2NvdW50LiBNdXN0IGJlIGEgY29udHJhY3QgYWRkcmVzcy4AAAAAB2FjY291bnQAAAAAEwAAAAAAAAAGY29uZmlnAAAAAAfQAAAADUNvbmZpZ0JpbmRpbmcAAAAAAACgVGhlIGNvbnRyb2xsZXIgaW5zdGFuY2UgZXZhbHVhdGluZyB0aGUgZXZpZGVuY2UgKGZvciBgUmVjb25maWd1cmVgLAp0aGUgY3VycmVudGx5IGFkb3B0ZWQgb25lLCBldmVuIHdoZW4gdGhlIGNoYW5nZSBhZG9wdHMgYW5vdGhlcikuCk11c3QgYmUgYSBjb250cmFjdCBhZGRyZXNzLgAAAApjb250cm9sbGVyAAAAAAATAAAAYFRoZSBuZXR3b3JrIGlkIChgc2hhMjU2YCBvZiB0aGUgbmV0d29yayBwYXNzcGhyYXNlKSwgYXMKYEVudjo6bGVkZ2VyKCkubmV0d29ya19pZCgpYCByZXR1cm5zIGl0LgAAAApuZXR3b3JrX2lkAAAAAAPuAAAAIAAAAAAAAAAHc3ViamVjdAAAAAfQAAAAEFN0YXRlbWVudFN1YmplY3QAAAAAAAAABnRpbWluZwAAAAAH0AAAAA9TdGF0ZW1lbnRUaW1pbmcA",
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
    epoch: this.txFromJSON<u64>,
        renew: this.txFromJSON<null>,
        config: this.txFromJSON<Option<CompiledRecoveryConfig>>,
        attempt: this.txFromJSON<Option<Attempt>>,
        enforce: this.txFromJSON<null>,
        install: this.txFromJSON<null>,
        baseline: this.txFromJSON<Option<Buffer>>,
        rcv_sync: this.txFromJSON<Result<SyncOutcome>>,
        statement: this.txFromJSON<Result<RecoveryStatement>>,
        submit_zk: this.txFromJSON<Result<void>>,
        uninstall: this.txFromJSON<null>,
        rcv_cancel: this.txFromJSON<Result<void>>,
        rcv_upgrade: this.txFromJSON<Result<u64>>,
        attempt_live: this.txFromJSON<boolean>,
        activity_gate: this.txFromJSON<ActivityGate>,
        approve_change: this.txFromJSON<Result<void>>,
        begin_lost_key: this.txFromJSON<Result<u64>>,
        change_evidence: this.txFromJSON<ChangeApproval>,
        next_attempt_id: this.txFromJSON<u64>,
        nullifier_spent: this.txFromJSON<boolean>,
        renew_nullifier: this.txFromJSON<null>,
        submit_guardian: this.txFromJSON<Result<void>>,
        begin_compromise: this.txFromJSON<Result<u64>>,
        change_statement: this.txFromJSON<Result<RecoveryStatement>>,
        publish_baseline: this.txFromJSON<Result<void>>,
        submit_zk_change: this.txFromJSON<Result<void>>
  }
}