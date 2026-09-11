import { describe, it, expect } from 'vitest';
import { buildSessionGrantOperation, parseDocDelegateParams } from './docRequest.js';

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
      limitStroops: null,
    });
  });

  it('defaults duration to 30d and label to "session"', () => {
    const r = parseDocDelegateParams(params({ duration: 'bogus', label: null }));
    expect(r.ok && r.req.duration).toBe('30d');
    expect(r.ok && r.req.label).toBe('session');
  });

  it('treats absent functions as any-function', () => {
    const r = parseDocDelegateParams(params({ functions: null }));
    expect(r.ok && r.req.functions).toBeUndefined();
  });

  it('parses a decimal-XLM limit to stroops and tolerates a malformed one', () => {
    const good = parseDocDelegateParams(params({ limit: '2.5', limit_period: 'week' }));
    expect(good.ok && good.req.limitStroops).toBe('25000000');
    expect(good.ok && good.req.limitPeriod).toBe('week');
    const bad = parseDocDelegateParams(params({ limit: 'lots' }));
    expect(bad.ok && bad.req.limitStroops).toBeNull();
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
});

describe('buildSessionGrantOperation (doc-only regression)', () => {
  const VERIFIER = 'CD4IF75DNQJKCT35PAJAQDPW3K337EK6SJZDMQEVLXAH65K7ZVZMLXYN';
  const OWNER_KEY = '04' + 'ab'.repeat(64);
  const SESSION_KEY = '04' + 'b0'.repeat(64);

  it('emits an apply-policy-doc descriptor — never add_context_rule — for the passkey grant', async () => {
    const { Networks } = await import('@stellar/stellar-sdk');
    const { parsePolicyDocJson } = await import('@nidohq/passkey-sdk');
    const { ownerAdminBaseline } = await import('./docDraft.js');
    const baseline = ownerAdminBaseline(
      { verifier: VERIFIER, publicKeyHex: OWNER_KEY },
      Networks.TESTNET,
    );
    const op = buildSessionGrantOperation({
      baseline,
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
    // The invariant the captain's live failure proved missing: the grant is
    // a whole-document apply, not a per-rule mutator call.
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
    const { ownerAdminBaseline, upsertSessionRule } = await import('./docDraft.js');
    const { diffPolicyDocs } = await import('./docDiff.js');
    const baseline = ownerAdminBaseline(
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
      isFirstApply: false,
      draft: draft(NEW_KEY),
      networkPassphrase: Networks.TESTNET,
      expiryLabel: 'Until revoked',
    });
    expect(op.type).toBe('apply-policy-doc');
    expect(op.prevDocJson).toBeDefined();
    // Re-delegation semantics: the session-key rule is REPLACED, not stacked.
    const doc = parsePolicyDocJson(op.docJson);
    expect(doc.rules.filter((r) => r.name === 'session-key')).toHaveLength(1);
    const d = diffPolicyDocs(parsePolicyDocJson(op.prevDocJson!), doc);
    expect(d.rulesModified.map((m) => m.name)).toEqual(['session-key']);
  });
});
