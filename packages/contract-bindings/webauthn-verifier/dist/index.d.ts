import { Buffer } from "buffer";
import { AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
/**
 * Error types for WebAuthn verification operations.
 */
export declare const WebAuthnError: {
    /**
     * The signature payload is invalid or has incorrect format.
     */
    3110: {
        message: string;
    };
    /**
     * The client data exceeds the maximum allowed length.
     */
    3111: {
        message: string;
    };
    /**
     * Failed to parse JSON from client data.
     */
    3112: {
        message: string;
    };
    /**
     * The type field in client data is not "webauthn.get".
     */
    3113: {
        message: string;
    };
    /**
     * The challenge in client data does not match expected value.
     */
    3114: {
        message: string;
    };
    /**
     * The authenticator data format is invalid or too short.
     */
    3115: {
        message: string;
    };
    /**
     * The User Present (UP) bit is not set in authenticator flags.
     */
    3116: {
        message: string;
    };
    /**
     * The User Verified (UV) bit is not set in authenticator flags.
     */
    3117: {
        message: string;
    };
    /**
     * Invalid relationship between Backup Eligibility and State bits.
     */
    3118: {
        message: string;
    };
    /**
     * The provided key data does not contain a valid 65-byte public key.
     */
    3119: {
        message: string;
    };
};
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
    verify: ({ signature_payload, key_data, sig_data }: {
        signature_payload: Buffer;
        key_data: Buffer;
        sig_data: Buffer;
    }, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>;
    /**
     * Construct and simulate a canonicalize_key transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Canonical identity for a WebAuthn key — the 65-byte SEC1 pubkey,
     * stripped of any trailing credential-ID metadata that varies per
     * browser session but doesn't change the underlying key. Required by
     * OZ v0.7+ for the smart account to detect duplicate signer registrations.
     */
    canonicalize_key: ({ key_data }: {
        key_data: Buffer;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>;
    /**
     * Construct and simulate a batch_canonicalize_key transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    batch_canonicalize_key: ({ key_data }: {
        key_data: Array<Buffer>;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Array<Buffer>>>;
}
export declare class Client extends ContractClient {
    readonly options: ContractClientOptions;
    static deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions & Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
    }): Promise<AssembledTransaction<T>>;
    constructor(options: ContractClientOptions);
    readonly fromJSON: {
        verify: (json: string) => AssembledTransaction<boolean>;
        canonicalize_key: (json: string) => AssembledTransaction<Buffer>;
        batch_canonicalize_key: (json: string) => AssembledTransaction<Buffer[]>;
    };
}
