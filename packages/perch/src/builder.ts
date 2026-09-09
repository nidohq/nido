// Fluent builder producing a validated PolicyDoc — the TS mirror of the README
// example. It assembles the wire (kebab-case) shape and runs it through the
// fail-closed schema on build(), so an invalid document throws at construction
// rather than at submit time.

import { bytesToHex } from '@noble/hashes/utils.js';
import {
  ACK_SENTINEL,
  parsePolicyDoc,
  type ArgPred,
  type PolicyDoc,
  type Rule,
  type SignerDecl,
} from './schema.js';

/** How a signer authenticates, keyed into the doc by a local id. */
export type SignerSpec =
  | {
      kind: 'external';
      verifier: string;
      /** hex-encoded key material. */
      keyHex: string;
    }
  | {
      kind: 'delegated';
      /** G… account or C… contract strkey, host-authenticated via CAP-0071. */
      address: string;
    };

/** Build an external signer spec; `key` may be raw bytes or an existing hex string. */
export function external(verifier: string, key: Uint8Array | string): SignerSpec {
  return { kind: 'external', verifier, keyHex: typeof key === 'string' ? key : bytesToHex(key) };
}

/** Build a delegated signer spec (CAP-0071): the address authorizes the same
 *  call tree inside the account's own auth entry. */
export function delegated(address: string): SignerSpec {
  return { kind: 'delegated', address };
}

// Argument-predicate constructors (wire shape).
export const isSelf = (): ArgPred => ({ type: 'is-self' });
export const addressEq = (address: string): ArgPred => ({ type: 'address-eq', address });
export const stringIn = (values: string[]): ArgPred => ({ type: 'string-in', values });
export const stringPrefix = (prefix: string): ArgPred => ({ type: 'string-prefix', prefix });
export const u32Eq = (value: number): ArgPred => ({ type: 'u32-eq', value });

export class RuleBuilder {
  private _scope: Rule['scope'] | null = null;
  private _principals: Rule['principals'] | null = null;
  private _functions?: string[];
  private _args?: Rule['args'];
  private _notAfterLedger?: number;

  constructor(private readonly name: string) {}

  selfAdmin(): this {
    this._scope = { type: 'self-admin' };
    return this;
  }
  callContract(address: string): this {
    this._scope = { type: 'contract', address };
    return this;
  }
  signedBy(...signerIds: string[]): this {
    this._principals = { type: 'all', signers: signerIds };
    return this;
  }
  selfAuthenticating(policy: string, installParamHex = '', ack: string = ACK_SENTINEL): this {
    this._principals = { type: 'self-authenticating', policy, 'install-param-hex': installParamHex, ack };
    return this;
  }
  func(...names: string[]): this {
    this._functions = names;
    return this;
  }
  arg(index: number, pred: ArgPred): this {
    (this._args ??= []).push({ index, pred });
    return this;
  }
  notAfter(ledger: number): this {
    this._notAfterLedger = ledger;
    return this;
  }

  /** @internal */
  toWire(): Rule {
    if (!this._scope) throw new Error(`rule "${this.name}": scope not set (call selfAdmin/callContract)`);
    if (!this._principals) throw new Error(`rule "${this.name}": principals not set (call signedBy/selfAuthenticating)`);
    const r: Record<string, unknown> = {
      name: this.name,
      scope: this._scope,
      principals: this._principals,
    };
    if (this._functions !== undefined) r.functions = this._functions;
    if (this._args !== undefined) r.args = this._args;
    if (this._notAfterLedger !== undefined) r['not-after-ledger'] = this._notAfterLedger;
    return r as Rule;
  }
}

export class PolicyBuilder {
  private _network?: string;
  private readonly _signers: SignerDecl[] = [];
  private readonly _rules: RuleBuilder[] = [];

  network(name: string): this {
    this._network = name;
    return this;
  }
  signer(id: string, spec: SignerSpec): this {
    this._signers.push(
      spec.kind === 'external'
        ? { id, verifier: spec.verifier, key: spec.keyHex }
        : { id, address: spec.address },
    );
    return this;
  }
  rule(name: string, build: (r: RuleBuilder) => void): this {
    const rb = new RuleBuilder(name);
    build(rb);
    this._rules.push(rb);
    return this;
  }

  /** Assemble and validate the document (throws on any schema violation). */
  build(): PolicyDoc {
    const doc: Record<string, unknown> = {
      version: 1,
      signers: this._signers,
      rules: this._rules.map((r) => r.toWire()),
    };
    if (this._network !== undefined) doc.network = this._network;
    return parsePolicyDoc(doc);
  }
}

/** Start a new policy document. */
export function policy(): PolicyBuilder {
  return new PolicyBuilder();
}
