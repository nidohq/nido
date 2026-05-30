import { Buffer } from "buffer";
import { AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions } from "@stellar/stellar-sdk/contract";
import type { u32, Option } from "@stellar/stellar-sdk/contract";
type Context = unknown;
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
/**
 * Represents different types of signers in the smart account system.
 */
export type Signer = {
    tag: "Delegated";
    values: readonly [string];
} | {
    tag: "External";
    values: readonly [string, Buffer];
};
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
export type ContextRuleType = {
    tag: "Default";
    values: void;
} | {
    tag: "CallContract";
    values: readonly [string];
} | {
    tag: "CreateContract";
    values: readonly [Buffer];
};
/**
 * Error codes for simple threshold policy operations.
 */
export declare const SimpleThresholdError: {
    /**
     * The smart account does not have a simple threshold policy installed.
     */
    3200: {
        message: string;
    };
    /**
     * When threshold is 0 or exceeds the number of available signers.
     */
    3201: {
        message: string;
    };
    /**
     * The transaction is not allowed by this policy.
     */
    3202: {
        message: string;
    };
    /**
     * The context rule for the smart account has been already installed.
     */
    3203: {
        message: string;
    };
};
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
    enforce: ({ context, authenticated_signers, context_rule, smart_account }: {
        context: Context;
        authenticated_signers: Array<Signer>;
        context_rule: ContextRule;
        smart_account: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a install transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    install: ({ install_params, context_rule, smart_account }: {
        install_params: SimpleThresholdAccountParams;
        context_rule: ContextRule;
        smart_account: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a uninstall transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    uninstall: ({ context_rule, smart_account }: {
        context_rule: ContextRule;
        smart_account: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a get_threshold transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Read the installed M-of-N threshold for a given account + rule.
     * Returns 0 if not installed.
     */
    get_threshold: ({ context_rule_id, smart_account }: {
        context_rule_id: u32;
        smart_account: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<u32>>;
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
        enforce: (json: string) => AssembledTransaction<null>;
        install: (json: string) => AssembledTransaction<null>;
        uninstall: (json: string) => AssembledTransaction<null>;
        get_threshold: (json: string) => AssembledTransaction<number>;
    };
}
