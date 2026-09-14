import { describe, it, expect } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { buildPolicyDoc, canonicalJson, docHash, lowerDoc, readPolicy } from './index.js';
import type { ReadPolicyInputs } from './index.js';
import type { ChainRule } from '../policyBlocks/types.js';

const ACCOUNT = StrKey.encodeContract(new Uint8Array(32).fill(0x54));
const TARGET = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';
const VERIFIER = 'CD4IF75DNQJKCT35PAJAQDPW3K337EK6SJZDMQEVLXAH65K7ZVZMLXYN';
const INTERPRETER = StrKey.encodeContract(new Uint8Array(32).fill(0x11));

const OWNER_KEY = new Uint8Array(65).fill(7);

const doc = buildPolicyDoc({
  signers: [{ id: 'owner', kind: 'passkey', verifier: VERIFIER, publicKey: OWNER_KEY }],
  permissions: [
    { name: 'admin', on: 'self-admin', by: ['owner'] },
    { name: 'pay', on: { contract: TARGET }, by: ['owner'], functions: ['transfer'] },
    { name: 'ops', on: { contract: TARGET }, by: ['owner'] },
  ],
});
const lowered = lowerDoc(doc, { account: ACCOUNT });

/** Chain rules exactly as the doc-only `apply_doc` would install them. */
function chainRules(): ChainRule[] {
  return lowered.rules.map((r, i) => ({
    ruleId: i + 1,
    contextType: { kind: 'call-contract', contract: r.contract } as const,
    name: r.name,
    signers: r.signers.map((s) => ({ ...s })),
    policies: r.program !== undefined ? [INTERPRETER] : [],
    validUntil: r.validUntil ?? null,
  }));
}

function inputs(overrides: Partial<ReadPolicyInputs> = {}): ReadPolicyInputs {
  return {
    chainRules: chainRules(),
    appliedDocHash: docHash(doc),
    storedDocJson: canonicalJson(doc),
    decompileCtx: { account: ACCOUNT, interpreterAddress: INTERPRETER },
    ...overrides,
  };
}

describe('readPolicy: tier a (doc-verified)', () => {
  it('verifies the on-chain doc copy (view-first, no event needed) against the stored hash', () => {
    const res = readPolicy(inputs());
    expect(res.tier).toBe('doc-verified');
    expect(res.docHash).toBe(docHash(doc));
    expect(res.doc?.rules.map((r) => r.name)).toEqual(['admin', 'pay', 'ops']);
  });

  it('verifies an event-recovered doc when the on-chain view is not fetched', () => {
    const res = readPolicy(
      inputs({ storedDocJson: undefined, eventDocJson: canonicalJson(doc) }),
    );
    expect(res.tier).toBe('doc-verified');
    expect(res.docHash).toBe(docHash(doc));
  });

  it('falls back from a corrupt view value to a valid event doc', () => {
    const res = readPolicy(
      inputs({ storedDocJson: 'not json at all', eventDocJson: canonicalJson(doc) }),
    );
    expect(res.tier).toBe('doc-verified');
    expect(res.docHash).toBe(docHash(doc));
  });
});

describe('readPolicy: tier b (decompiled fallback)', () => {
  it('falls back when the account never applied a document', () => {
    const res = readPolicy(
      inputs({ appliedDocHash: null, storedDocJson: undefined, eventDocJson: undefined }),
    );
    expect(res.tier).toBe('decompiled');
    expect(res.decompiled?.rules.length).toBe(3);
    expect(res.doc).toBeUndefined();
  });

  it('falls back when no doc source is available', () => {
    const res = readPolicy(inputs({ storedDocJson: undefined, eventDocJson: undefined }));
    expect(res.tier).toBe('decompiled');
  });

  it('falls back when every candidate fails hash verification', () => {
    const other = buildPolicyDoc({
      signers: [{ id: 'owner', kind: 'passkey', verifier: VERIFIER, publicKey: OWNER_KEY }],
      permissions: [{ name: 'other', on: { contract: TARGET }, by: ['owner'] }],
    });
    const res = readPolicy(
      inputs({ storedDocJson: canonicalJson(other), eventDocJson: canonicalJson(other) }),
    );
    expect(res.tier).toBe('decompiled');
  });
});
