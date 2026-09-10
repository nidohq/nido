import { describe, it, expect } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import { canonicalJson, docHash } from '@nidohq/passkey-sdk';
import {
  chooseApplyRoute,
  docHasCap,
  draftToDoc,
  parseFunctionsInput,
  validateSessionDocDraft,
  type SessionDocDraft,
} from './docDraft.js';

const SESSION_G = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const TARGET = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';

function draft(overrides: Partial<SessionDocDraft> = {}): SessionDocDraft {
  return {
    name: 'status-session',
    sessionAddress: SESSION_G,
    targetContract: TARGET,
    functionsInput: 'update_message',
    notAfterLedger: 5000,
    cap: { stroops: '1000000000', periodLedgers: 17280 },
    ...overrides,
  };
}

describe('parseFunctionsInput', () => {
  it('splits on commas and whitespace, dropping empties', () => {
    expect(parseFunctionsInput('a, b  c,,')).toEqual(['a', 'b', 'c']);
  });
  it('returns undefined for empty input (any function)', () => {
    expect(parseFunctionsInput('   ')).toBeUndefined();
  });
});

describe('validateSessionDocDraft', () => {
  it('accepts the filled template', () => {
    expect(validateSessionDocDraft(draft())).toEqual({ ok: true, errors: [] });
  });

  it('rejects a bad session address, target, and function name', () => {
    const r = validateSessionDocDraft(
      draft({ sessionAddress: 'nope', targetContract: 'also-no', functionsInput: 'bad-fn!' }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(3);
  });

  it('rejects a zero cap and a negative expiry', () => {
    const r = validateSessionDocDraft(
      draft({ cap: { stroops: '0', periodLedgers: 17280 }, notAfterLedger: -1 }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('cap'))).toBe(true);
    expect(r.errors.some((e) => e.includes('Expiry'))).toBe(true);
  });
});

describe('draftToDoc', () => {
  it('builds the template doc with cap, functions, expiry, and network', () => {
    const doc = draftToDoc(draft(), Networks.TESTNET);
    expect(doc.network).toBe(Networks.TESTNET);
    expect(doc.signers).toEqual([{ id: 'session', address: SESSION_G }]);
    const rule = doc.rules[0];
    expect(rule.name).toBe('status-session');
    expect(rule.functions).toEqual(['update_message']);
    expect(rule['not-after-ledger']).toBe(5000);
    expect(rule.cap).toEqual({ limit: '1000000000', 'period-ledgers': 17280 });
    // The doc is canonicalizable + hashable — the identity the chain stores.
    expect(docHash(doc)).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalJson(doc)).toContain('"status-session"');
  });

  it('omits functions, expiry, and cap when unset', () => {
    const doc = draftToDoc(
      draft({ functionsInput: '', notAfterLedger: null, cap: null }),
      Networks.TESTNET,
    );
    const rule = doc.rules[0];
    expect(rule.functions).toBeUndefined();
    expect(rule['not-after-ledger']).toBeUndefined();
    expect(rule.cap).toBeUndefined();
    expect(docHasCap(doc)).toBe(false);
  });
});

describe('chooseApplyRoute', () => {
  it('routes capped docs per-rule even when the surface exists (the hybrid contract refuses caps)', () => {
    expect(chooseApplyRoute({ hasDocSurface: true, docHasCap: true })).toBe('per-rule');
  });
  it('routes uncapped docs through apply_doc when the surface exists', () => {
    expect(chooseApplyRoute({ hasDocSurface: true, docHasCap: false })).toBe('apply-doc');
  });
  it('routes per-rule when the account lacks the surface', () => {
    expect(chooseApplyRoute({ hasDocSurface: false, docHasCap: false })).toBe('per-rule');
  });
});
