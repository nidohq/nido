// Connected apps on the account's scoped documents: one scope per app
// origin (SDK `perch/scopes.ts` says how the id is derived and how a second
// key joins). An app approval never reads or writes the admin document,
// with one exception: rules an app's key holds there from before its
// permissions moved to its scope. Those move on the app's next approval
// with the same key (`planAppGrant`): the scope is applied first, then the
// admin document without them, so the app keeps working after each of the
// two transactions; between them its rules exist twice, both allowing the
// same calls. The rest are listed as older app permissions with a Remove.
//
// Pure: the pages read the chain (`appGrantLoad.ts`) and sign.

import { canonicalJson, perch, type PolicyDoc } from '@nidohq/passkey-sdk';
import type { OperationDescriptor } from '../signing/signRequest.js';
import { diffPolicyDocs } from './docDiff.js';
import { MAX_DOC_GRANTS } from './docRequest.js';
import { appKeyOfSigner, upsertAppGrants, withoutRules, type SessionDocDraft, type SessionSignerDraft } from './docDraft.js';

type Rule = PolicyDoc['rules'][number];
type Signer = PolicyDoc['signers'][number];

function principalIds(rule: Rule): string[] {
  return rule.principals.type === 'self-authenticating' ? [] : rule.principals.signers;
}

/**
 * The contracts no app rule may reach, beyond the account itself (Perch's
 * excluded set): the recovery controller the account adopted, the one its
 * document names, and its ZK factor's adapter and pool.
 */
export function excludedSet(args: {
  recoveryController: string | null;
  adminDoc: PolicyDoc | null;
  deploymentController?: string | null;
}): string[] {
  const out = new Set<string>();
  if (args.recoveryController) out.add(args.recoveryController);
  if (args.deploymentController) out.add(args.deploymentController);
  const recovery = args.adminDoc?.recovery;
  if (recovery !== undefined) {
    out.add(recovery.controller);
    const mode = recovery.mode as { adapter?: string; pool?: string };
    if (mode.adapter) out.add(mode.adapter);
    if (mode.pool) out.add(mode.pool);
  }
  return [...out];
}

/** The ids of the admin document's signers that hold a self-admin rule. */
function adminSignerIds(doc: PolicyDoc): Set<string> {
  return new Set(doc.rules.filter((r) => r.scope.type === 'self-admin').flatMap(principalIds));
}

/** Every key the admin document's self-admin rules name, plus `extra` (the
 *  constructor's passkey on an account with no document yet). An app's
 *  scope may name none of them. */
export function adminKeys(doc: PolicyDoc | null, extra: readonly perch.AppKey[] = []): perch.AppKey[] {
  const ids = doc ? adminSignerIds(doc) : new Set<string>();
  return [...(doc?.signers.filter((s) => ids.has(s.id)).map(perch.appKeyOf) ?? []), ...extra];
}

/**
 * The admin document's app rules from before app permissions had scopes: a
 * rule scoped to a contract that is not on the excluded set, signed only by
 * keys that hold no self-admin rule. A guardian rule (on the recovery
 * controller, signed by the admin) is not one, and neither is any rule an
 * admin key signs.
 */
export function olderAppRules(doc: PolicyDoc, excluded: readonly string[]): Rule[] {
  const admins = adminSignerIds(doc);
  return doc.rules.filter(
    (r) =>
      r.scope.type === 'contract' &&
      !excluded.includes(r.scope.address) &&
      principalIds(r).length > 0 &&
      principalIds(r).every((id) => !admins.has(id)),
  );
}

/** The older app rules `key` alone signs: what that key's next approval
 *  moves into its origin's scope. */
export function rulesToMove(doc: PolicyDoc, excluded: readonly string[], key: perch.AppKey): Rule[] {
  const byId = new Map<string, Signer>(doc.signers.map((s) => [s.id, s]));
  return olderAppRules(doc, excluded).filter((r) =>
    principalIds(r).every((id) => {
      const s = byId.get(id);
      return s !== undefined && perch.sameAppKey(perch.appKeyOf(s), key);
    }),
  );
}

/** What an app approval is built from (`appGrantLoad.ts` reads it). */
export interface AppGrantContext {
  account: string;
  /** The request's origin, canonical. */
  origin: string;
  network: string;
  /** The applied admin document and its revision; null before the first
   *  `apply_doc`. */
  admin: { doc: PolicyDoc; revision: bigint } | null;
  excluded: string[];
  adminKeys: perch.AppKey[];
  /** The origin's scope (`findAppScope`). */
  scope: { id: number; view: perch.ScopeView | null };
}

export type ApplyScopeDescriptor = Extract<OperationDescriptor, { type: 'apply-scope' }>;

export interface AppGrantPlan {
  operation: ApplyScopeDescriptor;
  /** The scope's document after the approval. */
  doc: PolicyDoc;
  /** The scope's live document before it; null for a new or wiped scope. */
  base: PolicyDoc | null;
  /** Rules moving out of the admin document, by name. */
  moved: string[];
  /** The admin document after the move; null when nothing moves. */
  adminAfter: PolicyDoc | null;
}

/**
 * The one way an app approval becomes a signable operation: the origin's
 * scoped document with the drafts upserted (after any older rules of the
 * same key move in, so a new grant wins a name they share), and, when rules
 * move, the admin document without them as the second step. Throws when the
 * scope is live but its document cannot be read (an update would drop its
 * rules), or when the result is not a document the origin's scope may hold.
 *
 * Precondition: `validateSessionDocDraft(draft, limits, account, excluded).ok`
 * for each draft, distinct draft names, every draft naming `signer`.
 */
export function planAppGrant(
  ctx: AppGrantContext,
  signer: SessionSignerDraft,
  drafts: readonly SessionDocDraft[],
  expiryLabel: string,
): AppGrantPlan {
  const view = ctx.scope.view;
  if (view?.live && view.doc === null) {
    throw new Error("This app's current permissions could not be read, so an update cannot be built safely. Try again.");
  }
  const base = view?.live ? view.doc : null;
  const key = appKeyOfSigner(signer);
  const moving = ctx.admin ? rulesToMove(ctx.admin.doc, ctx.excluded, key) : [];
  const withMoved =
    moving.length === 0
      ? base
      : perch.upsertAppRules(
          base,
          ctx.origin,
          key,
          moving.map(({ principals: _, ...rule }) => rule),
          ctx.network,
        );
  const doc = upsertAppGrants(withMoved, ctx.origin, signer, drafts, ctx.network);
  const problem = perch.scopedDocProblem(doc, {
    account: ctx.account,
    excluded: ctx.excluded,
    adminKeys: ctx.adminKeys,
    origin: ctx.origin,
  });
  if (problem !== undefined) throw new Error(problem);
  const moved = moving.map((r) => r.name);
  const adminAfter = ctx.admin && moved.length > 0 ? withoutRules(ctx.admin.doc, moved, ctx.network) : null;
  return {
    doc,
    base,
    moved,
    adminAfter,
    operation: {
      type: 'apply-scope',
      scope: ctx.scope.id,
      origin: ctx.origin,
      docJson: canonicalJson(doc),
      ...(base !== null ? { prevDocJson: canonicalJson(base) } : {}),
      prevDocHash: view?.docHash ?? null,
      expiryLabel,
      ...(ctx.admin && adminAfter
        ? {
            adminFollowUp: {
              docJson: canonicalJson(adminAfter),
              prevDocJson: canonicalJson(ctx.admin.doc),
              expectedRevision: ctx.admin.revision.toString(),
              moved,
            },
          }
        : {}),
    },
  };
}

/** A new app's scope before its first approval: no keys, no rules. The
 *  "before" side of the diff an approval shows, so each rule reads as
 *  added. */
export function emptyScope(network: string): PolicyDoc {
  return { version: 1, network, signers: [], rules: [] };
}

/** A rule an app approval grants, with the keys that may sign it. */
export interface ScopeGrant {
  rule: Rule;
  signers: Signer[];
}

export type ScopeReview =
  | { ok: true; grants: ScopeGrant[]; moved: string[] }
  | { ok: false; reason: string };

/**
 * What an `apply-scope` approval grants, relative to the scope's applied
 * document (null for a new scope), for /sign/'s review: the rules it adds
 * or changes, in document order. An approval only adds access, for one key,
 * through its origin's signer ids; anything else is refused. `moved` names
 * the rules it moves in from the admin document, which are not counted
 * against MAX_DOC_GRANTS.
 */
export function reviewScopeGrant(
  prev: PolicyDoc | null,
  next: PolicyDoc,
  origin: string,
  moved: readonly string[] = [],
): ScopeReview {
  const diff = diffPolicyDocs(prev, next);
  if (diff.identical) return { ok: false, reason: 'This access is already in place; there is nothing new to approve.' };
  if (diff.rulesRemoved.length > 0) {
    return { ok: false, reason: `This request would remove the rule "${diff.rulesRemoved[0]!.name}". An app grant only adds access.` };
  }
  if (perch.scopeOrigin(next) !== perch.canonicalOrigin(origin)) {
    return { ok: false, reason: `These permissions are not ${origin}'s.` };
  }
  const changed = new Set([...diff.rulesAdded, ...diff.rulesModified.map((m) => m.after)].map((r) => r.name));
  const rules = next.rules.filter((r) => changed.has(r.name));
  if (rules.filter((r) => !moved.includes(r.name)).length > MAX_DOC_GRANTS) {
    return { ok: false, reason: `This request would grant more than ${MAX_DOC_GRANTS} rules at once.` };
  }
  const grants = rules.map((rule) => ({
    rule,
    signers: principalIds(rule).flatMap((id) => next.signers.filter((s) => s.id === id)),
  }));
  const shared = grants.reduce<Set<string> | null>((acc, g) => {
    const ids = new Set(g.signers.map((s) => s.id));
    return acc === null ? ids : new Set([...acc].filter((id) => ids.has(id)));
  }, null);
  if (shared === null || shared.size === 0) {
    return { ok: false, reason: 'These rules are for different keys. An app request grants access to one key.' };
  }
  return { ok: true, grants, moved: [...moved] };
}

/** An app on the account, as the policy view and the security page list it. */
export interface AppEntry {
  scope: number;
  origin: string | null;
  live: boolean;
  docHash: string;
  doc: PolicyDoc | null;
  /** Each key with the rules it may sign. */
  keys: { id: string; key: perch.AppKey; rules: string[] }[];
}

/** The account's apps, from its scopes. */
export function appEntries(scopes: readonly perch.ScopeView[]): AppEntry[] {
  return scopes.map((s) => ({
    scope: s.id,
    origin: s.origin,
    live: s.live,
    docHash: s.docHash,
    doc: s.doc,
    keys:
      s.doc?.signers.map((sg) => ({
        id: sg.id,
        key: perch.appKeyOf(sg),
        rules: s.doc!.rules.filter((r) => principalIds(r).includes(sg.id)).map((r) => r.name),
      })) ?? [],
  }));
}

/** An app permission still in the admin document, and the origin whose
 *  live scope already holds it for the same key (null: none does, so the
 *  app is unknown). */
export interface OlderAppPermission {
  rule: Rule;
  movedTo: string | null;
}

/** The admin document's older app rules ({@link olderAppRules}), each
 *  with the app it already moved to, if a move left this copy behind. */
export function olderAppPermissions(
  doc: PolicyDoc,
  excluded: readonly string[],
  scopes: readonly perch.ScopeView[],
): OlderAppPermission[] {
  const keyOf = (d: PolicyDoc, id: string) => {
    const s = d.signers.find((x) => x.id === id);
    return s === undefined ? null : perch.appKeyOf(s);
  };
  return olderAppRules(doc, excluded).map((rule) => {
    const keys = principalIds(rule).map((id) => keyOf(doc, id));
    const home = scopes.find(
      (s) =>
        s.live &&
        s.doc !== null &&
        s.doc.rules.some(
          (r) =>
            r.name === rule.name &&
            keys.every((k) => k !== null && principalIds(r).some((id) => {
              const sk = keyOf(s.doc!, id);
              return sk !== null && perch.sameAppKey(sk, k);
            })),
        ),
    );
    return { rule, movedTo: home?.origin ?? null };
  });
}
