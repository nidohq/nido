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
  1: {message:"VkParseError"},
  2: {message:"ProofParseError"},
  3: {message:"VerificationFailed"}
}

export interface Client {
  /**
   * Construct and simulate a vk transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read-only view of the compiled-in VK bytes, so off-chain tooling can
   * confirm which circuit this deployed instance is pinned to without
   * trusting metadata.
   */
  vk: (options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

  /**
   * Construct and simulate a verify_proof transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Verify an `UltraHonk` proof against the compiled-in VK. Mirrors
   * `nido-zk-verifier::verify_proof`'s structured-error, fail-closed
   * length precheck (same vendored parser, same trap-avoidance reasoning)
   * — see that contract's doc comment for why the length check exists
   * before the vendored `load_proof` runs.
   * 
   * # Errors
   * 
   * `VkParseError` if the compiled-in VK bytes fail to parse (a bug in
   * this build, not a runtime condition — the VK is a fixed constant);
   * `ProofParseError` if `proof_bytes` is not exactly the length the VK's
   * circuit size requires; `VerificationFailed` if a well-formed proof
   * does not verify against `public_inputs`.
   */
  verify_proof: ({public_inputs, proof_bytes}: {public_inputs: Buffer, proof_bytes: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAAwAAAAAAAAAMVmtQYXJzZUVycm9yAAAAAQAAAAAAAAAPUHJvb2ZQYXJzZUVycm9yAAAAAAIAAAAAAAAAElZlcmlmaWNhdGlvbkZhaWxlZAAAAAAAAw==",
        "AAAAAAAAAJlSZWFkLW9ubHkgdmlldyBvZiB0aGUgY29tcGlsZWQtaW4gVksgYnl0ZXMsIHNvIG9mZi1jaGFpbiB0b29saW5nIGNhbgpjb25maXJtIHdoaWNoIGNpcmN1aXQgdGhpcyBkZXBsb3llZCBpbnN0YW5jZSBpcyBwaW5uZWQgdG8gd2l0aG91dAp0cnVzdGluZyBtZXRhZGF0YS4AAAAAAAACdmsAAAAAAAAAAAABAAAADg==",
        "AAAAAAAAAnZWZXJpZnkgYW4gYFVsdHJhSG9ua2AgcHJvb2YgYWdhaW5zdCB0aGUgY29tcGlsZWQtaW4gVksuIE1pcnJvcnMKYG5pZG8temstdmVyaWZpZXI6OnZlcmlmeV9wcm9vZmAncyBzdHJ1Y3R1cmVkLWVycm9yLCBmYWlsLWNsb3NlZApsZW5ndGggcHJlY2hlY2sgKHNhbWUgdmVuZG9yZWQgcGFyc2VyLCBzYW1lIHRyYXAtYXZvaWRhbmNlIHJlYXNvbmluZykK4oCUIHNlZSB0aGF0IGNvbnRyYWN0J3MgZG9jIGNvbW1lbnQgZm9yIHdoeSB0aGUgbGVuZ3RoIGNoZWNrIGV4aXN0cwpiZWZvcmUgdGhlIHZlbmRvcmVkIGBsb2FkX3Byb29mYCBydW5zLgoKIyBFcnJvcnMKCmBWa1BhcnNlRXJyb3JgIGlmIHRoZSBjb21waWxlZC1pbiBWSyBieXRlcyBmYWlsIHRvIHBhcnNlIChhIGJ1ZyBpbgp0aGlzIGJ1aWxkLCBub3QgYSBydW50aW1lIGNvbmRpdGlvbiDigJQgdGhlIFZLIGlzIGEgZml4ZWQgY29uc3RhbnQpOwpgUHJvb2ZQYXJzZUVycm9yYCBpZiBgcHJvb2ZfYnl0ZXNgIGlzIG5vdCBleGFjdGx5IHRoZSBsZW5ndGggdGhlIFZLJ3MKY2lyY3VpdCBzaXplIHJlcXVpcmVzOyBgVmVyaWZpY2F0aW9uRmFpbGVkYCBpZiBhIHdlbGwtZm9ybWVkIHByb29mCmRvZXMgbm90IHZlcmlmeSBhZ2FpbnN0IGBwdWJsaWNfaW5wdXRzYC4AAAAAAAx2ZXJpZnlfcHJvb2YAAAACAAAAAAAAAA1wdWJsaWNfaW5wdXRzAAAAAAAADgAAAAAAAAALcHJvb2ZfYnl0ZXMAAAAADgAAAAEAAAPpAAAAAgAAAAM=" ]),
      options
    )
  }
  public readonly fromJSON = {
    vk: this.txFromJSON<Buffer>,
        verify_proof: this.txFromJSON<Result<void>>
  }
}