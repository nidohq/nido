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
  /**
   * The program evaluated to something other than `True`, or no signer
   * authenticated. The transaction is not authorized.
   */
  1: {message:"Denied"},
  /**
   * No program is installed for this `(account, rule)`.
   */
  2: {message:"NotInstalled"},
  /**
   * A program is already installed for this `(account, rule)`.
   */
  3: {message:"AlreadyInstalled"},
  /**
   * The install params carry a program that fails structural validation.
   */
  4: {message:"InvalidProgram"}
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
   * Construct and simulate a enforce transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  enforce: ({context, authenticated_signers, context_rule, smart_account}: {context: Context, authenticated_signers: Array<Signer>, context_rule: ContextRule, smart_account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a install transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  install: ({install_params, context_rule, smart_account}: {install_params: InstallParams, context_rule: ContextRule, smart_account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a uninstall transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  uninstall: ({context_rule, smart_account}: {context_rule: ContextRule, smart_account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_program transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The install params stored for one `(account, rule)`, or `None`.
   * Exposes `doc_hash` so lift/diff can check provenance against the
   * reviewed document rather than guess from the lowered rule.
   */
  get_program: ({smart_account, context_rule_id}: {smart_account: string, context_rule_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<InstallParams>>>

  /**
   * Construct and simulate a program_version transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Program wire-format version this interpreter evaluates. Unknown versions
   * are rejected at install time — fail closed. Used by lift/diff + wallets.
   */
  program_version: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

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
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABAAAAHRUaGUgcHJvZ3JhbSBldmFsdWF0ZWQgdG8gc29tZXRoaW5nIG90aGVyIHRoYW4gYFRydWVgLCBvciBubyBzaWduZXIKYXV0aGVudGljYXRlZC4gVGhlIHRyYW5zYWN0aW9uIGlzIG5vdCBhdXRob3JpemVkLgAAAAZEZW5pZWQAAAAAAAEAAAAzTm8gcHJvZ3JhbSBpcyBpbnN0YWxsZWQgZm9yIHRoaXMgYChhY2NvdW50LCBydWxlKWAuAAAAAAxOb3RJbnN0YWxsZWQAAAACAAAAOkEgcHJvZ3JhbSBpcyBhbHJlYWR5IGluc3RhbGxlZCBmb3IgdGhpcyBgKGFjY291bnQsIHJ1bGUpYC4AAAAAABBBbHJlYWR5SW5zdGFsbGVkAAAAAwAAAERUaGUgaW5zdGFsbCBwYXJhbXMgY2FycnkgYSBwcm9ncmFtIHRoYXQgZmFpbHMgc3RydWN0dXJhbCB2YWxpZGF0aW9uLgAAAA5JbnZhbGlkUHJvZ3JhbQAAAAAABA==",
        "AAAAAAAAAAAAAAAHZW5mb3JjZQAAAAAEAAAAAAAAAAdjb250ZXh0AAAAB9AAAAAHQ29udGV4dAAAAAAAAAAAFWF1dGhlbnRpY2F0ZWRfc2lnbmVycwAAAAAAA+oAAAfQAAAABlNpZ25lcgAAAAAAAAAAAAxjb250ZXh0X3J1bGUAAAfQAAAAC0NvbnRleHRSdWxlAAAAAAAAAAANc21hcnRfYWNjb3VudAAAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAHaW5zdGFsbAAAAAADAAAAAAAAAA5pbnN0YWxsX3BhcmFtcwAAAAAH0AAAAA1JbnN0YWxsUGFyYW1zAAAAAAAAAAAAAAxjb250ZXh0X3J1bGUAAAfQAAAAC0NvbnRleHRSdWxlAAAAAAAAAAANc21hcnRfYWNjb3VudAAAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAJdW5pbnN0YWxsAAAAAAAAAgAAAAAAAAAMY29udGV4dF9ydWxlAAAH0AAAAAtDb250ZXh0UnVsZQAAAAAAAAAADXNtYXJ0X2FjY291bnQAAAAAAAATAAAAAA==",
        "AAAAAAAAALtUaGUgaW5zdGFsbCBwYXJhbXMgc3RvcmVkIGZvciBvbmUgYChhY2NvdW50LCBydWxlKWAsIG9yIGBOb25lYC4KRXhwb3NlcyBgZG9jX2hhc2hgIHNvIGxpZnQvZGlmZiBjYW4gY2hlY2sgcHJvdmVuYW5jZSBhZ2FpbnN0IHRoZQpyZXZpZXdlZCBkb2N1bWVudCByYXRoZXIgdGhhbiBndWVzcyBmcm9tIHRoZSBsb3dlcmVkIHJ1bGUuAAAAAAtnZXRfcHJvZ3JhbQAAAAACAAAAAAAAAA1zbWFydF9hY2NvdW50AAAAAAAAEwAAAAAAAAAPY29udGV4dF9ydWxlX2lkAAAAAAQAAAABAAAD6AAAB9AAAAANSW5zdGFsbFBhcmFtcwAAAA==",
        "AAAAAAAAAJNQcm9ncmFtIHdpcmUtZm9ybWF0IHZlcnNpb24gdGhpcyBpbnRlcnByZXRlciBldmFsdWF0ZXMuIFVua25vd24gdmVyc2lvbnMKYXJlIHJlamVjdGVkIGF0IGluc3RhbGwgdGltZSDigJQgZmFpbCBjbG9zZWQuIFVzZWQgYnkgbGlmdC9kaWZmICsgd2FsbGV0cy4AAAAAD3Byb2dyYW1fdmVyc2lvbgAAAAAAAAAAAQAAAAQ=",
        "AAAAAgAAAC9PbmUgb3Agb2YgYSBwb3N0Zml4LWVuY29kZWQgY29uc3RyYWludCBwcm9ncmFtLgAAAAAAAAAAAk9wAAAAAAAQAAAAAQAAADBQb3AgYG5gIHZlcmRpY3RzLCBwdXNoIHRoZWlyIEtsZWVuZSBjb25qdW5jdGlvbi4AAAADQWxsAAAAAAEAAAAEAAAAAQAAADBQb3AgYG5gIHZlcmRpY3RzLCBwdXNoIHRoZWlyIEtsZWVuZSBkaXNqdW5jdGlvbi4AAAADQW55AAAAAAEAAAAEAAAAAAAAACpQb3Agb25lIHZlcmRpY3QsIHB1c2ggaXRzIEtsZWVuZSBuZWdhdGlvbi4AAAAAAANOb3QAAAAAAQAAAClBdCBsZWFzdCB0aGlzIG1hbnkgYXV0aGVudGljYXRlZCBzaWduZXJzLgAAAAAAAApNaW5TaWduZXJzAAAAAAABAAAABAAAAAEAAAApSW52b2tlZCBmdW5jdGlvbiBpcyBvbmUgb2YgdGhlc2Ugc3ltYm9scy4AAAAAAAAERm5JbgAAAAEAAAPqAAAAEQAAAAEAAAAmQXJndW1lbnQgYXQgaW5kZXggZXF1YWxzIHRoaXMgYWRkcmVzcy4AAAAAAAlBcmdBZGRyRXEAAAAAAAACAAAABAAAABMAAAABAAAAMkFyZ3VtZW50IGF0IGluZGV4IGlzIHRoZSBwcm90ZWN0ZWQgYWNjb3VudCBpdHNlbGYuAAAAAAANQXJnQWRkcklzU2VsZgAAAAAAAAEAAAAEAAAAAQAAACVBcmd1bWVudCBhdCBpbmRleCBlcXVhbHMgdGhpcyBzeW1ib2wuAAAAAAAACEFyZ1N5bUVxAAAAAgAAAAQAAAARAAAAAQAAADVBcmd1bWVudCBhdCBpbmRleCAoYSBzdHJpbmcpIGlzIG9uZSBvZiB0aGVzZSBzdHJpbmdzLgAAAAAAAAhBcmdTdHJJbgAAAAIAAAAEAAAD6gAAABAAAAABAAAANUFyZ3VtZW50IGF0IGluZGV4IChhIHN0cmluZykgc3RhcnRzIHdpdGggdGhpcyBwcmVmaXguAAAAAAAADEFyZ1N0clByZWZpeAAAAAIAAAAEAAAAEAAAAAEAAAAlQXJndW1lbnQgYXQgaW5kZXggZXF1YWxzIHRoZXNlIGJ5dGVzLgAAAAAAAApBcmdCeXRlc0VxAAAAAAACAAAABAAAAA4AAAABAAAAI0FyZ3VtZW50IGF0IGluZGV4IGVxdWFscyB0aGlzIGkxMjguAAAAAAlBcmdJMTI4RXEAAAAAAAACAAAABAAAAAsAAAABAAAAIkFyZ3VtZW50IGF0IGluZGV4IGVxdWFscyB0aGlzIHUzMi4AAAAAAAhBcmdVMzJFcQAAAAIAAAAEAAAABAAAAAEAAAApVGhlIGNhbGwgaGFzIGV4YWN0bHkgdGhpcyBtYW55IGFyZ3VtZW50cy4AAAAAAAAIQXJnQ291bnQAAAABAAAABAAAAAEAAAAvQ3VycmVudCBsZWRnZXIgc2VxdWVuY2UgaXMgc3RyaWN0bHkgYmVsb3cgdGhpcy4AAAAADExlZGdlckJlZm9yZQAAAAEAAAAEAAAAAQAAAClDdXJyZW50IGxlZGdlciBzZXF1ZW5jZSBpcyBhdCBsZWFzdCB0aGlzLgAAAAAAAA9MZWRnZXJBdE9yQWZ0ZXIAAAAAAQAAAAQ=",
        "AAAAAQAAAExBIHBvc3RmaXgtZW5jb2RlZCBjb25zdHJhaW50IHByb2dyYW0uIFRoZSBsYXN0IG9wIHByb2R1Y2VzIHRoZSByb290CnZlcmRpY3QuAAAAAAAAAApScG5Qcm9ncmFtAAAAAAACAAAAAAAAAANvcHMAAAAD6gAAB9AAAAACT3AAAAAAAAAAAAAHdmVyc2lvbgAAAAAE",
        "AAAAAQAAAaJXaGF0IHRoZSBjb21waWxlciBzdG9yZXMgaW4gdGhlIGludGVycHJldGVyIGZvciBvbmUgYChhY2NvdW50LCBydWxlKWA6IHRoZQpwcm9ncmFtIHBsdXMgdGhlIGBkb2NfaGFzaGAgb2YgdGhlIHNvdXJjZSBQb2xpY3lEb2MuIFNoYXJpbmcgdGhpcwpgI1tjb250cmFjdHR5cGVdYCBiZXR3ZWVuIHRoZSBjb21waWxlciBhbmQgdGhlIGludGVycHJldGVyIGlzIHdoYXQga2VlcHMKaW5zdGFsbCBwYXJhbXMgZnJvbSBldmVyIGJlaW5nIGEgaGFuZC1idWlsdCBgU2NWYWxgIOKAlCBib3RoIHNpZGVzIGVuY29kZSBhbmQKZGVjb2RlIHRocm91Z2ggZXhhY3RseSB0aGVzZSB0eXBlcy4gYGRvY19oYXNoYCBiaW5kcyB0aGUgb24tY2hhaW4gcHJvZ3JhbSB0bwp0aGUgcmV2aWV3ZWQgZG9jdW1lbnQgKHByb3ZlbmFuY2UgZm9yIGxpZnQvZGlmZikuAAAAAAAAAAAADUluc3RhbGxQYXJhbXMAAAAAAAACAAAAAAAAAAhkb2NfaGFzaAAAA+4AAAAgAAAAAAAAAAdwcm9ncmFtAAAAB9AAAAAKUnBuUHJvZ3JhbQAA",
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
    enforce: this.txFromJSON<null>,
        install: this.txFromJSON<null>,
        uninstall: this.txFromJSON<null>,
        get_program: this.txFromJSON<Option<InstallParams>>,
        program_version: this.txFromJSON<u32>
  }
}