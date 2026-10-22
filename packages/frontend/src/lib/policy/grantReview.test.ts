import { describe, expect, it } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import type { PolicyDoc } from '@nidohq/passkey-sdk';
import { adminBaseline, upsertSessionRule } from './docDraft.js';
import { reviewGrant } from './grantReview.js';

const VERIFIER = 'CD4IF75DNQJKCT35PAJAQDPW3K337EK6SJZDMQEVLXAH65K7ZVZMLXYN';
const TARGET = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';
const OWNER_KEY = '04' + 'ab'.repeat(64);
const SESSION_KEY = '04' + 'b0'.repeat(64);
const APP_ADDRESS = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

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
    expect(r.rule.name).toBe('session-key');
    expect(r.rule.scope).toEqual({ type: 'contract', address: TARGET });
    expect(r.signers).toEqual([{ id: 'session', verifier: VERIFIER, key: SESSION_KEY }]);
  });

  it('names a delegated signer by its address', () => {
    const r = reviewGrant(baseline, grant(baseline, 'app', 'address'));
    expect(r.ok && r.signers.map((s) => ('address' in s ? s.address : s.key))).toEqual([APP_ADDRESS]);
  });

  it('describes the one rule an update adds next to existing grants', () => {
    const applied = grant(baseline, 'first');
    const r = reviewGrant(applied, grant(applied, 'second'));
    expect(r.ok && r.rule.name).toBe('second');
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

  it('refuses a request that grants two rules at once', () => {
    expect(reviewGrant(baseline, grant(grant(baseline, 'one'), 'two'))).toEqual({
      ok: false,
      reason: expect.stringMatching(/2 rules at once/),
    });
  });

  it('refuses a request that changes nothing', () => {
    const applied = grant(baseline, 'first');
    expect(reviewGrant(applied, applied)).toEqual({ ok: false, reason: expect.stringMatching(/already in place/) });
  });
});
