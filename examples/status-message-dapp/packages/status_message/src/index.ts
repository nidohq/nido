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
    contractId: "CBXVJXHPSYORSAHPX4I6NYPQMDJWK2STQCE6JTIM7FNV4OZSIDJFGNDM",
  }
} as const


export interface Client {
  /**
   * Construct and simulate a get_message transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read an account's status message, if any has been set.
   */
  get_message: ({author}: {author: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a update_message transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set the calling account's status message. Requires `author`'s auth.
   */
  update_message: ({message, author}: {message: string, author: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

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
      new ContractSpec([ "AAAAAAAAADZSZWFkIGFuIGFjY291bnQncyBzdGF0dXMgbWVzc2FnZSwgaWYgYW55IGhhcyBiZWVuIHNldC4AAAAAAAtnZXRfbWVzc2FnZQAAAAABAAAAAAAAAAZhdXRob3IAAAAAABMAAAABAAAD6AAAABA=",
        "AAAAAAAAAENTZXQgdGhlIGNhbGxpbmcgYWNjb3VudCdzIHN0YXR1cyBtZXNzYWdlLiBSZXF1aXJlcyBgYXV0aG9yYCdzIGF1dGguAAAAAA51cGRhdGVfbWVzc2FnZQAAAAAAAgAAAAAAAAAHbWVzc2FnZQAAAAAQAAAAAAAAAAZhdXRob3IAAAAAABMAAAAA" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_message: this.txFromJSON<Option<string>>,
        update_message: this.txFromJSON<null>
  }
}