/**
 * Scoped documents, one per connected app origin (Perch
 * `docs/recovery/spec.md` §7.6).
 *
 * The admin document (`apply_doc`) holds the account's own rules: its admin
 * keys, its guardian rules, the recovery member, and everything a recovery
 * restores. Each app origin the owner lets in gets one scoped document
 * (`apply_scope(scope, doc)`) holding that app's rules: rules scoped to
 * other contracts only, signed by the app's own keys. Removing the app is
 * `remove_scope(scope)`. A scope's rules are read from `scope(id)` and
 * `scope_doc(id)`, never from `configuration()`, which covers the admin
 * document alone. `apply_scope` advances neither the configuration
 * revision nor the applied `doc_hash`.
 *
 * Scope ids are derived from the origin, so every wallet device and the
 * app itself find an origin's scope from chain state alone. Candidate `i`
 * (0 to 3) of canonical origin `O` is the big-endian `u32` of the first
 * four bytes of `sha256("nido/app-scope/v1" || 0x00 || utf8(O) || 0x00 ||
 * u8(i))`. Every signer of an app's scoped document has the id
 * `<O>#<k8>`, `k8` being the first 8 hex digits of `sha256` of the key's
 * bytes, so the document itself names its origin ({@link scopeOrigin}).
 * `O`'s scope is the first candidate whose document names `O` alone; when
 * there is none, the first candidate with no record. A candidate holding
 * another origin's document is skipped, so a colliding origin can never
 * take over another's scope; it only moves to its next candidate.
 *
 * A second session from the same origin (another device, or a cleared key)
 * joins the origin's scope: each rule it asks for keeps its name, takes the
 * new request's definition, and is signed by any one of the keys that held
 * it and the new key (`threshold` with `m = 1`), so a capped rule keeps one
 * spending record per origin. Rules the new request does not name keep
 * their keys.
 *
 * A scoped document must never name an admin credential: `apply_scope`
 * records every credential it names, and once a recovery completes, any
 * document naming one of them is refused (`WipedCredential`), the admin
 * document included.
 */

import { Buffer } from 'buffer';
import { Client as AccountClient } from '@nidohq/perch-account';
import { Operation, hash, nativeToScVal } from '@stellar/stellar-sdk';
import {
  canonicalJson,
  credentialFingerprint,
  decodeConfiguration,
  docHash,
  parsePolicyDoc,
  parsePolicyDocJson,
  type AccountConfiguration,
  type Credential,
  type PolicyDoc,
  type Rule,
  type SignerDecl,
} from '@stellar-registry/perch';
import { docCapProblem, type FlatDocLimits } from '../policyDoc/caps.js';
import type { TxBuild } from '../policyBlocks/types.js';
import type { AccountArgs } from './account.js';

/** A scope id: Perch's `u32`. */
export type ScopeId = number;

/** How many candidate ids an origin has. */
export const APP_SCOPE_CANDIDATES = 4;

const SCOPE_DOMAIN = 'nido/app-scope/v1';

/** A signer declaration without its document-local id: an app's key. */
export type AppKey = { address: string } | { verifier: string; key: string };

const enc = new TextEncoder();

/** Whether `hostname` is a loopback name an app may be served from over
 *  http: `localhost`, a `*.localhost` subdomain, or `127.0.0.1`. */
function loopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1';
}

/**
 * The WHATWG serialization of `origin`'s origin (lowercase scheme and host,
 * punycode, no default port, no path), the form scope ids and signer ids
 * are derived from. https, or http on a loopback host; anything else throws.
 */
export function canonicalOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`not an origin: ${JSON.stringify(origin)}`);
  }
  if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback(url.hostname))) return url.origin;
  throw new Error(`an app origin is https (or http on localhost), not ${JSON.stringify(origin)}`);
}

/** `origin`'s candidate scope ids, in the order they are tried. */
export function appScopeCandidates(origin: string): ScopeId[] {
  const o = enc.encode(canonicalOrigin(origin));
  const domain = enc.encode(SCOPE_DOMAIN);
  return Array.from({ length: APP_SCOPE_CANDIDATES }, (_, i) => {
    const preimage = Buffer.concat([domain, Buffer.from([0]), o, Buffer.from([0]), Buffer.from([i])]);
    return hash(preimage).readUInt32BE(0);
  });
}

/** The bytes an app key is fingerprinted by in its signer id: a passkey's
 *  public key, or a delegated address's strkey as UTF-8. */
function keyBytes(key: AppKey): Uint8Array {
  return 'address' in key ? enc.encode(key.address) : Buffer.from(key.key, 'hex');
}

/** The id an app key has in its origin's scoped document: `<origin>#<k8>`. */
export function appSignerId(origin: string, key: AppKey): string {
  return `${canonicalOrigin(origin)}#${hash(Buffer.from(keyBytes(key))).toString('hex').slice(0, 8)}`;
}

const SIGNER_ID = /^(.+)#([0-9a-f]{8})$/;

/** The origin a signer id names, or null when it is not an app signer id. */
function signerIdOrigin(id: string): string | null {
  const m = SIGNER_ID.exec(id);
  if (!m) return null;
  try {
    return canonicalOrigin(m[1]!) === m[1] ? m[1]! : null;
  } catch {
    return null;
  }
}

/** The one origin every signer id of `doc` names, or null when they name
 *  none, several, or not all of them are app signer ids. */
export function scopeOrigin(doc: PolicyDoc): string | null {
  const origins = new Set(doc.signers.map((s) => signerIdOrigin(s.id)));
  if (origins.size !== 1) return null;
  return [...origins][0] ?? null;
}

/** A signer declaration's key, without its id. */
export function appKeyOf(decl: SignerDecl): AppKey {
  return 'address' in decl ? { address: decl.address } : { verifier: decl.verifier, key: decl.key.toLowerCase() };
}

/** Whether two keys are the same credential. */
export function sameAppKey(a: AppKey, b: AppKey): boolean {
  if ('address' in a || 'address' in b) return 'address' in a && 'address' in b && a.address === b.address;
  return a.verifier === b.verifier && a.key.toLowerCase() === b.key.toLowerCase();
}

function credentialOf(key: AppKey): Credential {
  return 'address' in key
    ? { kind: 'delegated', address: key.address }
    : { kind: 'external', verifier: key.verifier, key: Buffer.from(key.key, 'hex') };
}

// --- Reads ------------------------------------------------------------------

/** A scope's record as `scope(id)` returns it. */
export interface ScopeRecordView {
  gen: bigint;
  /** Lowercase hex. */
  docHash: string;
  /** Every rule it installed, with its OZ id. Rule names repeat across
   *  scopes, so a rule is selected by `(scope, name)`. */
  rules: { id: number; name: string }[];
}

/** The account's scope views. {@link scopeReader} reads them from the
 *  chain; tests inject their own. */
export interface ScopeReader {
  scopeGeneration(): Promise<bigint>;
  scopeCount(): Promise<number>;
  scopes(start: number, count: number): Promise<ScopeId[]>;
  scope(id: ScopeId): Promise<ScopeRecordView | null>;
  /** The scoped document's canonical JSON. */
  scopeDoc(id: ScopeId): Promise<string | null>;
  credentialGeneration(fingerprint: Uint8Array): Promise<bigint | null>;
  isRevoked(fingerprint: Uint8Array): Promise<boolean>;
  /** The admin document's `configuration()`. */
  configuration(): Promise<AccountConfiguration>;
}

/** {@link ScopeReader} over the account's views. `allowHttp` for a local
 *  network's plain-http RPC. */
export function scopeReader(args: AccountArgs & { allowHttp?: boolean }): ScopeReader {
  const c = new AccountClient({
    contractId: args.account,
    networkPassphrase: args.networkPassphrase,
    rpcUrl: args.rpcUrl,
    ...(args.allowHttp ? { allowHttp: true } : {}),
  });
  return {
    async scopeGeneration() {
      return BigInt((await c.scope_generation()).result);
    },
    async scopeCount() {
      return Number((await c.scope_count()).result);
    },
    async scopes(start, count) {
      return (await c.scopes({ start, count })).result.map(Number);
    },
    async scope(id) {
      const r = (await c.scope({ scope: id })).result;
      if (r === undefined || r === null) return null;
      return {
        gen: BigInt(r.gen),
        docHash: Buffer.from(r.doc_hash).toString('hex'),
        rules: r.rules.map((x) => ({ id: Number(x.id), name: x.name })),
      };
    },
    async scopeDoc(id) {
      const d = (await c.scope_doc({ scope: id })).result;
      return d === undefined || d === null ? null : Buffer.from(d).toString('utf8');
    },
    async credentialGeneration(fingerprint) {
      const g = (await c.credential_generation({ fingerprint: Buffer.from(fingerprint) })).result;
      return g === undefined || g === null ? null : BigInt(g);
    },
    async isRevoked(fingerprint) {
      return (await c.is_revoked({ fingerprint: Buffer.from(fingerprint) })).result;
    },
    async configuration() {
      return decodeConfiguration((await c.configuration()).result as unknown as Record<string, unknown>);
    },
  };
}

/** One scoped document as applied. */
export interface ScopeView {
  id: ScopeId;
  gen: bigint;
  /** `gen` is the account's scope generation: no completed recovery has
   *  wiped it since it was applied. */
  live: boolean;
  docHash: string;
  /** Null when its bytes could not be read or parsed. */
  doc: PolicyDoc | null;
  /** The app origin its signer ids name ({@link scopeOrigin}). */
  origin: string | null;
  rules: { id: number; name: string }[];
}

/** Scope `id` as applied, or null when it has no record. */
export async function readScope(r: ScopeReader, id: ScopeId, generation?: bigint): Promise<ScopeView | null> {
  const [record, json, gen] = await Promise.all([
    r.scope(id),
    r.scopeDoc(id),
    generation === undefined ? r.scopeGeneration() : Promise.resolve(generation),
  ]);
  if (record === null) return null;
  let doc: PolicyDoc | null = null;
  try {
    doc = json === null ? null : parsePolicyDocJson(json);
  } catch {
    doc = null;
  }
  return {
    id,
    gen: record.gen,
    live: record.gen === gen,
    docHash: record.docHash,
    doc,
    origin: doc === null ? null : scopeOrigin(doc),
    rules: record.rules,
  };
}

const PAGE = 32;

/**
 * Every scope the account holds, wiped ones included, with the scope
 * generation they were read against. `scopes(start, count)` swap-removes,
 * so the listing is read again whenever `scope_count` moved during it.
 */
export async function readScopes(r: ScopeReader): Promise<{ generation: bigint; scopes: ScopeView[] }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [generation, count] = await Promise.all([r.scopeGeneration(), r.scopeCount()]);
    const ids: ScopeId[] = [];
    for (let start = 0; start < count; start += PAGE) ids.push(...(await r.scopes(start, PAGE)));
    if ((await r.scopeCount()) !== count) continue;
    const views = await Promise.all(ids.map((id) => readScope(r, id, generation)));
    return { generation, scopes: views.filter((v): v is ScopeView => v !== null) };
  }
  throw new Error('the account’s scopes kept changing while they were read; try again');
}

/** Every candidate of the origin holds another origin's document. */
export class AppScopesTaken extends Error {
  constructor(readonly origin: string) {
    super(
      `Every scope id ${origin} could use already holds another app's permissions on this account. ` +
        'Remove one of the apps listed on your Policy page first.',
    );
    this.name = 'AppScopesTaken';
  }
}

/**
 * `origin`'s scope: the first candidate whose document names `origin`
 * alone (its view, live or wiped), else the first candidate with no record
 * (`view` null). Throws {@link AppScopesTaken} when every candidate holds
 * another origin's document.
 */
export async function findAppScope(
  r: ScopeReader,
  origin: string,
): Promise<{ id: ScopeId; view: ScopeView | null }> {
  const o = canonicalOrigin(origin);
  const generation = await r.scopeGeneration();
  let free: ScopeId | undefined;
  for (const id of appScopeCandidates(o)) {
    const view = await readScope(r, id, generation);
    if (view === null) {
      free ??= id;
      continue;
    }
    if (view.origin === o) return { id, view };
  }
  if (free !== undefined) return { id: free, view: null };
  throw new AppScopesTaken(o);
}

/** Whether `key` may be named in a scoped document now: it is not revoked,
 *  and no scope wiped by a completed recovery named it. */
export async function credentialUsable(r: ScopeReader, key: AppKey): Promise<boolean> {
  const fp = credentialFingerprint(credentialOf(key));
  const [revoked, named, generation] = await Promise.all([
    r.isRevoked(fp),
    r.credentialGeneration(fp),
    r.scopeGeneration(),
  ]);
  return !revoked && (named === null || named >= generation);
}

// --- Documents --------------------------------------------------------------

/** What a scoped document is checked against. */
export interface ScopedDocContext {
  /** The account itself. */
  account: string;
  /** Its recovery controller, ZK adapter and pool: Perch's excluded set. */
  excluded: readonly string[];
  /** Every key the admin document names. */
  adminKeys: readonly AppKey[];
  /** The app origin the document is for. */
  origin: string;
}

/**
 * Why `doc` cannot be `origin`'s scoped document, or undefined. Mirrors the
 * account's `check_scoped` (no `recovery` member; every rule scoped to a
 * contract that is neither the account nor in the excluded set), and adds
 * Nido's own two: no admin credential, and every signer id names `origin`.
 */
export function scopedDocProblem(doc: PolicyDoc, ctx: ScopedDocContext): string | undefined {
  if (doc.recovery !== undefined) return 'An app’s permissions cannot carry a recovery configuration.';
  for (const rule of doc.rules) {
    if (rule.scope.type !== 'contract') {
      return `The rule "${rule.name}" would act on your account itself, which no app may do.`;
    }
    if (rule.scope.address === ctx.account) {
      return `The rule "${rule.name}" targets your own account, which would give the app full control of it.`;
    }
    if (ctx.excluded.includes(rule.scope.address)) {
      return `The rule "${rule.name}" targets your account's recovery, which no app may reach.`;
    }
  }
  const o = canonicalOrigin(ctx.origin);
  for (const s of doc.signers) {
    if (ctx.adminKeys.some((k) => sameAppKey(k, appKeyOf(s)))) {
      return 'An app’s permissions cannot name one of your own admin keys.';
    }
    if (signerIdOrigin(s.id) !== o) return `The key "${s.id}" is not one of ${o}'s keys.`;
  }
  return undefined;
}

/** A rule an app asks for, without its signers. */
export type AppRuleTemplate = Omit<Rule, 'principals'>;

function signerIds(rule: Rule): string[] {
  return rule.principals.type === 'self-authenticating' ? [] : [...rule.principals.signers];
}

/** One signer alone, or any one of several. */
function principalsOf(ids: readonly string[]): Rule['principals'] {
  return ids.length === 1 ? { type: 'all', signers: [...ids] } : { type: 'threshold', m: 1, signers: [...ids] };
}

/** Drop declarations no rule names, and validate through the schema. */
function rebuild(doc: PolicyDoc, signers: readonly SignerDecl[], rules: readonly Rule[]): PolicyDoc {
  const referenced = new Set(rules.flatMap(signerIds));
  return parsePolicyDoc({ ...doc, signers: signers.filter((s) => referenced.has(s.id)), rules });
}

/**
 * `origin`'s scoped document after it grants `key` the `rules` asked for,
 * built on `base` (its applied document, or null for a new or wiped scope).
 * A rule of the same name takes the new definition and is signed by any one
 * of the keys that already held it and `key`; other rules keep their keys.
 * Throws when two rules share a name.
 */
export function upsertAppRules(
  base: PolicyDoc | null,
  origin: string,
  key: AppKey,
  rules: readonly AppRuleTemplate[],
  network: string,
): PolicyDoc {
  const names = rules.map((r) => r.name);
  const repeated = names.find((n, i) => names.indexOf(n) !== i);
  if (repeated !== undefined) throw new Error(`two grants name the rule "${repeated}"`);
  if (base?.network !== undefined && base.network !== network) {
    throw new Error(`the app's scoped document is bound to "${base.network}", not "${network}"`);
  }
  const doc: PolicyDoc = base ?? { version: 1, network, signers: [], rules: [] };
  const id = appSignerId(origin, key);
  const known = doc.signers.find((s) => sameAppKey(appKeyOf(s), key));
  const signerId = known?.id ?? id;
  const signers = known ? [...doc.signers] : [...doc.signers, { id, ...key } as SignerDecl];
  let next = [...doc.rules];
  for (const template of rules) {
    const held = next.find((r) => r.name === template.name);
    const ids = held ? signerIds(held).filter((s) => s !== signerId) : [];
    const rule = { ...template, principals: principalsOf([...ids, signerId]) } as Rule;
    next = held ? next.map((r) => (r === held ? rule : r)) : [...next, rule];
  }
  return rebuild({ ...doc, network }, signers, next);
}

/**
 * `doc` without the key `signerId`: it leaves every rule's signers, a rule
 * it alone signed goes, and so does its declaration. Null when no rule is
 * left (remove the scope instead).
 */
export function withoutAppKey(doc: PolicyDoc, signerId: string): PolicyDoc | null {
  const rules = doc.rules.flatMap((r): Rule[] => {
    const ids = signerIds(r);
    if (!ids.includes(signerId)) return [r];
    const left = ids.filter((s) => s !== signerId);
    return left.length === 0 ? [] : [{ ...r, principals: principalsOf(left) }];
  });
  return rules.length === 0 ? null : rebuild(doc, doc.signers, rules);
}

// --- Transactions -----------------------------------------------------------

export interface ScopeTxArgs {
  /** The smart account. */
  account: string;
  networkPassphrase: string;
}

function invoke(account: string, fn: string, args: Parameters<typeof Operation.invokeContractFunction>[0]['args']) {
  return Operation.invokeContractFunction({ contract: account, function: fn, args });
}

const u32 = (n: ScopeId) => {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) throw new Error(`not a scope id: ${n}`);
  return nativeToScVal(n, { type: 'u32' });
};

/**
 * `apply_scope(scope, canonicalJson(doc))`. With `limits`, an over-limit
 * document is refused here, with the reason; with `scoped`, so is one the
 * account would refuse ({@link scopedDocProblem}).
 */
export function buildApplyScopeTx(
  scope: ScopeId,
  doc: PolicyDoc,
  args: ScopeTxArgs & { limits?: FlatDocLimits; scoped?: ScopedDocContext },
): TxBuild & { docHash: string; canonicalJson: string } {
  if (doc.network !== args.networkPassphrase) {
    throw new Error(`the scoped document is bound to "${doc.network}", not "${args.networkPassphrase}"`);
  }
  const tooLarge = args.limits === undefined ? undefined : docCapProblem(doc, args.limits);
  if (tooLarge !== undefined) throw new Error(tooLarge);
  const problem = args.scoped === undefined ? undefined : scopedDocProblem(doc, args.scoped);
  if (problem !== undefined) throw new Error(problem);
  const canonical = canonicalJson(doc);
  const op = invoke(args.account, 'apply_scope', [u32(scope), nativeToScVal(Buffer.from(canonical, 'utf8'))]);
  return {
    docHash: docHash(doc),
    canonicalJson: canonical,
    operations: [op],
    description: `Apply scope ${scope} (${doc.rules.length} rule${doc.rules.length === 1 ? '' : 's'})`,
  };
}

/** `remove_scope(scope)`: the owner revokes every rule of the scope. */
export function buildRemoveScopeTx(scope: ScopeId, args: ScopeTxArgs): TxBuild {
  return { operations: [invoke(args.account, 'remove_scope', [u32(scope)])], description: `Remove scope ${scope}` };
}

/** `gc_scope(scope)`: anyone removes a scope a completed recovery wiped. */
export function buildGcScopeTx(scope: ScopeId, args: ScopeTxArgs): TxBuild {
  return { operations: [invoke(args.account, 'gc_scope', [u32(scope)])], description: `Clean up scope ${scope}` };
}

// --- The app's side ---------------------------------------------------------

/**
 * The rule an app signs a call on `contract` through, for its key on this
 * account: in its origin's live scope first (by name from `scope(id)`), then
 * in the admin document (a rule from before the app's permissions moved to
 * its scope). Null when neither holds one, or the origin's scope was wiped
 * by a recovery: the app must then ask again with a new key.
 */
export async function findAppRule(
  r: ScopeReader,
  a: { origin: string; key: AppKey; contract: string },
): Promise<{ scope: ScopeId | null; ruleId: number; ruleName: string } | null> {
  let found: { id: ScopeId; view: ScopeView | null } | null;
  try {
    found = await findAppScope(r, a.origin);
  } catch (e) {
    if (!(e instanceof AppScopesTaken)) throw e;
    found = null;
  }
  const view = found?.view;
  if (view?.live && view.doc !== null) {
    const signer = view.doc.signers.find((s) => sameAppKey(appKeyOf(s), a.key));
    const rule =
      signer &&
      view.doc.rules.find(
        (x) => x.scope.type === 'contract' && x.scope.address === a.contract && signerIds(x).includes(signer.id),
      );
    const installed = rule && view.rules.find((x) => x.name === rule.name);
    if (installed) return { scope: view.id, ruleId: installed.id, ruleName: installed.name };
  }
  const config = await r.configuration();
  const admin = config.rules.find(
    (x) =>
      !x.recovery &&
      x.contract === a.contract &&
      x.signers.some((s) =>
        sameAppKey(s.kind === 'delegated' ? { address: s.address } : { verifier: s.verifier, key: Buffer.from(s.key).toString('hex') }, a.key),
      ),
  );
  return admin ? { scope: null, ruleId: admin.id, ruleName: admin.name } : null;
}
