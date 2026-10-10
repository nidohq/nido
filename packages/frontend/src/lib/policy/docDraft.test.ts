import { describe, it, expect } from 'vitest';
import { Networks, StrKey } from '@stellar/stellar-sdk';
import { buildPolicyDoc, canonicalJson, docHash, perch, type PolicyDoc } from '@nidohq/passkey-sdk';
import {
  addAdminKey,
  adminRules,
  draftToDoc,
  isAdminRule,
  nextAdminRuleName,
  adminBaseline,
  parseFunctionsInput,
  recoveryEditProblem,
  removeAdminRule,
  upsertSessionRule,
  validateAdminKeyDraft,
  validateSessionDocDraft,
  type AdminKeyDraft,
  type SessionDocDraft,
} from './docDraft.js';

// The account's document limits, as its compiler's `limits()` reports them
// on the deployed stack (the SDK's caps.test.ts pins these values to Perch's
// compiler source). The validators take them as an argument; nothing in the
// wallet hard-codes them.
const LIMITS = { maxSigners: 8, maxRules: 11, maxCanonicalBytes: 8192, maxRuleNameBytes: 20 };

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
    expect(validateSessionDocDraft(draft(), LIMITS)).toEqual({ ok: true, errors: [] });
  });

  it("refuses a 21-byte rule name before submission (Perch's 20-byte limit)", () => {
    expect(validateSessionDocDraft(draft({ name: 'x'.repeat(20) }), LIMITS).ok).toBe(true);
    const r = validateSessionDocDraft(draft({ name: 'x'.repeat(21) }), LIMITS);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(['Name must be at most 20 bytes (this one is 21).']);
  });

  it('checks the form alone while the limits load, and the name once they arrive', () => {
    const long = draft({ name: 'x'.repeat(21) });
    expect(validateSessionDocDraft(long, null).ok).toBe(true);
    expect(validateSessionDocDraft(long, LIMITS).ok).toBe(false);
    expect(validateSessionDocDraft(draft({ targetContract: 'nope' }), null).ok).toBe(false);
  });

  it('rejects a bad session address, target, and function name', () => {
    const r = validateSessionDocDraft(
      draft({ signer: { kind: 'delegated' as const, address: 'nope' }, targetContract: 'also-no', functionsInput: 'bad-fn!' }),
      LIMITS,
    );
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(3);
  });

  it('rejects a zero cap and a negative expiry', () => {
    const r = validateSessionDocDraft(
      draft({ cap: { stroops: '0', periodLedgers: 17280 }, notAfterLedger: -1 }),
      LIMITS,
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
  const baseline = adminBaseline(
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
      expect(validateAdminKeyDraft(delegatedDraft, base, LIMITS)).toEqual({ ok: true, errors: [] });
    });

    it("refuses a 21-byte admin rule name before submission", () => {
      const r = validateAdminKeyDraft({ ...delegatedDraft, name: 'a'.repeat(21) }, base, LIMITS);
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toBe('Name must be at most 20 bytes (this one is 21).');
    });

    it("refuses a ninth key or a twelfth rule (Perch's caps)", () => {
      const signers = Array.from({ length: 8 }, (_, i) => ({
        id: `k${i}`,
        address: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x40 + i)),
      }));
      const nine = validateAdminKeyDraft(delegatedDraft, { ...base, signers }, LIMITS);
      expect(nine.ok).toBe(false);
      expect(nine.errors.join(' ')).toMatch(/already holds 8 keys/);
      const rules = Array.from({ length: 11 }, (_, i) => ({ ...base.rules[0]!, name: `r${i}` }));
      const twelve = validateAdminKeyDraft(delegatedDraft, { ...base, rules }, LIMITS);
      expect(twelve.errors.join(' ')).toMatch(/already has 11 rules/);
    });

    it('rejects a duplicate rule name instead of replacing the rule', () => {
      const r = validateAdminKeyDraft({ ...delegatedDraft, name: 'session' }, base, LIMITS);
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toContain('already has a rule named');
    });

    it('rejects a malformed address and pasted passkey fields', () => {
      expect(
        validateAdminKeyDraft(
          { name: 'a2', signer: { kind: 'delegated', address: 'nope' } },
          base,
          LIMITS,
        ).errors[0],
      ).toContain('not a valid');
      const r = validateAdminKeyDraft(
        { name: 'a2', signer: { kind: 'passkey', verifier: 'bad', publicKeyHex: 'xyz' } },
        base,
        LIMITS,
      );
      expect(r.ok).toBe(false);
      expect(r.errors).toHaveLength(2);
    });

    it('rejects a key that is already an admin', () => {
      const r = validateAdminKeyDraft(
        { name: 'a2', signer: { kind: 'passkey', verifier: VERIFIER, publicKeyHex: OWNER_KEY } },
        base,
        LIMITS,
      );
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toContain('already an admin');
    });
  });

  describe('addAdminKey', () => {
    it('adds the signer (id admin-2, mirroring the default rule name) and its own self-admin rule', () => {
      const { doc, signerId } = addAdminKey(base, delegatedDraft, Networks.TESTNET);
      // Naming ruling: founder keeps `owner`; added admins are admin-2, admin-3, …
      expect(signerId).toBe('admin-2');
      expect(doc.signers.map((s) => s.id)).toEqual(['admin', 'session', 'admin-2']);
      expect(doc.rules.map((r) => r.name)).toEqual(['admin', 'session', 'admin-2']);
      expect(adminRules(doc).map((r) => r.name)).toEqual(['admin', 'admin-2']);
      // Each admin has its OWN rule (all = N-of-N, never co-signing).
      const added = doc.rules.find((r) => r.name === 'admin-2')!;
      expect(added.principals).toEqual({ type: 'all', signers: ['admin-2'] });
    });

    it('allocates the next admin-N id for each further key', () => {
      const withOne = addAdminKey(base, delegatedDraft, Networks.TESTNET).doc;
      const G3 = 'GCS7RFDDWSU2S2KYWEZDGHDGYUHM2VZWMCDTFP7ZS3MK7RY2VUXQ5D67';
      const { doc, signerId } = addAdminKey(
        withOne,
        { name: 'admin-3', signer: { kind: 'delegated', address: G3 } },
        Networks.TESTNET,
      );
      expect(signerId).toBe('admin-3');
      expect(nextAdminRuleName(doc)).toBe('admin-4');
      expect(adminRules(doc)).toHaveLength(3);
    });
  });

  describe('removeAdminRule', () => {
    const twoAdmins = addAdminKey(base, delegatedDraft, Networks.TESTNET).doc;

    it('removes an admin rule and prunes its now-orphaned signer', () => {
      const doc = removeAdminRule(twoAdmins, 'admin-2', Networks.TESTNET);
      expect(doc.rules.map((r) => r.name)).toEqual(['admin', 'session']);
      expect(doc.signers.map((s) => s.id)).toEqual(['admin', 'session']);
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
    expect(validateSessionDocDraft(draft, LIMITS)).toEqual({ ok: true, errors: [] });
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
    }, LIMITS);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
  });
});

describe('policy edits never reconfigure recovery', () => {
  const sessionDraft = {
    name: 'session',
    signer: { kind: 'delegated' as const, address: SESSION_G },
    targetContract: TARGET,
    functionsInput: 'udpate_message',
    notAfterLedger: 900,
    cap: null,
  };
  const recovery = (replaceable: string[]) =>
    perch.recoverySpec(perch.TESTNET, {
      profile: 'protected',
      mode: 'guardian-only',
      guardians: [G2],
      quorum: 1,
      replaceable,
    });
  const hashHex = (doc: PolicyDoc) => Buffer.from(perch.configHash(doc)!).toString('hex');

  // An early document: the founder is `owner`, and Protected recovery
  // restores it.
  const legacy = perch.withRecovery(
    buildPolicyDoc({
      network: Networks.TESTNET,
      signers: [{ id: 'owner', kind: 'passkey', verifier: VERIFIER, publicKey: OWNER_KEY }],
      permissions: [{ name: 'admin', on: 'self-admin', by: ['owner'] }],
    }),
    recovery(['owner']),
  );

  it('keeps the legacy owner id when recovery restores it, so the config hash holds', () => {
    const granted = upsertSessionRule(legacy, sessionDraft, Networks.TESTNET).doc;
    const withAdmin = addAdminKey(
      legacy,
      { name: 'admin-2', signer: { kind: 'delegated', address: G2 } },
      Networks.TESTNET,
    ).doc;
    for (const next of [granted, withAdmin]) {
      expect(next.signers.map((s) => s.id)).toContain('owner');
      expect(next.recovery?.replaceable).toEqual(['owner']);
      expect(hashHex(next)).toBe(hashHex(legacy));
      expect(recoveryEditProblem(legacy, next)).toBeUndefined();
    }
  });

  it('still renames owner to admin when recovery does not restore it', () => {
    const plain = buildPolicyDoc({
      network: Networks.TESTNET,
      signers: [{ id: 'owner', kind: 'passkey', verifier: VERIFIER, publicKey: OWNER_KEY }],
      permissions: [{ name: 'admin', on: 'self-admin', by: ['owner'] }],
    });
    const next = upsertSessionRule(plain, sessionDraft, Networks.TESTNET).doc;
    expect(next.signers.map((s) => s.id)).toEqual(['admin', 'session']);
  });

  it('refuses a policy write that changes, sets, or removes recovery', () => {
    const changed = perch.withRecovery(legacy, recovery(['owner', 'session']));
    const removed = perch.withRecovery(legacy, undefined);
    expect(recoveryEditProblem(legacy, changed)).toMatch(/Recovery page/);
    expect(recoveryEditProblem(legacy, removed)).toMatch(/Recovery page/);
    expect(recoveryEditProblem(null, legacy)).toMatch(/Recovery page/);
    expect(recoveryEditProblem(null, perch.withRecovery(legacy, undefined))).toBeUndefined();
  });

  it('refuses to remove the last admin key recovery can restore', () => {
    const base = perch.withRecovery(
      adminBaseline({ verifier: VERIFIER, publicKeyHex: OWNER_KEY }, Networks.TESTNET),
      recovery(['admin']),
    );
    const twoAdmins = addAdminKey(
      base,
      { name: 'admin-2', signer: { kind: 'delegated', address: G2 } },
      Networks.TESTNET,
    ).doc;
    expect(() => removeAdminRule(twoAdmins, 'admin', Networks.TESTNET)).toThrow(
      /last admin key your recovery can restore/,
    );
    // The other admin can go: recovery still restores `admin`.
    expect(removeAdminRule(twoAdmins, 'admin-2', Networks.TESTNET).rules.map((r) => r.name)).toEqual([
      'admin',
    ]);
    // With both restorable, either can go.
    const bothRestorable = perch.withRecovery(twoAdmins, recovery(['admin', 'admin-2']));
    expect(removeAdminRule(bothRestorable, 'admin', Networks.TESTNET).rules.map((r) => r.name)).toEqual([
      'admin-2',
    ]);
  });
});
