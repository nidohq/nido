import { describe, it, expect } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import { baselineWithoutExpiringRules, hasExpiringRules } from './baseline';
import { adminBaseline, upsertSessionRule } from '../policy/docDraft';

const VERIFIER = 'CD4IF75DNQJKCT35PAJAQDPW3K337EK6SJZDMQEVLXAH65K7ZVZMLXYN';
const OWNER_KEY = '04' + 'ab'.repeat(64);
const SESSION_KEY = '04' + 'b0'.repeat(64);
const TARGET = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';

function docWithExpiringSession() {
  const baseline = adminBaseline({ verifier: VERIFIER, publicKeyHex: OWNER_KEY }, Networks.TESTNET);
  return upsertSessionRule(
    baseline,
    {
      name: 'dapp-session',
      signer: { kind: 'passkey', verifier: VERIFIER, publicKeyHex: SESSION_KEY },
      targetContract: TARGET,
      functionsInput: '',
      notAfterLedger: 5_000_000, // expiring
      cap: null,
    },
    Networks.TESTNET,
  ).doc;
}

describe('recovery baseline — expiring-rule stripping', () => {
  it('a captured dApp session rule carries an expiry (precondition)', () => {
    const doc = docWithExpiringSession();
    expect(hasExpiringRules(doc)).toBe(true);
    expect(doc.rules.map((r) => r.name)).toEqual(['admin', 'dapp-session']);
  });

  it('strips expiring rules so the baseline cannot brick compromise recovery', () => {
    const doc = docWithExpiringSession();
    const baseline = baselineWithoutExpiringRules(doc);
    // The admin (permanent) rule survives; the expiring session rule is gone.
    expect(baseline.rules.map((r) => r.name)).toEqual(['admin']);
    expect(hasExpiringRules(baseline)).toBe(false);
    // No rule in the baseline carries an expiry.
    expect(baseline.rules.every((r) => r['not-after-ledger'] === undefined)).toBe(true);
  });

  it('prunes signers left unreferenced after stripping (no orphan session key)', () => {
    const doc = docWithExpiringSession();
    const baseline = baselineWithoutExpiringRules(doc);
    const ids = new Set(baseline.signers.map((s) => s.id));
    // Every surviving signer is referenced by a surviving rule.
    for (const r of baseline.rules) {
      const sids = 'signers' in r.principals ? r.principals.signers : [];
      for (const sid of sids) expect(ids.has(sid)).toBe(true);
    }
    // The orphaned session key is not carried into the restore point.
    expect(baseline.signers.some((s) => 'key' in s && s.key === SESSION_KEY.toLowerCase())).toBe(false);
  });

  it('leaves a baseline of only permanent rules unchanged', () => {
    const adminOnly = adminBaseline({ verifier: VERIFIER, publicKeyHex: OWNER_KEY }, Networks.TESTNET);
    const baseline = baselineWithoutExpiringRules(adminOnly);
    expect(baseline.rules).toEqual(adminOnly.rules);
    expect(baseline.signers).toEqual(adminOnly.signers);
  });
});
