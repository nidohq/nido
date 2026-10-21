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
   * Construct and simulate a admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a manager transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The address that must authorize `create_account`, or `None` if anyone
   * may.
   */
  manager: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Replace the factory's wasm with the installed wasm `wasm_hash`, and
   * with it the account wasm hash new accounts are deployed from. Admin
   * only.
   */
  upgrade: ({wasm_hash}: {wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * admin-sep's default, plus an `AdminChanged` event so watchers see who
   * can change the factory.
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_manager transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Require `manager`'s authorization on every `create_account` from now
   * on, or nobody's with `None`. Admin only.
   */
  set_manager: ({manager}: {manager: Option<string>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a pin_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pin `verifier` for every account created afterwards. Admin only.
   */
  pin_verifier: ({verifier}: {verifier: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_c_address transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The address `create_account` deploys to for `setup_pk`.
   */
  get_c_address: ({setup_pk}: {setup_pk: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a create_account transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deploy a Perch smart account at `get_c_address(setup_pk)` whose
   * constructor rule ("admin", scoped to the account itself) is the passkey
   * `key`, checked by the `WebAuthn` verifier. Everything else — further
   * signers, rules, and recovery — arrives through the account's first
   * `apply_doc`.
   * 
   * `setup_sig` is the setup key's Ed25519 signature over
   * `sha256("nido/bind/v1" || network_id || factory_id || key)`, so only
   * the holder of the setup key chooses the passkey at its address; the
   * manager, if one is set, decides only whether the account is created.
   */
  create_account: ({setup_pk, key, setup_sig}: {setup_pk: Buffer, key: Buffer, setup_sig: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a pinned_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The pinned `verifier` address, or `None` if unpinned.
   */
  pinned_verifier: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a account_wasm_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The installed `perch-account` wasm hash `create_account` deploys,
   * pinned when this wasm was built.
   */
  account_wasm_hash: (options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, verifier, manager}: {admin: string, verifier: Option<string>, manager: Option<string>},
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
    return ContractClient.deploy({admin, verifier, manager}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAAFYWRtaW4AAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAEpUaGUgYWRkcmVzcyB0aGF0IG11c3QgYXV0aG9yaXplIGBjcmVhdGVfYWNjb3VudGAsIG9yIGBOb25lYCBpZiBhbnlvbmUKbWF5LgAAAAAAB21hbmFnZXIAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAI1SZXBsYWNlIHRoZSBmYWN0b3J5J3Mgd2FzbSB3aXRoIHRoZSBpbnN0YWxsZWQgd2FzbSBgd2FzbV9oYXNoYCwgYW5kCndpdGggaXQgdGhlIGFjY291bnQgd2FzbSBoYXNoIG5ldyBhY2NvdW50cyBhcmUgZGVwbG95ZWQgZnJvbS4gQWRtaW4Kb25seS4AAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAA=",
        "AAAABQAAAH5UaGUgZmFjdG9yeSdzIHdhc20gd2FzIHJlcGxhY2VkOyB0aGUgbmV3IHdhc20gcnVucyBmcm9tIHRoZSBuZXh0Cmludm9jYXRpb24sIGFuZCB3aXRoIGl0IHRoZSBhY2NvdW50IHdhc20gaGFzaCB0aGF0IHdhc20gcGlucy4AAAAAAAAAAAAIVXBncmFkZWQAAAABAAAACHVwZ3JhZGVkAAAAAQAAAAAAAAAJd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAAAAAAAg==",
        "AAAAAAAAAF1hZG1pbi1zZXAncyBkZWZhdWx0LCBwbHVzIGFuIGBBZG1pbkNoYW5nZWRgIGV2ZW50IHNvIHdhdGNoZXJzIHNlZSB3aG8KY2FuIGNoYW5nZSB0aGUgZmFjdG9yeS4AAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAG1SZXF1aXJlIGBtYW5hZ2VyYCdzIGF1dGhvcml6YXRpb24gb24gZXZlcnkgYGNyZWF0ZV9hY2NvdW50YCBmcm9tIG5vdwpvbiwgb3Igbm9ib2R5J3Mgd2l0aCBgTm9uZWAuIEFkbWluIG9ubHkuAAAAAAAAC3NldF9tYW5hZ2VyAAAAAAEAAAAAAAAAB21hbmFnZXIAAAAD6AAAABMAAAAA",
        "AAAABQAAADVUaGUgYWRtaW4gd2FzIHNldCwgYXQgY29uc3RydWN0aW9uIG9yIGJ5IGBzZXRfYWRtaW5gLgAAAAAAAAAAAAAMQWRtaW5DaGFuZ2VkAAAAAQAAAA1hZG1pbl9jaGFuZ2VkAAAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAI=",
        "AAAAAAAAAEBQaW4gYHZlcmlmaWVyYCBmb3IgZXZlcnkgYWNjb3VudCBjcmVhdGVkIGFmdGVyd2FyZHMuIEFkbWluIG9ubHkuAAAADHBpbl92ZXJpZmllcgAAAAEAAAAAAAAACHZlcmlmaWVyAAAAEwAAAAA=",
        "AAAAAAAAAKtgdmVyaWZpZXJgIHBpbnMgdGhlIGBXZWJBdXRobmAgdmVyaWZpZXIgZnJvbSB0aGUgZmlyc3QgYWNjb3VudCBvbgooYE5vbmVgIGxlYXZlcyBpdCB0byB0aGUgcmVnaXN0cnkpLiBgbWFuYWdlcmAgbXVzdCBhdXRob3JpemUgZXZlcnkKYGNyZWF0ZV9hY2NvdW50YCAoYE5vbmVgIGxldHMgYW55b25lKS4AAAAADV9fY29uc3RydWN0b3IAAAAAAAADAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACHZlcmlmaWVyAAAD6AAAABMAAAAAAAAAB21hbmFnZXIAAAAD6AAAABMAAAAA",
        "AAAAAAAAADdUaGUgYWRkcmVzcyBgY3JlYXRlX2FjY291bnRgIGRlcGxveXMgdG8gZm9yIGBzZXR1cF9wa2AuAAAAAA1nZXRfY19hZGRyZXNzAAAAAAAAAQAAAAAAAAAIc2V0dXBfcGsAAAPuAAAAIAAAAAEAAAAT",
        "AAAABQAAAF1BbiBhY2NvdW50IHdhcyBjcmVhdGVkIGF0IGBhY2NvdW50YCBmb3IgdGhlIHBhc3NrZXkgYGtleWAsIGJvdW5kIGJ5IHRoZQpzZXR1cCBrZXkgYHNldHVwX3BrYC4AAAAAAAAAAAAADkFjY291bnRDcmVhdGVkAAAAAAABAAAAD2FjY291bnRfY3JlYXRlZAAAAAADAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAAAAAAAAhzZXR1cF9wawAAA+4AAAAgAAAAAAAAAAAAAAADa2V5AAAAA+4AAABBAAAAAAAAAAI=",
        "AAAABQAAAERXaG8gbXVzdCBhdXRob3JpemUgYGNyZWF0ZV9hY2NvdW50YCBmcm9tIG5vdyBvbjsgYE5vbmVgIGxldHMgYW55b25lLgAAAAAAAAAOTWFuYWdlckNoYW5nZWQAAAAAAAEAAAAPbWFuYWdlcl9jaGFuZ2VkAAAAAAEAAAAAAAAAB21hbmFnZXIAAAAD6AAAABMAAAAAAAAAAg==",
        "AAAABQAAADtBY2NvdW50cyBjcmVhdGVkIGZyb20gbm93IG9uIG5hbWUgdGhpcyBgV2ViQXV0aG5gIHZlcmlmaWVyLgAAAAAAAAAADlZlcmlmaWVyUGlubmVkAAAAAAABAAAAD3ZlcmlmaWVyX3Bpbm5lZAAAAAABAAAAAAAAAAh2ZXJpZmllcgAAABMAAAAAAAAAAg==",
        "AAAAAAAAAiVEZXBsb3kgYSBQZXJjaCBzbWFydCBhY2NvdW50IGF0IGBnZXRfY19hZGRyZXNzKHNldHVwX3BrKWAgd2hvc2UKY29uc3RydWN0b3IgcnVsZSAoImFkbWluIiwgc2NvcGVkIHRvIHRoZSBhY2NvdW50IGl0c2VsZikgaXMgdGhlIHBhc3NrZXkKYGtleWAsIGNoZWNrZWQgYnkgdGhlIGBXZWJBdXRobmAgdmVyaWZpZXIuIEV2ZXJ5dGhpbmcgZWxzZSDigJQgZnVydGhlcgpzaWduZXJzLCBydWxlcywgYW5kIHJlY292ZXJ5IOKAlCBhcnJpdmVzIHRocm91Z2ggdGhlIGFjY291bnQncyBmaXJzdApgYXBwbHlfZG9jYC4KCmBzZXR1cF9zaWdgIGlzIHRoZSBzZXR1cCBrZXkncyBFZDI1NTE5IHNpZ25hdHVyZSBvdmVyCmBzaGEyNTYoIm5pZG8vYmluZC92MSIgfHwgbmV0d29ya19pZCB8fCBmYWN0b3J5X2lkIHx8IGtleSlgLCBzbyBvbmx5CnRoZSBob2xkZXIgb2YgdGhlIHNldHVwIGtleSBjaG9vc2VzIHRoZSBwYXNza2V5IGF0IGl0cyBhZGRyZXNzOyB0aGUKbWFuYWdlciwgaWYgb25lIGlzIHNldCwgZGVjaWRlcyBvbmx5IHdoZXRoZXIgdGhlIGFjY291bnQgaXMgY3JlYXRlZC4AAAAAAAAOY3JlYXRlX2FjY291bnQAAAAAAAMAAAAAAAAACHNldHVwX3BrAAAD7gAAACAAAAAAAAAAA2tleQAAAAPuAAAAQQAAAAAAAAAJc2V0dXBfc2lnAAAAAAAD7gAAAEAAAAABAAAAEw==",
        "AAAAAAAAADVUaGUgcGlubmVkIGB2ZXJpZmllcmAgYWRkcmVzcywgb3IgYE5vbmVgIGlmIHVucGlubmVkLgAAAAAAAA9waW5uZWRfdmVyaWZpZXIAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAGJUaGUgaW5zdGFsbGVkIGBwZXJjaC1hY2NvdW50YCB3YXNtIGhhc2ggYGNyZWF0ZV9hY2NvdW50YCBkZXBsb3lzLApwaW5uZWQgd2hlbiB0aGlzIHdhc20gd2FzIGJ1aWx0LgAAAAAAEWFjY291bnRfd2FzbV9oYXNoAAAAAAAAAAAAAAEAAAPuAAAAIA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    admin: this.txFromJSON<string>,
        manager: this.txFromJSON<Option<string>>,
        upgrade: this.txFromJSON<null>,
        set_admin: this.txFromJSON<null>,
        set_manager: this.txFromJSON<null>,
        pin_verifier: this.txFromJSON<null>,
        get_c_address: this.txFromJSON<string>,
        create_account: this.txFromJSON<string>,
        pinned_verifier: this.txFromJSON<Option<string>>,
        account_wasm_hash: this.txFromJSON<Buffer>
  }
}