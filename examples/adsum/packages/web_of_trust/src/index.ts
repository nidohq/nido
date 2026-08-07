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


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CDI5YRC4K54QHJW63ONUQPZ6GOAU254GP43OWGCPK3QVPUKPIQIQGIFS",
  }
} as const



export interface PreVouch {
  claims: u32;
  expires: Option<u32>;
  from: string;
  max_claims: u32;
}

export const TrustError = {
  1: {message:"SelfVouch"},
  2: {message:"AlreadyVouched"},
  3: {message:"VouchNotFound"},
  4: {message:"PreVouchExists"},
  5: {message:"PreVouchNotFound"},
  6: {message:"PreVouchExpired"},
  7: {message:"InvalidMaxClaims"},
  8: {message:"ExpiryInPast"}
}




export interface Client {
  /**
   * Construct and simulate a vouch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  vouch: ({from, to}: {from: string, to: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a revoke transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  revoke: ({from, to}: {from: string, to: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a pre_vouch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pre_vouch: ({from, key, expires, max_claims}: {from: string, key: Buffer, expires: Option<u32>, max_claims: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a extend_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  extend_ttl: ({a}: {a: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a claim_vouch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim_vouch: ({key, to, sig}: {key: Buffer, to: string, sig: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a has_vouched transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  has_vouched: ({from, to}: {from: string, to: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_pre_vouch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_pre_vouch: ({key}: {key: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<PreVouch>>>

  /**
   * Construct and simulate a vouches_given transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  vouches_given: ({a}: {a: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a revoke_pre_vouch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  revoke_pre_vouch: ({from, key}: {from: string, key: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a vouches_received transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  vouches_received: ({a}: {a: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

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
      new ContractSpec([ "AAAAAAAAAAAAAAAFdm91Y2gAAAAAAAACAAAAAAAAAARmcm9tAAAAEwAAAAAAAAACdG8AAAAAABMAAAABAAAD6QAAAAIAAAfQAAAAClRydXN0RXJyb3IAAA==",
        "AAAAAAAAAAAAAAAGcmV2b2tlAAAAAAACAAAAAAAAAARmcm9tAAAAEwAAAAAAAAACdG8AAAAAABMAAAABAAAD6QAAAAIAAAfQAAAAClRydXN0RXJyb3IAAA==",
        "AAAABQAAAAAAAAAAAAAAB1ZvdWNoZWQAAAAAAQAAAAd2b3VjaGVkAAAAAAIAAAAAAAAABGZyb20AAAATAAAAAQAAAAAAAAACdG8AAAAAABMAAAAAAAAAAg==",
        "AAAAAQAAAAAAAAAAAAAACFByZVZvdWNoAAAABAAAAAAAAAAGY2xhaW1zAAAAAAAEAAAAAAAAAAdleHBpcmVzAAAAA+gAAAAEAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAKbWF4X2NsYWltcwAAAAAABA==",
        "AAAABAAAAAAAAAAAAAAAClRydXN0RXJyb3IAAAAAAAgAAAAAAAAACVNlbGZWb3VjaAAAAAAAAAEAAAAAAAAADkFscmVhZHlWb3VjaGVkAAAAAAACAAAAAAAAAA1Wb3VjaE5vdEZvdW5kAAAAAAAAAwAAAAAAAAAOUHJlVm91Y2hFeGlzdHMAAAAAAAQAAAAAAAAAEFByZVZvdWNoTm90Rm91bmQAAAAFAAAAAAAAAA9QcmVWb3VjaEV4cGlyZWQAAAAABgAAAAAAAAAQSW52YWxpZE1heENsYWltcwAAAAcAAAAAAAAADEV4cGlyeUluUGFzdAAAAAg=",
        "AAAAAAAAAAAAAAAJcHJlX3ZvdWNoAAAAAAAABAAAAAAAAAAEZnJvbQAAABMAAAAAAAAAA2tleQAAAAPuAAAAIAAAAAAAAAAHZXhwaXJlcwAAAAPoAAAABAAAAAAAAAAKbWF4X2NsYWltcwAAAAAABAAAAAEAAAPpAAAAAgAAB9AAAAAKVHJ1c3RFcnJvcgAA",
        "AAAAAAAAAAAAAAAKZXh0ZW5kX3R0bAAAAAAAAQAAAAAAAAABYQAAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAALY2xhaW1fdm91Y2gAAAAAAwAAAAAAAAADa2V5AAAAA+4AAAAgAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAADc2lnAAAAA+4AAABAAAAAAQAAA+kAAAACAAAH0AAAAApUcnVzdEVycm9yAAA=",
        "AAAAAAAAAAAAAAALaGFzX3ZvdWNoZWQAAAAAAgAAAAAAAAAEZnJvbQAAABMAAAAAAAAAAnRvAAAAAAATAAAAAQAAAAE=",
        "AAAABQAAAAAAAAAAAAAADFZvdWNoQ2xhaW1lZAAAAAEAAAANdm91Y2hfY2xhaW1lZAAAAAAAAAMAAAAAAAAAA2tleQAAAAPuAAAAIAAAAAEAAAAAAAAABGZyb20AAAATAAAAAAAAAAAAAAACdG8AAAAAABMAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADFZvdWNoUmV2b2tlZAAAAAEAAAANdm91Y2hfcmV2b2tlZAAAAAAAAAIAAAAAAAAABGZyb20AAAATAAAAAQAAAAAAAAACdG8AAAAAABMAAAAAAAAAAg==",
        "AAAAAAAAAAAAAAANZ2V0X3ByZV92b3VjaAAAAAAAAAEAAAAAAAAAA2tleQAAAAPuAAAAIAAAAAEAAAPoAAAH0AAAAAhQcmVWb3VjaA==",
        "AAAAAAAAAAAAAAANdm91Y2hlc19naXZlbgAAAAAAAAEAAAAAAAAAAWEAAAAAAAATAAAAAQAAA+oAAAAT",
        "AAAABQAAAAAAAAAAAAAAD1ByZVZvdWNoQ3JlYXRlZAAAAAABAAAAEXByZV92b3VjaF9jcmVhdGVkAAAAAAAAAgAAAAAAAAADa2V5AAAAA+4AAAAgAAAAAQAAAAAAAAAEZnJvbQAAABMAAAAAAAAAAg==",
        "AAAAAAAAAAAAAAAQcmV2b2tlX3ByZV92b3VjaAAAAAIAAAAAAAAABGZyb20AAAATAAAAAAAAAANrZXkAAAAD7gAAACAAAAABAAAD6QAAAAIAAAfQAAAAClRydXN0RXJyb3IAAA==",
        "AAAAAAAAAAAAAAAQdm91Y2hlc19yZWNlaXZlZAAAAAEAAAAAAAAAAWEAAAAAAAATAAAAAQAAA+oAAAAT" ]),
      options
    )
  }
  public readonly fromJSON = {
    vouch: this.txFromJSON<Result<void>>,
        revoke: this.txFromJSON<Result<void>>,
        pre_vouch: this.txFromJSON<Result<void>>,
        extend_ttl: this.txFromJSON<null>,
        claim_vouch: this.txFromJSON<Result<void>>,
        has_vouched: this.txFromJSON<boolean>,
        get_pre_vouch: this.txFromJSON<Option<PreVouch>>,
        vouches_given: this.txFromJSON<Array<string>>,
        revoke_pre_vouch: this.txFromJSON<Result<void>>,
        vouches_received: this.txFromJSON<Array<string>>
  }
}