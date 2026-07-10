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
    contractId: "CAUPKCFWVRFRMZXKVMSSZPN6OURTTDS6TDKS6JGXR5XE3D2BEYGT2QJH",
  }
} as const


export interface Petition {
  body: string;
  created_ledger: u32;
  creator: string;
  deadline: Option<u32>;
  goal: Option<u32>;
  sig_count: u32;
  title: string;
}

export const PetitionError = {
  1: {message:"NotFound"},
  2: {message:"TitleInvalid"},
  3: {message:"BodyInvalid"},
  4: {message:"DeadlineInPast"},
  5: {message:"Expired"},
  6: {message:"AlreadySigned"}
}



export interface Client {
  /**
   * Construct and simulate a sign transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  sign: ({id, signer}: {id: u32, signer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a extend_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  extend_ttl: ({id}: {id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a has_signed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  has_signed: ({id, addr}: {id: u32, addr: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_signers transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_signers: ({id, start, limit}: {id: u32, start: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a get_petition transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_petition: ({id}: {id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Petition>>>

  /**
   * Construct and simulate a petition_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  petition_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a create_petition transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_petition: ({creator, title, body, goal, deadline}: {creator: string, title: string, body: string, goal: Option<u32>, deadline: Option<u32>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a extend_signatures_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Callable by anyone (same keep-alive idiom as `extend_ttl`). Extends
   * the `signer_by_index` and `signatures` entries for signer indices
   * `[start, min(start + limit, sig_count))`. Paginated because a
   * petition's signer set is unbounded.
   */
  extend_signatures_ttl: ({id, start, limit}: {id: u32, start: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
      new ContractSpec([ "AAAAAAAAAAAAAAAEc2lnbgAAAAIAAAAAAAAAAmlkAAAAAAAEAAAAAAAAAAZzaWduZXIAAAAAABMAAAABAAAD6QAAAAIAAAfQAAAADVBldGl0aW9uRXJyb3IAAAA=",
        "AAAAAQAAAAAAAAAAAAAACFBldGl0aW9uAAAABwAAAAAAAAAEYm9keQAAABAAAAAAAAAADmNyZWF0ZWRfbGVkZ2VyAAAAAAAEAAAAAAAAAAdjcmVhdG9yAAAAABMAAAAAAAAACGRlYWRsaW5lAAAD6AAAAAQAAAAAAAAABGdvYWwAAAPoAAAABAAAAAAAAAAJc2lnX2NvdW50AAAAAAAABAAAAAAAAAAFdGl0bGUAAAAAAAAQ",
        "AAAAAAAAAAAAAAAKZXh0ZW5kX3R0bAAAAAAAAQAAAAAAAAACaWQAAAAAAAQAAAABAAAD6QAAAAIAAAfQAAAADVBldGl0aW9uRXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAKaGFzX3NpZ25lZAAAAAAAAgAAAAAAAAACaWQAAAAAAAQAAAAAAAAABGFkZHIAAAATAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAALZ2V0X3NpZ25lcnMAAAAAAwAAAAAAAAACaWQAAAAAAAQAAAAAAAAABXN0YXJ0AAAAAAAABAAAAAAAAAAFbGltaXQAAAAAAAAEAAAAAQAAA+oAAAAT",
        "AAAABAAAAAAAAAAAAAAADVBldGl0aW9uRXJyb3IAAAAAAAAGAAAAAAAAAAhOb3RGb3VuZAAAAAEAAAAAAAAADFRpdGxlSW52YWxpZAAAAAIAAAAAAAAAC0JvZHlJbnZhbGlkAAAAAAMAAAAAAAAADkRlYWRsaW5lSW5QYXN0AAAAAAAEAAAAAAAAAAdFeHBpcmVkAAAAAAUAAAAAAAAADUFscmVhZHlTaWduZWQAAAAAAAAG",
        "AAAAAAAAAAAAAAAMZ2V0X3BldGl0aW9uAAAAAQAAAAAAAAACaWQAAAAAAAQAAAABAAAD6AAAB9AAAAAIUGV0aXRpb24=",
        "AAAABQAAAAAAAAAAAAAADlBldGl0aW9uU2lnbmVkAAAAAAABAAAAD3BldGl0aW9uX3NpZ25lZAAAAAACAAAAAAAAAAJpZAAAAAAABAAAAAEAAAAAAAAABnNpZ25lcgAAAAAAEwAAAAAAAAAC",
        "AAAAAAAAAAAAAAAOcGV0aXRpb25fY291bnQAAAAAAAAAAAABAAAABA==",
        "AAAABQAAAAAAAAAAAAAAD1BldGl0aW9uQ3JlYXRlZAAAAAABAAAAEHBldGl0aW9uX2NyZWF0ZWQAAAACAAAAAAAAAAJpZAAAAAAABAAAAAEAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAC",
        "AAAAAAAAAAAAAAAPY3JlYXRlX3BldGl0aW9uAAAAAAUAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAFdGl0bGUAAAAAAAAQAAAAAAAAAARib2R5AAAAEAAAAAAAAAAEZ29hbAAAA+gAAAAEAAAAAAAAAAhkZWFkbGluZQAAA+gAAAAEAAAAAQAAA+kAAAAEAAAH0AAAAA1QZXRpdGlvbkVycm9yAAAA",
        "AAAAAAAAAOdDYWxsYWJsZSBieSBhbnlvbmUgKHNhbWUga2VlcC1hbGl2ZSBpZGlvbSBhcyBgZXh0ZW5kX3R0bGApLiBFeHRlbmRzCnRoZSBgc2lnbmVyX2J5X2luZGV4YCBhbmQgYHNpZ25hdHVyZXNgIGVudHJpZXMgZm9yIHNpZ25lciBpbmRpY2VzCmBbc3RhcnQsIG1pbihzdGFydCArIGxpbWl0LCBzaWdfY291bnQpKWAuIFBhZ2luYXRlZCBiZWNhdXNlIGEKcGV0aXRpb24ncyBzaWduZXIgc2V0IGlzIHVuYm91bmRlZC4AAAAAFWV4dGVuZF9zaWduYXR1cmVzX3R0bAAAAAAAAAMAAAAAAAAAAmlkAAAAAAAEAAAAAAAAAAVzdGFydAAAAAAAAAQAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPpAAAAAgAAB9AAAAANUGV0aXRpb25FcnJvcgAAAA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    sign: this.txFromJSON<Result<void>>,
        extend_ttl: this.txFromJSON<Result<void>>,
        has_signed: this.txFromJSON<boolean>,
        get_signers: this.txFromJSON<Array<string>>,
        get_petition: this.txFromJSON<Option<Petition>>,
        petition_count: this.txFromJSON<u32>,
        create_petition: this.txFromJSON<Result<u32>>,
        extend_signatures_ttl: this.txFromJSON<Result<void>>
  }
}