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





export interface Client {
  /**
   * Construct and simulate a get_c_address transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_c_address: ({funder}: {funder: string}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a create_account transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deploy an account contract and add a passkey to it. Lastly transfer funds to the contract's account.
   * 
   */
  create_account: ({funder, key, amount}: {funder: string, key: Buffer, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

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
      new ContractSpec([ "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAAAAAAA",
        "AAAAAAAAAAAAAAANZ2V0X2NfYWRkcmVzcwAAAAAAAAEAAAAAAAAABmZ1bmRlcgAAAAAAEwAAAAEAAAAT",
        "AAAAAAAAAGVEZXBsb3kgYW4gYWNjb3VudCBjb250cmFjdCBhbmQgYWRkIGEgcGFzc2tleSB0byBpdC4gTGFzdGx5IHRyYW5zZmVyIGZ1bmRzIHRvIHRoZSBjb250cmFjdCdzIGFjY291bnQuCgAAAAAAAA5jcmVhdGVfYWNjb3VudAAAAAAAAwAAAAAAAAAGZnVuZGVyAAAAAAATAAAAAAAAAANrZXkAAAAD7gAAAEEAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAAT" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_c_address: this.txFromJSON<string>,
        create_account: this.txFromJSON<string>
  }
}