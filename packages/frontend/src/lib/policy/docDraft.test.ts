import { describe, it, expect } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import { canonicalJson, docHash } from '@nidohq/passkey-sdk';
import {
  addAdminKey,
  adminRules,
  draftToDoc,
  isAdminRule,
  nextAdminRuleName,
  ownerAdminBaseline,
  parseFunctionsInput,
  removeAdminRule,
  upsertSessionRule,
  validateAdminKeyDraft,
  validateSessionDocDraft,
  type AdminKeyDraft,
  type SessionDocDraft,
} from './docDraft.js';

const SESSION_G = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const TARGET = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';
const VERIFIER = 'CD4IF75DNQJKCT35PAJAQDPW3K337EK6SJZDMQEVLXAH65K7ZVZMLXYN';
const OWNER_KEY = '04' + 'ab'.repeat(64);
const G2 = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

function draft(overrides: Partial<SessionDocDraft> = {}): SessionDocDraft {
  return {
    name: 'status-session',
    signer: { kind: 'delegated' as const, address: SESSION_G },
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
      draft({ signer: { kind: 'delegated' as const, address: 'nope' }, targetContract: 'also-no', functionsInput: 'bad-fn!' }),
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
  });
});

describe('admin keys', () => {
  const baseline = ownerAdminBaseline(
    { verifier: VERIFIER, publicKeyHex: OWNER_KEY },
    Networks.TESTNET,
  );
  // A realistic base: owner admin + one dApp session rule.
  const base = upsertSessionRule(
    baseline,
    {
      name: 'session',
      signer: { kind: 'delegated' as const, address: SESSION_G },
      targetContract: TARGET,
      functionsInput: 'udpate_message',
      notAfterLedger: 900,
      cap: null,
    },
    Networks.TESTNET,
  ).doc;

  const delegatedDraft: AdminKeyDraft = {
    name: 'admin-2',
    signer: { kind: 'delegated', address: G2 },
  };

  it('classifies admin rules (policy-free self-admin only)', () => {
    expect(base.rules.filter(isAdminRule).map((r) => r.name)).toEqual(['admin']);
    expect(adminRules(base)).toHaveLength(1);
    expect(nextAdminRuleName(base)).toBe('admin-2');
  });

  describe('validateAdminKeyDraft', () => {
    it('accepts a fresh delegated key', () => {
      expect(validateAdminKeyDraft(delegatedDraft, base)).toEqual({ ok: true, errors: [] });
    });

    it('rejects a duplicate rule name instead of replacing the rule', () => {
      const r = validateAdminKeyDraft({ ...delegatedDraft, name: 'session' }, base);
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toContain('already has a rule named');
    });

    it('rejects a malformed address and pasted passkey fields', () => {
      expect(
        validateAdminKeyDraft(
          { name: 'a2', signer: { kind: 'delegated', address: 'nope' } },
          base,
        ).errors[0],
      ).toContain('not a valid');
      const r = validateAdminKeyDraft(
        { name: 'a2', signer: { kind: 'passkey', verifier: 'bad', publicKeyHex: 'xyz' } },
        base,
      );
      expect(r.ok).toBe(false);
      expect(r.errors).toHaveLength(2);
    });

    it('rejects a key that is already an admin', () => {
      const r = validateAdminKeyDraft(
        { name: 'a2', signer: { kind: 'passkey', verifier: VERIFIER, publicKeyHex: OWNER_KEY } },
        base,
      );
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toContain('already an admin');
    });
  });

  describe('addAdminKey', () => {
    it('adds the signer and its own self-admin rule', () => {
      const { doc, signerId } = addAdminKey(base, delegatedDraft, Networks.TESTNET);
      expect(signerId).toBe('admin');
      expect(doc.signers.map((s) => s.id)).toEqual(['owner', 'session', 'admin']);
      expect(doc.rules.map((r) => r.name)).toEqual(['admin', 'session', 'admin-2']);
      expect(adminRules(doc).map((r) => r.name)).toEqual(['admin', 'admin-2']);
      // Each admin has its OWN rule (all = N-of-N, never co-signing).
      const added = doc.rules.find((r) => r.name === 'admin-2')!;
      expect(added.principals).toEqual({ type: 'all', signers: ['admin'] });
    });

    it('allocates a fresh signer id when "admin" is taken by a different key', () => {
      const withOne = addAdminKey(base, delegatedDraft, Networks.TESTNET).doc;
      const G3 = 'GCS7RFDDWSU2S2KYWEZDGHDGYUHM2VZWMCDTFP7ZS3MK7RY2VUXQ5D67';
      const { doc, signerId } = addAdminKey(
        withOne,
        { name: 'admin-3', signer: { kind: 'delegated', address: G3 } },
        Networks.TESTNET,
      );
      expect(signerId).toBe('admin-2');
      expect(adminRules(doc)).toHaveLength(3);
    });
  });

  describe('removeAdminRule', () => {
    const twoAdmins = addAdminKey(base, delegatedDraft, Networks.TESTNET).doc;

    it('removes an admin rule and prunes its now-orphaned signer', () => {
      const doc = removeAdminRule(twoAdmins, 'admin-2', Networks.TESTNET);
      expect(doc.rules.map((r) => r.name)).toEqual(['admin', 'session']);
      expect(doc.signers.map((s) => s.id)).toEqual(['owner', 'session']);
    });

    it('refuses to remove the last admin rule', () => {
      expect(() => removeAdminRule(base, 'admin', Networks.TESTNET)).toThrow(/last admin key/);
    });

    it('refuses non-admin and unknown rules', () => {
      expect(() => removeAdminRule(twoAdmins, 'session', Networks.TESTNET)).toThrow(
        /not an admin rule/,
      );
      expect(() => removeAdminRule(twoAdmins, 'ghost', Networks.TESTNET)).toThrow(/no rule named/);
    });
  });
});

describe('passkey session signers (legacy delegate flow)', () => {
  const draft: SessionDocDraft = {
    name: 'session-key',
    signer: { kind: 'passkey', verifier: VERIFIER, publicKeyHex: '04' + 'b0'.repeat(64) },
    targetContract: TARGET,
    functionsInput: '',
    notAfterLedger: null,
    cap: null,
  };

  it('validates and builds an external-signer session doc', () => {
    expect(validateSessionDocDraft(draft)).toEqual({ ok: true, errors: [] });
    const doc = draftToDoc(draft, Networks.TESTNET);
    expect(doc.signers).toEqual([
      { id: 'session', verifier: VERIFIER, key: '04' + 'b0'.repeat(64) },
    ]);
    expect(doc.rules[0].name).toBe('session-key');
  });

  it('rejects a bad verifier and non-hex key', () => {
    const r = validateSessionDocDraft({
      ...draft,
      signer: { kind: 'passkey', verifier: 'nope', publicKeyHex: 'zz' },
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
  });
});
