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
 * Error types for WebAuthn verification operations.
 */
export const WebAuthnError = {
  /**
   * The signature payload is invalid or has incorrect format.
   */
  3110: {message:"SignaturePayloadInvalid"},
  /**
   * The client data exceeds the maximum allowed length.
   */
  3111: {message:"ClientDataTooLong"},
  /**
   * Failed to parse JSON from client data.
   */
  3112: {message:"JsonParseError"},
  /**
   * The type field in client data is not "webauthn.get".
   */
  3113: {message:"TypeFieldInvalid"},
  /**
   * The challenge in client data does not match expected value.
   */
  3114: {message:"ChallengeInvalid"},
  /**
   * The authenticator data format is invalid or too short.
   */
  3115: {message:"AuthDataFormatInvalid"},
  /**
   * The User Present (UP) bit is not set in authenticator flags.
   */
  3116: {message:"PresentBitNotSet"},
  /**
   * The User Verified (UV) bit is not set in authenticator flags.
   */
  3117: {message:"VerifiedBitNotSet"},
  /**
   * Invalid relationship between Backup Eligibility and State bits.
   */
  3118: {message:"BackupEligibilityAndStateNotSet"},
  /**
   * The provided key data does not contain a valid 65-byte public key.
   */
  3119: {message:"KeyDataInvalid"}
}

export interface Client {
  /**
   * Construct and simulate a verify transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Verify a WebAuthn signature against a message and public key.
   * 
   * # Arguments
   * 
   * * `signature_payload` - The message hash that was signed
   * * `key_data` - Bytes containing:
   * - 65-byte secp256r1 public key (uncompressed format)
   * - Variable length credential ID (used on the client side)
   * * `sig_data` - XDR-encoded `WebAuthnSigData` structure containing:
   * - Authenticator data
   * - Client data JSON
   * - Signature components
   * 
   * # Returns
   * 
   * * `true` if the signature is valid
   * * `false` otherwise
   */
  verify: ({signature_payload, key_data, sig_data}: {signature_payload: Buffer, key_data: Buffer, sig_data: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a canonicalize_key transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Canonical identity for a WebAuthn key — the 65-byte SEC1 pubkey,
   * stripped of any trailing credential-ID metadata that varies per
   * browser session but doesn't change the underlying key. Required by
   * OZ v0.7+ for the smart account to detect duplicate signer registrations.
   */
  canonicalize_key: ({key_data}: {key_data: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

  /**
   * Construct and simulate a batch_canonicalize_key transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  batch_canonicalize_key: ({key_data}: {key_data: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Buffer>>>

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
      new ContractSpec([ "AAAAAAAAAdlWZXJpZnkgYSBXZWJBdXRobiBzaWduYXR1cmUgYWdhaW5zdCBhIG1lc3NhZ2UgYW5kIHB1YmxpYyBrZXkuCgojIEFyZ3VtZW50cwoKKiBgc2lnbmF0dXJlX3BheWxvYWRgIC0gVGhlIG1lc3NhZ2UgaGFzaCB0aGF0IHdhcyBzaWduZWQKKiBga2V5X2RhdGFgIC0gQnl0ZXMgY29udGFpbmluZzoKLSA2NS1ieXRlIHNlY3AyNTZyMSBwdWJsaWMga2V5ICh1bmNvbXByZXNzZWQgZm9ybWF0KQotIFZhcmlhYmxlIGxlbmd0aCBjcmVkZW50aWFsIElEICh1c2VkIG9uIHRoZSBjbGllbnQgc2lkZSkKKiBgc2lnX2RhdGFgIC0gWERSLWVuY29kZWQgYFdlYkF1dGhuU2lnRGF0YWAgc3RydWN0dXJlIGNvbnRhaW5pbmc6Ci0gQXV0aGVudGljYXRvciBkYXRhCi0gQ2xpZW50IGRhdGEgSlNPTgotIFNpZ25hdHVyZSBjb21wb25lbnRzCgojIFJldHVybnMKCiogYHRydWVgIGlmIHRoZSBzaWduYXR1cmUgaXMgdmFsaWQKKiBgZmFsc2VgIG90aGVyd2lzZQAAAAAAAAZ2ZXJpZnkAAAAAAAMAAAAAAAAAEXNpZ25hdHVyZV9wYXlsb2FkAAAAAAAADgAAAAAAAAAIa2V5X2RhdGEAAAAOAAAAAAAAAAhzaWdfZGF0YQAAAA4AAAABAAAAAQ==",
        "AAAAAAAAAQ5DYW5vbmljYWwgaWRlbnRpdHkgZm9yIGEgV2ViQXV0aG4ga2V5IOKAlCB0aGUgNjUtYnl0ZSBTRUMxIHB1YmtleSwKc3RyaXBwZWQgb2YgYW55IHRyYWlsaW5nIGNyZWRlbnRpYWwtSUQgbWV0YWRhdGEgdGhhdCB2YXJpZXMgcGVyCmJyb3dzZXIgc2Vzc2lvbiBidXQgZG9lc24ndCBjaGFuZ2UgdGhlIHVuZGVybHlpbmcga2V5LiBSZXF1aXJlZCBieQpPWiB2MC43KyBmb3IgdGhlIHNtYXJ0IGFjY291bnQgdG8gZGV0ZWN0IGR1cGxpY2F0ZSBzaWduZXIgcmVnaXN0cmF0aW9ucy4AAAAAABBjYW5vbmljYWxpemVfa2V5AAAAAQAAAAAAAAAIa2V5X2RhdGEAAAAOAAAAAQAAAA4=",
        "AAAAAAAAAAAAAAAWYmF0Y2hfY2Fub25pY2FsaXplX2tleQAAAAAAAQAAAAAAAAAIa2V5X2RhdGEAAAPqAAAADgAAAAEAAAPqAAAADg==",
        "AAAABAAAADFFcnJvciB0eXBlcyBmb3IgV2ViQXV0aG4gdmVyaWZpY2F0aW9uIG9wZXJhdGlvbnMuAAAAAAAAAAAAAA1XZWJBdXRobkVycm9yAAAAAAAACgAAADlUaGUgc2lnbmF0dXJlIHBheWxvYWQgaXMgaW52YWxpZCBvciBoYXMgaW5jb3JyZWN0IGZvcm1hdC4AAAAAAAAXU2lnbmF0dXJlUGF5bG9hZEludmFsaWQAAAAMJgAAADNUaGUgY2xpZW50IGRhdGEgZXhjZWVkcyB0aGUgbWF4aW11bSBhbGxvd2VkIGxlbmd0aC4AAAAAEUNsaWVudERhdGFUb29Mb25nAAAAAAAMJwAAACZGYWlsZWQgdG8gcGFyc2UgSlNPTiBmcm9tIGNsaWVudCBkYXRhLgAAAAAADkpzb25QYXJzZUVycm9yAAAAAAwoAAAANFRoZSB0eXBlIGZpZWxkIGluIGNsaWVudCBkYXRhIGlzIG5vdCAid2ViYXV0aG4uZ2V0Ii4AAAAQVHlwZUZpZWxkSW52YWxpZAAADCkAAAA7VGhlIGNoYWxsZW5nZSBpbiBjbGllbnQgZGF0YSBkb2VzIG5vdCBtYXRjaCBleHBlY3RlZCB2YWx1ZS4AAAAAEENoYWxsZW5nZUludmFsaWQAAAwqAAAANlRoZSBhdXRoZW50aWNhdG9yIGRhdGEgZm9ybWF0IGlzIGludmFsaWQgb3IgdG9vIHNob3J0LgAAAAAAFUF1dGhEYXRhRm9ybWF0SW52YWxpZAAAAAAADCsAAAA8VGhlIFVzZXIgUHJlc2VudCAoVVApIGJpdCBpcyBub3Qgc2V0IGluIGF1dGhlbnRpY2F0b3IgZmxhZ3MuAAAAEFByZXNlbnRCaXROb3RTZXQAAAwsAAAAPVRoZSBVc2VyIFZlcmlmaWVkIChVVikgYml0IGlzIG5vdCBzZXQgaW4gYXV0aGVudGljYXRvciBmbGFncy4AAAAAAAARVmVyaWZpZWRCaXROb3RTZXQAAAAAAAwtAAAAP0ludmFsaWQgcmVsYXRpb25zaGlwIGJldHdlZW4gQmFja3VwIEVsaWdpYmlsaXR5IGFuZCBTdGF0ZSBiaXRzLgAAAAAfQmFja3VwRWxpZ2liaWxpdHlBbmRTdGF0ZU5vdFNldAAAAAwuAAAAQlRoZSBwcm92aWRlZCBrZXkgZGF0YSBkb2VzIG5vdCBjb250YWluIGEgdmFsaWQgNjUtYnl0ZSBwdWJsaWMga2V5LgAAAAAADktleURhdGFJbnZhbGlkAAAAAAwv" ]),
      options
    )
  }
  public readonly fromJSON = {
    verify: this.txFromJSON<boolean>,
        canonicalize_key: this.txFromJSON<Buffer>,
        batch_canonicalize_key: this.txFromJSON<Array<Buffer>>
  }
}