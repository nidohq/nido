import { Buffer } from "buffer";
import { AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions } from "@stellar/stellar-sdk/contract";
import type { u32, Option } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
/**
 * Error codes for smart account operations.
 */
export declare const SmartAccountError: {
    /**
     * The specified context rule does not exist.
     */
    3000: {
        message: string;
    };
    /**
     * The provided context cannot be validated against any rule.
     */
    3002: {
        message: string;
    };
    /**
     * External signature verification failed.
     */
    3003: {
        message: string;
    };
    /**
     * Context rule must have at least one signer or policy.
     */
    3004: {
        message: string;
    };
    /**
     * The valid_until timestamp is in the past.
     */
    3005: {
        message: string;
    };
    /**
     * The specified signer was not found.
     */
    3006: {
        message: string;
    };
    /**
     * The signer already exists in the context rule.
     */
    3007: {
        message: string;
    };
    /**
     * The specified policy was not found.
     */
    3008: {
        message: string;
    };
    /**
     * The policy already exists in the context rule.
     */
    3009: {
        message: string;
    };
    /**
     * Too many signers in the context rule.
     */
    3010: {
        message: string;
    };
    /**
     * Too many policies in the context rule.
     */
    3011: {
        message: string;
    };
    /**
     * An internal ID counter (context rule, signer, or policy) has reached
     * its maximum value (`u32::MAX`) and cannot be incremented further.
     */
    3012: {
        message: string;
    };
    /**
     * External signer key data exceeds the maximum allowed size.
     */
    3013: {
        message: string;
    };
    /**
     * context_rule_ids length does not match auth_contexts length.
     */
    3014: {
        message: string;
    };
    /**
     * Context rule name exceeds the maximum allowed length.
     */
    3015: {
        message: string;
    };
    /**
     * A signer in `AuthPayload` is not part of any selected context rule.
     */
    3016: {
        message: string;
    };
};
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
 * The authorization payload passed to `__check_auth`, bundling cryptographic
 * proofs with context rule selection.
 *
 * This struct carries two distinct pieces of information that are both
 * required for authorization but cannot be derived from each other:
 *
 * - `signers` maps each [`Signer`] to its raw signature bytes, providing
 * cryptographic proof that the signer actually signed the transaction
 * payload. A context rule stores which signer *identities* are authorized
 * (via `signer_ids`), but the rule does not contain the signatures
 * themselves — those must be supplied here.
 *
 * - `context_rule_ids` tells the system which rule to validate for each auth
 * context. Because multiple rules can exist for the same context type, the
 * caller must explicitly select one per context rather than relying on
 * auto-discovery. Each entry is aligned by index with the `auth_contexts`
 * passed to `__check_auth`.
 *
 * The length of `context_rule_ids` must equal the number of auth contexts;
 * a mismatch is rejected with
 * [`SmartAccountError::ContextRuleIdsLen
 */
export interface AuthPayload {
    /**
   * Per-context rule IDs, aligned by index with `auth_contexts`.
   */
    context_rule_ids: Array<u32>;
    /**
   * Signature data mapped to each signer.
   */
    signers: Map<Signer, Buffer>;
}
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
export interface Client {
    /**
     * Construct and simulate a execute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    execute: ({ target, target_fn, target_args }: {
        target: string;
        target_fn: string;
        target_args: Array<any>;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a add_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    add_policy: ({ context_rule_id, policy, install_param }: {
        context_rule_id: u32;
        policy: string;
        install_param: any;
    }, options?: MethodOptions) => Promise<AssembledTransaction<u32>>;
    /**
     * Construct and simulate a add_signer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    add_signer: ({ context_rule_id, signer }: {
        context_rule_id: u32;
        signer: Signer;
    }, options?: MethodOptions) => Promise<AssembledTransaction<u32>>;
    /**
     * Construct and simulate a remove_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    remove_policy: ({ context_rule_id, policy_id }: {
        context_rule_id: u32;
        policy_id: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a remove_signer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    remove_signer: ({ context_rule_id, signer_id }: {
        context_rule_id: u32;
        signer_id: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a add_context_rule transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    add_context_rule: ({ context_type, name, valid_until, signers, policies }: {
        context_type: ContextRuleType;
        name: string;
        valid_until: Option<u32>;
        signers: Array<Signer>;
        policies: Map<string, any>;
    }, options?: MethodOptions) => Promise<AssembledTransaction<ContextRule>>;
    /**
     * Construct and simulate a get_context_rule transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_context_rule: ({ context_rule_id }: {
        context_rule_id: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<ContextRule>>;
    /**
     * Construct and simulate a remove_context_rule transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    remove_context_rule: ({ context_rule_id }: {
        context_rule_id: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a add_multisig_recovery transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Install a social-recovery rule scoped to calls on this account, gated
     * by an M-of-N multisig policy.
     *
     * Typed wrapper around `add_context_rule` that constructs the policies
     * map for the caller — the SDK doesn't need to wrestle with the
     * `Map<Address, Val>` install-param encoding (the generated TS bindings
     * would otherwise erase the install param to `any`).
     *
     * The rule is scoped to `CallContract(self)` so it authorises calls
     * against the account's own methods (e.g. `add_signer`, `remove_signer`,
     * `add_context_rule`) — not external transfers.
     *
     * # Arguments
     *
     * * `name` - Human-readable rule name.
     * * `valid_until` - Optional expiration ledger sequence.
     * * `friends` - The signers authorised by the recovery rule.
     * * `multisig_policy` - Address of the deployed multisig policy contract.
     * * `threshold` - Number of `friends` signatures required (M).
     */
    add_multisig_recovery: ({ name, valid_until, friends, multisig_policy, threshold }: {
        name: string;
        valid_until: Option<u32>;
        friends: Array<Signer>;
        multisig_policy: string;
        threshold: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<ContextRule>>;
    /**
     * Construct and simulate a get_context_rules_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_context_rules_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>;
    /**
     * Construct and simulate a update_context_rule_name transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    update_context_rule_name: ({ context_rule_id, name }: {
        context_rule_id: u32;
        name: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<ContextRule>>;
    /**
     * Construct and simulate a update_context_rule_valid_until transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    update_context_rule_valid_until: ({ context_rule_id, valid_until }: {
        context_rule_id: u32;
        valid_until: Option<u32>;
    }, options?: MethodOptions) => Promise<AssembledTransaction<ContextRule>>;
}
export declare class Client extends ContractClient {
    readonly options: ContractClientOptions;
    static deploy<T = Client>(
    /** Constructor/Initialization Args for the contract's `__constructor` method */
    { signers, policies }: {
        signers: Array<Signer>;
        policies: Map<string, any>;
    }, 
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
        execute: (json: string) => AssembledTransaction<null>;
        add_policy: (json: string) => AssembledTransaction<number>;
        add_signer: (json: string) => AssembledTransaction<number>;
        remove_policy: (json: string) => AssembledTransaction<null>;
        remove_signer: (json: string) => AssembledTransaction<null>;
        add_context_rule: (json: string) => AssembledTransaction<ContextRule>;
        get_context_rule: (json: string) => AssembledTransaction<ContextRule>;
        remove_context_rule: (json: string) => AssembledTransaction<null>;
        add_multisig_recovery: (json: string) => AssembledTransaction<ContextRule>;
        get_context_rules_count: (json: string) => AssembledTransaction<number>;
        update_context_rule_name: (json: string) => AssembledTransaction<ContextRule>;
        update_context_rule_valid_until: (json: string) => AssembledTransaction<ContextRule>;
    };
}
