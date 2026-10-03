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
 * Zero or one entries — a `Vec` because `CompiledRecoveryConfig` is
 * itself a `#[contracttype]` struct (see [`CompiledRule::install`]'s
 * doc comment for why `Option<CompiledRecoveryConfig>` doesn't compile
 * here). Present ⇒ the document enrolls account recovery — the applier
 * is expected to sync this configuration to the adopted
 * recovery-controller instance named in it. See `docs/recovery/` for
 * the full design; wire-compat notes live there too (this is a new
 * field on an existing constructorless, immutable deployable — a
 * compiler build carrying it is a new instance, not an in-place change
 * to any already-deployed one).
 */
recovery: Array<CompiledRecoveryConfig>;
  rules: Array<CompiledRule>;
}


/**
 * One rule, compiled to the exact shapes OZ's `add_context_rule` takes:
 * resolved addresses, OZ `Signer`s, and (for constrained rules) the
 * interpreter program as `InstallParams`.
 */
export interface CompiledRule {
  /**
 * Zero or one entries (a `Vec` for the same reason as `install` —
 * `CompiledCap` is itself a `#[contracttype]` struct). Present ⇒ also
 * attach OZ `spending_limit` with these params — the cumulative cap the
 * stateless interpreter cannot express. The applier resolves the
 * policy's content-addressed address and keys it into the rule's policy
 * map beside the interpreter; the tracked token is the rule's `Contract`
 * scope (validation pins `token == scope`).
 */
cap: Array<CompiledCap>;
  /**
 * Zero or one entries — a `Vec` rather than `Option<CompiledCap>`-style
 * `Option` because `InstallParams` is itself a `#[contracttype]` struct,
 * and `#[contracttype]`'s derive macro has no `ScVal`/spec conversion
 * for `Option<T>` where `T` is a custom struct or enum (confirmed
 * directly: it fails to compile with "the trait bound `ScVal:
 * TryFrom<&Option<T>>` is not satisfied" — `Option<u32>` on
 * `valid_until` above works because `u32` is a host-builtin type with
 * its own direct `ScVal` conversion, not because `Option` itself is the
 * problem). Empty ⇒ policy-free rule.
 */
install: Array<InstallParams>;
  name: string;
  scope: RuleScope;
  signers: Array<Signer>;
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
  doc_hash: Buffer;
  /**
 * Fingerprints of every credential in the target (spec §7.3 rule 7).
 */
fingerprints: Array<Buffer>;
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
   * The document exceeds a document cap ([`MAX_DOC_SIGNERS`], [`MAX_DOC_RULES`], [`MAX_DOC_CANONICAL_BYTES`]).
   */
  6: {message:"DocTooLarge"},
  /**
   * A signer's verifier could not canonicalize its key, so the credential cannot be fingerprinted for revocation.
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
 * One op of a postfix-encoded constraint program.
 */
export type Op = {tag: "All", values: readonly [u32]} | {tag: "Any", values: readonly [u32]} | {tag: "Not", values: void} | {tag: "MinSigners", values: readonly [u32]} | {tag: "FnIn", values: readonly [Array<string>]} | {tag: "ArgAddrEq", values: readonly [u32, string]} | {tag: "ArgAddrIsSelf", values: readonly [u32]} | {tag: "ArgSymEq", values: readonly [u32, string]} | {tag: "ArgStrIn", values: readonly [u32, Array<string>]} | {tag: "ArgStrPrefix", values: readonly [u32, string]} | {tag: "ArgBytesEq", values: readonly [u32, Buffer]} | {tag: "ArgI128Eq", values: readonly [u32, i128]} | {tag: "ArgU32Eq", values: readonly [u32, u32]} | {tag: "ArgCount", values: readonly [u32]} | {tag: "LedgerBefore", values: readonly [u32]} | {tag: "LedgerAtOrAfter", values: readonly [u32]};


/**
 * A postfix-encoded constraint program. The last op produces the root
 * verdict.
 */
export interface RpnProgram {
  ops: Array<Op>;
  version: u32;
}


/**
 * What the compiler stores in the interpreter for one `(account, rule)`: the
 * program plus the `doc_hash` of the source PolicyDoc. Sharing this
 * `#[contracttype]` between the compiler and the interpreter is what keeps
 * install params from ever being a hand-built `ScVal` — both sides encode and
 * decode through exactly these types. `doc_hash` binds the on-chain program to
 * the reviewed document (provenance for lift/diff).
 */
export interface InstallParams {
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
   * Construct and simulate a compile_doc transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * JSON bytes in → compiled rules + canonical `doc_hash` out. Pure:
   * no auth, no storage. The document must name THIS network (its
   * `network` string must hash to the chain's network id), so a testnet
   * document can never compile on mainnet or vice versa.
   */
  compile_doc: ({doc_json}: {doc_json: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<CompiledDoc>>>

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
      new ContractSpec([ "AAAAAgAAAHRXaGVyZSBhIGNvbXBpbGVkIHJ1bGUgYXBwbGllcy4gYFNlbGZBZG1pbmAgaXMgYWNjb3VudC1hZ25vc3RpYzogdGhlCmFwcGx5aW5nIGFjY291bnQgcmVzb2x2ZXMgaXQgdG8gaXRzIG93biBhZGRyZXNzLgAAAAAAAAAJUnVsZVNjb3BlAAAAAAAAAgAAAAAAAAAAAAAACVNlbGZBZG1pbgAAAAAAAAEAAAAAAAAACENvbnRyYWN0AAAAAQAAABM=",
        "AAAAAQAAALFBIGN1bXVsYXRpdmUgc3BlbmQgY2FwIGxvd2VyZWQgdG8gT1ogYHNwZW5kaW5nX2xpbWl0YCdzIGluc3RhbGwgcGFyYW1zCihgU3BlbmRpbmdMaW1pdEFjY291bnRQYXJhbXNgKS4gVGhlIHRyYWNrZWQgdG9rZW4gaXMgdGhlIHJ1bGUncyBzY29wZQpjb250cmFjdCwgc28gaXQgaXMgbm90IGNhcnJpZWQgaGVyZS4AAAAAAAAAAAAAC0NvbXBpbGVkQ2FwAAAAAAIAAAAhUm9sbGluZy13aW5kb3cgbGVuZ3RoIGluIGxlZGdlcnMuAAAAAAAADnBlcmlvZF9sZWRnZXJzAAAAAAAEAAAAMkN1bXVsYXRpdmUgYW1vdW50IGNlaWxpbmcgb3ZlciB0aGUgcm9sbGluZyB3aW5kb3cuAAAAAAAOc3BlbmRpbmdfbGltaXQAAAAAAAs=",
        "AAAAAQAAAEVBIGNvbXBpbGVkIGRvY3VtZW50OiBpdHMgY2Fub25pY2FsIGlkZW50aXR5IGFuZCB0aGUgcnVsZXMgaXQgYmVjb21lcy4AAAAAAAAAAAAAC0NvbXBpbGVkRG9jAAAAAAUAAACdVGhlIGNhbm9uaWNhbCBieXRlcyBgZG9jX2hhc2hgIGlzIHRoZSBoYXNoIG9mLiBUaGUgYWNjb3VudCBzdG9yZXMKdGhlbSBzbyBhbnlvbmUsIGluY2x1ZGluZyB0aGUgcmVjb3ZlcnkgY29udHJvbGxlciwgY2FuIHJlYWQgYmFjayB0aGUKZnVsbCBhcHBsaWVkIGRvY3VtZW50LgAAAAAAAAljYW5vbmljYWwAAAAAAAAOAAAAs2BzaGEyNTYoY2Fub25pY2FsIGJ5dGVzKWAg4oCUIHRoZSBoYXNoIHRoZSByZXZpZXdlciBhcHByb3ZlZC4gRm9ybWF0dGluZwpvZiB0aGUgc3VibWl0dGVkIEpTT04gaXMgaXJyZWxldmFudDogYSBwcmV0dHktcHJpbnRlZCBmaWxlIGFuZCBpdHMKbWluaWZpZWQgdHdpbiBjb21waWxlIHRvIHRoZSBzYW1lIGhhc2guAAAAAAhkb2NfaGFzaAAAA+4AAAAgAAAA0lRoZSBmaW5nZXJwcmludCAoYHBlcmNoX3JlY292ZXJ5X2ludGVyZmFjZTo6Y3JlZGVudGlhbDo6Q3JlZGVudGlhbDo6CmZpbmdlcnByaW50YCkgb2YgZXZlcnkgZGVjbGFyZWQgc2lnbmVyJ3MgY3JlZGVudGlhbCwgd2l0aCBleHRlcm5hbAprZXlzIGNhbm9uaWNhbGl6ZWQgYnkgdGhlaXIgdmVyaWZpZXIuIFdoYXQgcmV2b2NhdGlvbiBjb21wYXJlcwooc3BlYyDCpzgpLgAAAAAADGZpbmdlcnByaW50cwAAA+oAAAPuAAAAIAAAAnJaZXJvIG9yIG9uZSBlbnRyaWVzIOKAlCBhIGBWZWNgIGJlY2F1c2UgYENvbXBpbGVkUmVjb3ZlcnlDb25maWdgIGlzCml0c2VsZiBhIGAjW2NvbnRyYWN0dHlwZV1gIHN0cnVjdCAoc2VlIFtgQ29tcGlsZWRSdWxlOjppbnN0YWxsYF0ncwpkb2MgY29tbWVudCBmb3Igd2h5IGBPcHRpb248Q29tcGlsZWRSZWNvdmVyeUNvbmZpZz5gIGRvZXNuJ3QgY29tcGlsZQpoZXJlKS4gUHJlc2VudCDih5IgdGhlIGRvY3VtZW50IGVucm9sbHMgYWNjb3VudCByZWNvdmVyeSDigJQgdGhlIGFwcGxpZXIKaXMgZXhwZWN0ZWQgdG8gc3luYyB0aGlzIGNvbmZpZ3VyYXRpb24gdG8gdGhlIGFkb3B0ZWQKcmVjb3ZlcnktY29udHJvbGxlciBpbnN0YW5jZSBuYW1lZCBpbiBpdC4gU2VlIGBkb2NzL3JlY292ZXJ5L2AgZm9yCnRoZSBmdWxsIGRlc2lnbjsgd2lyZS1jb21wYXQgbm90ZXMgbGl2ZSB0aGVyZSB0b28gKHRoaXMgaXMgYSBuZXcKZmllbGQgb24gYW4gZXhpc3RpbmcgY29uc3RydWN0b3JsZXNzLCBpbW11dGFibGUgZGVwbG95YWJsZSDigJQgYQpjb21waWxlciBidWlsZCBjYXJyeWluZyBpdCBpcyBhIG5ldyBpbnN0YW5jZSwgbm90IGFuIGluLXBsYWNlIGNoYW5nZQp0byBhbnkgYWxyZWFkeS1kZXBsb3llZCBvbmUpLgAAAAAACHJlY292ZXJ5AAAD6gAAB9AAAAAWQ29tcGlsZWRSZWNvdmVyeUNvbmZpZwAAAAAAAAAAAAVydWxlcwAAAAAAA+oAAAfQAAAADENvbXBpbGVkUnVsZQ==",
        "AAAAAQAAAK9PbmUgcnVsZSwgY29tcGlsZWQgdG8gdGhlIGV4YWN0IHNoYXBlcyBPWidzIGBhZGRfY29udGV4dF9ydWxlYCB0YWtlczoKcmVzb2x2ZWQgYWRkcmVzc2VzLCBPWiBgU2lnbmVyYHMsIGFuZCAoZm9yIGNvbnN0cmFpbmVkIHJ1bGVzKSB0aGUKaW50ZXJwcmV0ZXIgcHJvZ3JhbSBhcyBgSW5zdGFsbFBhcmFtc2AuAAAAAAAAAAAMQ29tcGlsZWRSdWxlAAAABgAAAcVaZXJvIG9yIG9uZSBlbnRyaWVzIChhIGBWZWNgIGZvciB0aGUgc2FtZSByZWFzb24gYXMgYGluc3RhbGxgIOKAlApgQ29tcGlsZWRDYXBgIGlzIGl0c2VsZiBhIGAjW2NvbnRyYWN0dHlwZV1gIHN0cnVjdCkuIFByZXNlbnQg4oeSIGFsc28KYXR0YWNoIE9aIGBzcGVuZGluZ19saW1pdGAgd2l0aCB0aGVzZSBwYXJhbXMg4oCUIHRoZSBjdW11bGF0aXZlIGNhcCB0aGUKc3RhdGVsZXNzIGludGVycHJldGVyIGNhbm5vdCBleHByZXNzLiBUaGUgYXBwbGllciByZXNvbHZlcyB0aGUKcG9saWN5J3MgY29udGVudC1hZGRyZXNzZWQgYWRkcmVzcyBhbmQga2V5cyBpdCBpbnRvIHRoZSBydWxlJ3MgcG9saWN5Cm1hcCBiZXNpZGUgdGhlIGludGVycHJldGVyOyB0aGUgdHJhY2tlZCB0b2tlbiBpcyB0aGUgcnVsZSdzIGBDb250cmFjdGAKc2NvcGUgKHZhbGlkYXRpb24gcGlucyBgdG9rZW4gPT0gc2NvcGVgKS4AAAAAAAADY2FwAAAAA+oAAAfQAAAAC0NvbXBpbGVkQ2FwAAAAAjpaZXJvIG9yIG9uZSBlbnRyaWVzIOKAlCBhIGBWZWNgIHJhdGhlciB0aGFuIGBPcHRpb248Q29tcGlsZWRDYXA+YC1zdHlsZQpgT3B0aW9uYCBiZWNhdXNlIGBJbnN0YWxsUGFyYW1zYCBpcyBpdHNlbGYgYSBgI1tjb250cmFjdHR5cGVdYCBzdHJ1Y3QsCmFuZCBgI1tjb250cmFjdHR5cGVdYCdzIGRlcml2ZSBtYWNybyBoYXMgbm8gYFNjVmFsYC9zcGVjIGNvbnZlcnNpb24KZm9yIGBPcHRpb248VD5gIHdoZXJlIGBUYCBpcyBhIGN1c3RvbSBzdHJ1Y3Qgb3IgZW51bSAoY29uZmlybWVkCmRpcmVjdGx5OiBpdCBmYWlscyB0byBjb21waWxlIHdpdGggInRoZSB0cmFpdCBib3VuZCBgU2NWYWw6ClRyeUZyb208Jk9wdGlvbjxUPj5gIGlzIG5vdCBzYXRpc2ZpZWQiIOKAlCBgT3B0aW9uPHUzMj5gIG9uCmB2YWxpZF91bnRpbGAgYWJvdmUgd29ya3MgYmVjYXVzZSBgdTMyYCBpcyBhIGhvc3QtYnVpbHRpbiB0eXBlIHdpdGgKaXRzIG93biBkaXJlY3QgYFNjVmFsYCBjb252ZXJzaW9uLCBub3QgYmVjYXVzZSBgT3B0aW9uYCBpdHNlbGYgaXMgdGhlCnByb2JsZW0pLiBFbXB0eSDih5IgcG9saWN5LWZyZWUgcnVsZS4AAAAAAAdpbnN0YWxsAAAAA+oAAAfQAAAADUluc3RhbGxQYXJhbXMAAAAAAAAAAAAABG5hbWUAAAAQAAAAAAAAAAVzY29wZQAAAAAAB9AAAAAJUnVsZVNjb3BlAAAAAAAAAAAAAAdzaWduZXJzAAAAA+oAAAfQAAAABlNpZ25lcgAAAAAAAAAAAAt2YWxpZF91bnRpbAAAAAPoAAAABA==",
        "AAAAAQAAAHBXaGF0IGBkZXJpdmVfdGFyZ2V0YCByZXR1cm5zOiB0aGUgcmVjb3ZlcnkgdGFyZ2V0IHRoZSBjb250cm9sbGVyIGJpbmRzCmludG8gYW4gYXR0ZW1wdCdzIHN0YXRlbWVudCAoc3BlYyDCpzcuMSkuAAAAAAAAAA1EZXJpdmVkVGFyZ2V0AAAAAAAABAAAAFJUaGUgdGFyZ2V0J3MgY2Fub25pY2FsIGJ5dGVzOiBleGFjdGx5IHdoYXQgdGhlIGNvbXBsZXRpbmcgYGFwcGx5X2RvY2AKbXVzdCBzdWJtaXQuAAAAAAAJY2Fub25pY2FsAAAAAAAADgAAAGhUaGUgdGFyZ2V0J3MgcmVjb3ZlcnkgYGNvbmZpZ19oYXNoYCAodGhlIGN1cnJlbnQgb25lLCBvciB0aGUgY3VycmVudApvbmUgd2l0aCB0aGUgZGVjbGFyZWQgWksgcm90YXRpb24pLgAAAAtjb25maWdfaGFzaAAAAAPuAAAAIAAAAAAAAAAIZG9jX2hhc2gAAAPuAAAAIAAAAENGaW5nZXJwcmludHMgb2YgZXZlcnkgY3JlZGVudGlhbCBpbiB0aGUgdGFyZ2V0IChzcGVjIMKnNy4zIHJ1bGUgNykuAAAAAAxmaW5nZXJwcmludHMAAAPqAAAD7gAAACA=",
        "AAAABAAAAGRFdmVyeXRoaW5nIGBjb21waWxlX2RvY2AgY2FuIHJlZnVzZS4gKGAjW3NjZXJyXWAgYXNzaWducyBzZXF1ZW50aWFsIGNvZGVzCmZyb20gMSwgaW4gdmFyaWFudCBvcmRlci4pAAAAAAAAABBEb2NDb21waWxlckVycm9yAAAACwAAACtUaGUgc3VibWl0dGVkIGRvY3VtZW50IGJ5dGVzIGFyZSBub3QgVVRGLTguAAAAAApEb2NOb3RVdGY4AAAAAAABAAAAbFRoZSBkb2N1bWVudCBmYWlsZWQgZmFpbC1jbG9zZWQgcGFyc2luZyAodW5rbm93biBmaWVsZCwgYmFkIHNoYXBlLCB1bnN1cHBvcnRlZCB2ZXJzaW9uLCBkdXBsaWNhdGUga2V5LCDigKYpLgAAAAhEb2NQYXJzZQAAAAIAAABzVGhlIGRvY3VtZW50IGZhaWxlZCBzZW1hbnRpYyB2YWxpZGF0aW9uIChkYW5nbGluZyBzaWduZXIgcmVmLCBtYWxmb3JtZWQgYWRkcmVzcyBvciBrZXksIGFtYmlndW91cyBlbXB0eSBsaXN0LCDigKYpLgAAAAAKRG9jSW52YWxpZAAAAAAAAwAAAENUaGUgZG9jdW1lbnQgbmFtZXMgbm8gbmV0d29yaywgb3IgYSBuZXR3b3JrIHRoYXQgaXMgbm90IHRoaXMgY2hhaW4uAAAAAAxXcm9uZ05ldHdvcmsAAAAEAAAAQVRoZSBkb2N1bWVudCBjYW5ub3QgYmUgbG93ZXJlZCB0byBydWxlcyAodW5zdXBwb3J0ZWQgcnVsZSBzaGFwZSkuAAAAAAAACkRvY0NvbXBpbGUAAAAAAAUAAABqVGhlIGRvY3VtZW50IGV4Y2VlZHMgYSBkb2N1bWVudCBjYXAgKFtgTUFYX0RPQ19TSUdORVJTYF0sIFtgTUFYX0RPQ19SVUxFU2BdLCBbYE1BWF9ET0NfQ0FOT05JQ0FMX0JZVEVTYF0pLgAAAAAAC0RvY1Rvb0xhcmdlAAAAAAYAAABtQSBzaWduZXIncyB2ZXJpZmllciBjb3VsZCBub3QgY2Fub25pY2FsaXplIGl0cyBrZXksIHNvIHRoZSBjcmVkZW50aWFsIGNhbm5vdCBiZSBmaW5nZXJwcmludGVkIGZvciByZXZvY2F0aW9uLgAAAAAAABVLZXlOb3RDYW5vbmljYWxpemFibGUAAAAAAAAHAAAAOmBkZXJpdmVfdGFyZ2V0YDogdGhlIGN1cnJlbnQgZG9jdW1lbnQgZW5yb2xscyBubyByZWNvdmVyeS4AAAAAAAtOb3RFbnJvbGxlZAAAAAAIAAAA/WBkZXJpdmVfdGFyZ2V0YDogdGhlIHJlcGxhY2VtZW50IHNldCBicmVha3Mgc3BlYyDCpzcuMyBydWxlcyAxLTMgKG5vdCBjYW5vbmljYWwsIGVtcHR5IGZvciBsb3N0LWtleSwgYSBzaWduZXIgaWQgdGhhdCBpcyBub3QgcmVwbGFjZWFibGUgb3Igbm90IGRlY2xhcmVkIGluIHRoZSBzb3VyY2UsIG9yIGEgY2hhbmdlIG9mIGNyZWRlbnRpYWwga2luZCBvciB2ZXJpZmllciksIG9yIHRoZSBhY3Rpb24gaXMgbm90IGEgcmVjb3ZlcnkgYXR0ZW1wdC4AAAAAAAASUmVwbGFjZW1lbnRSZWZ1c2VkAAAAAAAJAAAAeWBkZXJpdmVfdGFyZ2V0YDogdGhlIFpLIGVucm9sbG1lbnQgaXMgbWlzc2luZyBmb3IgYSBaSyBtb2RlLCBwcmVzZW50IGZvciBhIGd1YXJkaWFuLW9ubHkgbW9kZSwgb3IgcmV1c2VzIHRoZSBlbnJvbGxlZCBpZC4AAAAAAAAUWmtFbnJvbGxtZW50TWlzbWF0Y2gAAAAKAAAAZGBkZXJpdmVfdGFyZ2V0YDogdGhlIHRhcmdldCBoYXMgbm8gcG9saWN5LWZyZWUgc2VsZi1hZG1pbiBydWxlIHdpdGggYSBzaWduZXIgKHRoZSBhbnRpLWJyaWNrIGNoZWNrKS4AAAAMQWRtaW5Mb2Nrb3V0AAAACw==",
        "AAAAAAAAAPlKU09OIGJ5dGVzIGluIOKGkiBjb21waWxlZCBydWxlcyArIGNhbm9uaWNhbCBgZG9jX2hhc2hgIG91dC4gUHVyZToKbm8gYXV0aCwgbm8gc3RvcmFnZS4gVGhlIGRvY3VtZW50IG11c3QgbmFtZSBUSElTIG5ldHdvcmsgKGl0cwpgbmV0d29ya2Agc3RyaW5nIG11c3QgaGFzaCB0byB0aGUgY2hhaW4ncyBuZXR3b3JrIGlkKSwgc28gYSB0ZXN0bmV0CmRvY3VtZW50IGNhbiBuZXZlciBjb21waWxlIG9uIG1haW5uZXQgb3IgdmljZSB2ZXJzYS4AAAAAAAALY29tcGlsZV9kb2MAAAAAAQAAAAAAAAAIZG9jX2pzb24AAAAOAAAAAQAAA+kAAAfQAAAAC0NvbXBpbGVkRG9jAAAAB9AAAAAQRG9jQ29tcGlsZXJFcnJvcg==",
        "AAAAAAAAAiNEZXJpdmUgYSByZWNvdmVyeSB0YXJnZXQgKGBkb2NzL3JlY292ZXJ5L3NwZWMubWRgIMKnNyk6IGBzb3VyY2VfanNvbmAKaXMgdGhlIGFjY291bnQncyBhcHBsaWVkIGRvY3VtZW50IChsb3N0LWtleSkgb3IgdGhlIHB1Ymxpc2hlZApiYXNlbGluZSAoY29tcHJvbWlzZSk7IGBjdXJyZW50X2pzb25gIGlzIHRoZSBhcHBsaWVkIGRvY3VtZW50LCB3aG9zZQpyZWNvdmVyeSBtZW1iZXIgdGhlIHRhcmdldCBrZWVwcy4gVGhlIHRhcmdldCBpcyB0aGUgc291cmNlIHdpdGgKZXhhY3RseSB0aGUgZGVjbGFyZWQgcmVwbGFjZW1lbnRzIGFuZCBaSyByb3RhdGlvbiwgdGhlbiB2YWxpZGF0ZWQsCm5ldHdvcmstYm91bmQsIGNhcHBlZCwgY29tcGlsZWQsIGFuZCBhbnRpLWJyaWNrLWNoZWNrZWQgbGlrZSBhbnkKYXBwbGllZCBkb2N1bWVudC4gUHVyZTogbm8gYXV0aCwgbm8gc3RvcmFnZS4gVGhlIGNvbnRyb2xsZXIgY2FsbHMgaXQKd2hlbiBhbiBhdHRlbXB0IGJlZ2lucywgYW5kIGNvbXBsZXRlcnMgc2ltdWxhdGUgaXQgdG8gb2J0YWluIHRoZQpjYW5vbmljYWwgYnl0ZXMuAAAAAA1kZXJpdmVfdGFyZ2V0AAAAAAAABAAAAAAAAAALc291cmNlX2pzb24AAAAADgAAAAAAAAAMY3VycmVudF9qc29uAAAADgAAAAAAAAAGYWN0aW9uAAAAAAfQAAAADlJlY292ZXJ5QWN0aW9uAAAAAAAAAAAADHJlcGxhY2VtZW50cwAAB9AAAAAOUmVwbGFjZW1lbnRTZXQAAAAAAAEAAAPpAAAH0AAAAA1EZXJpdmVkVGFyZ2V0AAAAAAAH0AAAABBEb2NDb21waWxlckVycm9y",
        "AAAAAgAAAC9PbmUgb3Agb2YgYSBwb3N0Zml4LWVuY29kZWQgY29uc3RyYWludCBwcm9ncmFtLgAAAAAAAAAAAk9wAAAAAAAQAAAAAQAAADBQb3AgYG5gIHZlcmRpY3RzLCBwdXNoIHRoZWlyIEtsZWVuZSBjb25qdW5jdGlvbi4AAAADQWxsAAAAAAEAAAAEAAAAAQAAADBQb3AgYG5gIHZlcmRpY3RzLCBwdXNoIHRoZWlyIEtsZWVuZSBkaXNqdW5jdGlvbi4AAAADQW55AAAAAAEAAAAEAAAAAAAAACpQb3Agb25lIHZlcmRpY3QsIHB1c2ggaXRzIEtsZWVuZSBuZWdhdGlvbi4AAAAAAANOb3QAAAAAAQAAAClBdCBsZWFzdCB0aGlzIG1hbnkgYXV0aGVudGljYXRlZCBzaWduZXJzLgAAAAAAAApNaW5TaWduZXJzAAAAAAABAAAABAAAAAEAAAApSW52b2tlZCBmdW5jdGlvbiBpcyBvbmUgb2YgdGhlc2Ugc3ltYm9scy4AAAAAAAAERm5JbgAAAAEAAAPqAAAAEQAAAAEAAAAmQXJndW1lbnQgYXQgaW5kZXggZXF1YWxzIHRoaXMgYWRkcmVzcy4AAAAAAAlBcmdBZGRyRXEAAAAAAAACAAAABAAAABMAAAABAAAAMkFyZ3VtZW50IGF0IGluZGV4IGlzIHRoZSBwcm90ZWN0ZWQgYWNjb3VudCBpdHNlbGYuAAAAAAANQXJnQWRkcklzU2VsZgAAAAAAAAEAAAAEAAAAAQAAACVBcmd1bWVudCBhdCBpbmRleCBlcXVhbHMgdGhpcyBzeW1ib2wuAAAAAAAACEFyZ1N5bUVxAAAAAgAAAAQAAAARAAAAAQAAADVBcmd1bWVudCBhdCBpbmRleCAoYSBzdHJpbmcpIGlzIG9uZSBvZiB0aGVzZSBzdHJpbmdzLgAAAAAAAAhBcmdTdHJJbgAAAAIAAAAEAAAD6gAAABAAAAABAAAANUFyZ3VtZW50IGF0IGluZGV4IChhIHN0cmluZykgc3RhcnRzIHdpdGggdGhpcyBwcmVmaXguAAAAAAAADEFyZ1N0clByZWZpeAAAAAIAAAAEAAAAEAAAAAEAAAAlQXJndW1lbnQgYXQgaW5kZXggZXF1YWxzIHRoZXNlIGJ5dGVzLgAAAAAAAApBcmdCeXRlc0VxAAAAAAACAAAABAAAAA4AAAABAAAAI0FyZ3VtZW50IGF0IGluZGV4IGVxdWFscyB0aGlzIGkxMjguAAAAAAlBcmdJMTI4RXEAAAAAAAACAAAABAAAAAsAAAABAAAAIkFyZ3VtZW50IGF0IGluZGV4IGVxdWFscyB0aGlzIHUzMi4AAAAAAAhBcmdVMzJFcQAAAAIAAAAEAAAABAAAAAEAAAApVGhlIGNhbGwgaGFzIGV4YWN0bHkgdGhpcyBtYW55IGFyZ3VtZW50cy4AAAAAAAAIQXJnQ291bnQAAAABAAAABAAAAAEAAAAvQ3VycmVudCBsZWRnZXIgc2VxdWVuY2UgaXMgc3RyaWN0bHkgYmVsb3cgdGhpcy4AAAAADExlZGdlckJlZm9yZQAAAAEAAAAEAAAAAQAAAClDdXJyZW50IGxlZGdlciBzZXF1ZW5jZSBpcyBhdCBsZWFzdCB0aGlzLgAAAAAAAA9MZWRnZXJBdE9yQWZ0ZXIAAAAAAQAAAAQ=",
        "AAAAAQAAAExBIHBvc3RmaXgtZW5jb2RlZCBjb25zdHJhaW50IHByb2dyYW0uIFRoZSBsYXN0IG9wIHByb2R1Y2VzIHRoZSByb290CnZlcmRpY3QuAAAAAAAAAApScG5Qcm9ncmFtAAAAAAACAAAAAAAAAANvcHMAAAAD6gAAB9AAAAACT3AAAAAAAAAAAAAHdmVyc2lvbgAAAAAE",
        "AAAAAQAAAaJXaGF0IHRoZSBjb21waWxlciBzdG9yZXMgaW4gdGhlIGludGVycHJldGVyIGZvciBvbmUgYChhY2NvdW50LCBydWxlKWA6IHRoZQpwcm9ncmFtIHBsdXMgdGhlIGBkb2NfaGFzaGAgb2YgdGhlIHNvdXJjZSBQb2xpY3lEb2MuIFNoYXJpbmcgdGhpcwpgI1tjb250cmFjdHR5cGVdYCBiZXR3ZWVuIHRoZSBjb21waWxlciBhbmQgdGhlIGludGVycHJldGVyIGlzIHdoYXQga2VlcHMKaW5zdGFsbCBwYXJhbXMgZnJvbSBldmVyIGJlaW5nIGEgaGFuZC1idWlsdCBgU2NWYWxgIOKAlCBib3RoIHNpZGVzIGVuY29kZSBhbmQKZGVjb2RlIHRocm91Z2ggZXhhY3RseSB0aGVzZSB0eXBlcy4gYGRvY19oYXNoYCBiaW5kcyB0aGUgb24tY2hhaW4gcHJvZ3JhbSB0bwp0aGUgcmV2aWV3ZWQgZG9jdW1lbnQgKHByb3ZlbmFuY2UgZm9yIGxpZnQvZGlmZikuAAAAAAAAAAAADUluc3RhbGxQYXJhbXMAAAAAAAACAAAAAAAAAAhkb2NfaGFzaAAAA+4AAAAgAAAAAAAAAAdwcm9ncmFtAAAAB9AAAAAKUnBuUHJvZ3JhbQAA",
        "AAAAAgAAAE5BIHNpZ25lciBjcmVkZW50aWFsLCBzaGFwZWQgbGlrZSBPWiBgc3RlbGxhcl9hY2NvdW50czo6c21hcnRfYWNjb3VudDo6U2lnbmVyYC4AAAAAAAAAAAAKQ3JlZGVudGlhbAAAAAAAAgAAAAEAAABsYFNpZ25lcjo6RGVsZWdhdGVkKGFkZHJlc3MpYDogYSBgRy4uLmAgb3IgYEMuLi5gIGFkZHJlc3MgdGhhdAphdXRoZW50aWNhdGVzIHRocm91Z2ggQ0FQLTAwNzEgZGVsZWdhdGVkIGF1dGguAAAACURlbGVnYXRlZAAAAAAAAAEAAAATAAAAAQAAAEhgU2lnbmVyOjpFeHRlcm5hbCh2ZXJpZmllciwga2V5KWA6IGEga2V5IGNoZWNrZWQgYnkgYSB2ZXJpZmllcgpjb250cmFjdC4AAAAIRXh0ZXJuYWwAAAACAAAAEwAAAA4=",
        "AAAAAQAAAGxPbmUgZGVzaWduYXRlZCBzaWduZXIgc2xvdCBhbmQgdGhlIGNyZWRlbnRpYWwgdGhhdCByZXBsYWNlcyB3aGF0ZXZlcgp0aGF0IHNsb3QgaG9sZHMgaW4gdGhlIHNvdXJjZSBkb2N1bWVudC4AAAAAAAAAC1JlcGxhY2VtZW50AAAAAAIAAAA4VGhlIGNyZWRlbnRpYWwgdGhlIHRhcmdldCBkb2N1bWVudCBnaXZlcyB0aGF0IHNpZ25lciBpZC4AAAAKY3JlZGVudGlhbAAAAAAH0AAAAApDcmVkZW50aWFsAAAAAABDQSBkb2N1bWVudCBzaWduZXIgaWQgbGlzdGVkIGluIHRoZSBlbnJvbGxlZCBgcmVjb3ZlcnkucmVwbGFjZWFibGVgLgAAAAAJc2lnbmVyX2lkAAAAAAAAEA==",
        "AAAAAQAAAVVBIFpLIGVucm9sbG1lbnQgYSByZWNvdmVyeSBjb21wbGV0aW9uIGluc3RhbGxzLgoKVGhlIGNvbW1pdG1lbnQgaXMgYm91bmQgaGVyZSwgbm90IG9ubHkgdGhlIGlkOiBjb21wbGV0aW9uIHJ1bnMgdW5kZXIgdGhlCnplcm8tc2lnbmVyIHJlY292ZXJ5IHJ1bGUsIHNvIG5vdGhpbmcgc2lnbnMgaXRzIGFyZ3VtZW50cywgYW5kIGEKY29tbWl0bWVudCBzdXBwbGllZCBvbmx5IGF0IGNvbXBsZXRpb24gY291bGQgYmUgc3dhcHBlZCBieSB3aG9ldmVyCnN1Ym1pdHMgdGhlIGNvbXBsZXRpbmcgdHJhbnNhY3Rpb24gZmlyc3Qg4oCUIGhhbmRpbmcgdGhlbSB0aGUgYWNjb3VudCdzCm5leHQgWksgZmFjdG9yLgAAAAAAAAAAAAAMWmtFbnJvbGxtZW50AAAAAgAAARlUaGUgbmV3IGxlYWYncyBpbm5lciBjb21taXRtZW50LCBgUG9zZWlkb24yKERPTV9MRUFGLCBzZWNyZXQpYC4KRGVyaXZhdGlvbiB3cml0ZXMgYGlkYCBhbmQgYGNvbW1pdG1lbnRgIGludG8gdGhlIHRhcmdldCBkb2N1bWVudCdzCnJlY292ZXJ5IHNlY3Rpb24sIHNvIHRoZSB0YXJnZXQgaGFzaCBiaW5kcyB0aGVtLCBhbmQgdGhlIGNvbXBsZXRpbmcKYGFwcGx5X2RvY2AgaW5zZXJ0cyB0aGUgbGVhZiBmcm9tIHRoZSBjb21waWxlZCB0YXJnZXQsIG5ldmVyIGZyb20gYQpjYWxsIGFyZ3VtZW50LgAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAE1UaGUgbmV3IGVucm9sbG1lbnQgaWQuIE11c3QgbmV2ZXIgaGF2ZSBiZWVuIGVucm9sbGVkIGZvciB0aGlzCmFjY291bnQgYmVmb3JlLgAAAAAAAAJpZAAAAAAD7gAAACA=",
        "AAAAAQAAAG9FdmVyeXRoaW5nIGEgYExvc3RLZXlgL2BDb21wcm9taXNlYCBhdHRlbXB0IGNoYW5nZXMgYWJvdXQgdGhlIHNvdXJjZQpkb2N1bWVudC4gU2VlIGBkb2NzL3JlY292ZXJ5L3NwZWMubWRgIMKnNy4AAAAAAAAAAA5SZXBsYWNlbWVudFNldAAAAAAAAgAAAHVTaWduZXIgcmVwbGFjZW1lbnRzIGluIHN0cmljdGx5IGFzY2VuZGluZyBgc2lnbmVyX2lkYCBieXRlIG9yZGVyCihzb3J0ZWQsIG5vIGR1cGxpY2F0ZXMpIOKAlCB0aGUgb25lIGNhbm9uaWNhbCBvcmRlci4AAAAAAAAHc2lnbmVycwAAAAPqAAAH0AAAAAtSZXBsYWNlbWVudAAAAAElVGhlIGZyZXNoIFpLIGVucm9sbG1lbnQgdGhlIGNvbXBsZXRpb24gaW5zdGFsbHMsIHJlcXVpcmVkIGV4YWN0bHkKd2hlbiB0aGUgZW5yb2xsZWQgbW9kZSBoYXMgYSBaSyBmYWN0b3IgKGEgWkstZXZpZGVuY2VkIGNvbXBsZXRpb24KY29uc3VtZXMgdGhlIGVucm9sbGVkIGNyZWRlbnRpYWwsIHNvIGl0IG11c3QgaW5zdGFsbCBhIGZyZXNoIG9uZSkuCkVtcHR5IG9yIG9uZSBlbnRyeSDigJQgYSBgVmVjYCBiZWNhdXNlIGAjW2NvbnRyYWN0dHlwZV1gIGNhbm5vdCBkZXJpdmUKYE9wdGlvbjxDdXN0b21TdHJ1Y3Q+YC4AAAAAAAANemtfZW5yb2xsbWVudAAAAAAAA+oAAAfQAAAADFprRW5yb2xsbWVudA==",
        "AAAAAgAAAHdXaG8gbWF5IGNoYW5nZSB0aGUgcmVjb3ZlcnkgY29uZmlndXJhdGlvbiwgYW5kIHdoZXRoZXIgYW4gYXV0aG9yaXplZAphdHRlbXB0IGZyZWV6ZXMgb3JkaW5hcnkgYWN0aXZpdHkgKHNwZWMgwqcyLCDCpzkpLgAAAAAAAAAAD1JlY292ZXJ5UHJvZmlsZQAAAAACAAAAAAAAAHdPd25lciBhdXRob3JpemF0aW9uIGFsb25lIHJlY29uZmlndXJlczsgYWN0aXZpdHkgY29udGludWVzIHdoaWxlIGFuCmF0dGVtcHQgaXMgYXV0aG9yaXplZDsgdGhlIG93bmVyIGNhbiBhbHdheXMgY2FuY2VsLgAAAAAETG9zcwAAAAAAAABpUmVjb25maWd1cmF0aW9uIGFuZCB1cGdyYWRlcyBhbHNvIG5lZWQgdGhlIGVucm9sbGVkIGNvbmRpdGlvbjsgYW4KYXV0aG9yaXplZCBhdHRlbXB0IGZyZWV6ZXMgdGhlIGFjY291bnQuAAAAAAAACVByb3RlY3RlZAAAAA==",
        "AAAAAQAAACJUaGUgWksgZmFjdG9yIChzcGVjIMKnMy4xLCDCpzMuNCkuAAAAAAAAAAAAEENvbXBpbGVkWmtGYWN0b3IAAAAFAAAANFRoZSBjb25zdHJ1Y3Rvcmxlc3MgWksgYWRhcHRlciB0aGUgY29udHJvbGxlciBjYWxscy4AAAAHYWRhcHRlcgAAAAATAAAAVGBzaGEyNTZgIG9mIHRoZSBhZGFwdGVyJ3MgdmVyaWZpY2F0aW9uIGtleTsgbXVzdCBlcXVhbCB0aGUgYWRhcHRlcidzCmBjaXJjdWl0X2lkKClgLgAAAApjaXJjdWl0X2lkAAAAAAPuAAAAIAAAAHJUaGUgY3VycmVudCBjcmVkZW50aWFsJ3MgaW5uZXIgY29tbWl0bWVudCwgYFBvc2VpZG9uMihET01fTEVBRiwKc2VjcmV0KWAsIGZyb20gd2hpY2ggdGhlIGFjY291bnQgaW5zZXJ0cyB0aGUgbGVhZi4AAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAD9UaGUgY3VycmVudCBjcmVkZW50aWFsJ3MgaWQsIGJvdW5kIGludG8gaXRzIGxlYWYgYW5kIG51bGxpZmllci4AAAAADWVucm9sbG1lbnRfaWQAAAAAAAPuAAAAIAAAACxUaGUgbWVtYmVyc2hpcCBwb29sIHJvb3RzIGFyZSBhY2NlcHRlZCBmcm9tLgAAAARwb29sAAAAEw==",
        "AAAAAQAAABRUaGUgZ3VhcmRpYW4gZmFjdG9yLgAAAAAAAAATQ29tcGlsZWRHdWFyZGlhblNldAAAAAACAAAAQEd1YXJkaWFuIGFkZHJlc3NlcyAoYEcuLi5gIG9yIGBDLi4uYCksIG5ldmVyIHRoZSBhY2NvdW50IGl0c2VsZi4AAAAJZ3VhcmRpYW5zAAAAAAAD6gAAABMAAAAhYDEgPD0gcXVvcnVtIDw9IGd1YXJkaWFucy5sZW4oKWAuAAAAAAAABnF1b3J1bQAAAAAABA==",
        "AAAAAgAAACBXaGljaCBmYWN0b3JzIGEgc3RhdGVtZW50IG5lZWRzLgAAAAAAAAAUQ29tcGlsZWRSZWNvdmVyeU1vZGUAAAADAAAAAQAAAAAAAAAMR3VhcmRpYW5Pbmx5AAAAAQAAB9AAAAATQ29tcGlsZWRHdWFyZGlhblNldAAAAAABAAAAAAAAAAZaa09ubHkAAAAAAAEAAAfQAAAAEENvbXBpbGVkWmtGYWN0b3IAAAABAAAAAAAAAAhDb21iaW5lZAAAAAIAAAfQAAAAE0NvbXBpbGVkR3VhcmRpYW5TZXQAAAAH0AAAABBDb21waWxlZFprRmFjdG9y",
        "AAAAAQAAAB1BIGNvbXBpbGVkIGByZWNvdmVyeWAgbWVtYmVyLgAAAAAAAAAAAAAWQ29tcGlsZWRSZWNvdmVyeUNvbmZpZwAAAAAACQAAAFRUaGUgZW5yb2xsZWQgYmFzZWxpbmUncyBjYW5vbmljYWwgZG9jdW1lbnQgaGFzaCwgaWYgY29tcHJvbWlzZQpyZWNvdmVyeSBpcyBlbnJvbGxlZC4AAAAIYmFzZWxpbmUAAAPoAAAD7gAAACAAAADiYHNoYTI1NigicGVyY2gvcmVjb3ZlcnkvY29uZmlnIiB8fCBjYW5vbmljYWwgSlNPTiBvZiB0aGUgcmVjb3ZlcnkKbWVtYmVyKWAsIGNvbXB1dGVkIGJ5IHRoZSBkb2MgY29tcGlsZXIgKHNwZWMgwqczLjIpLiBDb25maWd1cmF0aW9uCmlkZW50aXR5OiB0d28gY29tcGlsZWQgY29uZmlndXJhdGlvbnMgd2l0aCB0aGUgc2FtZSBgY29uZmlnX2hhc2hgIGFyZQp0aGUgc2FtZSBjb25maWd1cmF0aW9uLgAAAAAAC2NvbmZpZ19oYXNoAAAAA+4AAAAgAAAAIFRoZSBhZG9wdGVkIGNvbnRyb2xsZXIgaW5zdGFuY2UuAAAACmNvbnRyb2xsZXIAAAAAABMAAAAAAAAADWRlbGF5X2xlZGdlcnMAAAAAAAAEAAAAAAAAAA5leHBpcnlfbGVkZ2VycwAAAAAABAAAAAAAAAALbWF4X2NhbmNlbHMAAAAABAAAAAAAAAAEbW9kZQAAB9AAAAAUQ29tcGlsZWRSZWNvdmVyeU1vZGUAAAAAAAAAB3Byb2ZpbGUAAAAH0AAAAA9SZWNvdmVyeVByb2ZpbGUAAAAAe1NpZ25lciBpZHMgKG5vdCBjcmVkZW50aWFsIGZpbmdlcnByaW50cykgYSByZWNvdmVyeSBtYXkgcmVwbGFjZSwgc28Kcm90YXRpbmcgYSBrZXkgZG9lcyBub3QgY2hhbmdlIHRoZSBjb25maWd1cmF0aW9uICgjOTIpLgAAAAALcmVwbGFjZWFibGUAAAAD6gAAABA=",
        "AAAAAwAAAUpUaGUgYWN0aW9uIGRvbWFpbiBhIHN0YXRlbWVudCBhdXRob3JpemVzLiBFdmlkZW5jZSBmb3Igb25lIGFjdGlvbiBuZXZlcgpzYXRpc2ZpZXMgYW5vdGhlcjogdGhlIGFjdGlvbiBjb2RlIGlzIHRoZSBlbmNvZGluZydzIDI2dGggYnl0ZSBhbmQgc2VsZWN0cwp0aGUgc3ViamVjdCBsYXlvdXQsIHNvIHR3byBzdGF0ZW1lbnRzIHRoYXQgZGlmZmVyIG9ubHkgaW4gYWN0aW9uIGhhdmUKZGlmZmVyZW50IGRpZ2VzdHMgKGFuZCBkaWZmZXJlbnQgZW5jb2RlZCBsZW5ndGhzIGZvciBtb3N0IHBhaXJzKS4KClRoZSBudW1lcmljIGNvZGVzIGFyZSBwYXJ0IG9mIHRoZSB3aXJlIGZvcm1hdC4AAAAAAAAAAAAOUmVjb3ZlcnlBY3Rpb24AAAAAAAUAAABgTG9zdC1rZXkgcmVjb3Zlcnk6IHJlcGxhY2UgZGVzaWduYXRlZCBjcmVkZW50aWFscyBpbiBhbiBhZ3JlZWQKc25hcHNob3Qgb2YgdGhlIGN1cnJlbnQgZG9jdW1lbnQuAAAAB0xvc3RLZXkAAAAAAQAAAFlDb21wcm9taXNlIHJlY292ZXJ5OiByZXN0b3JlIHRoZSBlbnJvbGxlZCBiYXNlbGluZSwgd2l0aCBkZXNpZ25hdGVkCmNyZWRlbnRpYWxzIHJlcGxhY2VkLgAAAAAAAApDb21wcm9taXNlAAAAAAACAAAAHkNhbmNlbCBvbmUgaWRlbnRpZmllZCBhdHRlbXB0LgAAAAAABkNhbmNlbAAAAAAAAwAAAINDaGFuZ2Ugb3IgcmVtb3ZlIHRoZSBlbnJvbGxlZCByZWNvdmVyeSBjb25maWd1cmF0aW9uICh0aGUgZXZpZGVuY2UgYQpgUHJvdGVjdGVkYCBhY2NvdW50IG5lZWRzIGluIGFkZGl0aW9uIHRvIG93bmVyIGF1dGhvcml6YXRpb24pLgAAAAALUmVjb25maWd1cmUAAAAABAAAAHRBcHByb3ZlIG9uZSBzY2hlZHVsZWQgYWNjb3VudCB1cGdyYWRlICh0aGUgZXZpZGVuY2UgYSBgUHJvdGVjdGVkYAphY2NvdW50IG5lZWRzIGluIGFkZGl0aW9uIHRvIG93bmVyIGF1dGhvcml6YXRpb24pLgAAAAdVcGdyYWRlAAAAAAU=",
        "AAAAAgAAAEJSZXByZXNlbnRzIGRpZmZlcmVudCB0eXBlcyBvZiBzaWduZXJzIGluIHRoZSBzbWFydCBhY2NvdW50IHN5c3RlbS4AAAAAAAAAAAAGU2lnbmVyAAAAAAACAAAAAQAAAD1BIGRlbGVnYXRlZCBzaWduZXIgdGhhdCB1c2VzIGJ1aWx0LWluIHNpZ25hdHVyZSB2ZXJpZmljYXRpb24uAAAAAAAACURlbGVnYXRlZAAAAAAAAAEAAAATAAAAAQAAAHJBbiBleHRlcm5hbCBzaWduZXIgd2l0aCBjdXN0b20gdmVyaWZpY2F0aW9uIGxvZ2ljLgpDb250YWlucyB0aGUgdmVyaWZpZXIgY29udHJhY3QgYWRkcmVzcyBhbmQgdGhlIHB1YmxpYyBrZXkgZGF0YS4AAAAAAAhFeHRlcm5hbAAAAAIAAAATAAAADg==" ]),
      options
    )
  }
  public readonly fromJSON = {
    compile_doc: this.txFromJSON<Result<CompiledDoc>>,
        derive_target: this.txFromJSON<Result<DerivedTarget>>
  }
}