import type { ArgConstraint, CapConstraint, PolicyDoc, SignerDecl } from './schema.js';
/** Where a permission applies: the account itself, or one contract. */
export type PermissionScope = 'self-admin' | {
    contract: string;
};
/** One requested permission — becomes one rule. Only the `all`-principals shape
 *  is expressible here (every listed signer must authorize); the rarer
 *  self-authenticating rule is authored directly as a PolicyDoc. */
export interface Permission {
    name: string;
    on: PermissionScope;
    /** Signer ids that must all authorize (maps to `principals: all`). */
    by: string[];
    functions?: string[];
    args?: ArgConstraint[];
    /** Ledger sequence at/after which the permission stops (not-after-ledger). */
    until?: number;
    cap?: CapConstraint;
}
/** A 7715-shaped permission request over a set of declared signers. */
export interface PolicyRequest {
    network?: string;
    signers: SignerDecl[];
    permissions: Permission[];
}
/** Lower a request to its canonical PolicyDoc, validating fail-closed. The
 *  returned document canonicalizes (and hashes) identically to the same policy
 *  authored directly or built by the Rust model. */
export declare function requestToPolicyDoc(req: PolicyRequest): PolicyDoc;
//# sourceMappingURL=request.d.ts.map