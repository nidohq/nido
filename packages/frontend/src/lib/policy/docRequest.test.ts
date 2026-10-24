import { describe, it, expect } from 'vitest';
import {
  MAX_DOC_GRANTS,
  buildSessionGrantOperation,
  describeSessionScope,
  limitNoneHonoured,
  parseDocDelegateParams,
  sessionSignerDraft,
} from './docRequest.js';

const TARGET = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';
const SIGNER = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

function params(overrides: Record<string, string | null> = {}): URLSearchParams {
  const base: Record<string, string> = {
    origin: 'https://dapp.example',
    target: TARGET,
    signer: SIGNER,
    functions: 'udpate_message',
    duration: '24h',
    label: 'status-note-session',
    return: 'https://dapp.example/page?x=1',
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v !== null) p.set(k, v);
  }
  return p;
}

describe('parseDocDelegateParams', () => {
  it('parses a complete request', () => {
    const r = parseDocDelegateParams(params());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.req).toEqual({
      origin: 'https://dapp.example',
      signer: { kind: 'delegated', address: SIGNER },
      duration: '24h',
      grants: [{ target: TARGET, functions: ['udpate_message'], label: 'status-note-session', cap: null }],
      returnUrl: 'https://dapp.example/page?x=1',
    });
  });

  it('defaults an absent duration to 30d and label to "session"', () => {
    const r = parseDocDelegateParams(params({ duration: null, label: null }));
    expect(r.ok && r.req.duration).toBe('30d');
    expect(r.ok && r.req.grants[0]!.label).toBe('session');
  });

  it.each(['24h', '7d', '30d', 'none'])('accepts duration %s', (duration) => {
    const r = parseDocDelegateParams(params({ duration }));
    expect(r.ok && r.req.duration).toBe(duration);
  });

  it.each(['', 'bogus', '24H', ' 24h', 'toString', '__proto__'])(
    'rejects a present invalid duration %j',
    (duration) => {
      const r = parseDocDelegateParams(params({ duration }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('Invalid duration');
    },
  );

  it('treats absent functions as any-function', () => {
    const r = parseDocDelegateParams(params({ functions: null }));
    expect(r.ok && r.req.grants[0]!.functions).toBeUndefined();
  });

  it('requests no cap only when limit and limit_period are both absent', () => {
    const r = parseDocDelegateParams(params());
    expect(r.ok && r.req.grants[0]!.cap).toBeNull();
  });

  it.each([
    ['2.5', 'week', { stroops: '25000000', period: 'week' }],
    ['0.0000001', 'day', { stroops: '1', period: 'day' }],
    ['5', '30d', { stroops: '50000000', period: '30d' }],
    ['9999999', null, { stroops: '99999990000000', period: 'day' }],
  ] as const)('parses limit %j / limit_period %j', (limit, limit_period, cap) => {
    const r = parseDocDelegateParams(params({ limit, limit_period }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.req.grants[0]!.cap).toEqual(cap);
  });

  it.each([
    ['empty', '', 'Invalid limit amount'],
    ['malformed', 'lots', 'Invalid limit amount'],
    ['malformed (exponent)', '1e3', 'Invalid limit amount'],
    ['malformed (two points)', '1.2.3', 'Invalid limit amount'],
    ['zero', '0', 'greater than zero'],
    ['zero with decimals', '0.0000000', 'greater than zero'],
    ['negative', '-1', 'Invalid limit amount'],
    ['too precise', '1.00000001', 'Invalid limit amount'],
    ['over the maximum', '10000000', 'at most'],
    ['overflowing', '170141183460469231731687303715884105728', 'at most'],
  ])('rejects a %s limit (never an uncapped request)', (_case, limit, msg) => {
    const r = parseDocDelegateParams(params({ limit, limit_period: 'day' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(msg);
  });

  it.each(['', 'month', 'Day', 'toString'])(
    'rejects a present invalid limit_period %j',
    (limit_period) => {
      const r = parseDocDelegateParams(params({ limit: '1', limit_period }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('Invalid limit_period');
    },
  );

  it('rejects a limit_period without a limit', () => {
    const r = parseDocDelegateParams(params({ limit_period: 'week' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('without a limit');
  });

  it('takes limit=none as the app declaring the rule uncapped', () => {
    const r = parseDocDelegateParams(params({ limit: 'none' }));
    expect(r.ok && r.req.grants[0]!.cap).toBe('none');
  });

  describe('limitNoneHonoured', () => {
    const grantOf = (overrides: Record<string, string | null>) => {
      const r = parseDocDelegateParams(params({ limit: 'none', ...overrides }));
      if (!r.ok) throw new Error(r.error);
      return r.req.grants[0]!;
    };

    it('honours limit=none on a rule limited to calls that move no tokens', () => {
      expect(limitNoneHonoured(grantOf({ functions: 'guess' }))).toBe(true);
      expect(limitNoneHonoured(grantOf({ functions: 'guess,reveal' }))).toBe(true);
    });

    it.each(['transfer', 'approve', 'transfer_from', 'burn', 'clawback', 'guess,transfer', 'approve,guess'])(
      'does not honour limit=none on functions %j (token-moving)',
      (functions) => {
        expect(limitNoneHonoured(grantOf({ functions }))).toBe(false);
      },
    );

    it('does not honour limit=none on a rule allowing any function', () => {
      const grant = grantOf({ functions: null });
      expect(grant.functions).toBeUndefined();
      expect(limitNoneHonoured(grant)).toBe(false);
    });

    it('is false for a grant without limit=none', () => {
      expect(limitNoneHonoured(grantOf({ functions: 'guess', limit: null }))).toBe(false);
      expect(limitNoneHonoured(grantOf({ functions: 'guess', limit: '1' }))).toBe(false);
    });
  });

  it.each(['None', 'NONE', ' none'])('rejects %j as a limit (only the exact marker is none)', (limit) => {
    const r = parseDocDelegateParams(params({ limit }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Invalid limit amount');
  });

  it('rejects limit=none with a limit_period', () => {
    const r = parseDocDelegateParams(params({ limit: 'none', limit_period: 'day' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('with limit=none');
  });

  it.each([
    ['origin', 'Missing origin'],
    ['target', 'Invalid target'],
    ['signer', 'Invalid session signer'],
    ['return', 'Missing return'],
  ] as const)('rejects a missing/invalid %s', (key, msg) => {
    const r = parseDocDelegateParams(params({ [key]: key === 'origin' || key === 'return' ? null : 'nope' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain(msg);
  });

  it('rejects a javascript: / data: origin (opaque-origin callback guard)', () => {
    const js = parseDocDelegateParams(params({ origin: 'javascript:alert(1)', return: 'javascript:alert(1)' }));
    expect(js.ok).toBe(false);
    if (!js.ok) expect(js.error).toContain('Malformed origin');
    const data = parseDocDelegateParams(params({ origin: 'data:text/html,x', return: 'data:text/html,x' }));
    expect(data.ok).toBe(false);
  });

  it('rejects a javascript: return URL even with a valid origin', () => {
    const r = parseDocDelegateParams(params({ return: 'javascript:alert(document.cookie)' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Return URL origin');
  });

  it('rejects a cross-origin return URL', () => {
    const r = parseDocDelegateParams(params({ return: 'https://evil.example/cb' }));
    expect(r.ok).toBe(false);
  });
});

const PUBKEY = '04' + 'Ab'.repeat(64);
const XLM = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

describe('parseDocDelegateParams — passkey signer (pubkey=)', () => {
  it('accepts pubkey= in place of signer=, lowercased', () => {
    const r = parseDocDelegateParams(params({ signer: null, pubkey: PUBKEY }));
    expect(r.ok && r.req.signer).toEqual({ kind: 'passkey', publicKeyHex: PUBKEY.toLowerCase() });
  });

  it('rejects signer= and pubkey= together', () => {
    const r = parseDocDelegateParams(params({ pubkey: PUBKEY }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('not both');
  });

  it('rejects a request naming no signer', () => {
    const r = parseDocDelegateParams(params({ signer: null }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Invalid session signer');
  });

  it.each([
    ['compressed', '02' + 'ab'.repeat(32)],
    ['short', '04' + 'ab'.repeat(63)],
    ['long', '04' + 'ab'.repeat(65)],
    ['non-hex', '04' + 'zz'.repeat(64)],
    ['0x-prefixed', '0x04' + 'ab'.repeat(64)],
    ['empty', ''],
  ])('rejects a %s public key', (_case, pubkey) => {
    const r = parseDocDelegateParams(params({ signer: null, pubkey }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Invalid session public key');
    // The message describes the format the check accepts: a bare 04 prefix.
    if (!r.ok) expect(r.error).toContain('starting 04, with no 0x');
  });

  // Perch's compiler refuses a WebAuthn key with a credential id appended
  // (KeyNotCanonicalizable), so the request never carries one.
  it.each([
    ['with pubkey=', { signer: null, pubkey: PUBKEY, credential_id: 'q83vEjRW' }],
    ['with signer=', { credential_id: 'q83vEjRW' }],
    ['even empty', { signer: null, pubkey: PUBKEY, credential_id: '' }],
  ] as const)('rejects a credential_id %s', (_case, overrides) => {
    const r = parseDocDelegateParams(params(overrides as Record<string, string | null>));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('credential_id is not part of the request');
  });
});

/** A two-grant request: the Guess the Number game's `guess` (call-only)
 *  and the XLM transfer that moves the stake (capped). */
function multi(overrides: Record<string, string | null> = {}): URLSearchParams {
  const base: Record<string, string> = {
    origin: 'https://game.example',
    return: 'https://game.example/play',
    pubkey: PUBKEY,
    duration: '24h',
    'grant.0.label': 'guess',
    'grant.0.target': TARGET,
    'grant.0.functions': 'guess',
    'grant.0.limit': 'none',
    'grant.1.label': 'guess-xlm',
    'grant.1.target': XLM,
    'grant.1.functions': 'transfer',
    'grant.1.limit': '2',
    'grant.1.limit_period': 'day',
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v !== null) p.set(k, v);
  }
  return p;
}

describe('parseDocDelegateParams — several grants (grant.<i>.*)', () => {
  it('parses every grant, in index order, for one signer and one duration', () => {
    const r = parseDocDelegateParams(multi());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.req).toEqual({
      origin: 'https://game.example',
      signer: { kind: 'passkey', publicKeyHex: PUBKEY.toLowerCase() },
      duration: '24h',
      grants: [
        { label: 'guess', target: TARGET, functions: ['guess'], cap: 'none' },
        { label: 'guess-xlm', target: XLM, functions: ['transfer'], cap: { stroops: '20000000', period: 'day' } },
      ],
      returnUrl: 'https://game.example/play',
    });
  });

  it('orders grants by index, not by param order', () => {
    const p = new URLSearchParams();
    for (const [k, v] of [...multi().entries()].reverse()) p.append(k, v);
    const r = parseDocDelegateParams(p);
    expect(r.ok && r.req.grants.map((g) => g.label)).toEqual(['guess', 'guess-xlm']);
  });

  it('takes a delegated signer too, and leaves an absent limit to the user', () => {
    const r = parseDocDelegateParams(
      multi({ pubkey: null, signer: SIGNER, 'grant.1.limit': null, 'grant.1.limit_period': null }),
    );
    expect(r.ok && r.req.signer).toEqual({ kind: 'delegated', address: SIGNER });
    expect(r.ok && r.req.grants[1]!.cap).toBeNull();
  });

  it('accepts a single grant in the indexed format', () => {
    const p = multi();
    for (const k of [...p.keys()]) if (k.startsWith('grant.1.')) p.delete(k);
    const r = parseDocDelegateParams(p);
    expect(r.ok && r.req.grants.map((g) => g.label)).toEqual(['guess']);
  });

  it(`accepts ${MAX_DOC_GRANTS} grants and refuses more`, () => {
    const p = multi();
    for (let i = 2; i < MAX_DOC_GRANTS; i++) {
      p.set(`grant.${i}.label`, `rule-${i}`);
      p.set(`grant.${i}.target`, TARGET);
      p.set(`grant.${i}.limit`, 'none');
    }
    const ok = parseDocDelegateParams(p);
    expect(ok.ok && ok.req.grants).toHaveLength(MAX_DOC_GRANTS);
    p.set(`grant.${MAX_DOC_GRANTS}.label`, 'one-too-many');
    p.set(`grant.${MAX_DOC_GRANTS}.target`, TARGET);
    const over = parseDocDelegateParams(p);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toContain(`at most ${MAX_DOC_GRANTS} grants`);
  });

  it.each([
    ['a missing label', { 'grant.1.label': null }, 'grant.1: A label is required'],
    ['a blank label', { 'grant.1.label': '  ' }, 'grant.1: A label is required'],
    ['a repeated label', { 'grant.1.label': 'guess' }, 'Two grants name the rule "guess"'],
    ['a missing target', { 'grant.1.target': null }, 'grant.1: Invalid target'],
    ['a bad target', { 'grant.0.target': SIGNER }, 'grant.0: Invalid target'],
    ['a malformed limit', { 'grant.1.limit': '2 XLM' }, 'grant.1: Invalid limit amount'],
    ['a zero limit', { 'grant.1.limit': '0' }, 'grant.1: Limit must be greater than zero'],
    ['a bad limit_period', { 'grant.1.limit_period': 'month' }, 'grant.1: Invalid limit_period'],
    ['a limit_period without a limit', { 'grant.1.limit': null }, 'grant.1: limit_period was given without a limit'],
    ['a limit_period with limit=none', { 'grant.0.limit_period': 'day' }, 'grant.0: limit_period was given with limit=none'],
    ['an unknown field (a typo must not drop a cap)', { 'grant.1.limt': '2' }, 'Unknown grant parameter "grant.1.limt"'],
    ['a zero-padded index', { 'grant.01.label': 'x' }, 'Unknown grant parameter "grant.01.label"'],
    ['a field-less key', { 'grant.2': 'x' }, 'Unknown grant parameter "grant.2"'],
    ['a gap in the indexes', { 'grant.3.label': 'late', 'grant.3.target': TARGET }, 'grant.2 is missing'],
    ['a grant with no index 0', { 'grant.0.label': null, 'grant.0.target': null, 'grant.0.functions': null, 'grant.0.limit': null }, 'grant.0 is missing'],
    ['single-grant params alongside', { target: TARGET }, 'not both (found target)'],
    ['a stray single-grant limit alongside', { limit: '5' }, 'not both (found limit)'],
  ] as const)('rejects %s', (_case, overrides, msg) => {
    const r = parseDocDelegateParams(multi(overrides as Record<string, string | null>));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(msg);
  });

  it('takes to= on a transfer grant, single-grant and grant.<i> forms alike', () => {
    const multiReq = parseDocDelegateParams(multi({ 'grant.1.to': TARGET }));
    expect(multiReq.ok && multiReq.req.grants[1]).toMatchObject({ functions: ['transfer'], to: TARGET });
    expect(multiReq.ok && 'to' in multiReq.req.grants[0]!).toBe(false);
    const single = parseDocDelegateParams(params({ functions: 'transfer', to: SIGNER }));
    expect(single.ok && single.req.grants[0]!.to).toBe(SIGNER);
  });

  it.each([
    ['a non-transfer grant', { 'grant.0.to': TARGET }, 'grant.0: to= restricts whom transfer pays'],
    ['transfer among other functions', { 'grant.1.functions': 'transfer,approve', 'grant.1.to': TARGET }, 'exactly transfer'],
    ['a malformed address', { 'grant.1.to': 'CGAME' }, 'grant.1: Invalid to address'],
    ['a muxed address', { 'grant.1.to': 'MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAAAGZFQ' }, 'grant.1: Invalid to address'],
    ['a top-level to alongside grants', { to: TARGET }, 'not both (found to)'],
  ] as const)('rejects to= on %s', (_case, overrides, msg) => {
    const r = parseDocDelegateParams(multi(overrides as Record<string, string | null>));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(msg);
  });

  it('rejects a single-grant to= without functions=transfer', () => {
    const r = parseDocDelegateParams(params({ to: SIGNER }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('exactly transfer');
  });

  it('rejects a grant field given twice', () => {
    const p = multi();
    p.append('grant.1.limit', '100');
    const r = parseDocDelegateParams(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('grant.1.limit is given more than once');
  });

  it('still validates the common params', () => {
    for (const [overrides, msg] of [
      [{ origin: null }, 'Missing origin'],
      [{ pubkey: null }, 'Invalid session signer'],
      [{ return: 'https://evil.example/cb' }, 'Return URL origin'],
      [{ duration: '1y' }, 'Invalid duration'],
    ] as const) {
      const r = parseDocDelegateParams(multi(overrides));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain(msg);
    }
  });
});

describe('sessionSignerDraft', () => {
  const VERIFIER = 'CD4IF75DNQJKCT35PAJAQDPW3K337EK6SJZDMQEVLXAH65K7ZVZMLXYN';

  it('passes a delegated key through, verifier or not', () => {
    expect(sessionSignerDraft({ kind: 'delegated', address: SIGNER }, null)).toEqual({
      kind: 'delegated',
      address: SIGNER,
    });
  });

  it('waits for the verifier before declaring a passkey', () => {
    expect(sessionSignerDraft({ kind: 'passkey', publicKeyHex: PUBKEY }, null)).toBeNull();
  });

  it("declares a passkey against the account's verifier by its bare public key", () => {
    expect(sessionSignerDraft({ kind: 'passkey', publicKeyHex: PUBKEY }, VERIFIER)).toEqual({
      kind: 'passkey',
      verifier: VERIFIER,
      publicKeyHex: PUBKEY,
    });
  });
});

describe('describeSessionScope', () => {
  const base = { duration: '24h', notAfterLedger: null } as const;

  it('states a capped, expiring scope exactly', () => {
    expect(
      describeSessionScope({
        cap: { stroops: '25000000', period: 'week' },
        functions: ['transfer'],
        duration: '24h',
        notAfterLedger: 5145276,
      }),
    ).toEqual({
      amount: 'Up to 2.5 XLM per week',
      warn: false,
      recipient: 'to any address',
      expiry: 'At ledger 5,145,276 (≈ 24 hours)',
    });
  });

  it('states an uncapped, never-expiring scope plainly', () => {
    expect(describeSessionScope({ ...base, cap: null, functions: undefined, duration: 'none' })).toEqual({
      amount: 'No spending cap',
      warn: true,
      recipient: 'to any address',
      expiry: 'Never (until revoked)',
    });
  });

  it("says an uncapped rule allowing no token functions has no cap, without a warning", () => {
    const d = describeSessionScope({ ...base, cap: null, functions: ['guess'] });
    expect(d).toMatchObject({ amount: 'No cap — allows no token functions', warn: false, recipient: null });
  });

  it.each([[['transfer']], [['guess', 'approve']], [undefined]])(
    'warns "No spending cap" on an uncapped rule that can move tokens (%j)',
    (functions) => {
      const d = describeSessionScope({ ...base, cap: null, functions });
      expect(d).toMatchObject({ amount: 'No spending cap', warn: true });
    },
  );

  it('says whom a transfer may pay: only its to, or any address', () => {
    const cap = { stroops: '20000000', period: 'day' } as const;
    expect(describeSessionScope({ ...base, cap, functions: ['transfer'], to: TARGET }).recipient).toBe(
      `only to ${TARGET}`,
    );
    expect(describeSessionScope({ ...base, cap, functions: ['transfer'] })).toMatchObject({
      amount: 'Up to 2 XLM per day',
      recipient: 'to any address',
    });
  });

  it('falls back to the span before the ledger is read', () => {
    const d = describeSessionScope({ ...base, cap: null, functions: undefined, duration: '7d' });
    expect(d.expiry).toBe('After 7 days');
  });
});

describe('buildSessionGrantOperation (doc-only regression)', () => {
  const VERIFIER = 'CD4IF75DNQJKCT35PAJAQDPW3K337EK6SJZDMQEVLXAH65K7ZVZMLXYN';
  const OWNER_KEY = '04' + 'ab'.repeat(64);
  const SESSION_KEY = '04' + 'b0'.repeat(64);

  it('emits an apply-policy-doc descriptor — never add_context_rule — for the passkey grant', async () => {
    const { Networks } = await import('@stellar/stellar-sdk');
    const { parsePolicyDocJson } = await import('@nidohq/passkey-sdk');
    const { adminBaseline } = await import('./docDraft.js');
    const baseline = adminBaseline(
      { verifier: VERIFIER, publicKeyHex: OWNER_KEY },
      Networks.TESTNET,
    );
    const op = buildSessionGrantOperation({
      baseline,
      baselineRevision: 0n,
      isFirstApply: true,
      drafts: [
        {
          name: 'session-key',
          signer: { kind: 'passkey', verifier: VERIFIER, publicKeyHex: SESSION_KEY },
          targetContract: TARGET,
          functionsInput: '',
          notAfterLedger: 5145276,
          cap: null,
        },
      ],
      networkPassphrase: Networks.TESTNET,
      expiryLabel: '24 hours',
    });
    // The invariant that matters here: the grant is a whole-document apply,
    // not a per-rule mutator call.
    expect(op.type).toBe('apply-policy-doc');
    expect(op.prevDocJson).toBeUndefined(); // first apply
    const doc = parsePolicyDocJson(op.docJson);
    // The merged doc carries the anti-brick admin rule AND the session rule
    // for the dApp's passkey, declared against the account's verifier.
    expect(doc.rules.map((r) => r.name)).toEqual(['admin', 'session-key']);
    expect(doc.signers).toContainEqual({
      id: 'session',
      verifier: VERIFIER,
      key: SESSION_KEY.toLowerCase(),
    });
    const rule = doc.rules.find((r) => r.name === 'session-key')!;
    expect(rule['not-after-ledger']).toBe(5145276);
  });

  it('carries prevDocJson on an update and replaces a same-named rule', async () => {
    const { Networks } = await import('@stellar/stellar-sdk');
    const { parsePolicyDocJson } = await import('@nidohq/passkey-sdk');
    const { adminBaseline, upsertSessionRule } = await import('./docDraft.js');
    const { diffPolicyDocs } = await import('./docDiff.js');
    const baseline = adminBaseline(
      { verifier: VERIFIER, publicKeyHex: OWNER_KEY },
      Networks.TESTNET,
    );
    const draft = (key: string) => ({
      name: 'session-key',
      signer: { kind: 'passkey' as const, verifier: VERIFIER, publicKeyHex: key },
      targetContract: TARGET,
      functionsInput: '',
      notAfterLedger: null,
      cap: null,
    });
    const applied = upsertSessionRule(baseline, draft(SESSION_KEY), Networks.TESTNET).doc;
    const NEW_KEY = '04' + 'c1'.repeat(64);
    const op = buildSessionGrantOperation({
      baseline: applied,
      baselineRevision: 3n,
      isFirstApply: false,
      drafts: [draft(NEW_KEY)],
      networkPassphrase: Networks.TESTNET,
      expiryLabel: 'Until revoked',
    });
    expect(op.type).toBe('apply-policy-doc');
    expect(op.prevDocJson).toBeDefined();
    // The apply lands only at the revision the baseline was read at.
    expect(op.expectedRevision).toBe('3');
    // Re-delegation semantics: the session-key rule is REPLACED, not stacked.
    const doc = parsePolicyDocJson(op.docJson);
    expect(doc.rules.filter((r) => r.name === 'session-key')).toHaveLength(1);
    const d = diffPolicyDocs(parsePolicyDocJson(op.prevDocJson!), doc);
    expect(d.rulesModified.map((m) => m.name)).toEqual(['session-key']);
  });
  it('installs several grants as ONE document update sharing one signer', async () => {
    const { Networks } = await import('@stellar/stellar-sdk');
    const { parsePolicyDocJson } = await import('@nidohq/passkey-sdk');
    const { adminBaseline } = await import('./docDraft.js');
    const { diffPolicyDocs } = await import('./docDiff.js');
    const baseline = adminBaseline({ verifier: VERIFIER, publicKeyHex: OWNER_KEY }, Networks.TESTNET);
    const signer = { kind: 'passkey' as const, verifier: VERIFIER, publicKeyHex: SESSION_KEY };
    const op = buildSessionGrantOperation({
      baseline,
      baselineRevision: 4n,
      isFirstApply: false,
      drafts: [
        { name: 'guess', signer, targetContract: TARGET, functionsInput: 'guess', notAfterLedger: 900, cap: null },
        {
          name: 'guess-xlm',
          signer,
          targetContract: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
          functionsInput: 'transfer',
          notAfterLedger: 900,
          cap: { stroops: '20000000', periodLedgers: 17280 },
        },
      ],
      networkPassphrase: Networks.TESTNET,
      expiryLabel: '24 hours',
    });
    expect(op.type).toBe('apply-policy-doc');
    expect(op.expectedRevision).toBe('4');
    const doc = parsePolicyDocJson(op.docJson);
    expect(doc.rules.map((r) => r.name)).toEqual(['admin', 'guess', 'guess-xlm']);
    // One declaration for the app's key, referenced by both rules.
    expect(doc.signers.filter((s) => 'key' in s && s.key === SESSION_KEY)).toHaveLength(1);
    const guess = doc.rules.find((r) => r.name === 'guess')!;
    const xlm = doc.rules.find((r) => r.name === 'guess-xlm')!;
    expect(guess.functions).toEqual(['guess']);
    expect(guess.cap).toBeUndefined();
    expect(xlm.functions).toEqual(['transfer']);
    expect(xlm.cap).toBeDefined();
    const d = diffPolicyDocs(parsePolicyDocJson(op.prevDocJson!), doc);
    expect(d.rulesAdded.map((r) => r.name)).toEqual(['guess', 'guess-xlm']);
  });
});
