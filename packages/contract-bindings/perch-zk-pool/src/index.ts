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
 * A tree's public summary.
 */
export interface TreeInfo {
  capacity: u64;
  /**
 * The latest root (the empty-tree root before any insertion).
 */
root: Buffer;
  /**
 * Full, and never written again.
 */
sealed: boolean;
  /**
 * Leaves inserted so far.
 */
size: u64;
  tree_id: u32;
}


/**
 * Where an insertion landed (the `LeafInserted` event's payload).
 * `(tree_id, index)` is the leaf's permanent position; `root` is the
 * tree's root right after the insertion.
 */
export interface Insertion {
  index: u64;
  leaf: Buffer;
  root: Buffer;
  tree_id: u32;
}

/**
 * Everything the pool can refuse.
 */
export const PoolError = {
  /**
   * The commitment is not a canonical BN254 field element (`>= r`).
   */
  1: {message:"NonCanonicalCommitment"},
  /**
   * The inserting address is not a contract. Leaves bind a contract id.
   */
  2: {message:"AccountNotContract"},
  /**
   * This account already inserted a leaf under this enrollment id.
   */
  3: {message:"EnrollmentIdTaken"},
  /**
   * No tree with this id has been opened.
   */
  4: {message:"UnknownTree"},
  /**
   * A page request exceeds `MAX_PAGE`.
   */
  5: {message:"PageTooLarge"},
  /**
   * The tree id counter would overflow (2^32 full trees).
   */
  6: {message:"TreeIdOverflow"}
}


/**
 * A leaf's permanent position.
 */
export interface LeafPosition {
  index: u64;
  tree_id: u32;
}

export type PoolKey = {tag: "CurrentTree", values: void} | {tag: "Tree", values: readonly [u32]} | {tag: "Root", values: readonly [u32, Buffer]} | {tag: "Leaf", values: readonly [u32, u64]} | {tag: "Enrollment", values: readonly [string, Buffer]};


export interface TreeState {
  /**
 * `frontier[level]` is the most recent node at `level` that was a left
 * child: the left sibling the next right child at that level hashes
 * with. Entries are written before they are ever read.
 */
frontier: Array<Buffer>;
  /**
 * The root after the latest insertion.
 */
root: Buffer;
  /**
 * Leaves inserted so far; also the index the next insertion takes.
 */
size: u64;
}



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
   * The ZK enrollment id was enrolled for this account before (the controller checks the account's `is_enrolled_id` at T1; the pure `derive_target` cannot see the account's history).
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
  30: {message:"MalformedContextRule"},
  /**
   * A credential the replacement set replaces still appears in the target (a swap or a no-op replacement, spec §7.3 rule 8).
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
   * VkParseError
   */
  1: {message:"VkParseError"},
  /**
   * ProofParseError
   */
  2: {message:"ProofParseError"},
  /**
   * VerificationFailed
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

export interface Client {
  /**
   * Construct and simulate a tree transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  tree: ({tree_id}: {tree_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<TreeInfo>>>

  /**
   * Construct and simulate a depth transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `MembershipPoolInterface::depth`: see [`TREE_DEPTH`].
   */
  depth: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a leaves transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * A page of `tree_id`'s leaves, for rebuilding witnesses from storage.
   */
  leaves: ({tree_id, start, count}: {tree_id: u32, start: u64, count: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Array<Buffer>>>>

  /**
   * Construct and simulate a version transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * See [`VERSION`].
   */
  version: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a enrollment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Where `account`'s enrollment `enrollment_id` landed, if it exists.
   */
  enrollment: ({account, enrollment_id}: {account: string, enrollment_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<LeafPosition>>>

  /**
   * Construct and simulate a rcv_insert transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Insert `commitment` (`H(DOM_LEAF, secret)`) for `account` under
   * `enrollment_id` (spec §14.2). Invoker-only: `account.require_auth()`
   * is satisfiable only by the account's own code calling, because the
   * account refuses to sign reserved `rcv_*` names (spec §15). The pool,
   * not the caller, derives the stored leaf from the account and the id,
   * and refuses a second insertion under the same id. Returns nothing:
   * the leaf's position is in the `LeafInserted` event and in
   * [`Self::enrollment`].
   */
  rcv_insert: ({account, enrollment_id, commitment}: {account: string, enrollment_id: Buffer, commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a renew_root transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Permissionless keep-alive for one historical root a prover relies on.
   */
  renew_root: ({tree_id, root}: {tree_id: u32, root: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a renew_tree transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Permissionless keep-alive: extend `tree_id`'s state and latest root
   * (and the current-tree pointer) to the network's maximum TTL. Changes
   * nothing else.
   */
  renew_tree: ({tree_id}: {tree_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a current_tree transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The tree insertions currently go into.
   */
  current_tree: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a renew_leaves transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Permissionless keep-alive for a page of `tree_id`'s leaves.
   */
  renew_leaves: ({tree_id, start, count}: {tree_id: u32, start: u64, count: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a is_known_root transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `MembershipPoolInterface::is_known_root`: whether `root` is a root
   * tree `tree_id` of this pool has ever had.
   */
  is_known_root: ({tree_id, root}: {tree_id: u32, root: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a renew_enrollment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Permissionless keep-alive for one enrollment's record and leaf.
   */
  renew_enrollment: ({account, enrollment_id}: {account: string, enrollment_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

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
      new ContractSpec([ "AAAAAQAAABhBIHRyZWUncyBwdWJsaWMgc3VtbWFyeS4AAAAAAAAACFRyZWVJbmZvAAAABQAAAAAAAAAIY2FwYWNpdHkAAAAGAAAAO1RoZSBsYXRlc3Qgcm9vdCAodGhlIGVtcHR5LXRyZWUgcm9vdCBiZWZvcmUgYW55IGluc2VydGlvbikuAAAAAARyb290AAAD7gAAACAAAAAeRnVsbCwgYW5kIG5ldmVyIHdyaXR0ZW4gYWdhaW4uAAAAAAAGc2VhbGVkAAAAAAABAAAAF0xlYXZlcyBpbnNlcnRlZCBzbyBmYXIuAAAAAARzaXplAAAABgAAAAAAAAAHdHJlZV9pZAAAAAAE",
        "AAAAAQAAAKlXaGVyZSBhbiBpbnNlcnRpb24gbGFuZGVkICh0aGUgYExlYWZJbnNlcnRlZGAgZXZlbnQncyBwYXlsb2FkKS4KYCh0cmVlX2lkLCBpbmRleClgIGlzIHRoZSBsZWFmJ3MgcGVybWFuZW50IHBvc2l0aW9uOyBgcm9vdGAgaXMgdGhlCnRyZWUncyByb290IHJpZ2h0IGFmdGVyIHRoZSBpbnNlcnRpb24uAAAAAAAAAAAAAAlJbnNlcnRpb24AAAAAAAAEAAAAAAAAAAVpbmRleAAAAAAAAAYAAAAAAAAABGxlYWYAAAPuAAAAIAAAAAAAAAAEcm9vdAAAA+4AAAAgAAAAAAAAAAd0cmVlX2lkAAAAAAQ=",
        "AAAABAAAAB9FdmVyeXRoaW5nIHRoZSBwb29sIGNhbiByZWZ1c2UuAAAAAAAAAAAJUG9vbEVycm9yAAAAAAAABgAAAD9UaGUgY29tbWl0bWVudCBpcyBub3QgYSBjYW5vbmljYWwgQk4yNTQgZmllbGQgZWxlbWVudCAoYD49IHJgKS4AAAAAFk5vbkNhbm9uaWNhbENvbW1pdG1lbnQAAAAAAAEAAABDVGhlIGluc2VydGluZyBhZGRyZXNzIGlzIG5vdCBhIGNvbnRyYWN0LiBMZWF2ZXMgYmluZCBhIGNvbnRyYWN0IGlkLgAAAAASQWNjb3VudE5vdENvbnRyYWN0AAAAAAACAAAAPlRoaXMgYWNjb3VudCBhbHJlYWR5IGluc2VydGVkIGEgbGVhZiB1bmRlciB0aGlzIGVucm9sbG1lbnQgaWQuAAAAAAARRW5yb2xsbWVudElkVGFrZW4AAAAAAAADAAAAJU5vIHRyZWUgd2l0aCB0aGlzIGlkIGhhcyBiZWVuIG9wZW5lZC4AAAAAAAALVW5rbm93blRyZWUAAAAABAAAACJBIHBhZ2UgcmVxdWVzdCBleGNlZWRzIGBNQVhfUEFHRWAuAAAAAAAMUGFnZVRvb0xhcmdlAAAABQAAADVUaGUgdHJlZSBpZCBjb3VudGVyIHdvdWxkIG92ZXJmbG93ICgyXjMyIGZ1bGwgdHJlZXMpLgAAAAAAAA5UcmVlSWRPdmVyZmxvdwAAAAAABg==",
        "AAAAAQAAABxBIGxlYWYncyBwZXJtYW5lbnQgcG9zaXRpb24uAAAAAAAAAAxMZWFmUG9zaXRpb24AAAACAAAAAAAAAAVpbmRleAAAAAAAAAYAAAAAAAAAB3RyZWVfaWQAAAAABA==",
        "AAAAAgAAAAAAAAAAAAAAB1Bvb2xLZXkAAAAABQAAAAAAAAAAAAAAC0N1cnJlbnRUcmVlAAAAAAEAAAAAAAAABFRyZWUAAAABAAAABAAAAAEAAAAAAAAABFJvb3QAAAACAAAABAAAA+4AAAAgAAAAAQAAAAAAAAAETGVhZgAAAAIAAAAEAAAABgAAAAEAAAAAAAAACkVucm9sbG1lbnQAAAAAAAIAAAATAAAD7gAAACA=",
        "AAAAAQAAAAAAAAAAAAAACVRyZWVTdGF0ZQAAAAAAAAMAAAC7YGZyb250aWVyW2xldmVsXWAgaXMgdGhlIG1vc3QgcmVjZW50IG5vZGUgYXQgYGxldmVsYCB0aGF0IHdhcyBhIGxlZnQKY2hpbGQ6IHRoZSBsZWZ0IHNpYmxpbmcgdGhlIG5leHQgcmlnaHQgY2hpbGQgYXQgdGhhdCBsZXZlbCBoYXNoZXMKd2l0aC4gRW50cmllcyBhcmUgd3JpdHRlbiBiZWZvcmUgdGhleSBhcmUgZXZlciByZWFkLgAAAAAIZnJvbnRpZXIAAAPqAAAD7gAAACAAAAAkVGhlIHJvb3QgYWZ0ZXIgdGhlIGxhdGVzdCBpbnNlcnRpb24uAAAABHJvb3QAAAPuAAAAIAAAAEBMZWF2ZXMgaW5zZXJ0ZWQgc28gZmFyOyBhbHNvIHRoZSBpbmRleCB0aGUgbmV4dCBpbnNlcnRpb24gdGFrZXMuAAAABHNpemUAAAAG",
        "AAAABQAAAI1FbWl0dGVkIGZvciBldmVyeSBpbnNlcnRpb24uIFRvZ2V0aGVyIHdpdGggdGhlIGBMZWFmYCBzdG9yYWdlIGVudHJpZXMsCnRoaXMgaXMgd2hhdCBhbiBpbmRleGVyIHJlcGxheXMgdG8gcmVidWlsZCBhIHRyZWUgYW5kIHNlcnZlIHdpdG5lc3Nlcy4AAAAAAAAAAAAADExlYWZJbnNlcnRlZAAAAAEAAAANbGVhZl9pbnNlcnRlZAAAAAAAAAYAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAAAAAAAB3RyZWVfaWQAAAAABAAAAAEAAAAAAAAADWVucm9sbG1lbnRfaWQAAAAAAAPuAAAAIAAAAAAAAAAAAAAABWluZGV4AAAAAAAABgAAAAAAAAAAAAAABGxlYWYAAAPuAAAAIAAAAAAAAAAAAAAABHJvb3QAAAPuAAAAIAAAAAAAAAAC",
        "AAAAAAAAAAAAAAAEdHJlZQAAAAEAAAAAAAAAB3RyZWVfaWQAAAAABAAAAAEAAAPpAAAH0AAAAAhUcmVlSW5mbwAAB9AAAAAJUG9vbEVycm9yAAAA",
        "AAAAAAAAADVgTWVtYmVyc2hpcFBvb2xJbnRlcmZhY2U6OmRlcHRoYDogc2VlIFtgVFJFRV9ERVBUSGBdLgAAAAAAAAVkZXB0aAAAAAAAAAAAAAABAAAABA==",
        "AAAAAAAAAERBIHBhZ2Ugb2YgYHRyZWVfaWRgJ3MgbGVhdmVzLCBmb3IgcmVidWlsZGluZyB3aXRuZXNzZXMgZnJvbSBzdG9yYWdlLgAAAAZsZWF2ZXMAAAAAAAMAAAAAAAAAB3RyZWVfaWQAAAAABAAAAAAAAAAFc3RhcnQAAAAAAAAGAAAAAAAAAAVjb3VudAAAAAAAAAQAAAABAAAD6QAAA+oAAAPuAAAAIAAAB9AAAAAJUG9vbEVycm9yAAAA",
        "AAAAAAAAABBTZWUgW2BWRVJTSU9OYF0uAAAAB3ZlcnNpb24AAAAAAAAAAAEAAAAE",
        "AAAAAAAAAEJXaGVyZSBgYWNjb3VudGAncyBlbnJvbGxtZW50IGBlbnJvbGxtZW50X2lkYCBsYW5kZWQsIGlmIGl0IGV4aXN0cy4AAAAAAAplbnJvbGxtZW50AAAAAAACAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAADWVucm9sbG1lbnRfaWQAAAAAAAPuAAAAIAAAAAEAAAPoAAAH0AAAAAxMZWFmUG9zaXRpb24=",
        "AAAAAAAAAeZJbnNlcnQgYGNvbW1pdG1lbnRgIChgSChET01fTEVBRiwgc2VjcmV0KWApIGZvciBgYWNjb3VudGAgdW5kZXIKYGVucm9sbG1lbnRfaWRgIChzcGVjIMKnMTQuMikuIEludm9rZXItb25seTogYGFjY291bnQucmVxdWlyZV9hdXRoKClgCmlzIHNhdGlzZmlhYmxlIG9ubHkgYnkgdGhlIGFjY291bnQncyBvd24gY29kZSBjYWxsaW5nLCBiZWNhdXNlIHRoZQphY2NvdW50IHJlZnVzZXMgdG8gc2lnbiByZXNlcnZlZCBgcmN2XypgIG5hbWVzIChzcGVjIMKnMTUpLiBUaGUgcG9vbCwKbm90IHRoZSBjYWxsZXIsIGRlcml2ZXMgdGhlIHN0b3JlZCBsZWFmIGZyb20gdGhlIGFjY291bnQgYW5kIHRoZSBpZCwKYW5kIHJlZnVzZXMgYSBzZWNvbmQgaW5zZXJ0aW9uIHVuZGVyIHRoZSBzYW1lIGlkLiBSZXR1cm5zIG5vdGhpbmc6CnRoZSBsZWFmJ3MgcG9zaXRpb24gaXMgaW4gdGhlIGBMZWFmSW5zZXJ0ZWRgIGV2ZW50IGFuZCBpbgpbYFNlbGY6OmVucm9sbG1lbnRgXS4AAAAAAApyY3ZfaW5zZXJ0AAAAAAADAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAADWVucm9sbG1lbnRfaWQAAAAAAAPuAAAAIAAAAAAAAAAKY29tbWl0bWVudAAAAAAD7gAAACAAAAABAAAD6QAAAAIAAAfQAAAACVBvb2xFcnJvcgAAAA==",
        "AAAAAAAAAEVQZXJtaXNzaW9ubGVzcyBrZWVwLWFsaXZlIGZvciBvbmUgaGlzdG9yaWNhbCByb290IGEgcHJvdmVyIHJlbGllcyBvbi4AAAAAAAAKcmVuZXdfcm9vdAAAAAAAAgAAAAAAAAAHdHJlZV9pZAAAAAAEAAAAAAAAAARyb290AAAD7gAAACAAAAAA",
        "AAAAAAAAAJZQZXJtaXNzaW9ubGVzcyBrZWVwLWFsaXZlOiBleHRlbmQgYHRyZWVfaWRgJ3Mgc3RhdGUgYW5kIGxhdGVzdCByb290CihhbmQgdGhlIGN1cnJlbnQtdHJlZSBwb2ludGVyKSB0byB0aGUgbmV0d29yaydzIG1heGltdW0gVFRMLiBDaGFuZ2VzCm5vdGhpbmcgZWxzZS4AAAAAAApyZW5ld190cmVlAAAAAAABAAAAAAAAAAd0cmVlX2lkAAAAAAQAAAABAAAD6QAAAAIAAAfQAAAACVBvb2xFcnJvcgAAAA==",
        "AAAAAAAAACZUaGUgdHJlZSBpbnNlcnRpb25zIGN1cnJlbnRseSBnbyBpbnRvLgAAAAAADGN1cnJlbnRfdHJlZQAAAAAAAAABAAAABA==",
        "AAAAAAAAADtQZXJtaXNzaW9ubGVzcyBrZWVwLWFsaXZlIGZvciBhIHBhZ2Ugb2YgYHRyZWVfaWRgJ3MgbGVhdmVzLgAAAAAMcmVuZXdfbGVhdmVzAAAAAwAAAAAAAAAHdHJlZV9pZAAAAAAEAAAAAAAAAAVzdGFydAAAAAAAAAYAAAAAAAAABWNvdW50AAAAAAAABAAAAAEAAAPpAAAAAgAAB9AAAAAJUG9vbEVycm9yAAAA",
        "AAAAAAAAAGxgTWVtYmVyc2hpcFBvb2xJbnRlcmZhY2U6OmlzX2tub3duX3Jvb3RgOiB3aGV0aGVyIGByb290YCBpcyBhIHJvb3QKdHJlZSBgdHJlZV9pZGAgb2YgdGhpcyBwb29sIGhhcyBldmVyIGhhZC4AAAANaXNfa25vd25fcm9vdAAAAAAAAAIAAAAAAAAAB3RyZWVfaWQAAAAABAAAAAAAAAAEcm9vdAAAA+4AAAAgAAAAAQAAAAE=",
        "AAAAAAAAAD9QZXJtaXNzaW9ubGVzcyBrZWVwLWFsaXZlIGZvciBvbmUgZW5yb2xsbWVudCdzIHJlY29yZCBhbmQgbGVhZi4AAAAAEHJlbmV3X2Vucm9sbG1lbnQAAAACAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAADWVucm9sbG1lbnRfaWQAAAAAAAPuAAAAIAAAAAA=",
        "AAAAAQAAACxXaGF0IGEgY29tcGxldGlvbiBoYW5kcyBiYWNrIHRvIHRoZSBhY2NvdW50LgAAAAAAAAAKQ29tcGxldGlvbgAAAAAAAgAAABtUaGUgYXR0ZW1wdCB0aGF0IGNvbXBsZXRlZC4AAAAACmF0dGVtcHRfaWQAAAAAAAYAAAIQVGhlIGNyZWRlbnRpYWxzIHRoYXQgb2NjdXBpZWQgdGhlIHJlcGxhY2VkIHNpZ25lciBzbG90cyAqKmluIHRoZQphdHRlbXB0J3Mgc291cmNlIGRvY3VtZW50KiosIGFzIGRlcml2ZWQgYXQgVDE6IHRoZSBhcHBsaWVkIGRvY3VtZW50CmZvciBsb3N0LWtleSwgdGhlIGJhc2VsaW5lIGZvciBjb21wcm9taXNlLiBUaGUgYWNjb3VudCBmaW5nZXJwcmludHMKdGhlbSBvdmVyIGNhbm9uaWNhbCBrZXlzIGFuZCByZXZva2VzIHRoZW0gdG9nZXRoZXIgd2l0aCBldmVyeQpjcmVkZW50aWFsIHRoZSBjb21wbGV0aW9uIHJlbW92ZWQgZnJvbSBpdHMgY3VycmVudCBkb2N1bWVudC4gV2l0aG91dAp0aGVzZSwgYSBiYXNlbGluZSBjcmVkZW50aWFsIHJlcGxhY2VkIGJ5IGEgY29tcHJvbWlzZSByZWNvdmVyeSwgYW5kCmFscmVhZHkgYWJzZW50IGZyb20gdGhlIGN1cnJlbnQgZG9jdW1lbnQsIHdvdWxkIHN0YXkgdW5yZXZva2VkIGFuZApjb3VsZCBiZSByZXN0b3JlZCBieSBhIGxhdGVyIHJlY292ZXJ5IGZyb20gdGhlIHNhbWUgYmFzZWxpbmUuAAAACHJlcGxhY2VkAAAD6gAAB9AAAAAKQ3JlZGVudGlhbAAA",
        "AAAAAgAAAFhXaGF0IGByY3Zfc3luY2AgZGlkLCBzbyB0aGUgYWNjb3VudCBrbm93cyB3aGljaCBvZiBpdHMgb3duIGVmZmVjdHMgdG8KYXBwbHkgKHNwZWMgwqcxMCkuAAAAAAAAAAtTeW5jT3V0Y29tZQAAAAAFAAAAAAAAAB9Ob3RoaW5nIGFib3V0IHJlY292ZXJ5IGNoYW5nZWQuAAAAAAlVbmNoYW5nZWQAAAAAAAAAAAAAMEEgY29uZmlndXJhdGlvbiB3YXMgZW5yb2xsZWQgYXQgdGhpcyBjb250cm9sbGVyLgAAAAhFbnJvbGxlZAAAAAAAAAAoVGhlIGVucm9sbGVkIGNvbmZpZ3VyYXRpb24gd2FzIHJlcGxhY2VkLgAAAAxSZWNvbmZpZ3VyZWQAAAAAAAAAdVRoZSBjb25maWd1cmF0aW9uIHdhcyByZW1vdmVkIGZyb20gdGhpcyBjb250cm9sbGVyIChyZWNvdmVyeQpyZW1vdmVkLCBvciB0aGUgYWNjb3VudCBzd2l0Y2hlZCB0byBhbm90aGVyIGNvbnRyb2xsZXIpLgAAAAAAAAdSZW1vdmVkAAAAAAEAAAFzVGhlIGF1dGhvcml6ZWQgYXR0ZW1wdCBjb21wbGV0ZWQgaW4gdGhpcyBpbnZvY2F0aW9uLiBUaGUgYWNjb3VudAppbnNlcnRzIHRoZSBuZXcgbGVhZiBpZiB0aGUgZW5yb2xsbWVudCBpZCBjaGFuZ2VkLCByZWNvcmRzIHRoZQplbnJvbGxtZW50IGlkLCByZXZva2VzIFtgQ29tcGxldGlvbjo6cmVwbGFjZWRgXSB0b2dldGhlciB3aXRoIGV2ZXJ5CmNyZWRlbnRpYWwgdGhlIGNvbXBsZXRpb24gcmVtb3ZlZCBmcm9tIGl0cyBjdXJyZW50IGRvY3VtZW50IChzcGVjIMKnODsKYGNyZWRlbnRpYWw6OnJldm9jYXRpb25zYCBjb21wdXRlcyB0aGUgdW5pb24pLCBjbGVhcnMKaXRzIHBlbmRpbmcgdXBncmFkZSwgYW5kIGNsZWFycyBpdHMgZnJlZXplIG1pcnJvci4AAAAACUNvbXBsZXRlZAAAAAAAAAEAAAfQAAAACkNvbXBsZXRpb24AAA==",
        "AAAAAgAAAEhXaGljaCBwaGFzZSBvZiBhbiBhY2NvdW50IHVwZ3JhZGUgYHJjdl91cGdyYWRlYCBpcyBjaGVja2luZyAoc3BlYyDCpzEyKS4AAAAAAAAAC1VwZ3JhZGVTdGVwAAAAAAIAAAABAAAAlWBzY2hlZHVsZV91cGdyYWRlYDogcmVmdXNlIGR1cmluZyBhbiBhdXRob3JpemVkIHdpbmRvdzsgdW5kZXIKYFByb3RlY3RlZGAsIHJlcXVpcmUgcmVjb3JkZWQgYXBwcm92YWxzIG9mIHRoaXMgc3ViamVjdCB2YWxpZCB0aHJvdWdoCnRoZSBnaXZlbiBsZWRnZXIuAAAAAAAACFNjaGVkdWxlAAAAAgAAB9AAAAAOVXBncmFkZVN1YmplY3QAAAAAAAQAAAABAAAAhWBleGVjdXRlX3VwZ3JhZGVgIG9mIGEgcmVxdWVzdCByZWNvcmRlZCBhdCB0aGlzIGVwb2NoOiByZWZ1c2UgZHVyaW5nCmFuIGF1dGhvcml6ZWQgd2luZG93IG9yIGlmIHRoZSBlcG9jaCBtb3ZlZCwgdGhlbiBidW1wIHRoZSBlcG9jaC4AAAAAAAAHRXhlY3V0ZQAAAAABAAAABg==",
        "AAAABAAAAKFFdmVyeXRoaW5nIGEgcmVjb3ZlcnkgY29udHJvbGxlciBjYW4gcmVmdXNlLiBDb2RlcyBhcmUgc2VxdWVudGlhbCBmcm9tIDEKaW4gZGVjbGFyYXRpb24gb3JkZXIgYW5kIGFyZSB3aXJlIGZvcm1hdDogYXBwZW5kIG5ldyB2YXJpYW50cyBhdCB0aGUKZW5kLCBuZXZlciByZW9yZGVyLgAAAAAAAAAAAAANUmVjb3ZlcnlFcnJvcgAAAAAAAB8AAABBTm8gY29uZmlndXJhdGlvbiBpcyBlbnJvbGxlZCBmb3IgdGhpcyBhY2NvdW50IGF0IHRoaXMgY29udHJvbGxlci4AAAAAAAALTm90RW5yb2xsZWQAAAAAAQAAAIBBbiBhdHRlbXB0IGlzIGF1dGhvcml6ZWQgYW5kIGxpdmU6IGJlZ2luLCBwb2xpY3kgY2hhbmdlcywgYW5kIHVwZ3JhZGVzIGFyZSByZWZ1c2VkIHVudGlsIGl0IGNvbXBsZXRlcywgaXMgY2FuY2VsbGVkLCBvciBleHBpcmVzLgAAABFBdHRlbXB0QXV0aG9yaXplZAAAAAAAAAIAAAAvTm8gYXR0ZW1wdCB3aXRoIHRoaXMgaWQgZXhpc3RzIGZvciB0aGUgYWNjb3VudC4AAAAADU5vU3VjaEF0dGVtcHQAAAAAAAADAAAAY1RoZSBhdHRlbXB0IGlzIHRlcm1pbmFsLCBleHBpcmVkLCBmcm9tIGFuIG9sZGVyIGVwb2NoLCBvciBpbnZhbGlkYXRlZCBieSBhIHNpYmxpbmcncyBhdXRob3JpemF0aW9uLgAAAAAOQXR0ZW1wdE5vdExpdmUAAAAAAAQAAABASW5pdGlhdGlvbiBldmlkZW5jZSBmb3IgYW4gYXR0ZW1wdCB0aGF0IGlzIG5vIGxvbmdlciBjb2xsZWN0aW5nLgAAABRBdHRlbXB0Tm90Q29sbGVjdGluZwAAAAUAAAAlQ29tcGxldGlvbiBiZWZvcmUgYGV4ZWN1dGFibGVfYWZ0ZXJgLgAAAAAAABBOb3RFeGVjdXRhYmxlWWV0AAAABgAAAGZUaGUgY29tcGxldGlvbiBjb250ZXh0LCBvciB0aGUgY29tcGlsZWQgZG9jdW1lbnQgaGFzaCwgZG9lcyBub3QgbWF0Y2ggdGhlIGF1dGhvcml6ZWQgYXR0ZW1wdCdzIHRhcmdldC4AAAAAAAtXcm9uZ1RhcmdldAAAAAAHAAAAKFRoZSBhZGRyZXNzIGlzIG5vdCBhbiBlbnJvbGxlZCBndWFyZGlhbi4AAAAMTm90QUd1YXJkaWFuAAAACAAAADtUaGlzIGd1YXJkaWFuIG9yIGZhY3RvciBhbHJlYWR5IGNvdW50ZWQgZm9yIHRoaXMgc3RhdGVtZW50LgAAAAAOQWxyZWFkeUNvdW50ZWQAAAAAAAkAAAApVGhlIGVucm9sbGVkIG1vZGUgaGFzIG5vIGd1YXJkaWFuIGZhY3Rvci4AAAAAAAASTW9kZUhhc05vR3VhcmRpYW5zAAAAAAAKAAAAI1RoZSBlbnJvbGxlZCBtb2RlIGhhcyBubyBaSyBmYWN0b3IuAAAAAAtNb2RlSGFzTm9aawAAAAALAAAAPlRoZSBhZGFwdGVyIHJlZnVzZWQgdGhlIHByb29mIChpdHMgYFprQWRhcHRlckVycm9yYCBzYXlzIHdoeSkuAAAAAAASWmtFdmlkZW5jZVJlamVjdGVkAAAAAAAMAAAAH1RoZSBwcm9vZidzIG51bGxpZmllciBpcyBzcGVudC4AAAAADk51bGxpZmllclNwZW50AAAAAAANAAAAPlRoZSBzdGF0ZW1lbnQncyBmcmVzaG5lc3MgYm91bmQgaGFzIHBhc3NlZCBvciByZWFjaGVzIHRvbyBmYXIuAAAAAAAPRXZpZGVuY2VFeHBpcmVkAAAAAA4AAABHVGhlIHN0YXRlbWVudCBjYW5ub3QgYmUgZW5jb2RlZCAoYSBub24tY29udHJhY3QgYWNjb3VudCBvciBjb250cm9sbGVyKS4AAAAAEEludmFsaWRTdGF0ZW1lbnQAAAAPAAAAXVJlY29yZGVkIGFwcHJvdmFscyBkbyBub3Qgc2F0aXNmeSB0aGUgZW5yb2xsZWQgY29uZGl0aW9uIGZvciB0aGlzIHJlY29uZmlndXJhdGlvbiBvciB1cGdyYWRlLgAAAAAAAA9Db25kaXRpb25Ob3RNZXQAAAAAEAAAACdUaGUgYWNjb3VudCdzIGBtYXgtY2FuY2Vsc2AgaXMgdXNlZCB1cC4AAAAAEU1heENhbmNlbHNSZWFjaGVkAAAAAAAAEQAAADJPd25lciBjYW5jZWxsYXRpb24gaXMgb25seSBhdmFpbGFibGUgdW5kZXIgYExvc3NgLgAAAAAAEk93bmVyQ2FuY2VsUmVmdXNlZAAAAAAAEgAAAEJUaGUgcmVwbGFjZW1lbnQgc2V0IGJyZWFrcyBhIMKnNy4zIHJ1bGUsIG9yIGRlcml2YXRpb24gcmVmdXNlZCBpdC4AAAAAABNJbnZhbGlkUmVwbGFjZW1lbnRzAAAAABMAAAA6VGhlIHRhcmdldCBvciBhIHJlcGxhY2VtZW50IGNvbnRhaW5zIGEgcmV2b2tlZCBjcmVkZW50aWFsLgAAAAAAEUNyZWRlbnRpYWxSZXZva2VkAAAAAAAAFAAAALJUaGUgWksgZW5yb2xsbWVudCBpZCB3YXMgZW5yb2xsZWQgZm9yIHRoaXMgYWNjb3VudCBiZWZvcmUgKHRoZSBjb250cm9sbGVyIGNoZWNrcyB0aGUgYWNjb3VudCdzIGBpc19lbnJvbGxlZF9pZGAgYXQgVDE7IHRoZSBwdXJlIGBkZXJpdmVfdGFyZ2V0YCBjYW5ub3Qgc2VlIHRoZSBhY2NvdW50J3MgaGlzdG9yeSkuAAAAAAASRW5yb2xsbWVudElkUmV1c2VkAAAAAAAVAAAALkNvbXByb21pc2UgcmVjb3Zlcnkgd2l0aCBubyBiYXNlbGluZSBlbnJvbGxlZC4AAAAAAApOb0Jhc2VsaW5lAAAAAAAWAAAAQENvbXByb21pc2UgcmVjb3ZlcnkgYmVmb3JlIHRoZSBiYXNlbGluZSdzIGNvbnRlbnQgd2FzIHB1Ymxpc2hlZC4AAAAUQmFzZWxpbmVOb3RQdWJsaXNoZWQAAAAXAAAAPlRoZSBwdWJsaXNoZWQgZG9jdW1lbnQgZG9lcyBub3QgaGFzaCB0byB0aGUgZW5yb2xsZWQgYmFzZWxpbmUuAAAAAAAQQmFzZWxpbmVNaXNtYXRjaAAAABgAAABTVGhlIGFkYXB0ZXIncyBjaXJjdWl0IGlkIG9yIHRyZWUgZGVwdGggZG9lcyBub3QgbWF0Y2ggdGhlIGVucm9sbGVkIGZhY3RvciBhbmQgcG9vbC4AAAAAEFprV2lyaW5nTWlzbWF0Y2gAAAAZAAAAMlRoZSBaSyBmYWN0b3IgY2hhbmdlZCB3aXRob3V0IGEgbmV3IGVucm9sbG1lbnQgaWQuAAAAAAAWWmtGYWN0b3JDaGFuZ2VkSW5QbGFjZQAAAAAAGgAAAHVUaGUgY29uZmlndXJhdGlvbiBpcyBtYWxmb3JtZWQgKGZvciBleGFtcGxlLCB0aGUgYWNjb3VudCBpcyBvbmUgb2YgaXRzIG93biBndWFyZGlhbnMsIG9yIHRoZSBxdW9ydW0gaXMgb3V0IG9mIHJhbmdlKS4AAAAAAAAUSW52YWxpZENvbmZpZ3VyYXRpb24AAAAbAAAAMUFuIHVwZ3JhZGUgcmVxdWVzdCByZWNvcmRlZCB1bmRlciBhbiBvbGRlciBlcG9jaC4AAAAAAAAMU3RhbGVVcGdyYWRlAAAAHAAAAC9BIGxlZGdlci1zZXF1ZW5jZSBjb21wdXRhdGlvbiBvdmVyZmxvd2VkIGB1MzJgLgAAAAAOTGVkZ2VyT3ZlcmZsb3cAAAAAAB0AAAA9VGhlIHBvbGljeSB3YXMgYXR0YWNoZWQgdG8gYSBjb250ZXh0IHJ1bGUgb2YgdGhlIHdyb25nIHNoYXBlLgAAAAAAABRNYWxmb3JtZWRDb250ZXh0UnVsZQAAAB4AAAB5QSBjcmVkZW50aWFsIHRoZSByZXBsYWNlbWVudCBzZXQgcmVwbGFjZXMgc3RpbGwgYXBwZWFycyBpbiB0aGUgdGFyZ2V0IChhIHN3YXAgb3IgYSBuby1vcCByZXBsYWNlbWVudCwgc3BlYyDCpzcuMyBydWxlIDgpLgAAAAAAABpSZXBsYWNlZENyZWRlbnRpYWxSZXRhaW5lZAAAAAAAHw==",
        "AAAAAgAAAE5BIHNpZ25lciBjcmVkZW50aWFsLCBzaGFwZWQgbGlrZSBPWiBgc3RlbGxhcl9hY2NvdW50czo6c21hcnRfYWNjb3VudDo6U2lnbmVyYC4AAAAAAAAAAAAKQ3JlZGVudGlhbAAAAAAAAgAAAAEAAABsYFNpZ25lcjo6RGVsZWdhdGVkKGFkZHJlc3MpYDogYSBgRy4uLmAgb3IgYEMuLi5gIGFkZHJlc3MgdGhhdAphdXRoZW50aWNhdGVzIHRocm91Z2ggQ0FQLTAwNzEgZGVsZWdhdGVkIGF1dGguAAAACURlbGVnYXRlZAAAAAAAAAEAAAATAAAAAQAAAEhgU2lnbmVyOjpFeHRlcm5hbCh2ZXJpZmllciwga2V5KWA6IGEga2V5IGNoZWNrZWQgYnkgYSB2ZXJpZmllcgpjb250cmFjdC4AAAAIRXh0ZXJuYWwAAAACAAAAEwAAAA4=",
        "AAAAAQAAAGxPbmUgZGVzaWduYXRlZCBzaWduZXIgc2xvdCBhbmQgdGhlIGNyZWRlbnRpYWwgdGhhdCByZXBsYWNlcyB3aGF0ZXZlcgp0aGF0IHNsb3QgaG9sZHMgaW4gdGhlIHNvdXJjZSBkb2N1bWVudC4AAAAAAAAAC1JlcGxhY2VtZW50AAAAAAIAAAA4VGhlIGNyZWRlbnRpYWwgdGhlIHRhcmdldCBkb2N1bWVudCBnaXZlcyB0aGF0IHNpZ25lciBpZC4AAAAKY3JlZGVudGlhbAAAAAAH0AAAAApDcmVkZW50aWFsAAAAAABDQSBkb2N1bWVudCBzaWduZXIgaWQgbGlzdGVkIGluIHRoZSBlbnJvbGxlZCBgcmVjb3ZlcnkucmVwbGFjZWFibGVgLgAAAAAJc2lnbmVyX2lkAAAAAAAAEA==",
        "AAAAAQAAAVVBIFpLIGVucm9sbG1lbnQgYSByZWNvdmVyeSBjb21wbGV0aW9uIGluc3RhbGxzLgoKVGhlIGNvbW1pdG1lbnQgaXMgYm91bmQgaGVyZSwgbm90IG9ubHkgdGhlIGlkOiBjb21wbGV0aW9uIHJ1bnMgdW5kZXIgdGhlCnplcm8tc2lnbmVyIHJlY292ZXJ5IHJ1bGUsIHNvIG5vdGhpbmcgc2lnbnMgaXRzIGFyZ3VtZW50cywgYW5kIGEKY29tbWl0bWVudCBzdXBwbGllZCBvbmx5IGF0IGNvbXBsZXRpb24gY291bGQgYmUgc3dhcHBlZCBieSB3aG9ldmVyCnN1Ym1pdHMgdGhlIGNvbXBsZXRpbmcgdHJhbnNhY3Rpb24gZmlyc3Qg4oCUIGhhbmRpbmcgdGhlbSB0aGUgYWNjb3VudCdzCm5leHQgWksgZmFjdG9yLgAAAAAAAAAAAAAMWmtFbnJvbGxtZW50AAAAAgAAARlUaGUgbmV3IGxlYWYncyBpbm5lciBjb21taXRtZW50LCBgUG9zZWlkb24yKERPTV9MRUFGLCBzZWNyZXQpYC4KRGVyaXZhdGlvbiB3cml0ZXMgYGlkYCBhbmQgYGNvbW1pdG1lbnRgIGludG8gdGhlIHRhcmdldCBkb2N1bWVudCdzCnJlY292ZXJ5IHNlY3Rpb24sIHNvIHRoZSB0YXJnZXQgaGFzaCBiaW5kcyB0aGVtLCBhbmQgdGhlIGNvbXBsZXRpbmcKYGFwcGx5X2RvY2AgaW5zZXJ0cyB0aGUgbGVhZiBmcm9tIHRoZSBjb21waWxlZCB0YXJnZXQsIG5ldmVyIGZyb20gYQpjYWxsIGFyZ3VtZW50LgAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAE1UaGUgbmV3IGVucm9sbG1lbnQgaWQuIE11c3QgbmV2ZXIgaGF2ZSBiZWVuIGVucm9sbGVkIGZvciB0aGlzCmFjY291bnQgYmVmb3JlLgAAAAAAAAJpZAAAAAAD7gAAACA=",
        "AAAAAQAAAG9FdmVyeXRoaW5nIGEgYExvc3RLZXlgL2BDb21wcm9taXNlYCBhdHRlbXB0IGNoYW5nZXMgYWJvdXQgdGhlIHNvdXJjZQpkb2N1bWVudC4gU2VlIGBkb2NzL3JlY292ZXJ5L3NwZWMubWRgIMKnNy4AAAAAAAAAAA5SZXBsYWNlbWVudFNldAAAAAAAAgAAAHVTaWduZXIgcmVwbGFjZW1lbnRzIGluIHN0cmljdGx5IGFzY2VuZGluZyBgc2lnbmVyX2lkYCBieXRlIG9yZGVyCihzb3J0ZWQsIG5vIGR1cGxpY2F0ZXMpIOKAlCB0aGUgb25lIGNhbm9uaWNhbCBvcmRlci4AAAAAAAAHc2lnbmVycwAAAAPqAAAH0AAAAAtSZXBsYWNlbWVudAAAAAElVGhlIGZyZXNoIFpLIGVucm9sbG1lbnQgdGhlIGNvbXBsZXRpb24gaW5zdGFsbHMsIHJlcXVpcmVkIGV4YWN0bHkKd2hlbiB0aGUgZW5yb2xsZWQgbW9kZSBoYXMgYSBaSyBmYWN0b3IgKGEgWkstZXZpZGVuY2VkIGNvbXBsZXRpb24KY29uc3VtZXMgdGhlIGVucm9sbGVkIGNyZWRlbnRpYWwsIHNvIGl0IG11c3QgaW5zdGFsbCBhIGZyZXNoIG9uZSkuCkVtcHR5IG9yIG9uZSBlbnRyeSDigJQgYSBgVmVjYCBiZWNhdXNlIGAjW2NvbnRyYWN0dHlwZV1gIGNhbm5vdCBkZXJpdmUKYE9wdGlvbjxDdXN0b21TdHJ1Y3Q+YC4AAAAAAAANemtfZW5yb2xsbWVudAAAAAAAA+oAAAfQAAAADFprRW5yb2xsbWVudA==",
        "AAAAAQAAAI5XaGljaCBlbnJvbGxlZCBaSyBmYWN0b3IgYSBzdGF0ZW1lbnQgaXMgY2hlY2tlZCBhZ2FpbnN0LiBUaGUgY29udHJvbGxlcgpidWlsZHMgdGhpcyBmcm9tIGl0cyBzdG9yZWQgY29uZmlndXJhdGlvbiDigJQgbmV2ZXIgZnJvbSBjYWxsZXIgaW5wdXQuAAAAAAAAAAAACVprQmluZGluZwAAAAAAAAMAAAB1VGhlIGNpcmN1aXQgaWRlbnRpdHkgdGhlIGVucm9sbGluZyBkb2N1bWVudCBuYW1lZC4gVGhlIGFkYXB0ZXIKcmVmdXNlcyBhbnkgYmluZGluZyB3aG9zZSBgY2lyY3VpdF9pZGAgaXMgbm90IGl0cyBvd24uAAAAAAAACmNpcmN1aXRfaWQAAAAAA+4AAAAgAAAAyFRoZSBlbnJvbGxlZCBjcmVkZW50aWFsJ3MgaWQsIGJvdW5kIGludG8gaXRzIGxlYWYgYW5kIGl0cyBudWxsaWZpZXIuCkEgbGVhZiBlbnJvbGxlZCB1bmRlciBhbnkgb3RoZXIgaWQg4oCUIGluY2x1ZGluZyB0aGUgYWNjb3VudCdzIG93bgplYXJsaWVyIGVucm9sbG1lbnRzIOKAlCBjYW5ub3Qgc2F0aXNmeSBhIHByb29mIGZvciB0aGlzIGJpbmRpbmcuAAAADWVucm9sbG1lbnRfaWQAAAAAAAPuAAAAIAAAAEVUaGUgZW5yb2xsZWQgbWVtYmVyc2hpcCBwb29sLiBSb290cyBhcmUgYWNjZXB0ZWQgb25seSBmcm9tIHRoaXMgcG9vbC4AAAAAAAAEcG9vbAAAABM=",
        "AAAAAQAAABpPbmUgWksgcHJvb2YgYXMgc3VibWl0dGVkLgAAAAAAAAAAAApaa0V2aWRlbmNlAAAAAAAEAAAAP1RoZSBjcmVkZW50aWFsJ3MgbnVsbGlmaWVyICh0aGUgY2lyY3VpdCdzIHNlY29uZCBwdWJsaWMgaW5wdXQpLgAAAAAJbnVsbGlmaWVyAAAAAAAD7gAAACAAAAAVVGhlIHNlcmlhbGl6ZWQgcHJvb2YuAAAAAAAABXByb29mAAAAAAAADgAAAGBUaGUgcm9vdCB0aGUgcHJvb2Ygd2FzIGdlbmVyYXRlZCBhZ2FpbnN0OyBtdXN0IGJlIGFjY2VwdGFibGUgdG8gdGhlCmVucm9sbGVkIHBvb2wgZm9yIGB0cmVlX2lkYC4AAAAEcm9vdAAAA+4AAAAgAAAALFRoZSBwb29sIHRyZWUgdGhlIHByb29mJ3MgTWVya2xlIHBhdGggaXMgaW4uAAAAB3RyZWVfaWQAAAAABA==",
        "AAAABAAAAIVFdmVyeXRoaW5nIFtgWmtBZGFwdGVySW50ZXJmYWNlOjp2ZXJpZnlgXSBjYW4gcmVmdXNlLiBFYWNoIGlzIGEgcmVmdXNhbApvZiB0aGlzIGV2aWRlbmNlIG9ubHk7IG5vbmUgaXMgYSBzdGF0ZW1lbnQgYWJvdXQgdGhlIGFjY291bnQuAAAAAAAAAAAAAA5aa0FkYXB0ZXJFcnJvcgAAAAAACAAAADlUaGUgYmluZGluZyBuYW1lcyBhIGNpcmN1aXQgdGhpcyBhZGFwdGVyIGRvZXMgbm90IHZlcmlmeS4AAAAAAAAPQ2lyY3VpdE1pc21hdGNoAAAAAAEAAABYVGhlIHN0YXRlbWVudCBjYW5ub3QgYmUgcHJvamVjdGVkIChpdHMgYWNjb3VudCBvciBjb250cm9sbGVyIGlzIG5vdCBhIGNvbnRyYWN0IGFkZHJlc3MpLgAAABBJbnZhbGlkU3RhdGVtZW50AAAAAgAAADdUaGUgcm9vdCBvciBudWxsaWZpZXIgaXMgbm90IGEgY2Fub25pY2FsIGZpZWxkIGVsZW1lbnQuAAAAABFOb25DYW5vbmljYWxGaWVsZAAAAAAAAAMAAAA0VGhlIGVucm9sbGVkIHBvb2wgZG9lcyBub3QgYWNjZXB0IGAodHJlZV9pZCwgcm9vdClgLgAAAAtVbmtub3duUm9vdAAAAAAEAAAAJlRoZSBlbnJvbGxlZCBwb29sIGNvdWxkIG5vdCBiZSBjYWxsZWQuAAAAAAAPUG9vbFVuYXZhaWxhYmxlAAAAAAUAAAA3VGhlIHByb29mIGlzIG5vdCB0aGUgbGVuZ3RoL3NoYXBlIHRoZSBjaXJjdWl0IHByb2R1Y2VzLgAAAAAOTWFsZm9ybWVkUHJvb2YAAAAAAAYAAAAgVGhlIHZlcmlmaWVyIHJlamVjdGVkIHRoZSBwcm9vZi4AAAANUHJvb2ZSZWplY3RlZAAAAAAAAAcAAABAVGhlIHZlcmlmaWVyIGNvdWxkIG5vdCBiZSBjYWxsZWQgb3IgZmFpbGVkIHRvIHBhcnNlIGl0cyBvd24ga2V5LgAAABNWZXJpZmllclVuYXZhaWxhYmxlAAAAAAg=",
        "AAAABAAAAKhBIGJhY2tlbmQgdmVyaWZpZXIncyByZWZ1c2Fscy4gU2FtZSBuYW1lcywgb3JkZXIsIGFuZCBjb2RlcyAoMSwgMiwgMykKYXMgTmlkbydzIGNvbnN0cnVjdG9ybGVzcyBgbmlkby1yZWNvdmVyeS12ZXJpZmllcmAsIHNvIGVpdGhlciBjYW4gc2l0CmJlaGluZCBhbiBhZGFwdGVyIHVuY2hhbmdlZC4AAAAAAAAAElByb29mVmVyaWZpZXJFcnJvcgAAAAAAAwAAAAxWa1BhcnNlRXJyb3IAAAAMVmtQYXJzZUVycm9yAAAAAQAAAA9Qcm9vZlBhcnNlRXJyb3IAAAAAD1Byb29mUGFyc2VFcnJvcgAAAAACAAAAElZlcmlmaWNhdGlvbkZhaWxlZAAAAAAAElZlcmlmaWNhdGlvbkZhaWxlZAAAAAAAAw==",
        "AAAAAgAAAHdXaG8gbWF5IGNoYW5nZSB0aGUgcmVjb3ZlcnkgY29uZmlndXJhdGlvbiwgYW5kIHdoZXRoZXIgYW4gYXV0aG9yaXplZAphdHRlbXB0IGZyZWV6ZXMgb3JkaW5hcnkgYWN0aXZpdHkgKHNwZWMgwqcyLCDCpzkpLgAAAAAAAAAAD1JlY292ZXJ5UHJvZmlsZQAAAAACAAAAAAAAAHdPd25lciBhdXRob3JpemF0aW9uIGFsb25lIHJlY29uZmlndXJlczsgYWN0aXZpdHkgY29udGludWVzIHdoaWxlIGFuCmF0dGVtcHQgaXMgYXV0aG9yaXplZDsgdGhlIG93bmVyIGNhbiBhbHdheXMgY2FuY2VsLgAAAAAETG9zcwAAAAAAAABpUmVjb25maWd1cmF0aW9uIGFuZCB1cGdyYWRlcyBhbHNvIG5lZWQgdGhlIGVucm9sbGVkIGNvbmRpdGlvbjsgYW4KYXV0aG9yaXplZCBhdHRlbXB0IGZyZWV6ZXMgdGhlIGFjY291bnQuAAAAAAAACVByb3RlY3RlZAAAAA==",
        "AAAAAQAAACJUaGUgWksgZmFjdG9yIChzcGVjIMKnMy4xLCDCpzMuNCkuAAAAAAAAAAAAEENvbXBpbGVkWmtGYWN0b3IAAAAFAAAANFRoZSBjb25zdHJ1Y3Rvcmxlc3MgWksgYWRhcHRlciB0aGUgY29udHJvbGxlciBjYWxscy4AAAAHYWRhcHRlcgAAAAATAAAAVGBzaGEyNTZgIG9mIHRoZSBhZGFwdGVyJ3MgdmVyaWZpY2F0aW9uIGtleTsgbXVzdCBlcXVhbCB0aGUgYWRhcHRlcidzCmBjaXJjdWl0X2lkKClgLgAAAApjaXJjdWl0X2lkAAAAAAPuAAAAIAAAAHJUaGUgY3VycmVudCBjcmVkZW50aWFsJ3MgaW5uZXIgY29tbWl0bWVudCwgYFBvc2VpZG9uMihET01fTEVBRiwKc2VjcmV0KWAsIGZyb20gd2hpY2ggdGhlIGFjY291bnQgaW5zZXJ0cyB0aGUgbGVhZi4AAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAD9UaGUgY3VycmVudCBjcmVkZW50aWFsJ3MgaWQsIGJvdW5kIGludG8gaXRzIGxlYWYgYW5kIG51bGxpZmllci4AAAAADWVucm9sbG1lbnRfaWQAAAAAAAPuAAAAIAAAACxUaGUgbWVtYmVyc2hpcCBwb29sIHJvb3RzIGFyZSBhY2NlcHRlZCBmcm9tLgAAAARwb29sAAAAEw==",
        "AAAAAQAAABRUaGUgZ3VhcmRpYW4gZmFjdG9yLgAAAAAAAAATQ29tcGlsZWRHdWFyZGlhblNldAAAAAACAAAAQEd1YXJkaWFuIGFkZHJlc3NlcyAoYEcuLi5gIG9yIGBDLi4uYCksIG5ldmVyIHRoZSBhY2NvdW50IGl0c2VsZi4AAAAJZ3VhcmRpYW5zAAAAAAAD6gAAABMAAAAhYDEgPD0gcXVvcnVtIDw9IGd1YXJkaWFucy5sZW4oKWAuAAAAAAAABnF1b3J1bQAAAAAABA==",
        "AAAAAgAAACBXaGljaCBmYWN0b3JzIGEgc3RhdGVtZW50IG5lZWRzLgAAAAAAAAAUQ29tcGlsZWRSZWNvdmVyeU1vZGUAAAADAAAAAQAAAAAAAAAMR3VhcmRpYW5Pbmx5AAAAAQAAB9AAAAATQ29tcGlsZWRHdWFyZGlhblNldAAAAAABAAAAAAAAAAZaa09ubHkAAAAAAAEAAAfQAAAAEENvbXBpbGVkWmtGYWN0b3IAAAABAAAAAAAAAAhDb21iaW5lZAAAAAIAAAfQAAAAE0NvbXBpbGVkR3VhcmRpYW5TZXQAAAAH0AAAABBDb21waWxlZFprRmFjdG9y",
        "AAAAAQAAAB1BIGNvbXBpbGVkIGByZWNvdmVyeWAgbWVtYmVyLgAAAAAAAAAAAAAWQ29tcGlsZWRSZWNvdmVyeUNvbmZpZwAAAAAACQAAAFRUaGUgZW5yb2xsZWQgYmFzZWxpbmUncyBjYW5vbmljYWwgZG9jdW1lbnQgaGFzaCwgaWYgY29tcHJvbWlzZQpyZWNvdmVyeSBpcyBlbnJvbGxlZC4AAAAIYmFzZWxpbmUAAAPoAAAD7gAAACAAAADUW2Bjb25maWdfaGFzaGBdIG9mIHRoZSBjYW5vbmljYWwgSlNPTiBvZiB0aGUgcmVjb3ZlcnkgbWVtYmVyLCBjb21wdXRlZApieSB0aGUgZG9jIGNvbXBpbGVyIChzcGVjIMKnMy4yKS4gQ29uZmlndXJhdGlvbgppZGVudGl0eTogdHdvIGNvbXBpbGVkIGNvbmZpZ3VyYXRpb25zIHdpdGggdGhlIHNhbWUgYGNvbmZpZ19oYXNoYCBhcmUKdGhlIHNhbWUgY29uZmlndXJhdGlvbi4AAAALY29uZmlnX2hhc2gAAAAD7gAAACAAAAAgVGhlIGFkb3B0ZWQgY29udHJvbGxlciBpbnN0YW5jZS4AAAAKY29udHJvbGxlcgAAAAAAEwAAAAAAAAANZGVsYXlfbGVkZ2VycwAAAAAAAAQAAAAAAAAADmV4cGlyeV9sZWRnZXJzAAAAAAAEAAAAAAAAAAttYXhfY2FuY2VscwAAAAAEAAAAAAAAAARtb2RlAAAH0AAAABRDb21waWxlZFJlY292ZXJ5TW9kZQAAAAAAAAAHcHJvZmlsZQAAAAfQAAAAD1JlY292ZXJ5UHJvZmlsZQAAAAB7U2lnbmVyIGlkcyAobm90IGNyZWRlbnRpYWwgZmluZ2VycHJpbnRzKSBhIHJlY292ZXJ5IG1heSByZXBsYWNlLCBzbwpyb3RhdGluZyBhIGtleSBkb2VzIG5vdCBjaGFuZ2UgdGhlIGNvbmZpZ3VyYXRpb24gKCM5MikuAAAAAAtyZXBsYWNlYWJsZQAAAAPqAAAAEA==",
        "AAAAAQAAAmFPbmUgcGVuZGluZyBhY2NvdW50IHVwZ3JhZGUgKHNwZWMgwqcxMikuCgpTdGFsZW5lc3MgaXMganVkZ2VkIGFnYWluc3QgdGhlIGFjY291bnQncyBvd24gKipyZWNvdmVyeSBnZW5lcmF0aW9uKiosIGEKYHU2NGAgdGhlIGFjY291bnQga2VlcHMgaW4gaXRzIG93biBzdG9yYWdlLiBJdCBzdGFydHMgYXQgMCBhbmQgaXMgbmV2ZXIKcmVzZXQuIEl0IGFkdmFuY2VzIG9uIGV2ZXJ5IGByY3Zfc3luY2Agb3V0Y29tZSBvdGhlciB0aGFuIGBVbmNoYW5nZWRgCihgY29udHJvbGxlcjo6U3luY091dGNvbWU6OmJ1bXBzX2dlbmVyYXRpb25gKSBhbmQgb24gZXZlcnkgZXhlY3V0ZWQKdXBncmFkZS4KClRoZSBjb250cm9sbGVyJ3MgZXBvY2ggY2Fubm90IHBsYXkgdGhpcyByb2xlLiBJdCBiZWxvbmdzIHRvIG9uZQpjb250cm9sbGVyIGFuZCBkb2VzIG5vdCBleGlzdCB3aGlsZSB0aGUgYWNjb3VudCBpcyB1bmVucm9sbGVkLCBzbyBhCnJlcXVlc3Qgc2NoZWR1bGVkIHVuZW5yb2xsZWQgd291bGQgc3Vydml2ZSBlbnJvbGxpbmcgcmVjb3ZlcnkgYW5kCnJlbW92aW5nIGl0IGFnYWluOiB0aGUgZmluYWwgc3RhdGUgaGFzIG5vIGNvbnRyb2xsZXIsIGp1c3QgYXMgYXQKc2NoZWR1bGluZy4AAAAAAAAAAAAADlVwZ3JhZGVSZXF1ZXN0AAAAAAAFAAAAlVRoZSBhZG9wdGVkIGNvbnRyb2xsZXIncyBlcG9jaCB3aGVuIHNjaGVkdWxlZCwgaWYgYSBjb250cm9sbGVyIHdhcwphZG9wdGVkLiBQYXNzZWQgYmFjayBhcyBgVXBncmFkZVN0ZXA6OkV4ZWN1dGVgIHNvIHRoZSBjb250cm9sbGVyIGNhbgpjaGVjayBpdCB0b28uAAAAAAAAEGNvbnRyb2xsZXJfZXBvY2gAAAPoAAAABgAAADJUaGUgZmlyc3QgbGVkZ2VyIGF0IHdoaWNoIHRoZSByZXF1ZXN0IG1heSBleGVjdXRlLgAAAAAADWV4ZWN1dGFibGVfYXQAAAAAAAAEAAAAQVRoZSBhY2NvdW50J3MgcmVjb3ZlcnkgZ2VuZXJhdGlvbiB3aGVuIHRoZSByZXF1ZXN0IHdhcyBzY2hlZHVsZWQuAAAAAAAACmdlbmVyYXRpb24AAAAAAAYAAAAaUGVyLWFjY291bnQsIG5ldmVyIHJldXNlZC4AAAAAAApyZXF1ZXN0X2lkAAAAAAAGAAAAJFRoZSBleGFjdCBXYXNtIHRoZSBhY2NvdW50IHdpbGwgcnVuLgAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIA==",
        "AAAAAgAAAEVXaGF0IGEgYFJlY29uZmlndXJlYCBzdGF0ZW1lbnQgY2hhbmdlcyB0aGUgZW5yb2xsZWQgY29uZmlndXJhdGlvbiB0by4AAAAAAAAAAAAADENvbmZpZ0NoYW5nZQAAAAIAAAAAAAAAIVJlbW92ZSByZWNvdmVyeSBmcm9tIHRoZSBhY2NvdW50LgAAAAAAAAZSZW1vdmUAAAAAAAEAAACLUmVwbGFjZSB0aGUgY29uZmlndXJhdGlvbiB3aXRoIHRoZSBvbmUgd2hvc2UKW2BDb25maWdCaW5kaW5nOjpjb25maWdfaGFzaGBdIGlzIHRoaXMgdmFsdWUgKHdoaWNoIG1heSBuYW1lIGEKZGlmZmVyZW50IGNvbnRyb2xsZXIgaW5zdGFuY2UpLgAAAAADU2V0AAAAAAEAAAPuAAAAIA==",
        "AAAAAQAAACRUaGUgc3ViamVjdCBvZiBhIGBDYW5jZWxgIHN0YXRlbWVudC4AAAAAAAAADUNhbmNlbFN1YmplY3QAAAAAAAACAAAAHFRoZSBhdHRlbXB0IGJlaW5nIGNhbmNlbGxlZC4AAAAKYXR0ZW1wdF9pZAAAAAAABgAAAHRUaGF0IGF0dGVtcHQncyBvd24gaW5pdGlhdGlvbiBzdGF0ZW1lbnQgZGlnZXN0LCBzbyBjYW5jZWxsYXRpb24KZXZpZGVuY2UgbmFtZXMgZXhhY3RseSBvbmUgcHJvcG9zYWwsIG5vdCBqdXN0IGFuIGlkLgAAABFhdHRlbXB0X3N0YXRlbWVudAAAAAAAA+4AAAAg",
        "AAAAAQAAADxUaGUgZW5yb2xsZWQgY29uZmlndXJhdGlvbiBhIHN0YXRlbWVudCBpcyBldmFsdWF0ZWQgYWdhaW5zdC4AAAAAAAAADUNvbmZpZ0JpbmRpbmcAAAAAAAACAAABZWBzaGEyNTYoInBlcmNoL3JlY292ZXJ5L2NvbmZpZyIgfHwgY2Fub25pY2FsIEpTT04gb2YgdGhlIGVucm9sbGVkCmRvY3VtZW50J3MgcmVjb3ZlcnkgbWVtYmVyKWAsIGFzIFtgY3JhdGU6OmNvbmZpZzo6Y29uZmlnX2hhc2hgXQpjb21wdXRlcyBpdCAoYGRvY3MvcmVjb3Zlcnkvc3BlYy5tZGAgwqczLjIpLiBCaW5kcyB0aGUgd2hvbGUKY29uZmlndXJhdGlvbjogcHJvZmlsZSwgbW9kZSwgZ3VhcmRpYW5zLCBxdW9ydW0sIFpLIGFkYXB0ZXIsIGNpcmN1aXQKaWQsIHBvb2wsIGVucm9sbG1lbnQgaWQgYW5kIGNvbW1pdG1lbnQsIGNvbnRyb2xsZXIsIGJhc2VsaW5lLApyZXBsYWNlYWJsZSBzaWduZXIgaWRzLCBhbmQgdGltaW5nLgAAAAAAAAtjb25maWdfaGFzaAAAAAPuAAAAIAAAAORUaGUgY29udHJvbGxlcidzIHBlci1hY2NvdW50IGNvbmZpZ3VyYXRpb24gZXBvY2guIEl0IGluY3JlbWVudHMgb24KZXZlcnkgZW5yb2xsbWVudCwgcmVjb25maWd1cmF0aW9uLCByZW1vdmFsLCBjb21wbGV0ZWQgcmVjb3ZlcnksIGFuZApleGVjdXRlZCBhY2NvdW50IHVwZ3JhZGUsIHNvIGV2aWRlbmNlIHByb2R1Y2VkIHVuZGVyIG9uZSBlcG9jaCBpcwpkZWFkIHVuZGVyIGV2ZXJ5IGxhdGVyIG9uZS4AAAAFZXBvY2gAAAAAAAAG",
        "AAAAAQAAADNUaGUgc3ViamVjdCBvZiBhIGBMb3N0S2V5YCBvciBgQ29tcHJvbWlzZWAgYXR0ZW1wdC4AAAAAAAAAAA5BdHRlbXB0U3ViamVjdAAAAAAABAAAAD5UaGUgY29udHJvbGxlci1hc3NpZ25lZCwgcGVyLWFjY291bnQsIG5ldmVyLXJldXNlZCBhdHRlbXB0IGlkLgAAAAAACmF0dGVtcHRfaWQAAAAAAAYAAABJW2BjcmF0ZTo6Y3JlZGVudGlhbDo6UmVwbGFjZW1lbnRTZXQ6Omhhc2hgXSBvZiB0aGUgZGVjbGFyZWQKcmVwbGFjZW1lbnRzLgAAAAAAABFyZXBsYWNlbWVudHNfaGFzaAAAAAAAA+4AAAAgAAAAo2BMb3N0S2V5YDogdGhlIGNhbm9uaWNhbCBoYXNoIG9mIHRoZSBhY2NvdW50J3MgYXBwbGllZCBkb2N1bWVudCB3aGVuCnRoZSBhdHRlbXB0IGJlZ2FuICh0aGUgYWdyZWVkIHNuYXBzaG90KS4gYENvbXByb21pc2VgOiB0aGUgZW5yb2xsZWQKYmFzZWxpbmUncyBjYW5vbmljYWwgaGFzaC4AAAAAD3NvdXJjZV9kb2NfaGFzaAAAAAPuAAAAIAAAAHxUaGUgY2Fub25pY2FsIGhhc2ggb2YgdGhlIHRhcmdldCBkb2N1bWVudCwgZGVyaXZlZCBvbi1jaGFpbiBmcm9tCnRoZSBzb3VyY2UgYW5kIHRoZSByZXBsYWNlbWVudCBzZXQg4oCUIG5ldmVyIGNhbGxlci1jaG9zZW4uAAAAD3RhcmdldF9kb2NfaGFzaAAAAAPuAAAAIA==",
        "AAAAAwAAAUpUaGUgYWN0aW9uIGRvbWFpbiBhIHN0YXRlbWVudCBhdXRob3JpemVzLiBFdmlkZW5jZSBmb3Igb25lIGFjdGlvbiBuZXZlcgpzYXRpc2ZpZXMgYW5vdGhlcjogdGhlIGFjdGlvbiBjb2RlIGlzIHRoZSBlbmNvZGluZydzIDI2dGggYnl0ZSBhbmQgc2VsZWN0cwp0aGUgc3ViamVjdCBsYXlvdXQsIHNvIHR3byBzdGF0ZW1lbnRzIHRoYXQgZGlmZmVyIG9ubHkgaW4gYWN0aW9uIGhhdmUKZGlmZmVyZW50IGRpZ2VzdHMgKGFuZCBkaWZmZXJlbnQgZW5jb2RlZCBsZW5ndGhzIGZvciBtb3N0IHBhaXJzKS4KClRoZSBudW1lcmljIGNvZGVzIGFyZSBwYXJ0IG9mIHRoZSB3aXJlIGZvcm1hdC4AAAAAAAAAAAAOUmVjb3ZlcnlBY3Rpb24AAAAAAAUAAABgTG9zdC1rZXkgcmVjb3Zlcnk6IHJlcGxhY2UgZGVzaWduYXRlZCBjcmVkZW50aWFscyBpbiBhbiBhZ3JlZWQKc25hcHNob3Qgb2YgdGhlIGN1cnJlbnQgZG9jdW1lbnQuAAAAB0xvc3RLZXkAAAAAAQAAAFlDb21wcm9taXNlIHJlY292ZXJ5OiByZXN0b3JlIHRoZSBlbnJvbGxlZCBiYXNlbGluZSwgd2l0aCBkZXNpZ25hdGVkCmNyZWRlbnRpYWxzIHJlcGxhY2VkLgAAAAAAAApDb21wcm9taXNlAAAAAAACAAAAHkNhbmNlbCBvbmUgaWRlbnRpZmllZCBhdHRlbXB0LgAAAAAABkNhbmNlbAAAAAAAAwAAAINDaGFuZ2Ugb3IgcmVtb3ZlIHRoZSBlbnJvbGxlZCByZWNvdmVyeSBjb25maWd1cmF0aW9uICh0aGUgZXZpZGVuY2UgYQpgUHJvdGVjdGVkYCBhY2NvdW50IG5lZWRzIGluIGFkZGl0aW9uIHRvIG93bmVyIGF1dGhvcml6YXRpb24pLgAAAAALUmVjb25maWd1cmUAAAAABAAAAHRBcHByb3ZlIG9uZSBzY2hlZHVsZWQgYWNjb3VudCB1cGdyYWRlICh0aGUgZXZpZGVuY2UgYSBgUHJvdGVjdGVkYAphY2NvdW50IG5lZWRzIGluIGFkZGl0aW9uIHRvIG93bmVyIGF1dGhvcml6YXRpb24pLgAAAAdVcGdyYWRlAAAAAAU=",
        "AAAABAAAADhFdmVyeXRoaW5nIGVuY29kaW5nIGEgc3RhdGVtZW50IG9yIGl0cyBwYXJ0cyBjYW4gcmVmdXNlLgAAAAAAAAAOU3RhdGVtZW50RXJyb3IAAAAAAAcAAAAtYGFjY291bnRgIGlzIG5vdCBhIGNvbnRyYWN0IChgQy4uLmApIGFkZHJlc3MuAAAAAAAAEkFjY291bnROb3RDb250cmFjdAAAAAAAAQAAADBgY29udHJvbGxlcmAgaXMgbm90IGEgY29udHJhY3QgKGBDLi4uYCkgYWRkcmVzcy4AAAAVQ29udHJvbGxlck5vdENvbnRyYWN0AAAAAAAAAgAAAHdBIGNyZWRlbnRpYWwgbmFtZXMgYW4gYWRkcmVzcyBzaGFwZSB0aGUgcmVjb3Zlcnkgc3RhY2sgZG9lcyBub3QgYWNjZXB0IChtdXhlZCwgY2xhaW1hYmxlLWJhbGFuY2UsIGxpcXVpZGl0eS1wb29sLCAuLi4pLgAAAAASVW5zdXBwb3J0ZWRBZGRyZXNzAAAAAAADAAAAekEgcmVwbGFjZW1lbnQgc2V0J3Mgc2lnbmVyIGlkcyBhcmUgbm90IHN0cmljdGx5IGFzY2VuZGluZyAoc29ydGVkLCBubyBkdXBsaWNhdGVzKSwgc28gaXQgaGFzIG5vIHNpbmdsZSBjYW5vbmljYWwgZW5jb2RpbmcuAAAAAAAYUmVwbGFjZW1lbnRzTm90Q2Fub25pY2FsAAAABAAAACNBIHJlcGxhY2VtZW50IHNldCByZXBsYWNlcyBub3RoaW5nLgAAAAARRW1wdHlSZXBsYWNlbWVudHMAAAAAAAAFAAAAQFRoZSBjdXJyZW50IGxlZGdlciBpcyBwYXN0IHRoZSBzdGF0ZW1lbnQncyBgdmFsaWRfdW50aWxfbGVkZ2VyYC4AAAAPRXZpZGVuY2VFeHBpcmVkAAAAAAYAAAB5QSBwcm92aWRlci1jaG9zZW4gYHZhbGlkX3VudGlsX2xlZGdlcmAgcmVhY2hlcyBmdXJ0aGVyIHBhc3QgdGhlIGN1cnJlbnQgbGVkZ2VyIHRoYW4gdGhlIGVucm9sbGVkIGBleHBpcnlfbGVkZ2Vyc2AgYWxsb3dzLgAAAAAAABVFdmlkZW5jZVdpbmRvd1Rvb0xvbmcAAAAAAAAH",
        "AAAAAQAAACZUaGUgc3ViamVjdCBvZiBhbiBgVXBncmFkZWAgc3RhdGVtZW50LgAAAAAAAAAAAA5VcGdyYWRlU3ViamVjdAAAAAAAAgAAADtUaGUgYWNjb3VudCdzIHBlci1hY2NvdW50LCBuZXZlci1yZXVzZWQgdXBncmFkZSByZXF1ZXN0IGlkLgAAAAAKcmVxdWVzdF9pZAAAAAAABgAAADxUaGUgZXhhY3QgV2FzbSBoYXNoIHRoZSBhY2NvdW50IHdvdWxkIHJ1biBhZnRlciB0aGUgdXBncmFkZS4AAAAJd2FzbV9oYXNoAAAAAAAD7gAAACA=",
        "AAAAAQAAACtUaW1pbmcgdGVybXMsIGFsbCBpbiBsZWRnZXItc2VxdWVuY2UgdW5pdHMuAAAAAAAAAAAPU3RhdGVtZW50VGltaW5nAAAAAAMAAABmVGhlIGVucm9sbGVkIGBkZWxheS1sZWRnZXJzYDogbGVkZ2VycyBiZXR3ZWVuIGFuIGF0dGVtcHQgYmVjb21pbmcKYXV0aG9yaXplZCBhbmQgYmVjb21pbmcgY29tcGxldGFibGUuAAAAAAANZGVsYXlfbGVkZ2VycwAAAAAAAAQAAADQVGhlIGVucm9sbGVkIGBleHBpcnktbGVkZ2Vyc2A6IHRoZSBldmlkZW5jZSB3aW5kb3cgZm9yIGEgY29sbGVjdGluZwphdHRlbXB0LCB0aGUgY29tcGxldGlvbiB3aW5kb3cgZm9yIGFuIGF1dGhvcml6ZWQgb25lLCBhbmQgdGhlIHVwcGVyCmJvdW5kIG9uIGhvdyBmYXIgYWhlYWQgYSBwcm92aWRlci1jaG9zZW4gYHZhbGlkX3VudGlsX2xlZGdlcmAgbWF5CnJlYWNoLgAAAA5leHBpcnlfbGVkZ2VycwAAAAAABAAAAapUaGUgbGFzdCBsZWRnZXIgc2VxdWVuY2UgKGluY2x1c2l2ZSkgYXQgd2hpY2ggdGhpcyBldmlkZW5jZSBtYXkgYmUKYWNjZXB0ZWQuIFRoZSBjb250cm9sbGVyIGZpeGVzIGl0IGZvciBhdHRlbXB0LWJvdW5kIGFjdGlvbnM6CmBMb3N0S2V5YC9gQ29tcHJvbWlzZWAgdXNlIHRoZSBhdHRlbXB0J3MgZXZpZGVuY2UgZGVhZGxpbmUsIGFuZApgQ2FuY2VsYCB0aGUgbGFzdCBsZWRnZXIgdGhlIGF0dGVtcHQgY291bGQgcG9zc2libHkgYmUgbGl2ZSwgc28KYXBwcm92YWxzIGNvbGxlY3RlZCBvdmVyIHNldmVyYWwgdHJhbnNhY3Rpb25zIGFsbCBzaWduIG9uZQpzdGF0ZW1lbnQuIEZvciBgUmVjb25maWd1cmVgL2BVcGdyYWRlYCB0aGUgZXZpZGVuY2UgcHJvdmlkZXIgY2hvb3NlcwppdCwgd2l0aGluIGBleHBpcnlfbGVkZ2Vyc2Agb2Ygc3VibWlzc2lvbi4AAAAAABJ2YWxpZF91bnRpbF9sZWRnZXIAAAAAAAQ=",
        "AAAAAgAAAJ1UaGUgYWN0aW9uLXNwZWNpZmljIHBhcnQgb2YgYSBzdGF0ZW1lbnQuIFRoZSB2YXJpYW50IGRldGVybWluZXMKW2BSZWNvdmVyeVN0YXRlbWVudDo6YWN0aW9uYF07IHRoZXJlIGlzIG5vIHNlcGFyYXRlIGFjdGlvbiBmaWVsZCB0aGF0CmNvdWxkIGRpc2FncmVlIHdpdGggaXQuAAAAAAAAAAAAABBTdGF0ZW1lbnRTdWJqZWN0AAAABQAAAAEAAAAAAAAAB0xvc3RLZXkAAAAAAQAAB9AAAAAOQXR0ZW1wdFN1YmplY3QAAAAAAAEAAAAAAAAACkNvbXByb21pc2UAAAAAAAEAAAfQAAAADkF0dGVtcHRTdWJqZWN0AAAAAAABAAAAAAAAAAZDYW5jZWwAAAAAAAEAAAfQAAAADUNhbmNlbFN1YmplY3QAAAAAAAABAAAAAAAAAAtSZWNvbmZpZ3VyZQAAAAABAAAH0AAAAAxDb25maWdDaGFuZ2UAAAABAAAAAAAAAAdVcGdyYWRlAAAAAAEAAAfQAAAADlVwZ3JhZGVTdWJqZWN0AAA=",
        "AAAAAQAAADBUaGUgb25lIHJlY292ZXJ5IHN0YXRlbWVudC4gU2VlIHRoZSBtb2R1bGUgZG9jcy4AAAAAAAAAEVJlY292ZXJ5U3RhdGVtZW50AAAAAAAABgAAADNUaGUgcmVjb3ZlcmluZyBhY2NvdW50LiBNdXN0IGJlIGEgY29udHJhY3QgYWRkcmVzcy4AAAAAB2FjY291bnQAAAAAEwAAAAAAAAAGY29uZmlnAAAAAAfQAAAADUNvbmZpZ0JpbmRpbmcAAAAAAACgVGhlIGNvbnRyb2xsZXIgaW5zdGFuY2UgZXZhbHVhdGluZyB0aGUgZXZpZGVuY2UgKGZvciBgUmVjb25maWd1cmVgLAp0aGUgY3VycmVudGx5IGFkb3B0ZWQgb25lLCBldmVuIHdoZW4gdGhlIGNoYW5nZSBhZG9wdHMgYW5vdGhlcikuCk11c3QgYmUgYSBjb250cmFjdCBhZGRyZXNzLgAAAApjb250cm9sbGVyAAAAAAATAAAAYFRoZSBuZXR3b3JrIGlkIChgc2hhMjU2YCBvZiB0aGUgbmV0d29yayBwYXNzcGhyYXNlKSwgYXMKYEVudjo6bGVkZ2VyKCkubmV0d29ya19pZCgpYCByZXR1cm5zIGl0LgAAAApuZXR3b3JrX2lkAAAAAAPuAAAAIAAAAAAAAAAHc3ViamVjdAAAAAfQAAAAEFN0YXRlbWVudFN1YmplY3QAAAAAAAAABnRpbWluZwAAAAAH0AAAAA9TdGF0ZW1lbnRUaW1pbmcA" ]),
      options
    )
  }
  public readonly fromJSON = {
    tree: this.txFromJSON<Result<TreeInfo>>,
        depth: this.txFromJSON<u32>,
        leaves: this.txFromJSON<Result<Array<Buffer>>>,
        version: this.txFromJSON<u32>,
        enrollment: this.txFromJSON<Option<LeafPosition>>,
        rcv_insert: this.txFromJSON<Result<void>>,
        renew_root: this.txFromJSON<null>,
        renew_tree: this.txFromJSON<Result<void>>,
        current_tree: this.txFromJSON<u32>,
        renew_leaves: this.txFromJSON<Result<void>>,
        is_known_root: this.txFromJSON<boolean>,
        renew_enrollment: this.txFromJSON<null>
  }
}