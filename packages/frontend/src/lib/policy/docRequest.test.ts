import { describe, it, expect } from 'vitest';
import {
  buildSessionGrantOperation,
  describeSessionScope,
  parseDocDelegateParams,
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
    expect(r.req).toMatchObject({
      origin: 'https://dapp.example',
      target: TARGET,
      signer: SIGNER,
      functions: ['udpate_message'],
      duration: '24h',
      label: 'status-note-session',
      cap: null,
    });
  });

  it('defaults an absent duration to 30d and label to "session"', () => {
    const r = parseDocDelegateParams(params({ duration: null, label: null }));
    expect(r.ok && r.req.duration).toBe('30d');
    expect(r.ok && r.req.label).toBe('session');
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
    expect(r.ok && r.req.functions).toBeUndefined();
  });

  it('requests no cap only when limit and limit_period are both absent', () => {
    const r = parseDocDelegateParams(params());
    expect(r.ok && r.req.cap).toBeNull();
  });

  it.each([
    ['2.5', 'week', { stroops: '25000000', period: 'week' }],
    ['0.0000001', 'day', { stroops: '1', period: 'day' }],
    ['5', '30d', { stroops: '50000000', period: '30d' }],
    ['9999999', null, { stroops: '99999990000000', period: 'day' }],
  ] as const)('parses limit %j / limit_period %j', (limit, limit_period, cap) => {
    const r = parseDocDelegateParams(params({ limit, limit_period }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.req.cap).toEqual(cap);
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

describe('describeSessionScope', () => {
  it('states a capped, expiring scope exactly', () => {
    expect(
      describeSessionScope({
        target: TARGET,
        functions: ['tip', 'transfer'],
        cap: { stroops: '25000000', period: 'week' },
        duration: '24h',
        notAfterLedger: 5145276,
      }),
    ).toEqual({
      functions: `Only tip, transfer on ${TARGET}`,
      amount: 'Up to 2.5 XLM per week',
      expiry: 'At ledger 5,145,276 (≈ 24 hours)',
    });
  });

  it('states an uncapped, never-expiring scope plainly', () => {
    expect(
      describeSessionScope({
        target: TARGET,
        functions: undefined,
        cap: null,
        duration: 'none',
        notAfterLedger: null,
      }),
    ).toEqual({
      functions: `Any function on ${TARGET}`,
      amount: 'No spending cap',
      expiry: 'Never (until revoked)',
    });
  });

  it('falls back to the span before the ledger is read', () => {
    const d = describeSessionScope({
      target: TARGET,
      functions: undefined,
      cap: null,
      duration: '7d',
      notAfterLedger: null,
    });
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
      draft: {
        name: 'session-key',
        signer: { kind: 'passkey', verifier: VERIFIER, publicKeyHex: SESSION_KEY },
        targetContract: TARGET,
        functionsInput: '',
        notAfterLedger: 5145276,
        cap: null,
      },
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
      draft: draft(NEW_KEY),
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
});
