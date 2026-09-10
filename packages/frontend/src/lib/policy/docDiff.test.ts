import { describe, it, expect } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import { buildPolicyDoc, scopedSessionKeyDoc } from '@nidohq/passkey-sdk';
import { diffPolicyDocs, diffRuleFields } from './docDiff.js';
import { ownerAdminBaseline, upsertSessionRule, type SessionDocDraft } from './docDraft.js';

const TARGET = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';
const TARGET2 = 'CDVVRZAVXTUQLS5LCGUP3H26RGOIUFKNE2UEJ6CAWYMBWY5LNORF6POX';
const VERIFIER = 'CD4IF75DNQJKCT35PAJAQDPW3K337EK6SJZDMQEVLXAH65K7ZVZMLXYN';
const G1 = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const G2 = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const OWNER_KEY = '04' + 'ab'.repeat(64);

const baseDoc = buildPolicyDoc({
  signers: [
    { id: 'owner', kind: 'passkey', verifier: VERIFIER, publicKey: OWNER_KEY },
    { id: 'ops', kind: 'delegated', address: G1 },
  ],
  permissions: [
    { name: 'pay', on: { contract: TARGET }, by: ['owner'], functions: ['transfer'], until: 9000 },
    { name: 'ops', on: { contract: TARGET2 }, by: ['ops'] },
  ],
});

describe('diffPolicyDocs', () => {
  it('marks a first apply as all-new', () => {
    const d = diffPolicyDocs(null, baseDoc);
    expect(d.firstApply).toBe(true);
    expect(d.rulesAdded.map((r) => r.name)).toEqual(['pay', 'ops']);
    expect(d.signers.map((s) => s.kind)).toEqual(['added', 'added']);
    expect(d.identical).toBe(false);
  });

  it('reports identical docs as a no-op', () => {
    const d = diffPolicyDocs(baseDoc, baseDoc);
    expect(d.identical).toBe(true);
    expect(d.unchangedRuleNames).toEqual(['pay', 'ops']);
  });

  it('classifies added, removed, and modified rules by name', () => {
    const next = buildPolicyDoc({
      signers: [
        { id: 'owner', kind: 'passkey', verifier: VERIFIER, publicKey: OWNER_KEY },
        { id: 'session', kind: 'delegated', address: G2 },
      ],
      permissions: [
        // 'pay' modified: functions widen, expiry moves.
        { name: 'pay', on: { contract: TARGET }, by: ['owner'], functions: ['transfer', 'approve'], until: 12000 },
        // 'ops' removed; 'session' added.
        { name: 'session', on: { contract: TARGET2 }, by: ['session'], until: 500 },
      ],
    });
    const d = diffPolicyDocs(baseDoc, next);
    expect(d.firstApply).toBe(false);
    expect(d.rulesAdded.map((r) => r.name)).toEqual(['session']);
    expect(d.rulesRemoved.map((r) => r.name)).toEqual(['ops']);
    expect(d.rulesModified).toHaveLength(1);
    expect(d.rulesModified[0].name).toBe('pay');
    expect(d.rulesModified[0].changes.join('\n')).toContain('functions: transfer → transfer, approve');
    expect(d.rulesModified[0].changes.join('\n')).toContain('expiry: ledger 9000 → ledger 12000');
    // Signer churn: 'session' added, 'ops' removed.
    expect(d.signers).toEqual([
      { decl: { id: 'session', address: G2 }, kind: 'added' },
      { decl: { id: 'ops', address: G1 }, kind: 'removed' },
    ]);
  });

  it('surfaces a rekeyed signer on rules that reference it', () => {
    const next = buildPolicyDoc({
      signers: [
        { id: 'owner', kind: 'passkey', verifier: VERIFIER, publicKey: OWNER_KEY },
        { id: 'ops', kind: 'delegated', address: G2 }, // same id, new key
      ],
      permissions: [
        { name: 'pay', on: { contract: TARGET }, by: ['owner'], functions: ['transfer'], until: 9000 },
        { name: 'ops', on: { contract: TARGET2 }, by: ['ops'] },
      ],
    });
    const d = diffPolicyDocs(baseDoc, next);
    expect(d.signers).toEqual([{ decl: { id: 'ops', address: G2 }, kind: 'rekeyed' }]);
    expect(d.rulesModified).toHaveLength(1);
    expect(d.rulesModified[0].name).toBe('ops');
    expect(d.rulesModified[0].changes[0]).toContain('signer "ops" now declares a different key');
  });
});

describe('renderDocDiffHtml', () => {
  it('renders a first apply as all-new and an update with its change kinds', async () => {
    const { renderDocDiffHtml } = await import('../../components/PolicyInspector.js');
    const first = renderDocDiffHtml(diffPolicyDocs(null, baseDoc));
    expect(first).toContain('First document');

    const draft: SessionDocDraft = {
      name: 'session',
      sessionAddress: G2,
      targetContract: TARGET2,
      functionsInput: '',
      notAfterLedger: null,
      cap: null,
    };
    const { doc } = upsertSessionRule(baseDoc, draft, Networks.TESTNET);
    const update = renderDocDiffHtml(diffPolicyDocs(baseDoc, doc));
    expect(update).toContain('+ added');
    expect(update).toContain('session');
    expect(update).toContain('Unchanged: pay, ops');

    const noop = renderDocDiffHtml(diffPolicyDocs(baseDoc, baseDoc));
    expect(noop).toContain('No changes');
  });
});

describe('diffRuleFields', () => {
  it('reports scope, cap, and quorum changes', () => {
    const a = scopedSessionKeyDoc({ sessionAddress: G1, targetContract: TARGET }).rules[0];
    const b = {
      ...scopedSessionKeyDoc({
        sessionAddress: G1,
        targetContract: TARGET2,
        cap: { limitStroops: 5_0000000n, periodLedgers: 17280 },
      }).rules[0],
    };
    const changes = diffRuleFields(a, b);
    expect(changes.join('\n')).toContain('scope:');
    expect(changes.join('\n')).toContain('cap: no cap → 50000000 stroops per 17280 ledgers');
  });
});

describe('upsertSessionRule', () => {
  const draft: SessionDocDraft = {
    name: 'session',
    sessionAddress: G2,
    targetContract: TARGET2,
    functionsInput: 'udpate_message',
    notAfterLedger: 700,
    cap: null,
  };

  it('first apply: upserts into the owner-admin baseline (anti-brick rule rides along)', () => {
    const baseline = ownerAdminBaseline(
      { verifier: VERIFIER, publicKeyHex: OWNER_KEY },
      Networks.TESTNET,
    );
    const { doc, signerId } = upsertSessionRule(baseline, draft, Networks.TESTNET);
    expect(signerId).toBe('session');
    expect(doc.rules.map((r) => r.name)).toEqual(['admin', 'session']);
    // The admin rule is the policy-free self-admin shape the contract's
    // DocAdminLockout check requires.
    expect(doc.rules[0].scope).toEqual({ type: 'self-admin' });
    expect(doc.rules[0].functions).toBeUndefined();
    expect(doc.rules[0].cap).toBeUndefined();
    expect(doc.signers.map((s) => s.id)).toEqual(['owner', 'session']);
    // Everything renders as newly granted on the first apply.
    const d = diffPolicyDocs(null, doc);
    expect(d.firstApply).toBe(true);
    expect(d.rulesAdded.map((r) => r.name)).toEqual(['admin', 'session']);
  });

  it('appends to an existing doc, keeping its rules and signers', () => {
    const { doc, signerId } = upsertSessionRule(baseDoc, draft, Networks.TESTNET);
    expect(signerId).toBe('session');
    expect(doc.rules.map((r) => r.name)).toEqual(['pay', 'ops', 'session']);
    expect(doc.signers.map((s) => s.id)).toEqual(['owner', 'ops', 'session']);
    const d = diffPolicyDocs(baseDoc, doc);
    expect(d.rulesAdded.map((r) => r.name)).toEqual(['session']);
    expect(d.rulesRemoved).toEqual([]);
    expect(d.rulesModified).toEqual([]);
  });

  it('reuses an existing declaration for the same key', () => {
    const { doc, signerId } = upsertSessionRule(
      baseDoc,
      { ...draft, sessionAddress: G1 },
      Networks.TESTNET,
    );
    expect(signerId).toBe('ops');
    expect(doc.signers.map((s) => s.id)).toEqual(['owner', 'ops']);
  });

  it('allocates a fresh id on collision and prunes orphaned signers on replace', () => {
    // First install a 'session' rule for G2, then replace it with one for a
    // different key: the old declaration must not linger unreferenced.
    const first = upsertSessionRule(baseDoc, draft, Networks.TESTNET).doc;
    const G3 = 'GCS7RFDDWSU2S2KYWEZDGHDGYUHM2VZWMCDTFP7ZS3MK7RY2VUXQ5D67';
    const second = upsertSessionRule(first, { ...draft, sessionAddress: G3 }, Networks.TESTNET);
    expect(second.signerId).toBe('session-2');
    expect(second.doc.signers.map((s) => s.id)).toEqual(['owner', 'ops', 'session-2']);
    const d = diffPolicyDocs(first, second.doc);
    expect(d.rulesModified.map((m) => m.name)).toEqual(['session']);
    expect(d.signers.map((s) => [s.decl.id, s.kind])).toEqual([
      ['session-2', 'added'],
      ['session', 'removed'],
    ]);
  });

  it('refuses a cross-network update', () => {
    const bound = ownerAdminBaseline(
      { verifier: VERIFIER, publicKeyHex: OWNER_KEY },
      Networks.TESTNET,
    );
    expect(() => upsertSessionRule(bound, draft, 'Other Net')).toThrow(/bound to/);
  });
});
