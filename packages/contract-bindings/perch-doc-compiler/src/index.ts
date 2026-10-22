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
 * The document caps a compiler enforces, as [`PerchDocCompiler::limits`]
 * returns them. Versioned: a later budget (a complexity-weighted one, say)
 * is a new variant, which a consumer that does not know it refuses rather
 * than misreads.
 */
export type DocLimits = {tag: "V1", values: readonly [FlatDocLimits]};

/**
 * Where a compiled rule applies. `SelfAdmin` is account-agnostic: the
 * applying account resolves it to its own address.
 */
export type RuleScope = {tag: "SelfAdmin", values: void} | {tag: "Contract", values: readonly [string]};


/**
 * A cumulative spend cap lowered to OZ `spending_limit`'s install params
 * (`SpendingLimitAccountParams`). The tracked token is the rule's scope
 * contract, so it is not carried here.
 */
export interface CompiledCap {
  /**
 * Rolling-window length in ledgers.
 */
period_ledgers: u32;
  /**
 * Cumulative amount ceiling over the rolling window.
 */
spending_limit: i128;
}


/**
 * A compiled document: its canonical identity and the rules it becomes.
 */
export interface CompiledDoc {
  /**
 * The canonical bytes `doc_hash` is the hash of. The account stores
 * them so anyone, including the recovery controller, can read back the
 * full applied document.
 */
canonical: Buffer;
  /**
 * `sha256(canonical bytes)` — the hash the reviewer approved. Formatting
 * of the submitted JSON is irrelevant: a pretty-printed file and its
 * minified twin compile to the same hash.
 */
doc_hash: Buffer;
  /**
 * The fingerprint (`perch_recovery_interface::credential::Credential::
 * fingerprint`) of every declared signer's credential, with external
 * keys canonicalized by their verifier. What revocation compares
 * (spec §8).
 */
fingerprints: Array<Buffer>;
  /**
 * The compiled `recovery` member: zero or one entries (a `Vec` for the
 * same reason as [`CompiledRule::install`]). Present ⇒ the document
 * enrolls account recovery, and the applier syncs this configuration to
 * the controller instance it names (`docs/recovery/`).
 */
recovery: Array<CompiledRecoveryConfig>;
  /**
 * One compiled rule per document rule, in the submitted order.
 */
rules: Array<CompiledRule>;
}


/**
 * One rule, compiled to the exact shapes OZ's `add_context_rule` takes:
 * resolved addresses, OZ `Signer`s, and (for constrained rules) the
 * interpreter program as `InstallParams`.
 */
export interface CompiledRule {
  /**
 * Zero or one entries (a `Vec` for the same reason as `install`).
 * Present ⇒ also attach OZ `spending_limit` with these params — the
 * cumulative cap the stateless interpreter cannot express. The applier
 * resolves the policy's content-addressed address and keys it into the
 * rule's policy map beside the interpreter; the tracked token is the
 * rule's `Contract` scope (validation pins `token == scope`).
 */
cap: Array<CompiledCap>;
  /**
 * The interpreter program to attach: zero or one entries. A `Vec`
 * because `#[contracttype]` has no conversion for `Option` of a custom
 * struct (`Option<u32>` on `valid_until` works because `u32` is a host
 * type). Empty ⇒ a policy-free rule.
 */
install: Array<InstallParams>;
  /**
 * The rule's name in the document. The account matches installed rules
 * by name and scope.
 */
name: string;
  scope: RuleScope;
  /**
 * The rule's signers, with external keys as declared (already
 * verifier-canonical).
 */
signers: Array<Signer>;
  /**
 * The last ledger the rule authorizes, if bounded: OZ's inclusive
 * `valid_until`, one below the document's `not-after-ledger`.
 */
valid_until: Option<u32>;
}


/**
 * What `derive_target` returns: the recovery target the controller binds
 * into an attempt's statement (spec §7.1).
 */
export interface DerivedTarget {
  /**
 * The target's canonical bytes: exactly what the completing `apply_doc`
 * must submit.
 */
canonical: Buffer;
  /**
 * The target's recovery `config_hash` (the current one, or the current
 * one with the declared ZK rotation).
 */
config_hash: Buffer;
  /**
 * `sha256` of `canonical`: the target's `doc_hash`.
 */
doc_hash: Buffer;
  /**
 * Fingerprints of every credential in the target (spec §7.3 rule 7).
 */
fingerprints: Array<Buffer>;
  /**
 * The credentials occupying the replaced signer slots in the source:
 * the applied document's for lost-key, the baseline's for compromise.
 * External keys are canonicalized by their verifier, so a credential's
 * `fingerprint` is the one revocation compares. The controller records
 * them at T1 and the completion revokes them (spec §8).
 */
replaced: Array<Credential>;
}


/**
 * Flat per-document caps: [`MAX_DOC_SIGNERS`], [`MAX_DOC_RULES`],
 * [`MAX_DOC_CANONICAL_BYTES`], [`MAX_RULE_NAME_BYTES`].
 */
export interface FlatDocLimits {
  max_canonical_bytes: u32;
  max_rule_name_bytes: u32;
  max_rules: u32;
  max_signers: u32;
}

/**
 * Everything `compile_doc` can refuse. (`#[scerr]` assigns sequential codes
 * from 1, in variant order.)
 */
export const DocCompilerError = {
  /**
   * The submitted document bytes are not UTF-8.
   */
  1: {message:"DocNotUtf8"},
  /**
   * The document failed fail-closed parsing (unknown field, bad shape, unsupported version, duplicate key, …).
   */
  2: {message:"DocParse"},
  /**
   * The document failed semantic validation (dangling signer ref, malformed address or key, ambiguous empty list, …).
   */
  3: {message:"DocInvalid"},
  /**
   * The document names no network, or a network that is not this chain.
   */
  4: {message:"WrongNetwork"},
  /**
   * The document cannot be lowered to rules (unsupported rule shape).
   */
  5: {message:"DocCompile"},
  /**
   * The document exceeds a document cap ([`MAX_DOC_SIGNERS`], [`MAX_DOC_RULES`], [`MAX_DOC_CANONICAL_BYTES`], [`MAX_RULE_NAME_BYTES`]).
   */
  6: {message:"DocTooLarge"},
  /**
   * A signer's external `key` is not its verifier-canonical form: either the verifier could not canonicalize it at all, or the declared bytes differ from the canonical form the verifier returns (e.g. a WebAuthn key carrying a credential-id suffix the verifier drops, or a non-canonical point encoding). The compiler refuses it rather than silently canonicalizing, so the bytes the document hash — and a recovery attempt's `replacements_hash` — bind are exactly the bytes the installed credential uses, and two signers cannot hide one physical key under two spellings.
   */
  7: {message:"KeyNotCanonicalizable"},
  /**
   * `derive_target`: the current document enrolls no recovery.
   */
  8: {message:"NotEnrolled"},
  /**
   * `derive_target`: the replacement set breaks spec §7.3 rules 1-3 (not canonical, empty for lost-key, a signer id that is not replaceable or not declared in the source, or a change of credential kind or verifier), or the action is not a recovery attempt.
   */
  9: {message:"ReplacementRefused"},
  /**
   * `derive_target`: the ZK enrollment is missing for a ZK mode, present for a guardian-only mode, or reuses the enrolled id.
   */
  10: {message:"ZkEnrollmentMismatch"},
  /**
   * `derive_target`: the target has no policy-free self-admin rule with a signer (the anti-brick check).
   */
  11: {message:"AdminLockout"}
}


/**
 * The canonical form and fragment hashes a compiler produces, as
 * [`PerchDocCompiler::capabilities`] returns them.
 */
export interface CompilerCapabilities {
  /**
 * The CANON version `doc_hash` is `sha256` of (`CANONICAL.md`).
 */
canon_version: u32;
  /**
 * The domain tag of a recovery member's `config_hash` (spec §3.2).
 */
config_hash_tag: string;
  /**
 * The domain tag of a rule's `rule_hash` (spec §3.2).
 */
rule_hash_tag: string;
}

/**
 * One op of a postfix-encoded constraint program.
 */
export type Op = {tag: "All", values: readonly [u32]} | {tag: "Any", values: readonly [u32]} | {tag: "Not", values: void} | {tag: "MinSigners", values: readonly [u32]} | {tag: "FnIn", values: readonly [Array<string>]} | {tag: "ArgAddrEq", values: readonly [u32, string]} | {tag: "ArgAddrIsSelf", values: readonly [u32]} | {tag: "ArgSymEq", values: readonly [u32, string]} | {tag: "ArgStrIn", values: readonly [u32, Array<string>]} | {tag: "ArgStrPrefix", values: readonly [u32, string]} | {tag: "ArgBytesEq", values: readonly [u32, Buffer]} | {tag: "ArgI128Eq", values: readonly [u32, i128]} | {tag: "ArgU32Eq", values: readonly [u32, u32]} | {tag: "ArgCount", values: readonly [u32]} | {tag: "LedgerBefore", values: readonly [u32]} | {tag: "LedgerAtOrAfter", values: readonly [u32]};


/**
 * A postfix-encoded constraint program. The last op produces the root
 * verdict.
 */
export interface RpnProgram {
  /**
 * The ops, evaluated left to right.
 */
ops: Array<Op>;
  /**
 * The wire-format version; only [`PROGRAM_VERSION`] validates.
 */
version: u32;
}


/**
 * What the compiler stores in the interpreter for one `(account, rule)`: the
 * program plus the provenance hash of the rule it was compiled from. Sharing
 * this `#[contracttype]` between the compiler and the interpreter is what
 * keeps install params from ever being a hand-built `ScVal` — both sides
 * encode and decode through exactly these types.
 */
export interface InstallParams {
  /**
 * The source rule's `perch_ir::rule_hash`, not the whole document's
 * hash (the field keeps its original name). It binds the on-chain
 * program to the reviewed rule (provenance for lift/diff).
 */
doc_hash: Buffer;
  program: RpnProgram;
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
  /**
 * Ledgers from an attempt's authorization until it can complete.
 */
delay_ledgers: u32;
  /**
 * The evidence window of a collecting attempt and the completion
 * window of an authorized one, in ledgers.
 */
expiry_ledgers: u32;
  /**
 * Lifetime cap on evidence-based cancellations of authorized attempts.
 */
max_cancels: u32;
  /**
 * The factors evidence must satisfy.
 */
mode: CompiledRecoveryMode;
  /**
 * Who may change the configuration, and whether an authorized attempt
 * freezes the account.
 */
profile: RecoveryProfile;
  /**
 * Signer ids (not credential fingerprints) a recovery may replace, so
 * rotating a key does not change the configuration (#92).
 */
replaceable: Array<string>;
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
 * Represents different types of signers in the smart account system.
 */
export type Signer = {tag: "Delegated", values: readonly [string]} | {tag: "External", values: readonly [string, Buffer]};

export interface Client {
  /**
   * Construct and simulate a limits transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The document caps every `compile_doc` and `derive_target` enforces.
   */
  limits: (options?: MethodOptions) => Promise<AssembledTransaction<DocLimits>>

  /**
   * Construct and simulate a compile_doc transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * JSON bytes in → compiled rules + canonical `doc_hash` out. Pure:
   * no auth, no storage. The document must name THIS network (its
   * `network` string must hash to the chain's network id), so a testnet
   * document can never compile on mainnet or vice versa. It must also fit
   * the document caps ([`Self::limits`]), and every external signer key
   * must already be its verifier-canonical form: the compiler calls each
   * named verifier's `batch_canonicalize_key` to check.
   */
  compile_doc: ({doc_json}: {doc_json: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<CompiledDoc>>>

  /**
   * Construct and simulate a capabilities transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The CANON version and the fragment hash domain tags this compiler
   * produces.
   */
  capabilities: (options?: MethodOptions) => Promise<AssembledTransaction<CompilerCapabilities>>

  /**
   * Construct and simulate a derive_target transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Derive a recovery target (`docs/recovery/spec.md` §7): `source_json`
   * is the account's applied document (lost-key) or the published
   * baseline (compromise); `current_json` is the applied document, whose
   * recovery member the target keeps. The target is the source with
   * exactly the declared replacements and ZK rotation, then validated,
   * network-bound, capped, compiled, and anti-brick-checked like any
   * applied document. Pure: no auth, no storage. The controller calls it
   * when an attempt begins, and completers simulate it to obtain the
   * canonical bytes.
   */
  derive_target: ({source_json, current_json, action, replacements}: {source_json: Buffer, current_json: Buffer, action: RecoveryAction, replacements: ReplacementSet}, options?: MethodOptions) => Promise<AssembledTransaction<Result<DerivedTarget>>>

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
      new ContractSpec([ "AAAAAgAAAOZUaGUgZG9jdW1lbnQgY2FwcyBhIGNvbXBpbGVyIGVuZm9yY2VzLCBhcyBbYFBlcmNoRG9jQ29tcGlsZXI6OmxpbWl0c2BdCnJldHVybnMgdGhlbS4gVmVyc2lvbmVkOiBhIGxhdGVyIGJ1ZGdldCAoYSBjb21wbGV4aXR5LXdlaWdodGVkIG9uZSwgc2F5KQppcyBhIG5ldyB2YXJpYW50LCB3aGljaCBhIGNvbnN1bWVyIHRoYXQgZG9lcyBub3Qga25vdyBpdCByZWZ1c2VzIHJhdGhlcgp0aGFuIG1pc3JlYWRzLgAAAAAAAAAAAAlEb2NMaW1pdHMAAAAAAAABAAAAAQAAAAAAAAACVjEAAAAAAAEAAAfQAAAADUZsYXREb2NMaW1pdHMAAAA=",
        "AAAAAgAAAHRXaGVyZSBhIGNvbXBpbGVkIHJ1bGUgYXBwbGllcy4gYFNlbGZBZG1pbmAgaXMgYWNjb3VudC1hZ25vc3RpYzogdGhlCmFwcGx5aW5nIGFjY291bnQgcmVzb2x2ZXMgaXQgdG8gaXRzIG93biBhZGRyZXNzLgAAAAAAAAAJUnVsZVNjb3BlAAAAAAAAAgAAAAAAAAA8Q2FsbHMgdG8gdGhlIGFwcGx5aW5nIGFjY291bnQgaXRzZWxmIChgQ2FsbENvbnRyYWN0KHNlbGYpYCkuAAAACVNlbGZBZG1pbgAAAAAAAAEAAAAXQ2FsbHMgdG8gdGhpcyBjb250cmFjdC4AAAAACENvbnRyYWN0AAAAAQAAABM=",
        "AAAAAQAAALFBIGN1bXVsYXRpdmUgc3BlbmQgY2FwIGxvd2VyZWQgdG8gT1ogYHNwZW5kaW5nX2xpbWl0YCdzIGluc3RhbGwgcGFyYW1zCihgU3BlbmRpbmdMaW1pdEFjY291bnRQYXJhbXNgKS4gVGhlIHRyYWNrZWQgdG9rZW4gaXMgdGhlIHJ1bGUncyBzY29wZQpjb250cmFjdCwgc28gaXQgaXMgbm90IGNhcnJpZWQgaGVyZS4AAAAAAAAAAAAAC0NvbXBpbGVkQ2FwAAAAAAIAAAAhUm9sbGluZy13aW5kb3cgbGVuZ3RoIGluIGxlZGdlcnMuAAAAAAAADnBlcmlvZF9sZWRnZXJzAAAAAAAEAAAAMkN1bXVsYXRpdmUgYW1vdW50IGNlaWxpbmcgb3ZlciB0aGUgcm9sbGluZyB3aW5kb3cuAAAAAAAOc3BlbmRpbmdfbGltaXQAAAAAAAs=",
        "AAAAAQAAAEVBIGNvbXBpbGVkIGRvY3VtZW50OiBpdHMgY2Fub25pY2FsIGlkZW50aXR5IGFuZCB0aGUgcnVsZXMgaXQgYmVjb21lcy4AAAAAAAAAAAAAC0NvbXBpbGVkRG9jAAAAAAUAAACdVGhlIGNhbm9uaWNhbCBieXRlcyBgZG9jX2hhc2hgIGlzIHRoZSBoYXNoIG9mLiBUaGUgYWNjb3VudCBzdG9yZXMKdGhlbSBzbyBhbnlvbmUsIGluY2x1ZGluZyB0aGUgcmVjb3ZlcnkgY29udHJvbGxlciwgY2FuIHJlYWQgYmFjayB0aGUKZnVsbCBhcHBsaWVkIGRvY3VtZW50LgAAAAAAAAljYW5vbmljYWwAAAAAAAAOAAAAs2BzaGEyNTYoY2Fub25pY2FsIGJ5dGVzKWAg4oCUIHRoZSBoYXNoIHRoZSByZXZpZXdlciBhcHByb3ZlZC4gRm9ybWF0dGluZwpvZiB0aGUgc3VibWl0dGVkIEpTT04gaXMgaXJyZWxldmFudDogYSBwcmV0dHktcHJpbnRlZCBmaWxlIGFuZCBpdHMKbWluaWZpZWQgdHdpbiBjb21waWxlIHRvIHRoZSBzYW1lIGhhc2guAAAAAAhkb2NfaGFzaAAAA+4AAAAgAAAA0lRoZSBmaW5nZXJwcmludCAoYHBlcmNoX3JlY292ZXJ5X2ludGVyZmFjZTo6Y3JlZGVudGlhbDo6Q3JlZGVudGlhbDo6CmZpbmdlcnByaW50YCkgb2YgZXZlcnkgZGVjbGFyZWQgc2lnbmVyJ3MgY3JlZGVudGlhbCwgd2l0aCBleHRlcm5hbAprZXlzIGNhbm9uaWNhbGl6ZWQgYnkgdGhlaXIgdmVyaWZpZXIuIFdoYXQgcmV2b2NhdGlvbiBjb21wYXJlcwooc3BlYyDCpzgpLgAAAAAADGZpbmdlcnByaW50cwAAA+oAAAPuAAAAIAAAAQNUaGUgY29tcGlsZWQgYHJlY292ZXJ5YCBtZW1iZXI6IHplcm8gb3Igb25lIGVudHJpZXMgKGEgYFZlY2AgZm9yIHRoZQpzYW1lIHJlYXNvbiBhcyBbYENvbXBpbGVkUnVsZTo6aW5zdGFsbGBdKS4gUHJlc2VudCDih5IgdGhlIGRvY3VtZW50CmVucm9sbHMgYWNjb3VudCByZWNvdmVyeSwgYW5kIHRoZSBhcHBsaWVyIHN5bmNzIHRoaXMgY29uZmlndXJhdGlvbiB0bwp0aGUgY29udHJvbGxlciBpbnN0YW5jZSBpdCBuYW1lcyAoYGRvY3MvcmVjb3ZlcnkvYCkuAAAAAAhyZWNvdmVyeQAAA+oAAAfQAAAAFkNvbXBpbGVkUmVjb3ZlcnlDb25maWcAAAAAADxPbmUgY29tcGlsZWQgcnVsZSBwZXIgZG9jdW1lbnQgcnVsZSwgaW4gdGhlIHN1Ym1pdHRlZCBvcmRlci4AAAAFcnVsZXMAAAAAAAPqAAAH0AAAAAxDb21waWxlZFJ1bGU=",
        "AAAAAQAAAK9PbmUgcnVsZSwgY29tcGlsZWQgdG8gdGhlIGV4YWN0IHNoYXBlcyBPWidzIGBhZGRfY29udGV4dF9ydWxlYCB0YWtlczoKcmVzb2x2ZWQgYWRkcmVzc2VzLCBPWiBgU2lnbmVyYHMsIGFuZCAoZm9yIGNvbnN0cmFpbmVkIHJ1bGVzKSB0aGUKaW50ZXJwcmV0ZXIgcHJvZ3JhbSBhcyBgSW5zdGFsbFBhcmFtc2AuAAAAAAAAAAAMQ29tcGlsZWRSdWxlAAAABgAAAY5aZXJvIG9yIG9uZSBlbnRyaWVzIChhIGBWZWNgIGZvciB0aGUgc2FtZSByZWFzb24gYXMgYGluc3RhbGxgKS4KUHJlc2VudCDih5IgYWxzbyBhdHRhY2ggT1ogYHNwZW5kaW5nX2xpbWl0YCB3aXRoIHRoZXNlIHBhcmFtcyDigJQgdGhlCmN1bXVsYXRpdmUgY2FwIHRoZSBzdGF0ZWxlc3MgaW50ZXJwcmV0ZXIgY2Fubm90IGV4cHJlc3MuIFRoZSBhcHBsaWVyCnJlc29sdmVzIHRoZSBwb2xpY3kncyBjb250ZW50LWFkZHJlc3NlZCBhZGRyZXNzIGFuZCBrZXlzIGl0IGludG8gdGhlCnJ1bGUncyBwb2xpY3kgbWFwIGJlc2lkZSB0aGUgaW50ZXJwcmV0ZXI7IHRoZSB0cmFja2VkIHRva2VuIGlzIHRoZQpydWxlJ3MgYENvbnRyYWN0YCBzY29wZSAodmFsaWRhdGlvbiBwaW5zIGB0b2tlbiA9PSBzY29wZWApLgAAAAAAA2NhcAAAAAPqAAAH0AAAAAtDb21waWxlZENhcAAAAADuVGhlIGludGVycHJldGVyIHByb2dyYW0gdG8gYXR0YWNoOiB6ZXJvIG9yIG9uZSBlbnRyaWVzLiBBIGBWZWNgCmJlY2F1c2UgYCNbY29udHJhY3R0eXBlXWAgaGFzIG5vIGNvbnZlcnNpb24gZm9yIGBPcHRpb25gIG9mIGEgY3VzdG9tCnN0cnVjdCAoYE9wdGlvbjx1MzI+YCBvbiBgdmFsaWRfdW50aWxgIHdvcmtzIGJlY2F1c2UgYHUzMmAgaXMgYSBob3N0CnR5cGUpLiBFbXB0eSDih5IgYSBwb2xpY3ktZnJlZSBydWxlLgAAAAAAB2luc3RhbGwAAAAD6gAAB9AAAAANSW5zdGFsbFBhcmFtcwAAAAAAAFdUaGUgcnVsZSdzIG5hbWUgaW4gdGhlIGRvY3VtZW50LiBUaGUgYWNjb3VudCBtYXRjaGVzIGluc3RhbGxlZCBydWxlcwpieSBuYW1lIGFuZCBzY29wZS4AAAAABG5hbWUAAAAQAAAAAAAAAAVzY29wZQAAAAAAB9AAAAAJUnVsZVNjb3BlAAAAAAAAUFRoZSBydWxlJ3Mgc2lnbmVycywgd2l0aCBleHRlcm5hbCBrZXlzIGFzIGRlY2xhcmVkIChhbHJlYWR5CnZlcmlmaWVyLWNhbm9uaWNhbCkuAAAAB3NpZ25lcnMAAAAD6gAAB9AAAAAGU2lnbmVyAAAAAAB7VGhlIGxhc3QgbGVkZ2VyIHRoZSBydWxlIGF1dGhvcml6ZXMsIGlmIGJvdW5kZWQ6IE9aJ3MgaW5jbHVzaXZlCmB2YWxpZF91bnRpbGAsIG9uZSBiZWxvdyB0aGUgZG9jdW1lbnQncyBgbm90LWFmdGVyLWxlZGdlcmAuAAAAAAt2YWxpZF91bnRpbAAAAAPoAAAABA==",
        "AAAAAQAAAHBXaGF0IGBkZXJpdmVfdGFyZ2V0YCByZXR1cm5zOiB0aGUgcmVjb3ZlcnkgdGFyZ2V0IHRoZSBjb250cm9sbGVyIGJpbmRzCmludG8gYW4gYXR0ZW1wdCdzIHN0YXRlbWVudCAoc3BlYyDCpzcuMSkuAAAAAAAAAA1EZXJpdmVkVGFyZ2V0AAAAAAAABQAAAFJUaGUgdGFyZ2V0J3MgY2Fub25pY2FsIGJ5dGVzOiBleGFjdGx5IHdoYXQgdGhlIGNvbXBsZXRpbmcgYGFwcGx5X2RvY2AKbXVzdCBzdWJtaXQuAAAAAAAJY2Fub25pY2FsAAAAAAAADgAAAGhUaGUgdGFyZ2V0J3MgcmVjb3ZlcnkgYGNvbmZpZ19oYXNoYCAodGhlIGN1cnJlbnQgb25lLCBvciB0aGUgY3VycmVudApvbmUgd2l0aCB0aGUgZGVjbGFyZWQgWksgcm90YXRpb24pLgAAAAtjb25maWdfaGFzaAAAAAPuAAAAIAAAADFgc2hhMjU2YCBvZiBgY2Fub25pY2FsYDogdGhlIHRhcmdldCdzIGBkb2NfaGFzaGAuAAAAAAAACGRvY19oYXNoAAAD7gAAACAAAABDRmluZ2VycHJpbnRzIG9mIGV2ZXJ5IGNyZWRlbnRpYWwgaW4gdGhlIHRhcmdldCAoc3BlYyDCpzcuMyBydWxlIDcpLgAAAAAMZmluZ2VycHJpbnRzAAAD6gAAA+4AAAAgAAABR1RoZSBjcmVkZW50aWFscyBvY2N1cHlpbmcgdGhlIHJlcGxhY2VkIHNpZ25lciBzbG90cyBpbiB0aGUgc291cmNlOgp0aGUgYXBwbGllZCBkb2N1bWVudCdzIGZvciBsb3N0LWtleSwgdGhlIGJhc2VsaW5lJ3MgZm9yIGNvbXByb21pc2UuCkV4dGVybmFsIGtleXMgYXJlIGNhbm9uaWNhbGl6ZWQgYnkgdGhlaXIgdmVyaWZpZXIsIHNvIGEgY3JlZGVudGlhbCdzCmBmaW5nZXJwcmludGAgaXMgdGhlIG9uZSByZXZvY2F0aW9uIGNvbXBhcmVzLiBUaGUgY29udHJvbGxlciByZWNvcmRzCnRoZW0gYXQgVDEgYW5kIHRoZSBjb21wbGV0aW9uIHJldm9rZXMgdGhlbSAoc3BlYyDCpzgpLgAAAAAIcmVwbGFjZWQAAAPqAAAH0AAAAApDcmVkZW50aWFsAAA=",
        "AAAAAQAAAHVGbGF0IHBlci1kb2N1bWVudCBjYXBzOiBbYE1BWF9ET0NfU0lHTkVSU2BdLCBbYE1BWF9ET0NfUlVMRVNgXSwKW2BNQVhfRE9DX0NBTk9OSUNBTF9CWVRFU2BdLCBbYE1BWF9SVUxFX05BTUVfQllURVNgXS4AAAAAAAAAAAAADUZsYXREb2NMaW1pdHMAAAAAAAAEAAAAAAAAABNtYXhfY2Fub25pY2FsX2J5dGVzAAAAAAQAAAAAAAAAE21heF9ydWxlX25hbWVfYnl0ZXMAAAAABAAAAAAAAAAJbWF4X3J1bGVzAAAAAAAABAAAAAAAAAALbWF4X3NpZ25lcnMAAAAABA==",
        "AAAABAAAAGRFdmVyeXRoaW5nIGBjb21waWxlX2RvY2AgY2FuIHJlZnVzZS4gKGAjW3NjZXJyXWAgYXNzaWducyBzZXF1ZW50aWFsIGNvZGVzCmZyb20gMSwgaW4gdmFyaWFudCBvcmRlci4pAAAAAAAAABBEb2NDb21waWxlckVycm9yAAAACwAAACtUaGUgc3VibWl0dGVkIGRvY3VtZW50IGJ5dGVzIGFyZSBub3QgVVRGLTguAAAAAApEb2NOb3RVdGY4AAAAAAABAAAAbFRoZSBkb2N1bWVudCBmYWlsZWQgZmFpbC1jbG9zZWQgcGFyc2luZyAodW5rbm93biBmaWVsZCwgYmFkIHNoYXBlLCB1bnN1cHBvcnRlZCB2ZXJzaW9uLCBkdXBsaWNhdGUga2V5LCDigKYpLgAAAAhEb2NQYXJzZQAAAAIAAABzVGhlIGRvY3VtZW50IGZhaWxlZCBzZW1hbnRpYyB2YWxpZGF0aW9uIChkYW5nbGluZyBzaWduZXIgcmVmLCBtYWxmb3JtZWQgYWRkcmVzcyBvciBrZXksIGFtYmlndW91cyBlbXB0eSBsaXN0LCDigKYpLgAAAAAKRG9jSW52YWxpZAAAAAAAAwAAAENUaGUgZG9jdW1lbnQgbmFtZXMgbm8gbmV0d29yaywgb3IgYSBuZXR3b3JrIHRoYXQgaXMgbm90IHRoaXMgY2hhaW4uAAAAAAxXcm9uZ05ldHdvcmsAAAAEAAAAQVRoZSBkb2N1bWVudCBjYW5ub3QgYmUgbG93ZXJlZCB0byBydWxlcyAodW5zdXBwb3J0ZWQgcnVsZSBzaGFwZSkuAAAAAAAACkRvY0NvbXBpbGUAAAAAAAUAAACDVGhlIGRvY3VtZW50IGV4Y2VlZHMgYSBkb2N1bWVudCBjYXAgKFtgTUFYX0RPQ19TSUdORVJTYF0sIFtgTUFYX0RPQ19SVUxFU2BdLCBbYE1BWF9ET0NfQ0FOT05JQ0FMX0JZVEVTYF0sIFtgTUFYX1JVTEVfTkFNRV9CWVRFU2BdKS4AAAAAC0RvY1Rvb0xhcmdlAAAAAAYAAAI3QSBzaWduZXIncyBleHRlcm5hbCBga2V5YCBpcyBub3QgaXRzIHZlcmlmaWVyLWNhbm9uaWNhbCBmb3JtOiBlaXRoZXIgdGhlIHZlcmlmaWVyIGNvdWxkIG5vdCBjYW5vbmljYWxpemUgaXQgYXQgYWxsLCBvciB0aGUgZGVjbGFyZWQgYnl0ZXMgZGlmZmVyIGZyb20gdGhlIGNhbm9uaWNhbCBmb3JtIHRoZSB2ZXJpZmllciByZXR1cm5zIChlLmcuIGEgV2ViQXV0aG4ga2V5IGNhcnJ5aW5nIGEgY3JlZGVudGlhbC1pZCBzdWZmaXggdGhlIHZlcmlmaWVyIGRyb3BzLCBvciBhIG5vbi1jYW5vbmljYWwgcG9pbnQgZW5jb2RpbmcpLiBUaGUgY29tcGlsZXIgcmVmdXNlcyBpdCByYXRoZXIgdGhhbiBzaWxlbnRseSBjYW5vbmljYWxpemluZywgc28gdGhlIGJ5dGVzIHRoZSBkb2N1bWVudCBoYXNoIOKAlCBhbmQgYSByZWNvdmVyeSBhdHRlbXB0J3MgYHJlcGxhY2VtZW50c19oYXNoYCDigJQgYmluZCBhcmUgZXhhY3RseSB0aGUgYnl0ZXMgdGhlIGluc3RhbGxlZCBjcmVkZW50aWFsIHVzZXMsIGFuZCB0d28gc2lnbmVycyBjYW5ub3QgaGlkZSBvbmUgcGh5c2ljYWwga2V5IHVuZGVyIHR3byBzcGVsbGluZ3MuAAAAABVLZXlOb3RDYW5vbmljYWxpemFibGUAAAAAAAAHAAAAOmBkZXJpdmVfdGFyZ2V0YDogdGhlIGN1cnJlbnQgZG9jdW1lbnQgZW5yb2xscyBubyByZWNvdmVyeS4AAAAAAAtOb3RFbnJvbGxlZAAAAAAIAAAA/WBkZXJpdmVfdGFyZ2V0YDogdGhlIHJlcGxhY2VtZW50IHNldCBicmVha3Mgc3BlYyDCpzcuMyBydWxlcyAxLTMgKG5vdCBjYW5vbmljYWwsIGVtcHR5IGZvciBsb3N0LWtleSwgYSBzaWduZXIgaWQgdGhhdCBpcyBub3QgcmVwbGFjZWFibGUgb3Igbm90IGRlY2xhcmVkIGluIHRoZSBzb3VyY2UsIG9yIGEgY2hhbmdlIG9mIGNyZWRlbnRpYWwga2luZCBvciB2ZXJpZmllciksIG9yIHRoZSBhY3Rpb24gaXMgbm90IGEgcmVjb3ZlcnkgYXR0ZW1wdC4AAAAAAAASUmVwbGFjZW1lbnRSZWZ1c2VkAAAAAAAJAAAAeWBkZXJpdmVfdGFyZ2V0YDogdGhlIFpLIGVucm9sbG1lbnQgaXMgbWlzc2luZyBmb3IgYSBaSyBtb2RlLCBwcmVzZW50IGZvciBhIGd1YXJkaWFuLW9ubHkgbW9kZSwgb3IgcmV1c2VzIHRoZSBlbnJvbGxlZCBpZC4AAAAAAAAUWmtFbnJvbGxtZW50TWlzbWF0Y2gAAAAKAAAAZGBkZXJpdmVfdGFyZ2V0YDogdGhlIHRhcmdldCBoYXMgbm8gcG9saWN5LWZyZWUgc2VsZi1hZG1pbiBydWxlIHdpdGggYSBzaWduZXIgKHRoZSBhbnRpLWJyaWNrIGNoZWNrKS4AAAAMQWRtaW5Mb2Nrb3V0AAAACw==",
        "AAAAAQAAAG9UaGUgY2Fub25pY2FsIGZvcm0gYW5kIGZyYWdtZW50IGhhc2hlcyBhIGNvbXBpbGVyIHByb2R1Y2VzLCBhcwpbYFBlcmNoRG9jQ29tcGlsZXI6OmNhcGFiaWxpdGllc2BdIHJldHVybnMgdGhlbS4AAAAAAAAAABRDb21waWxlckNhcGFiaWxpdGllcwAAAAMAAAA9VGhlIENBTk9OIHZlcnNpb24gYGRvY19oYXNoYCBpcyBgc2hhMjU2YCBvZiAoYENBTk9OSUNBTC5tZGApLgAAAAAAAA1jYW5vbl92ZXJzaW9uAAAAAAAABAAAAEFUaGUgZG9tYWluIHRhZyBvZiBhIHJlY292ZXJ5IG1lbWJlcidzIGBjb25maWdfaGFzaGAgKHNwZWMgwqczLjIpLgAAAAAAAA9jb25maWdfaGFzaF90YWcAAAAAEAAAADRUaGUgZG9tYWluIHRhZyBvZiBhIHJ1bGUncyBgcnVsZV9oYXNoYCAoc3BlYyDCpzMuMikuAAAADXJ1bGVfaGFzaF90YWcAAAAAAAAQ",
        "AAAAAAAAAENUaGUgZG9jdW1lbnQgY2FwcyBldmVyeSBgY29tcGlsZV9kb2NgIGFuZCBgZGVyaXZlX3RhcmdldGAgZW5mb3JjZXMuAAAAAAZsaW1pdHMAAAAAAAAAAAABAAAH0AAAAAlEb2NMaW1pdHMAAAA=",
        "AAAAAAAAAcdKU09OIGJ5dGVzIGluIOKGkiBjb21waWxlZCBydWxlcyArIGNhbm9uaWNhbCBgZG9jX2hhc2hgIG91dC4gUHVyZToKbm8gYXV0aCwgbm8gc3RvcmFnZS4gVGhlIGRvY3VtZW50IG11c3QgbmFtZSBUSElTIG5ldHdvcmsgKGl0cwpgbmV0d29ya2Agc3RyaW5nIG11c3QgaGFzaCB0byB0aGUgY2hhaW4ncyBuZXR3b3JrIGlkKSwgc28gYSB0ZXN0bmV0CmRvY3VtZW50IGNhbiBuZXZlciBjb21waWxlIG9uIG1haW5uZXQgb3IgdmljZSB2ZXJzYS4gSXQgbXVzdCBhbHNvIGZpdAp0aGUgZG9jdW1lbnQgY2FwcyAoW2BTZWxmOjpsaW1pdHNgXSksIGFuZCBldmVyeSBleHRlcm5hbCBzaWduZXIga2V5Cm11c3QgYWxyZWFkeSBiZSBpdHMgdmVyaWZpZXItY2Fub25pY2FsIGZvcm06IHRoZSBjb21waWxlciBjYWxscyBlYWNoCm5hbWVkIHZlcmlmaWVyJ3MgYGJhdGNoX2Nhbm9uaWNhbGl6ZV9rZXlgIHRvIGNoZWNrLgAAAAALY29tcGlsZV9kb2MAAAAAAQAAAAAAAAAIZG9jX2pzb24AAAAOAAAAAQAAA+kAAAfQAAAAC0NvbXBpbGVkRG9jAAAAB9AAAAAQRG9jQ29tcGlsZXJFcnJvcg==",
        "AAAAAAAAAEtUaGUgQ0FOT04gdmVyc2lvbiBhbmQgdGhlIGZyYWdtZW50IGhhc2ggZG9tYWluIHRhZ3MgdGhpcyBjb21waWxlcgpwcm9kdWNlcy4AAAAADGNhcGFiaWxpdGllcwAAAAAAAAABAAAH0AAAABRDb21waWxlckNhcGFiaWxpdGllcw==",
        "AAAAAAAAAiNEZXJpdmUgYSByZWNvdmVyeSB0YXJnZXQgKGBkb2NzL3JlY292ZXJ5L3NwZWMubWRgIMKnNyk6IGBzb3VyY2VfanNvbmAKaXMgdGhlIGFjY291bnQncyBhcHBsaWVkIGRvY3VtZW50IChsb3N0LWtleSkgb3IgdGhlIHB1Ymxpc2hlZApiYXNlbGluZSAoY29tcHJvbWlzZSk7IGBjdXJyZW50X2pzb25gIGlzIHRoZSBhcHBsaWVkIGRvY3VtZW50LCB3aG9zZQpyZWNvdmVyeSBtZW1iZXIgdGhlIHRhcmdldCBrZWVwcy4gVGhlIHRhcmdldCBpcyB0aGUgc291cmNlIHdpdGgKZXhhY3RseSB0aGUgZGVjbGFyZWQgcmVwbGFjZW1lbnRzIGFuZCBaSyByb3RhdGlvbiwgdGhlbiB2YWxpZGF0ZWQsCm5ldHdvcmstYm91bmQsIGNhcHBlZCwgY29tcGlsZWQsIGFuZCBhbnRpLWJyaWNrLWNoZWNrZWQgbGlrZSBhbnkKYXBwbGllZCBkb2N1bWVudC4gUHVyZTogbm8gYXV0aCwgbm8gc3RvcmFnZS4gVGhlIGNvbnRyb2xsZXIgY2FsbHMgaXQKd2hlbiBhbiBhdHRlbXB0IGJlZ2lucywgYW5kIGNvbXBsZXRlcnMgc2ltdWxhdGUgaXQgdG8gb2J0YWluIHRoZQpjYW5vbmljYWwgYnl0ZXMuAAAAAA1kZXJpdmVfdGFyZ2V0AAAAAAAABAAAAAAAAAALc291cmNlX2pzb24AAAAADgAAAAAAAAAMY3VycmVudF9qc29uAAAADgAAAAAAAAAGYWN0aW9uAAAAAAfQAAAADlJlY292ZXJ5QWN0aW9uAAAAAAAAAAAADHJlcGxhY2VtZW50cwAAB9AAAAAOUmVwbGFjZW1lbnRTZXQAAAAAAAEAAAPpAAAH0AAAAA1EZXJpdmVkVGFyZ2V0AAAAAAAH0AAAABBEb2NDb21waWxlckVycm9y",
        "AAAAAgAAAC9PbmUgb3Agb2YgYSBwb3N0Zml4LWVuY29kZWQgY29uc3RyYWludCBwcm9ncmFtLgAAAAAAAAAAAk9wAAAAAAAQAAAAAQAAADBQb3AgYG5gIHZlcmRpY3RzLCBwdXNoIHRoZWlyIEtsZWVuZSBjb25qdW5jdGlvbi4AAAADQWxsAAAAAAEAAAAEAAAAAQAAADBQb3AgYG5gIHZlcmRpY3RzLCBwdXNoIHRoZWlyIEtsZWVuZSBkaXNqdW5jdGlvbi4AAAADQW55AAAAAAEAAAAEAAAAAAAAACpQb3Agb25lIHZlcmRpY3QsIHB1c2ggaXRzIEtsZWVuZSBuZWdhdGlvbi4AAAAAAANOb3QAAAAAAQAAAClBdCBsZWFzdCB0aGlzIG1hbnkgYXV0aGVudGljYXRlZCBzaWduZXJzLgAAAAAAAApNaW5TaWduZXJzAAAAAAABAAAABAAAAAEAAAApSW52b2tlZCBmdW5jdGlvbiBpcyBvbmUgb2YgdGhlc2Ugc3ltYm9scy4AAAAAAAAERm5JbgAAAAEAAAPqAAAAEQAAAAEAAAAmQXJndW1lbnQgYXQgaW5kZXggZXF1YWxzIHRoaXMgYWRkcmVzcy4AAAAAAAlBcmdBZGRyRXEAAAAAAAACAAAABAAAABMAAAABAAAAMkFyZ3VtZW50IGF0IGluZGV4IGlzIHRoZSBwcm90ZWN0ZWQgYWNjb3VudCBpdHNlbGYuAAAAAAANQXJnQWRkcklzU2VsZgAAAAAAAAEAAAAEAAAAAQAAACVBcmd1bWVudCBhdCBpbmRleCBlcXVhbHMgdGhpcyBzeW1ib2wuAAAAAAAACEFyZ1N5bUVxAAAAAgAAAAQAAAARAAAAAQAAADVBcmd1bWVudCBhdCBpbmRleCAoYSBzdHJpbmcpIGlzIG9uZSBvZiB0aGVzZSBzdHJpbmdzLgAAAAAAAAhBcmdTdHJJbgAAAAIAAAAEAAAD6gAAABAAAAABAAAANUFyZ3VtZW50IGF0IGluZGV4IChhIHN0cmluZykgc3RhcnRzIHdpdGggdGhpcyBwcmVmaXguAAAAAAAADEFyZ1N0clByZWZpeAAAAAIAAAAEAAAAEAAAAAEAAAAlQXJndW1lbnQgYXQgaW5kZXggZXF1YWxzIHRoZXNlIGJ5dGVzLgAAAAAAAApBcmdCeXRlc0VxAAAAAAACAAAABAAAAA4AAAABAAAAI0FyZ3VtZW50IGF0IGluZGV4IGVxdWFscyB0aGlzIGkxMjguAAAAAAlBcmdJMTI4RXEAAAAAAAACAAAABAAAAAsAAAABAAAAIkFyZ3VtZW50IGF0IGluZGV4IGVxdWFscyB0aGlzIHUzMi4AAAAAAAhBcmdVMzJFcQAAAAIAAAAEAAAABAAAAAEAAAApVGhlIGNhbGwgaGFzIGV4YWN0bHkgdGhpcyBtYW55IGFyZ3VtZW50cy4AAAAAAAAIQXJnQ291bnQAAAABAAAABAAAAAEAAAAvQ3VycmVudCBsZWRnZXIgc2VxdWVuY2UgaXMgc3RyaWN0bHkgYmVsb3cgdGhpcy4AAAAADExlZGdlckJlZm9yZQAAAAEAAAAEAAAAAQAAAClDdXJyZW50IGxlZGdlciBzZXF1ZW5jZSBpcyBhdCBsZWFzdCB0aGlzLgAAAAAAAA9MZWRnZXJBdE9yQWZ0ZXIAAAAAAQAAAAQ=",
        "AAAAAQAAAExBIHBvc3RmaXgtZW5jb2RlZCBjb25zdHJhaW50IHByb2dyYW0uIFRoZSBsYXN0IG9wIHByb2R1Y2VzIHRoZSByb290CnZlcmRpY3QuAAAAAAAAAApScG5Qcm9ncmFtAAAAAAACAAAAIVRoZSBvcHMsIGV2YWx1YXRlZCBsZWZ0IHRvIHJpZ2h0LgAAAAAAAANvcHMAAAAD6gAAB9AAAAACT3AAAAAAADxUaGUgd2lyZS1mb3JtYXQgdmVyc2lvbjsgb25seSBbYFBST0dSQU1fVkVSU0lPTmBdIHZhbGlkYXRlcy4AAAAHdmVyc2lvbgAAAAAE",
        "AAAAAQAAAVVXaGF0IHRoZSBjb21waWxlciBzdG9yZXMgaW4gdGhlIGludGVycHJldGVyIGZvciBvbmUgYChhY2NvdW50LCBydWxlKWA6IHRoZQpwcm9ncmFtIHBsdXMgdGhlIHByb3ZlbmFuY2UgaGFzaCBvZiB0aGUgcnVsZSBpdCB3YXMgY29tcGlsZWQgZnJvbS4gU2hhcmluZwp0aGlzIGAjW2NvbnRyYWN0dHlwZV1gIGJldHdlZW4gdGhlIGNvbXBpbGVyIGFuZCB0aGUgaW50ZXJwcmV0ZXIgaXMgd2hhdAprZWVwcyBpbnN0YWxsIHBhcmFtcyBmcm9tIGV2ZXIgYmVpbmcgYSBoYW5kLWJ1aWx0IGBTY1ZhbGAg4oCUIGJvdGggc2lkZXMKZW5jb2RlIGFuZCBkZWNvZGUgdGhyb3VnaCBleGFjdGx5IHRoZXNlIHR5cGVzLgAAAAAAAAAAAAANSW5zdGFsbFBhcmFtcwAAAAAAAAIAAAC6VGhlIHNvdXJjZSBydWxlJ3MgYHBlcmNoX2lyOjpydWxlX2hhc2hgLCBub3QgdGhlIHdob2xlIGRvY3VtZW50J3MKaGFzaCAodGhlIGZpZWxkIGtlZXBzIGl0cyBvcmlnaW5hbCBuYW1lKS4gSXQgYmluZHMgdGhlIG9uLWNoYWluCnByb2dyYW0gdG8gdGhlIHJldmlld2VkIHJ1bGUgKHByb3ZlbmFuY2UgZm9yIGxpZnQvZGlmZikuAAAAAAAIZG9jX2hhc2gAAAPuAAAAIAAAAAAAAAAHcHJvZ3JhbQAAAAfQAAAAClJwblByb2dyYW0AAA==",
        "AAAAAgAAAE5BIHNpZ25lciBjcmVkZW50aWFsLCBzaGFwZWQgbGlrZSBPWiBgc3RlbGxhcl9hY2NvdW50czo6c21hcnRfYWNjb3VudDo6U2lnbmVyYC4AAAAAAAAAAAAKQ3JlZGVudGlhbAAAAAAAAgAAAAEAAABsYFNpZ25lcjo6RGVsZWdhdGVkKGFkZHJlc3MpYDogYSBgRy4uLmAgb3IgYEMuLi5gIGFkZHJlc3MgdGhhdAphdXRoZW50aWNhdGVzIHRocm91Z2ggQ0FQLTAwNzEgZGVsZWdhdGVkIGF1dGguAAAACURlbGVnYXRlZAAAAAAAAAEAAAATAAAAAQAAAEhgU2lnbmVyOjpFeHRlcm5hbCh2ZXJpZmllciwga2V5KWA6IGEga2V5IGNoZWNrZWQgYnkgYSB2ZXJpZmllcgpjb250cmFjdC4AAAAIRXh0ZXJuYWwAAAACAAAAEwAAAA4=",
        "AAAAAQAAAGxPbmUgZGVzaWduYXRlZCBzaWduZXIgc2xvdCBhbmQgdGhlIGNyZWRlbnRpYWwgdGhhdCByZXBsYWNlcyB3aGF0ZXZlcgp0aGF0IHNsb3QgaG9sZHMgaW4gdGhlIHNvdXJjZSBkb2N1bWVudC4AAAAAAAAAC1JlcGxhY2VtZW50AAAAAAIAAAA4VGhlIGNyZWRlbnRpYWwgdGhlIHRhcmdldCBkb2N1bWVudCBnaXZlcyB0aGF0IHNpZ25lciBpZC4AAAAKY3JlZGVudGlhbAAAAAAH0AAAAApDcmVkZW50aWFsAAAAAABDQSBkb2N1bWVudCBzaWduZXIgaWQgbGlzdGVkIGluIHRoZSBlbnJvbGxlZCBgcmVjb3ZlcnkucmVwbGFjZWFibGVgLgAAAAAJc2lnbmVyX2lkAAAAAAAAEA==",
        "AAAAAQAAAVVBIFpLIGVucm9sbG1lbnQgYSByZWNvdmVyeSBjb21wbGV0aW9uIGluc3RhbGxzLgoKVGhlIGNvbW1pdG1lbnQgaXMgYm91bmQgaGVyZSwgbm90IG9ubHkgdGhlIGlkOiBjb21wbGV0aW9uIHJ1bnMgdW5kZXIgdGhlCnplcm8tc2lnbmVyIHJlY292ZXJ5IHJ1bGUsIHNvIG5vdGhpbmcgc2lnbnMgaXRzIGFyZ3VtZW50cywgYW5kIGEKY29tbWl0bWVudCBzdXBwbGllZCBvbmx5IGF0IGNvbXBsZXRpb24gY291bGQgYmUgc3dhcHBlZCBieSB3aG9ldmVyCnN1Ym1pdHMgdGhlIGNvbXBsZXRpbmcgdHJhbnNhY3Rpb24gZmlyc3Qg4oCUIGhhbmRpbmcgdGhlbSB0aGUgYWNjb3VudCdzCm5leHQgWksgZmFjdG9yLgAAAAAAAAAAAAAMWmtFbnJvbGxtZW50AAAAAgAAARlUaGUgbmV3IGxlYWYncyBpbm5lciBjb21taXRtZW50LCBgUG9zZWlkb24yKERPTV9MRUFGLCBzZWNyZXQpYC4KRGVyaXZhdGlvbiB3cml0ZXMgYGlkYCBhbmQgYGNvbW1pdG1lbnRgIGludG8gdGhlIHRhcmdldCBkb2N1bWVudCdzCnJlY292ZXJ5IHNlY3Rpb24sIHNvIHRoZSB0YXJnZXQgaGFzaCBiaW5kcyB0aGVtLCBhbmQgdGhlIGNvbXBsZXRpbmcKYGFwcGx5X2RvY2AgaW5zZXJ0cyB0aGUgbGVhZiBmcm9tIHRoZSBjb21waWxlZCB0YXJnZXQsIG5ldmVyIGZyb20gYQpjYWxsIGFyZ3VtZW50LgAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAE1UaGUgbmV3IGVucm9sbG1lbnQgaWQuIE11c3QgbmV2ZXIgaGF2ZSBiZWVuIGVucm9sbGVkIGZvciB0aGlzCmFjY291bnQgYmVmb3JlLgAAAAAAAAJpZAAAAAAD7gAAACA=",
        "AAAAAQAAAG9FdmVyeXRoaW5nIGEgYExvc3RLZXlgL2BDb21wcm9taXNlYCBhdHRlbXB0IGNoYW5nZXMgYWJvdXQgdGhlIHNvdXJjZQpkb2N1bWVudC4gU2VlIGBkb2NzL3JlY292ZXJ5L3NwZWMubWRgIMKnNy4AAAAAAAAAAA5SZXBsYWNlbWVudFNldAAAAAAAAgAAAHVTaWduZXIgcmVwbGFjZW1lbnRzIGluIHN0cmljdGx5IGFzY2VuZGluZyBgc2lnbmVyX2lkYCBieXRlIG9yZGVyCihzb3J0ZWQsIG5vIGR1cGxpY2F0ZXMpIOKAlCB0aGUgb25lIGNhbm9uaWNhbCBvcmRlci4AAAAAAAAHc2lnbmVycwAAAAPqAAAH0AAAAAtSZXBsYWNlbWVudAAAAAElVGhlIGZyZXNoIFpLIGVucm9sbG1lbnQgdGhlIGNvbXBsZXRpb24gaW5zdGFsbHMsIHJlcXVpcmVkIGV4YWN0bHkKd2hlbiB0aGUgZW5yb2xsZWQgbW9kZSBoYXMgYSBaSyBmYWN0b3IgKGEgWkstZXZpZGVuY2VkIGNvbXBsZXRpb24KY29uc3VtZXMgdGhlIGVucm9sbGVkIGNyZWRlbnRpYWwsIHNvIGl0IG11c3QgaW5zdGFsbCBhIGZyZXNoIG9uZSkuCkVtcHR5IG9yIG9uZSBlbnRyeSDigJQgYSBgVmVjYCBiZWNhdXNlIGAjW2NvbnRyYWN0dHlwZV1gIGNhbm5vdCBkZXJpdmUKYE9wdGlvbjxDdXN0b21TdHJ1Y3Q+YC4AAAAAAAANemtfZW5yb2xsbWVudAAAAAAAA+oAAAfQAAAADFprRW5yb2xsbWVudA==",
        "AAAAAgAAAHdXaG8gbWF5IGNoYW5nZSB0aGUgcmVjb3ZlcnkgY29uZmlndXJhdGlvbiwgYW5kIHdoZXRoZXIgYW4gYXV0aG9yaXplZAphdHRlbXB0IGZyZWV6ZXMgb3JkaW5hcnkgYWN0aXZpdHkgKHNwZWMgwqcyLCDCpzkpLgAAAAAAAAAAD1JlY292ZXJ5UHJvZmlsZQAAAAACAAAAAAAAAHdPd25lciBhdXRob3JpemF0aW9uIGFsb25lIHJlY29uZmlndXJlczsgYWN0aXZpdHkgY29udGludWVzIHdoaWxlIGFuCmF0dGVtcHQgaXMgYXV0aG9yaXplZDsgdGhlIG93bmVyIGNhbiBhbHdheXMgY2FuY2VsLgAAAAAETG9zcwAAAAAAAABpUmVjb25maWd1cmF0aW9uIGFuZCB1cGdyYWRlcyBhbHNvIG5lZWQgdGhlIGVucm9sbGVkIGNvbmRpdGlvbjsgYW4KYXV0aG9yaXplZCBhdHRlbXB0IGZyZWV6ZXMgdGhlIGFjY291bnQuAAAAAAAACVByb3RlY3RlZAAAAA==",
        "AAAAAQAAACJUaGUgWksgZmFjdG9yIChzcGVjIMKnMy4xLCDCpzMuNCkuAAAAAAAAAAAAEENvbXBpbGVkWmtGYWN0b3IAAAAFAAAANFRoZSBjb25zdHJ1Y3Rvcmxlc3MgWksgYWRhcHRlciB0aGUgY29udHJvbGxlciBjYWxscy4AAAAHYWRhcHRlcgAAAAATAAAAVGBzaGEyNTZgIG9mIHRoZSBhZGFwdGVyJ3MgdmVyaWZpY2F0aW9uIGtleTsgbXVzdCBlcXVhbCB0aGUgYWRhcHRlcidzCmBjaXJjdWl0X2lkKClgLgAAAApjaXJjdWl0X2lkAAAAAAPuAAAAIAAAAHJUaGUgY3VycmVudCBjcmVkZW50aWFsJ3MgaW5uZXIgY29tbWl0bWVudCwgYFBvc2VpZG9uMihET01fTEVBRiwKc2VjcmV0KWAsIGZyb20gd2hpY2ggdGhlIGFjY291bnQgaW5zZXJ0cyB0aGUgbGVhZi4AAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAD9UaGUgY3VycmVudCBjcmVkZW50aWFsJ3MgaWQsIGJvdW5kIGludG8gaXRzIGxlYWYgYW5kIG51bGxpZmllci4AAAAADWVucm9sbG1lbnRfaWQAAAAAAAPuAAAAIAAAACxUaGUgbWVtYmVyc2hpcCBwb29sIHJvb3RzIGFyZSBhY2NlcHRlZCBmcm9tLgAAAARwb29sAAAAEw==",
        "AAAAAQAAABRUaGUgZ3VhcmRpYW4gZmFjdG9yLgAAAAAAAAATQ29tcGlsZWRHdWFyZGlhblNldAAAAAACAAAAQEd1YXJkaWFuIGFkZHJlc3NlcyAoYEcuLi5gIG9yIGBDLi4uYCksIG5ldmVyIHRoZSBhY2NvdW50IGl0c2VsZi4AAAAJZ3VhcmRpYW5zAAAAAAAD6gAAABMAAAAhYDEgPD0gcXVvcnVtIDw9IGd1YXJkaWFucy5sZW4oKWAuAAAAAAAABnF1b3J1bQAAAAAABA==",
        "AAAAAgAAACBXaGljaCBmYWN0b3JzIGEgc3RhdGVtZW50IG5lZWRzLgAAAAAAAAAUQ29tcGlsZWRSZWNvdmVyeU1vZGUAAAADAAAAAQAAABZBIHF1b3J1bSBvZiBndWFyZGlhbnMuAAAAAAAMR3VhcmRpYW5Pbmx5AAAAAQAAB9AAAAATQ29tcGlsZWRHdWFyZGlhblNldAAAAAABAAAADU9uZSBaSyBwcm9vZi4AAAAAAAAGWmtPbmx5AAAAAAABAAAH0AAAABBDb21waWxlZFprRmFjdG9yAAAAAQAAACdBIHF1b3J1bSBvZiBndWFyZGlhbnMgYW5kIG9uZSBaSyBwcm9vZi4AAAAACENvbWJpbmVkAAAAAgAAB9AAAAATQ29tcGlsZWRHdWFyZGlhblNldAAAAAfQAAAAEENvbXBpbGVkWmtGYWN0b3I=",
        "AAAAAQAAAB1BIGNvbXBpbGVkIGByZWNvdmVyeWAgbWVtYmVyLgAAAAAAAAAAAAAWQ29tcGlsZWRSZWNvdmVyeUNvbmZpZwAAAAAACQAAAFRUaGUgZW5yb2xsZWQgYmFzZWxpbmUncyBjYW5vbmljYWwgZG9jdW1lbnQgaGFzaCwgaWYgY29tcHJvbWlzZQpyZWNvdmVyeSBpcyBlbnJvbGxlZC4AAAAIYmFzZWxpbmUAAAPoAAAD7gAAACAAAADUW2Bjb25maWdfaGFzaGBdIG9mIHRoZSBjYW5vbmljYWwgSlNPTiBvZiB0aGUgcmVjb3ZlcnkgbWVtYmVyLCBjb21wdXRlZApieSB0aGUgZG9jIGNvbXBpbGVyIChzcGVjIMKnMy4yKS4gQ29uZmlndXJhdGlvbgppZGVudGl0eTogdHdvIGNvbXBpbGVkIGNvbmZpZ3VyYXRpb25zIHdpdGggdGhlIHNhbWUgYGNvbmZpZ19oYXNoYCBhcmUKdGhlIHNhbWUgY29uZmlndXJhdGlvbi4AAAALY29uZmlnX2hhc2gAAAAD7gAAACAAAAAgVGhlIGFkb3B0ZWQgY29udHJvbGxlciBpbnN0YW5jZS4AAAAKY29udHJvbGxlcgAAAAAAEwAAAD5MZWRnZXJzIGZyb20gYW4gYXR0ZW1wdCdzIGF1dGhvcml6YXRpb24gdW50aWwgaXQgY2FuIGNvbXBsZXRlLgAAAAAADWRlbGF5X2xlZGdlcnMAAAAAAAAEAAAAZ1RoZSBldmlkZW5jZSB3aW5kb3cgb2YgYSBjb2xsZWN0aW5nIGF0dGVtcHQgYW5kIHRoZSBjb21wbGV0aW9uCndpbmRvdyBvZiBhbiBhdXRob3JpemVkIG9uZSwgaW4gbGVkZ2Vycy4AAAAADmV4cGlyeV9sZWRnZXJzAAAAAAAEAAAARExpZmV0aW1lIGNhcCBvbiBldmlkZW5jZS1iYXNlZCBjYW5jZWxsYXRpb25zIG9mIGF1dGhvcml6ZWQgYXR0ZW1wdHMuAAAAC21heF9jYW5jZWxzAAAAAAQAAAAiVGhlIGZhY3RvcnMgZXZpZGVuY2UgbXVzdCBzYXRpc2Z5LgAAAAAABG1vZGUAAAfQAAAAFENvbXBpbGVkUmVjb3ZlcnlNb2RlAAAAWFdobyBtYXkgY2hhbmdlIHRoZSBjb25maWd1cmF0aW9uLCBhbmQgd2hldGhlciBhbiBhdXRob3JpemVkIGF0dGVtcHQKZnJlZXplcyB0aGUgYWNjb3VudC4AAAAHcHJvZmlsZQAAAAfQAAAAD1JlY292ZXJ5UHJvZmlsZQAAAAB7U2lnbmVyIGlkcyAobm90IGNyZWRlbnRpYWwgZmluZ2VycHJpbnRzKSBhIHJlY292ZXJ5IG1heSByZXBsYWNlLCBzbwpyb3RhdGluZyBhIGtleSBkb2VzIG5vdCBjaGFuZ2UgdGhlIGNvbmZpZ3VyYXRpb24gKCM5MikuAAAAAAtyZXBsYWNlYWJsZQAAAAPqAAAAEA==",
        "AAAAAwAAAUpUaGUgYWN0aW9uIGRvbWFpbiBhIHN0YXRlbWVudCBhdXRob3JpemVzLiBFdmlkZW5jZSBmb3Igb25lIGFjdGlvbiBuZXZlcgpzYXRpc2ZpZXMgYW5vdGhlcjogdGhlIGFjdGlvbiBjb2RlIGlzIHRoZSBlbmNvZGluZydzIDI2dGggYnl0ZSBhbmQgc2VsZWN0cwp0aGUgc3ViamVjdCBsYXlvdXQsIHNvIHR3byBzdGF0ZW1lbnRzIHRoYXQgZGlmZmVyIG9ubHkgaW4gYWN0aW9uIGhhdmUKZGlmZmVyZW50IGRpZ2VzdHMgKGFuZCBkaWZmZXJlbnQgZW5jb2RlZCBsZW5ndGhzIGZvciBtb3N0IHBhaXJzKS4KClRoZSBudW1lcmljIGNvZGVzIGFyZSBwYXJ0IG9mIHRoZSB3aXJlIGZvcm1hdC4AAAAAAAAAAAAOUmVjb3ZlcnlBY3Rpb24AAAAAAAUAAABgTG9zdC1rZXkgcmVjb3Zlcnk6IHJlcGxhY2UgZGVzaWduYXRlZCBjcmVkZW50aWFscyBpbiBhbiBhZ3JlZWQKc25hcHNob3Qgb2YgdGhlIGN1cnJlbnQgZG9jdW1lbnQuAAAAB0xvc3RLZXkAAAAAAQAAAFlDb21wcm9taXNlIHJlY292ZXJ5OiByZXN0b3JlIHRoZSBlbnJvbGxlZCBiYXNlbGluZSwgd2l0aCBkZXNpZ25hdGVkCmNyZWRlbnRpYWxzIHJlcGxhY2VkLgAAAAAAAApDb21wcm9taXNlAAAAAAACAAAAHkNhbmNlbCBvbmUgaWRlbnRpZmllZCBhdHRlbXB0LgAAAAAABkNhbmNlbAAAAAAAAwAAAINDaGFuZ2Ugb3IgcmVtb3ZlIHRoZSBlbnJvbGxlZCByZWNvdmVyeSBjb25maWd1cmF0aW9uICh0aGUgZXZpZGVuY2UgYQpgUHJvdGVjdGVkYCBhY2NvdW50IG5lZWRzIGluIGFkZGl0aW9uIHRvIG93bmVyIGF1dGhvcml6YXRpb24pLgAAAAALUmVjb25maWd1cmUAAAAABAAAAHRBcHByb3ZlIG9uZSBzY2hlZHVsZWQgYWNjb3VudCB1cGdyYWRlICh0aGUgZXZpZGVuY2UgYSBgUHJvdGVjdGVkYAphY2NvdW50IG5lZWRzIGluIGFkZGl0aW9uIHRvIG93bmVyIGF1dGhvcml6YXRpb24pLgAAAAdVcGdyYWRlAAAAAAU=",
        "AAAAAgAAAEJSZXByZXNlbnRzIGRpZmZlcmVudCB0eXBlcyBvZiBzaWduZXJzIGluIHRoZSBzbWFydCBhY2NvdW50IHN5c3RlbS4AAAAAAAAAAAAGU2lnbmVyAAAAAAACAAAAAQAAAD1BIGRlbGVnYXRlZCBzaWduZXIgdGhhdCB1c2VzIGJ1aWx0LWluIHNpZ25hdHVyZSB2ZXJpZmljYXRpb24uAAAAAAAACURlbGVnYXRlZAAAAAAAAAEAAAATAAAAAQAAAHJBbiBleHRlcm5hbCBzaWduZXIgd2l0aCBjdXN0b20gdmVyaWZpY2F0aW9uIGxvZ2ljLgpDb250YWlucyB0aGUgdmVyaWZpZXIgY29udHJhY3QgYWRkcmVzcyBhbmQgdGhlIHB1YmxpYyBrZXkgZGF0YS4AAAAAAAhFeHRlcm5hbAAAAAIAAAATAAAADg==" ]),
      options
    )
  }
  public readonly fromJSON = {
    limits: this.txFromJSON<DocLimits>,
        compile_doc: this.txFromJSON<Result<CompiledDoc>>,
        capabilities: this.txFromJSON<CompilerCapabilities>,
        derive_target: this.txFromJSON<Result<DerivedTarget>>
  }
}