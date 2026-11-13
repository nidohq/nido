import { describe, expect, it } from 'vitest';
import { Networks, StrKey } from '@stellar/stellar-sdk';
import { buildPolicyDoc, canonicalJson, docHash, parsePolicyDocJson, perch, type PolicyDoc } from '@nidohq/passkey-sdk';
import {
  appEntries,
  excludedSet,
  olderAppPermissions,
  olderAppRules,
  planAppGrant,
  reviewScopeGrant,
  rulesToMove,
  type AppGrantContext,
} from './appScopes.js';
import { removeAppRequest, removeKeyRequest } from './appActions.js';
import { upsertSessionRule, validateSessionDocDraft, type SessionDocDraft } from './docDraft.js';
import { MAX_DOC_GRANTS } from './docRequest.js';

const NET = Networks.TESTNET;
const contract = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));
const ACCOUNT = contract(1);
const VERIFIER = contract(2);
const GAME = contract(3);
const XLM = contract(4);
const ORIGIN = 'https://game.example';
const OWNER_KEY = '04' + 'ab'.repeat(64);
const APP_KEY = '04' + 'cd'.repeat(64);
const OTHER_KEY = '04' + 'ef'.repeat(64);
const CONTROLLER = perch.TESTNET.recoveryController;
const G2 = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const LIMITS = { maxSigners: 8, maxRules: 10, maxCanonicalBytes: 8192, maxRuleNameBytes: 20 };

const passkey = (publicKeyHex: string) => ({ kind: 'passkey' as const, verifier: VERIFIER, publicKeyHex });
const appKey = (key: string) => ({ verifier: VERIFIER, key });

function draft(overrides: Partial<SessionDocDraft> = {}): SessionDocDraft {
  return {
    name: 'guess',
    signer: passkey(APP_KEY),
    targetContract: GAME,
    functionsInput: 'guess',
    notAfterLedger: 900,
    cap: null,
    ...overrides,
  };
}

/** The admin document of an account enrolled in guardian recovery, with a
 *  guardian rule (the admin's, on the recovery controller) and `older`
 *  app rules from before apps had scopes. */
function adminDoc(older: SessionDocDraft[] = []): PolicyDoc {
  let doc = perch.withRecovery(
    buildPolicyDoc({
      network: NET,
      signers: [{ id: 'admin', kind: 'passkey', verifier: VERIFIER, publicKey: OWNER_KEY }],
      permissions: [
        { name: 'admin', on: 'self-admin', by: ['admin'] },
        { name: 'guardian', on: { contract: CONTROLLER }, by: ['admin'] },
      ],
    }),
    perch.recoverySpec(perch.TESTNET, { profile: 'loss', mode: 'guardian-only', guardians: [G2], quorum: 1, replaceable: ['admin'] }),
  );
  for (const d of older) doc = upsertSessionRule(doc, d, NET).doc;
  return doc;
}

function ctx(overrides: Partial<AppGrantContext> = {}): AppGrantContext {
  return {
    account: ACCOUNT,
    origin: ORIGIN,
    network: NET,
    admin: null,
    excluded: [CONTROLLER],
    adminKeys: [appKey(OWNER_KEY)],
    scope: { id: perch.appScopeCandidates(ORIGIN)[0]!, view: null },
    ...overrides,
  };
}

/** The origin's live scope as `findAppScope` returns it. */
function liveScope(doc: PolicyDoc, live = true): AppGrantContext['scope'] {
  const id = perch.appScopeCandidates(ORIGIN)[0]!;
  return {
    id,
    view: {
      id,
      gen: live ? 0n : 0n,
      live,
      docHash: docHash(doc),
      doc,
      origin: perch.scopeOrigin(doc),
      rules: doc.rules.map((r, i) => ({ id: 40 + i, name: r.name })),
    },
  };
}

describe('excludedSet', () => {
  it('holds the adopted controller, the one the document names, and a ZK factor’s adapter and pool', () => {
    const doc = adminDoc();
    expect(excludedSet({ recoveryController: contract(7), adminDoc: doc })).toEqual([contract(7), CONTROLLER]);
    const zk = { ...doc, recovery: { ...doc.recovery!, mode: { type: 'zk-only', adapter: contract(8), pool: contract(9) } } };
    expect(excludedSet({ recoveryController: null, adminDoc: zk as PolicyDoc })).toEqual([CONTROLLER, contract(8), contract(9)]);
  });
});

describe('older app rules in the admin document', () => {
  const doc = adminDoc([draft(), draft({ name: 'other-app', signer: passkey(OTHER_KEY), targetContract: XLM })]);

  it('are contract-scoped rules signed only by non-admin keys, off the excluded set', () => {
    expect(olderAppRules(doc, [CONTROLLER]).map((r) => r.name)).toEqual(['guess', 'other-app']);
  });

  it('never include the guardian rule, a rule an admin key signs, or one on the excluded set', () => {
    const adminSigned = upsertSessionRule(adminDoc(), draft({ name: 'mine', signer: passkey(OWNER_KEY) }), NET).doc;
    expect(olderAppRules(adminSigned, [CONTROLLER])).toEqual([]);
    expect(olderAppRules(doc, [CONTROLLER, GAME]).map((r) => r.name)).toEqual(['other-app']);
  });

  it('move only with the key that alone signs them', () => {
    expect(rulesToMove(doc, [CONTROLLER], appKey(APP_KEY)).map((r) => r.name)).toEqual(['guess']);
    expect(rulesToMove(doc, [CONTROLLER], appKey('04' + '99'.repeat(64)))).toEqual([]);
  });
});

describe('planAppGrant', () => {
  it('builds a new scope: an apply-scope request, never touching the admin document', () => {
    const plan = planAppGrant(ctx({ admin: { doc: adminDoc(), revision: 4n } }), passkey(APP_KEY), [draft()], '24 hours');
    expect(plan.operation).toMatchObject({
      type: 'apply-scope',
      scope: perch.appScopeCandidates(ORIGIN)[0],
      origin: ORIGIN,
      prevDocHash: null,
      expiryLabel: '24 hours',
    });
    expect(plan.operation.prevDocJson).toBeUndefined();
    expect(plan.operation.adminFollowUp).toBeUndefined();
    const doc = parsePolicyDocJson(plan.operation.docJson);
    expect(doc.signers).toEqual([{ id: perch.appSignerId(ORIGIN, appKey(APP_KEY)), ...appKey(APP_KEY) }]);
    expect(doc.rules.map((r) => r.name)).toEqual(['guess']);
  });

  it('updates a live scope: the same key re-delegating replaces its rule', () => {
    const first = planAppGrant(ctx(), passkey(APP_KEY), [draft()], '24 hours').doc;
    const plan = planAppGrant(ctx({ scope: liveScope(first) }), passkey(APP_KEY), [draft({ notAfterLedger: 1900 })], '24 hours');
    expect(plan.operation.prevDocJson).toBe(canonicalJson(first));
    expect(plan.operation.prevDocHash).toBe(docHash(first));
    expect(plan.doc.rules).toHaveLength(1);
    expect(plan.doc.rules[0]!['not-after-ledger']).toBe(1900);
  });

  it('a second key from the same origin joins its scope', () => {
    const first = planAppGrant(ctx(), passkey(APP_KEY), [draft()], '24 hours').doc;
    const plan = planAppGrant(ctx({ scope: liveScope(first) }), passkey(OTHER_KEY), [draft({ signer: passkey(OTHER_KEY) })], '7 days');
    expect(plan.doc.signers.map((s) => s.id)).toEqual([
      perch.appSignerId(ORIGIN, appKey(APP_KEY)),
      perch.appSignerId(ORIGIN, appKey(OTHER_KEY)),
    ]);
    expect(plan.doc.rules[0]!.principals).toMatchObject({ type: 'threshold', m: 1 });
  });

  it('applies over a wiped scope as a new one', () => {
    const first = planAppGrant(ctx(), passkey(APP_KEY), [draft()], '24 hours').doc;
    const plan = planAppGrant(ctx({ scope: liveScope(first, false) }), passkey(OTHER_KEY), [draft({ signer: passkey(OTHER_KEY) })], '24 hours');
    expect(plan.base).toBeNull();
    expect(plan.operation.prevDocHash).toBe(docHash(first));
    expect(plan.doc.signers.map((s) => s.id)).toEqual([perch.appSignerId(ORIGIN, appKey(OTHER_KEY))]);
  });

  it('moves this key’s older rules: the scope first, then the admin document without them', () => {
    const old = adminDoc([
      draft({ name: 'guess', notAfterLedger: 500 }),
      draft({ name: 'stake', targetContract: XLM, functionsInput: 'transfer', cap: { stroops: '100', periodLedgers: 17280 } }),
      draft({ name: 'other-app', signer: passkey(OTHER_KEY) }),
    ]);
    const plan = planAppGrant(ctx({ admin: { doc: old, revision: 7n } }), passkey(APP_KEY), [draft()], '24 hours');
    expect(plan.moved).toEqual(['guess', 'stake']);
    // The new grant wins the name it shares with a moved rule.
    expect(plan.doc.rules.map((r) => [r.name, r['not-after-ledger']])).toEqual([
      ['guess', 900],
      ['stake', 900],
    ]);
    const follow = plan.operation.adminFollowUp!;
    expect(follow.moved).toEqual(['guess', 'stake']);
    expect(follow.expectedRevision).toBe('7');
    expect(follow.prevDocJson).toBe(canonicalJson(old));
    const after = parsePolicyDocJson(follow.docJson);
    expect(after.rules.map((r) => r.name)).toEqual(['admin', 'guardian', 'other-app']);
    expect(after.recovery).toEqual(old.recovery);
    expect(perch.scopedDocProblem(plan.doc, { account: ACCOUNT, excluded: [CONTROLLER], adminKeys: [appKey(OWNER_KEY)], origin: ORIGIN })).toBeUndefined();
  });

  it('refuses a scope that names an admin key', () => {
    expect(() => planAppGrant(ctx(), passkey(OWNER_KEY), [draft({ signer: passkey(OWNER_KEY) })], '24 hours')).toThrow(/admin keys/);
  });

  it('refuses to build over a live scope it could not read', () => {
    const first = planAppGrant(ctx(), passkey(APP_KEY), [draft()], '24 hours').doc;
    const unread = liveScope(first);
    unread.view!.doc = null;
    expect(() => planAppGrant(ctx({ scope: unread }), passkey(APP_KEY), [draft()], '24 hours')).toThrow(/could not be read/);
  });
});

describe('the three wallet bugs scopes close', () => {
  it('an app request labelled "guardian" lands in its own scope; the guardian rule stays the admin’s', () => {
    const admin = adminDoc();
    const plan = planAppGrant(ctx({ admin: { doc: admin, revision: 2n } }), passkey(APP_KEY), [draft({ name: 'guardian' })], '24 hours');
    expect(plan.operation.type).toBe('apply-scope');
    expect(plan.operation.adminFollowUp).toBeUndefined();
    expect(plan.doc.rules.map((r) => [r.name, r.scope])).toEqual([['guardian', { type: 'contract', address: GAME }]]);
    // And the admin document's own merge refuses to replace it, too.
    expect(() => upsertSessionRule(admin, draft({ name: 'guardian' }), NET)).toThrow(/core account rule named "guardian"/);
  });

  it('an app grant on the recovery controller is refused before anything is signed', () => {
    const onController = draft({ targetContract: CONTROLLER });
    expect(validateSessionDocDraft(onController, LIMITS, ACCOUNT, [CONTROLLER]).errors.join(' ')).toMatch(/your account's recovery/);
    expect(() => planAppGrant(ctx(), passkey(APP_KEY), [onController], '24 hours')).toThrow(/recovery/);
  });

  it('removing an app is a remove-scope request, not the per-rule removal the account no longer has', () => {
    const doc = planAppGrant(ctx(), passkey(APP_KEY), [draft()], '24 hours').doc;
    const [app] = appEntries([liveScope(doc).view!]);
    const req = removeAppRequest(ACCOUNT, app!, '/security/');
    expect(req.operation).toEqual({ type: 'remove-scope', scope: app!.scope, origin: ORIGIN });
    expect(req.returnTarget).toEqual({ type: 'route', url: '/security/' });
  });
});

describe('removeKeyRequest', () => {
  const first = planAppGrant(ctx(), passkey(APP_KEY), [draft()], '24 hours').doc;
  const joined = planAppGrant(ctx({ scope: liveScope(first) }), passkey(OTHER_KEY), [draft({ signer: passkey(OTHER_KEY) })], '24 hours').doc;

  it('applies the scope without the key while another key is left', () => {
    const [app] = appEntries([liveScope(joined).view!]);
    const id = perch.appSignerId(ORIGIN, appKey(APP_KEY));
    const req = removeKeyRequest(ACCOUNT, app!, id, '/account/policy/');
    expect(req.operation).toMatchObject({ type: 'apply-scope', removesKey: id, prevDocHash: docHash(joined) });
    const after = parsePolicyDocJson((req.operation as { docJson: string }).docJson);
    expect(after.signers.map((s) => s.id)).toEqual([perch.appSignerId(ORIGIN, appKey(OTHER_KEY))]);
  });

  it('removes the app when the key was its last', () => {
    const [app] = appEntries([liveScope(first).view!]);
    const req = removeKeyRequest(ACCOUNT, app!, perch.appSignerId(ORIGIN, appKey(APP_KEY)), '/account/policy/');
    expect(req.operation.type).toBe('remove-scope');
  });
});

describe('reviewScopeGrant', () => {
  const first = planAppGrant(ctx(), passkey(APP_KEY), [draft(), draft({ name: 'stake', targetContract: XLM })], '24 hours').doc;

  it('lists the rules an approval adds or changes', () => {
    const review = reviewScopeGrant(null, first, ORIGIN);
    expect(review.ok && review.grants.map((g) => g.rule.name)).toEqual(['guess', 'stake']);
  });

  it('refuses a removal, another origin’s keys, and nothing new', () => {
    const fewer = { ...first, rules: [first.rules[0]!] };
    expect(reviewScopeGrant(first, fewer, ORIGIN)).toMatchObject({ ok: false, reason: expect.stringMatching(/remove the rule "stake"/) });
    expect(reviewScopeGrant(null, first, 'https://other.example')).toMatchObject({ ok: false });
    expect(reviewScopeGrant(first, first, ORIGIN)).toMatchObject({ ok: false, reason: expect.stringMatching(/already in place/) });
  });

  it('refuses more grants than a request carries, counting moved rules apart', () => {
    const drafts = Array.from({ length: MAX_DOC_GRANTS + 1 }, (_, i) => draft({ name: `g${i}` }));
    const big = planAppGrant(ctx(), passkey(APP_KEY), drafts, '24 hours').doc;
    expect(reviewScopeGrant(null, big, ORIGIN).ok).toBe(false);
    expect(reviewScopeGrant(null, big, ORIGIN, ['g0']).ok).toBe(true);
  });
});

describe('olderAppPermissions', () => {
  it('names the app a move left a copy for; the rest are unknown', () => {
    const old = adminDoc([draft(), draft({ name: 'other-app', signer: passkey(OTHER_KEY) })]);
    const scope = planAppGrant(ctx(), passkey(APP_KEY), [draft()], '24 hours').doc;
    expect(
      olderAppPermissions(old, [CONTROLLER], [liveScope(scope).view!]).map((p) => [p.rule.name, p.movedTo]),
    ).toEqual([
      ['guess', ORIGIN],
      ['other-app', null],
    ]);
  });
});

describe('appEntries', () => {
  it('lists each app with its keys and the rules each may sign', () => {
    const doc = planAppGrant(ctx(), passkey(APP_KEY), [draft(), draft({ name: 'stake', targetContract: XLM })], '24 hours').doc;
    expect(appEntries([liveScope(doc).view!])).toEqual([
      {
        scope: perch.appScopeCandidates(ORIGIN)[0],
        origin: ORIGIN,
        live: true,
        docHash: docHash(doc),
        doc,
        keys: [{ id: perch.appSignerId(ORIGIN, appKey(APP_KEY)), key: appKey(APP_KEY), rules: ['guess', 'stake'] }],
      },
    ]);
  });
});
