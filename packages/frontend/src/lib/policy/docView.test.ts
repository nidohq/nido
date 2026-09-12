import { describe, it, expect } from 'vitest';
import { buildPolicyDoc, docHash, scopedSessionKeyDoc } from '@nidohq/passkey-sdk';
import { describeDocRule, describeDocSigner, summarizeDoc } from './docView.js';

const TARGET = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';
const VERIFIER = 'CD4IF75DNQJKCT35PAJAQDPW3K337EK6SJZDMQEVLXAH65K7ZVZMLXYN';
const SESSION_G = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const OWNER_KEY = '04' + 'ab'.repeat(64);

describe('describeDocSigner', () => {
  it('labels a delegated signer with its doc id and address', () => {
    const v = describeDocSigner({ id: 'session', address: SESSION_G });
    expect(v.id).toBe('session');
    expect(v.kind).toBe('delegated');
    expect(v.full).toBe(SESSION_G);
    expect(v.detail).toContain('…');
  });

  it('labels a passkey signer with its doc id and truncated key', () => {
    const v = describeDocSigner({ id: 'owner', verifier: VERIFIER, key: OWNER_KEY });
    expect(v.id).toBe('owner');
    expect(v.kind).toBe('passkey');
    expect(v.full).toBe(OWNER_KEY);
  });
});

describe('describeDocRule', () => {
  const doc = scopedSessionKeyDoc({
    sessionAddress: SESSION_G,
    targetContract: TARGET,
    functions: ['update_message'],
    notAfterLedger: 5000,
    cap: { limitStroops: 100_0000000n, periodLedgers: 17280 },
    name: 'status-session',
  });

  it('keeps the doc rule name, functions, expiry, and cap', () => {
    const v = describeDocRule(doc.rules[0]);
    expect(v.name).toBe('status-session');
    expect(v.contract).toBe(TARGET);
    expect(v.functions).toEqual(['update_message']);
    expect(v.notAfterLedger).toBe(5000);
    expect(v.cap).toEqual({ limit: '1000000000', periodLedgers: 17280 });
    expect(v.signerIds).toEqual(['session']);
  });

  it('writes the permission sentence with the doc names', () => {
    const v = describeDocRule(doc.rules[0]);
    expect(v.permission).toContain('"session"');
    expect(v.permission).toContain('update_message');
  });

  it('treats absent functions as any-function and absent expiry as none', () => {
    const bare = scopedSessionKeyDoc({ sessionAddress: SESSION_G, targetContract: TARGET });
    const v = describeDocRule(bare.rules[0]);
    expect(v.functions).toBeNull();
    expect(v.notAfterLedger).toBeNull();
    expect(v.cap).toBeNull();
    expect(v.permission).toContain('any function');
  });

  it('labels a threshold quorum', () => {
    const doc2 = buildPolicyDoc({
      signers: [
        { id: 'a', kind: 'delegated', address: SESSION_G },
        { id: 'b', kind: 'passkey', verifier: VERIFIER, publicKey: OWNER_KEY },
      ],
      permissions: [{ name: 'ops', on: { contract: TARGET }, by: ['a', 'b'] }],
    });
    // requestToPolicyDoc only emits `all` principals; patch to threshold to
    // exercise the label without hand-writing a whole doc.
    const rule = { ...doc2.rules[0], principals: { type: 'threshold' as const, signers: ['a', 'b'], m: 1 } };
    const v = describeDocRule(rule);
    expect(v.quorumLabel).toBe('Any 1 of 2');
    expect(v.permission).toContain('any 1 of');
  });
});

describe('summarizeDoc', () => {
  const doc = scopedSessionKeyDoc({
    sessionAddress: SESSION_G,
    targetContract: TARGET,
    functions: ['update_message'],
    name: 'status-session',
  });
  const hash = docHash(doc);

  it('carries the doc hash badge, signers, and rules', () => {
    const m = summarizeDoc(doc, hash);
    expect(m.docHash).toBe(hash);
    expect(m.docHashShort).toContain('…');
    expect(m.signers).toHaveLength(1);
    expect(m.rules).toHaveLength(1);
  });
});

describe('renderDocPreviewHtml', () => {
  it('renders rule cards with the doc names and tucks the JSON behind a toggle', async () => {
    const { renderDocPreviewHtml } = await import('../../components/PolicyInspector.js');
    const { canonicalJson } = await import('@nidohq/passkey-sdk');
    const doc = scopedSessionKeyDoc({
      sessionAddress: SESSION_G,
      targetContract: TARGET,
      functions: ['update_message'],
      notAfterLedger: 5000,
      name: 'status-session',
    });
    const html = renderDocPreviewHtml(summarizeDoc(doc, docHash(doc)), canonicalJson(doc));
    expect(html).toContain('status-session');
    expect(html).toContain('update_message');
    expect(html).toContain('"session"'); // the doc's own signer id
    expect(html).toContain('Stops at ledger 5,000');
    // Raw JSON is available but folded, not dumped.
    expect(html).toContain('<details');
    expect(html).toContain('Raw document JSON');
  });
});

describe('admin single-list rendering', () => {
  it('marks admin rules in the display model', async () => {
    const { Networks } = await import('@stellar/stellar-sdk');
    const { ownerAdminBaseline } = await import('./docDraft.js');
    const baseline = ownerAdminBaseline(
      { verifier: VERIFIER, publicKeyHex: OWNER_KEY },
      Networks.TESTNET,
    );
    expect(describeDocRule(baseline.rules[0]).isAdmin).toBe(true);
    const session = scopedSessionKeyDoc({ sessionAddress: SESSION_G, targetContract: TARGET });
    expect(describeDocRule(session.rules[0]).isAdmin).toBe(false);
  });

  it('folds all admin rules into ONE Admin-keys card in the doc view', async () => {
    const { Networks } = await import('@stellar/stellar-sdk');
    const { addAdminKey, ownerAdminBaseline } = await import('./docDraft.js');
    const { renderDocPolicy } = await import('../../components/PolicyInspector.js');
    const { docHash: hashOf } = await import('@nidohq/passkey-sdk');
    const baseline = ownerAdminBaseline(
      { verifier: VERIFIER, publicKeyHex: OWNER_KEY },
      Networks.TESTNET,
    );
    const twoAdmins = addAdminKey(
      baseline,
      { name: 'admin-2', signer: { kind: 'delegated', address: SESSION_G } },
      Networks.TESTNET,
    ).doc;
    const el = document.createElement('div');
    renderDocPolicy(el, summarizeDoc(twoAdmins, hashOf(twoAdmins)), {});
    // ONE consolidated card listing both keys ("any may act"), no per-rule
    // admin cards.
    expect(el.querySelectorAll('[data-doc-admins]')).toHaveLength(1);
    const card = el.querySelector('[data-doc-admins]')!;
    expect(card.textContent).toContain('"owner"');
    expect(card.textContent).toContain('"admin-2"');
    expect(card.textContent).toContain('Any of these');
    expect(el.querySelectorAll('[data-doc-rule]')).toHaveLength(0);
  });
});
