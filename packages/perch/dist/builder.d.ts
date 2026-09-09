import { type ArgPred, type PolicyDoc, type Rule } from './schema.js';
/** How a signer authenticates, keyed into the doc by a local id. */
export type SignerSpec = {
    kind: 'external';
    verifier: string;
    /** hex-encoded key material. */
    keyHex: string;
} | {
    kind: 'delegated';
    /** G… account or C… contract strkey, host-authenticated via CAP-0071. */
    address: string;
};
/** Build an external signer spec; `key` may be raw bytes or an existing hex string. */
export declare function external(verifier: string, key: Uint8Array | string): SignerSpec;
/** Build a delegated signer spec (CAP-0071): the address authorizes the same
 *  call tree inside the account's own auth entry. */
export declare function delegated(address: string): SignerSpec;
export declare const isSelf: () => ArgPred;
export declare const addressEq: (address: string) => ArgPred;
export declare const stringIn: (values: string[]) => ArgPred;
export declare const stringPrefix: (prefix: string) => ArgPred;
export declare const u32Eq: (value: number) => ArgPred;
export declare class RuleBuilder {
    private readonly name;
    private _scope;
    private _principals;
    private _functions?;
    private _args?;
    private _notAfterLedger?;
    constructor(name: string);
    selfAdmin(): this;
    callContract(address: string): this;
    signedBy(...signerIds: string[]): this;
    selfAuthenticating(policy: string, installParamHex?: string, ack?: string): this;
    func(...names: string[]): this;
    arg(index: number, pred: ArgPred): this;
    notAfter(ledger: number): this;
    /** @internal */
    toWire(): Rule;
}
export declare class PolicyBuilder {
    private _network?;
    private readonly _signers;
    private readonly _rules;
    network(name: string): this;
    signer(id: string, spec: SignerSpec): this;
    rule(name: string, build: (r: RuleBuilder) => void): this;
    /** Assemble and validate the document (throws on any schema violation). */
    build(): PolicyDoc;
}
/** Start a new policy document. */
export declare function policy(): PolicyBuilder;
//# sourceMappingURL=builder.d.ts.map