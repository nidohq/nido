import { describe, expect, it } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import type { PolicyDoc } from '@nidohq/passkey-sdk';
import { adminBaseline, upsertSessionRule, upsertSessionRules, type SessionDocDraft } from './docDraft.js';
import { MAX_DOC_GRANTS } from './docRequest.js';
import { reviewGrant } from './grantReview.js';

const VERIFIER = 'CD4IF75DNQJKCT35PAJAQDPW3K337EK6SJZDMQEVLXAH65K7ZVZMLXYN';
const TARGET = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';
const OWNER_KEY = '04' + 'ab'.repeat(64);
const SESSION_KEY = '04' + 'b0'.repeat(64);
const APP_ADDRESS = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

const XLM = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

const baseline = adminBaseline({ verifier: VERIFIER, publicKeyHex: OWNER_KEY }, Networks.TESTNET);

function grant(current: PolicyDoc, name: string, signer: 'passkey' | 'address' = 'passkey'): PolicyDoc {
  return upsertSessionRule(
    current,
    {
      name,
      signer:
        signer === 'passkey'
          ? { kind: 'passkey', verifier: VERIFIER, publicKeyHex: SESSION_KEY }
          : { kind: 'delegated', address: APP_ADDRESS },
      targetContract: TARGET,
      functionsInput: 'udpate_message',
      notAfterLedger: 5000,
      cap: null,
    },
    Networks.TESTNET,
  ).doc;
}

describe('reviewGrant', () => {
  it('describes the granted rule on a first apply, not the admin rule that leads the document', () => {
    const next = grant(baseline, 'session-key');
    expect(next.rules[0]!.name).toBe('admin');
    const r = reviewGrant(null, next);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.grants).toHaveLength(1);
    expect(r.grants[0]!.rule.name).toBe('session-key');
    expect(r.grants[0]!.rule.scope).toEqual({ type: 'contract', address: TARGET });
    expect(r.grants[0]!.signers).toEqual([{ id: 'session', verifier: VERIFIER, key: SESSION_KEY }]);
  });

  it('names a delegated signer by its address', () => {
    const r = reviewGrant(baseline, grant(baseline, 'app', 'address'));
    expect(r.ok && r.grants[0]!.signers.map((s) => ('address' in s ? s.address : s.key))).toEqual([APP_ADDRESS]);
  });

  it('describes the one rule an update adds next to existing grants', () => {
    const applied = grant(baseline, 'first');
    const r = reviewGrant(applied, grant(applied, 'second'));
    expect(r.ok && r.grants.map((g) => g.rule.name)).toEqual(['second']);
  });

  it('refuses a request that changes the account-scoped admin rule', () => {
    const next = grant(baseline, 'session-key');
    const tampered: PolicyDoc = {
      ...next,
      rules: next.rules.map((r) => (r.name === 'admin' ? { ...r, functions: ['apply_doc'] } : r)),
    };
    expect(reviewGrant(baseline, tampered)).toEqual({ ok: false, reason: expect.stringMatching(/own rule "admin"/) });
  });

  it('refuses a request that removes a rule', () => {
    const applied = grant(baseline, 'first');
    expect(reviewGrant(applied, baseline)).toEqual({ ok: false, reason: expect.stringMatching(/remove the rule "first"/) });
  });


  it('refuses a request that changes nothing', () => {
    const applied = grant(baseline, 'first');
    expect(reviewGrant(applied, applied)).toEqual({ ok: false, reason: expect.stringMatching(/already in place/) });
  });
});

/** One delegate-doc request's rules for one key, as the page builds them. */
function request(current: PolicyDoc, drafts: Partial<SessionDocDraft>[]): PolicyDoc {
  return upsertSessionRules(
    current,
    drafts.map((d, i) => ({
      name: `rule-${i}`,
      signer: { kind: 'passkey' as const, verifier: VERIFIER, publicKeyHex: SESSION_KEY },
      targetContract: TARGET,
      functionsInput: 'guess',
      notAfterLedger: 5000,
      cap: null,
      ...d,
    })),
    Networks.TESTNET,
  );
}

describe('reviewGrant — several rules from one request', () => {
  const game = { name: 'guess', functionsInput: 'guess' };
  const stake = {
    name: 'guess-xlm',
    targetContract: XLM,
    functionsInput: 'transfer',
    cap: { stroops: '20000000', periodLedgers: 17280 },
  };

  it('describes every rule a request grants, in document order, each with its key', () => {
    const r = reviewGrant(null, request(baseline, [game, stake]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.grants.map((g) => g.rule.name)).toEqual(['guess', 'guess-xlm']);
    expect(r.grants.map((g) => g.rule.scope)).toEqual([
      { type: 'contract', address: TARGET },
      { type: 'contract', address: XLM },
    ]);
    expect(r.grants[0]!.rule.cap).toBeUndefined();
    expect(r.grants[1]!.rule.cap).toBeDefined();
    for (const g of r.grants) expect(g.signers).toEqual([{ id: 'session', verifier: VERIFIER, key: SESSION_KEY }]);
  });

  it('counts a re-delegated rule next to a new one, not the rules left alone', () => {
    const applied = request(baseline, [{ name: 'kept' }, game]);
    const r = reviewGrant(applied, request(applied, [{ ...game, notAfterLedger: 9000 }, { ...stake, notAfterLedger: 9000 }]));
    expect(r.ok && r.grants.map((g) => g.rule.name)).toEqual(['guess', 'guess-xlm']);
  });

  it(`grants up to ${MAX_DOC_GRANTS} rules and refuses more`, () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `r${i}` }));
    const ok = reviewGrant(null, request(baseline, many(MAX_DOC_GRANTS)));
    expect(ok.ok && ok.grants).toHaveLength(MAX_DOC_GRANTS);
    expect(reviewGrant(null, request(baseline, many(MAX_DOC_GRANTS + 1)))).toEqual({
      ok: false,
      reason: expect.stringMatching(new RegExp(`${MAX_DOC_GRANTS + 1} rules at once`)),
    });
  });

  it('refuses rules for different keys', () => {
    const next = request(request(baseline, [game]), [
      { ...stake, signer: { kind: 'delegated', address: APP_ADDRESS } },
    ]);
    expect(reviewGrant(baseline, next)).toEqual({ ok: false, reason: expect.stringMatching(/different keys/) });
  });

  it('refuses rules with different expiries', () => {
    const next = request(baseline, [game, { ...stake, notAfterLedger: 6000 }]);
    expect(reviewGrant(baseline, next)).toEqual({ ok: false, reason: expect.stringMatching(/expire at different times/) });
  });

  it('still refuses a request that also removes or changes a core rule', () => {
    const applied = request(baseline, [{ name: 'old' }]);
    const dropped: PolicyDoc = { ...request(applied, [game, stake]), rules: request(applied, [game, stake]).rules.filter((r) => r.name !== 'old') };
    expect(reviewGrant(applied, dropped)).toEqual({ ok: false, reason: expect.stringMatching(/remove the rule "old"/) });
    const next = request(baseline, [game, stake]);
    const tampered: PolicyDoc = {
      ...next,
      rules: next.rules.map((r) => (r.name === 'admin' ? { ...r, functions: ['apply_doc'] } : r)),
    };
    expect(reviewGrant(baseline, tampered)).toEqual({ ok: false, reason: expect.stringMatching(/own rule "admin"/) });
  });

  it('refuses a first document that grants no app access', () => {
    expect(reviewGrant(null, baseline)).toEqual({ ok: false, reason: expect.stringMatching(/grants no app access/) });
  });
});
