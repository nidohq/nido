// Fluent builder producing a validated PolicyDoc — the TS mirror of the README
// example. It assembles the wire (kebab-case) shape and runs it through the
// fail-closed schema on build(), so an invalid document throws at construction
// rather than at submit time.
import { bytesToHex } from '@noble/hashes/utils.js';
import { ACK_SENTINEL, parsePolicyDoc, } from './schema.js';
/** Build an external signer spec; `key` may be raw bytes or an existing hex string. */
export function external(verifier, key) {
    return { kind: 'external', verifier, keyHex: typeof key === 'string' ? key : bytesToHex(key) };
}
/** Build a delegated signer spec (CAP-0071): the address authorizes the same
 *  call tree inside the account's own auth entry. */
export function delegated(address) {
    return { kind: 'delegated', address };
}
// Argument-predicate constructors (wire shape).
export const isSelf = () => ({ type: 'is-self' });
export const addressEq = (address) => ({ type: 'address-eq', address });
export const stringIn = (values) => ({ type: 'string-in', values });
export const stringPrefix = (prefix) => ({ type: 'string-prefix', prefix });
export const u32Eq = (value) => ({ type: 'u32-eq', value });
export class RuleBuilder {
    name;
    _scope = null;
    _principals = null;
    _functions;
    _args;
    _notAfterLedger;
    constructor(name) {
        this.name = name;
    }
    selfAdmin() {
        this._scope = { type: 'self-admin' };
        return this;
    }
    callContract(address) {
        this._scope = { type: 'contract', address };
        return this;
    }
    signedBy(...signerIds) {
        this._principals = { type: 'all', signers: signerIds };
        return this;
    }
    selfAuthenticating(policy, installParamHex = '', ack = ACK_SENTINEL) {
        this._principals = { type: 'self-authenticating', policy, 'install-param-hex': installParamHex, ack };
        return this;
    }
    func(...names) {
        this._functions = names;
        return this;
    }
    arg(index, pred) {
        (this._args ??= []).push({ index, pred });
        return this;
    }
    notAfter(ledger) {
        this._notAfterLedger = ledger;
        return this;
    }
    /** @internal */
    toWire() {
        if (!this._scope)
            throw new Error(`rule "${this.name}": scope not set (call selfAdmin/callContract)`);
        if (!this._principals)
            throw new Error(`rule "${this.name}": principals not set (call signedBy/selfAuthenticating)`);
        const r = {
            name: this.name,
            scope: this._scope,
            principals: this._principals,
        };
        if (this._functions !== undefined)
            r.functions = this._functions;
        if (this._args !== undefined)
            r.args = this._args;
        if (this._notAfterLedger !== undefined)
            r['not-after-ledger'] = this._notAfterLedger;
        return r;
    }
}
export class PolicyBuilder {
    _network;
    _signers = [];
    _rules = [];
    network(name) {
        this._network = name;
        return this;
    }
    signer(id, spec) {
        this._signers.push(spec.kind === 'external'
            ? { id, verifier: spec.verifier, key: spec.keyHex }
            : { id, address: spec.address });
        return this;
    }
    rule(name, build) {
        const rb = new RuleBuilder(name);
        build(rb);
        this._rules.push(rb);
        return this;
    }
    /** Assemble and validate the document (throws on any schema violation). */
    build() {
        const doc = {
            version: 1,
            signers: this._signers,
            rules: this._rules.map((r) => r.toWire()),
        };
        if (this._network !== undefined)
            doc.network = this._network;
        return parsePolicyDoc(doc);
    }
}
/** Start a new policy document. */
export function policy() {
    return new PolicyBuilder();
}
//# sourceMappingURL=builder.js.map