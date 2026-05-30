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
 * Installation parameters for the simple threshold policy.
 */
export interface SimpleThresholdAccountParams {
  /**
 * The minimum number of signers required for authorization.
 */
threshold: u32;
}

export interface Client {
  /**
   * Construct and simulate a enforce transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  enforce: ({context, authenticated_signers, context_rule, smart_account}: {context: Context, authenticated_signers: Array<Signer>, context_rule: ContextRule, smart_account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a install transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  install: ({install_params, context_rule, smart_account}: {install_params: SimpleThresholdAccountParams, context_rule: ContextRule, smart_account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a uninstall transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  uninstall: ({context_rule, smart_account}: {context_rule: ContextRule, smart_account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_threshold transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read the installed M-of-N threshold for a given account + rule.
   * Returns 0 if not installed.
   */
  get_threshold: ({context_rule_id, smart_account}: {context_rule_id: u32, smart_account: string}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

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
      new ContractSpec([ "AAAAAAAAAAAAAAAHZW5mb3JjZQAAAAAEAAAAAAAAAAdjb250ZXh0AAAAB9AAAAAHQ29udGV4dAAAAAAAAAAAFWF1dGhlbnRpY2F0ZWRfc2lnbmVycwAAAAAAA+oAAAfQAAAABlNpZ25lcgAAAAAAAAAAAAxjb250ZXh0X3J1bGUAAAfQAAAAC0NvbnRleHRSdWxlAAAAAAAAAAANc21hcnRfYWNjb3VudAAAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAHaW5zdGFsbAAAAAADAAAAAAAAAA5pbnN0YWxsX3BhcmFtcwAAAAAH0AAAABxTaW1wbGVUaHJlc2hvbGRBY2NvdW50UGFyYW1zAAAAAAAAAAxjb250ZXh0X3J1bGUAAAfQAAAAC0NvbnRleHRSdWxlAAAAAAAAAAANc21hcnRfYWNjb3VudAAAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAJdW5pbnN0YWxsAAAAAAAAAgAAAAAAAAAMY29udGV4dF9ydWxlAAAH0AAAAAtDb250ZXh0UnVsZQAAAAAAAAAADXNtYXJ0X2FjY291bnQAAAAAAAATAAAAAA==",
        "AAAAAAAAAFtSZWFkIHRoZSBpbnN0YWxsZWQgTS1vZi1OIHRocmVzaG9sZCBmb3IgYSBnaXZlbiBhY2NvdW50ICsgcnVsZS4KUmV0dXJucyAwIGlmIG5vdCBpbnN0YWxsZWQuAAAAAA1nZXRfdGhyZXNob2xkAAAAAAAAAgAAAAAAAAAPY29udGV4dF9ydWxlX2lkAAAAAAQAAAAAAAAADXNtYXJ0X2FjY291bnQAAAAAAAATAAAAAQAAAAQ=",
        "AAAAAgAAAEJSZXByZXNlbnRzIGRpZmZlcmVudCB0eXBlcyBvZiBzaWduZXJzIGluIHRoZSBzbWFydCBhY2NvdW50IHN5c3RlbS4AAAAAAAAAAAAGU2lnbmVyAAAAAAACAAAAAQAAAD1BIGRlbGVnYXRlZCBzaWduZXIgdGhhdCB1c2VzIGJ1aWx0LWluIHNpZ25hdHVyZSB2ZXJpZmljYXRpb24uAAAAAAAACURlbGVnYXRlZAAAAAAAAAEAAAATAAAAAQAAAHJBbiBleHRlcm5hbCBzaWduZXIgd2l0aCBjdXN0b20gdmVyaWZpY2F0aW9uIGxvZ2ljLgpDb250YWlucyB0aGUgdmVyaWZpZXIgY29udHJhY3QgYWRkcmVzcyBhbmQgdGhlIHB1YmxpYyBrZXkgZGF0YS4AAAAAAAhFeHRlcm5hbAAAAAIAAAATAAAADg==",
        "AAAAAQAAADxBIGNvbXBsZXRlIGNvbnRleHQgcnVsZSBkZWZpbmluZyBhdXRob3JpemF0aW9uIHJlcXVpcmVtZW50cy4AAAAAAAAAC0NvbnRleHRSdWxlAAAAAAgAAAApVGhlIHR5cGUgb2YgY29udGV4dCB0aGlzIHJ1bGUgYXBwbGllcyB0by4AAAAAAAAMY29udGV4dF90eXBlAAAH0AAAAA9Db250ZXh0UnVsZVR5cGUAAAAAJ1VuaXF1ZSBpZGVudGlmaWVyIGZvciB0aGUgY29udGV4dCBydWxlLgAAAAACaWQAAAAAAAQAAAApSHVtYW4tcmVhZGFibGUgbmFtZSBmb3IgdGhlIGNvbnRleHQgcnVsZS4AAAAAAAAEbmFtZQAAABAAAAAwTGlzdCBvZiBwb2xpY3kgY29udHJhY3RzIHRoYXQgbXVzdCBiZSBzYXRpc2ZpZWQuAAAACHBvbGljaWVzAAAD6gAAABMAAABKR2xvYmFsIHJlZ2lzdHJ5IElEcyBmb3IgZWFjaCBwb2xpY3ksIHBvc2l0aW9uYWxseSBhbGlnbmVkIHdpdGgKYHBvbGljaWVzYC4AAAAAAApwb2xpY3lfaWRzAAAAAAPqAAAABAAAAElHbG9iYWwgcmVnaXN0cnkgSURzIGZvciBlYWNoIHNpZ25lciwgcG9zaXRpb25hbGx5IGFsaWduZWQgd2l0aApgc2lnbmVyc2AuAAAAAAAACnNpZ25lcl9pZHMAAAAAA+oAAAAEAAAAKExpc3Qgb2Ygc2lnbmVycyBhdXRob3JpemVkIGJ5IHRoaXMgcnVsZS4AAAAHc2lnbmVycwAAAAPqAAAH0AAAAAZTaWduZXIAAAAAADFPcHRpb25hbCBleHBpcmF0aW9uIGxlZGdlciBzZXF1ZW5jZSBmb3IgdGhlIHJ1bGUuAAAAAAAAC3ZhbGlkX3VudGlsAAAAA+gAAAAE",
        "AAAAAgAAAEBUeXBlcyBvZiBjb250ZXh0cyB0aGF0IGNhbiBiZSBhdXRob3JpemVkIGJ5IHNtYXJ0IGFjY291bnQgcnVsZXMuAAAAAAAAAA9Db250ZXh0UnVsZVR5cGUAAAAAAwAAAAAAAAAtRGVmYXVsdCBydWxlcyB0aGF0IGNhbiBhdXRob3JpemUgYW55IGNvbnRleHQuAAAAAAAAB0RlZmF1bHQAAAAAAQAAADBSdWxlcyBzcGVjaWZpYyB0byBjYWxsaW5nIGEgcGFydGljdWxhciBjb250cmFjdC4AAAAMQ2FsbENvbnRyYWN0AAAAAQAAABMAAAABAAAAQlJ1bGVzIHNwZWNpZmljIHRvIGNyZWF0aW5nIGEgY29udHJhY3Qgd2l0aCBhIHBhcnRpY3VsYXIgV0FTTSBoYXNoLgAAAAAADkNyZWF0ZUNvbnRyYWN0AAAAAAABAAAD7gAAACA=",
        "AAAABQAAADlFdmVudCBlbWl0dGVkIHdoZW4gYSBzaW1wbGUgdGhyZXNob2xkIHBvbGljeSBpcyBlbmZvcmNlZC4AAAAAAAAAAAAADlNpbXBsZUVuZm9yY2VkAAAAAAABAAAAD3NpbXBsZV9lbmZvcmNlZAAAAAAEAAAAAAAAAA1zbWFydF9hY2NvdW50AAAAAAAAEwAAAAEAAAAAAAAAB2NvbnRleHQAAAAH0AAAAAdDb250ZXh0AAAAAAAAAAAAAAAAD2NvbnRleHRfcnVsZV9pZAAAAAAEAAAAAAAAAAAAAAAVYXV0aGVudGljYXRlZF9zaWduZXJzAAAAAAAD6gAAB9AAAAAGU2lnbmVyAAAAAAAAAAAAAg==",
        "AAAABQAAADpFdmVudCBlbWl0dGVkIHdoZW4gYSBzaW1wbGUgdGhyZXNob2xkIHBvbGljeSBpcyBpbnN0YWxsZWQuAAAAAAAAAAAAD1NpbXBsZUluc3RhbGxlZAAAAAABAAAAEHNpbXBsZV9pbnN0YWxsZWQAAAADAAAAAAAAAA1zbWFydF9hY2NvdW50AAAAAAAAEwAAAAEAAAAAAAAAD2NvbnRleHRfcnVsZV9pZAAAAAAEAAAAAAAAAAAAAAAJdGhyZXNob2xkAAAAAAAABAAAAAAAAAAC",
        "AAAABQAAADxFdmVudCBlbWl0dGVkIHdoZW4gYSBzaW1wbGUgdGhyZXNob2xkIHBvbGljeSBpcyB1bmluc3RhbGxlZC4AAAAAAAAAEVNpbXBsZVVuaW5zdGFsbGVkAAAAAAAAAQAAABJzaW1wbGVfdW5pbnN0YWxsZWQAAAAAAAIAAAAAAAAADXNtYXJ0X2FjY291bnQAAAAAAAATAAAAAQAAAAAAAAAPY29udGV4dF9ydWxlX2lkAAAAAAQAAAAAAAAAAg==",
        "AAAABAAAADNFcnJvciBjb2RlcyBmb3Igc2ltcGxlIHRocmVzaG9sZCBwb2xpY3kgb3BlcmF0aW9ucy4AAAAAAAAAABRTaW1wbGVUaHJlc2hvbGRFcnJvcgAAAAQAAABEVGhlIHNtYXJ0IGFjY291bnQgZG9lcyBub3QgaGF2ZSBhIHNpbXBsZSB0aHJlc2hvbGQgcG9saWN5IGluc3RhbGxlZC4AAAAYU21hcnRBY2NvdW50Tm90SW5zdGFsbGVkAAAMgAAAAD9XaGVuIHRocmVzaG9sZCBpcyAwIG9yIGV4Y2VlZHMgdGhlIG51bWJlciBvZiBhdmFpbGFibGUgc2lnbmVycy4AAAAAEEludmFsaWRUaHJlc2hvbGQAAAyBAAAALlRoZSB0cmFuc2FjdGlvbiBpcyBub3QgYWxsb3dlZCBieSB0aGlzIHBvbGljeS4AAAAAAApOb3RBbGxvd2VkAAAAAAyCAAAAQlRoZSBjb250ZXh0IHJ1bGUgZm9yIHRoZSBzbWFydCBhY2NvdW50IGhhcyBiZWVuIGFscmVhZHkgaW5zdGFsbGVkLgAAAAAAEEFscmVhZHlJbnN0YWxsZWQAAAyD",
        "AAAAAQAAADhJbnN0YWxsYXRpb24gcGFyYW1ldGVycyBmb3IgdGhlIHNpbXBsZSB0aHJlc2hvbGQgcG9saWN5LgAAAAAAAAAcU2ltcGxlVGhyZXNob2xkQWNjb3VudFBhcmFtcwAAAAEAAAA5VGhlIG1pbmltdW0gbnVtYmVyIG9mIHNpZ25lcnMgcmVxdWlyZWQgZm9yIGF1dGhvcml6YXRpb24uAAAAAAAACXRocmVzaG9sZAAAAAAAAAQ=" ]),
      options
    )
  }
  public readonly fromJSON = {
    enforce: this.txFromJSON<null>,
        install: this.txFromJSON<null>,
        uninstall: this.txFromJSON<null>,
        get_threshold: this.txFromJSON<u32>
  }
}
