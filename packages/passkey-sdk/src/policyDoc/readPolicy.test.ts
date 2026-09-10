import { describe, it, expect } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import {
  buildPolicyDoc,
  canonicalJson,
  docHash,
  lowerDoc,
  readPolicy,
} from './index.js';
import type { ReadPolicyInputs } from './index.js';
import type { ChainRule } from '../policyBlocks/types.js';

const ACCOUNT = StrKey.encodeContract(new Uint8Array(32).fill(0x54));
const TARGET = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';
const VERIFIER = 'CD4IF75DNQJKCT35PAJAQDPW3K337EK6SJZDMQEVLXAH65K7ZVZMLXYN';
const INTERPRETER = StrKey.encodeContract(new Uint8Array(32).fill(0x11));

const OWNER_KEY = new Uint8Array(65).fill(7);
const PASSKEY = new Uint8Array(65).fill(9);

const doc = buildPolicyDoc({
  signers: [{ id: 'owner', kind: 'passkey', verifier: VERIFIER, publicKey: OWNER_KEY }],
  permissions: [
    { name: 'pay', on: { contract: TARGET }, by: ['owner'], functions: ['transfer'] },
    { name: 'ops', on: { contract: TARGET }, by: ['owner'] },
  ],
});
const lowered = lowerDoc(doc, { account: ACCOUNT });

/** The account's default passkey rule — NOT doc-managed; must never affect
 *  the doc tiers. */
const defaultRule: ChainRule = {
  ruleId: 0,
  contextType: { kind: 'default' },
  name: 'default',
  signers: [{ kind: 'external', verifier: VERIFIER, publicKey: PASSKEY }],
  policies: [],
  validUntil: null,
};

/** Chain rules exactly as the contract's `apply_doc` would install them. */
function freshChainRules(): ChainRule[] {
  return [
    defaultRule,
    ...lowered.rules.map((r, i) => ({
      ruleId: i + 1,
      contextType: { kind: 'call-contract', contract: r.contract } as const,
      name: r.name,
      signers: r.signers.map((s) => ({ ...s })),
      policies: r.program !== undefined ? [INTERPRETER] : [],
      validUntil: r.validUntil ?? null,
    })),
  ];
}

function inputs(overrides: Partial<ReadPolicyInputs> = {}): ReadPolicyInputs {
  return {
    chainRules: freshChainRules(),
    appliedDocHash: docHash(doc),
    docRuleIds: [1, 2],
    eventDocJson: canonicalJson(doc),
    decompileCtx: { account: ACCOUNT, interpreterAddress: INTERPRETER },
    ...overrides,
  };
}

describe('readPolicy: tier a (doc-verified)', () => {
  it('verifies an event-recovered doc against the stored hash and live rules', () => {
    const res = readPolicy(inputs());
    expect(res.tier).toBe('doc-verified');
    expect(res.docHash).toBe(docHash(doc));
    expect(res.doc?.rules.map((r) => r.name)).toEqual(['pay', 'ops']);
    expect(res.drift).toBeUndefined();
  });

  it('is indifferent to non-doc rules (hybrid coexistence)', () => {
    const chainRules = freshChainRules();
    chainRules.push({
      ruleId: 9,
      contextType: { kind: 'call-contract', contract: ACCOUNT },
      name: 'legacy-session',
      signers: [{ kind: 'delegated', address: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ' }],
      policies: [],
      validUntil: null,
    });
    expect(readPolicy(inputs({ chainRules })).tier).toBe('doc-verified');
  });
});

describe('readPolicy: tier b (doc-drift)', () => {
  it('flags a signer added to a doc rule via the legacy mutators', () => {
    const chainRules = freshChainRules();
    chainRules[1].signers.push({ kind: 'delegated', address: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ' });
    const res = readPolicy(inputs({ chainRules }));
    expect(res.tier).toBe('doc-drift');
    expect(res.doc).toBeDefined();
    expect(res.drift?.some((d) => /signer .* added on chain/.test(d))).toBe(true);
  });

  it('flags a doc-managed rule removed via the legacy mutators', () => {
    const chainRules = freshChainRules().filter((r) => r.ruleId !== 2);
    const res = readPolicy(inputs({ chainRules }));
    expect(res.tier).toBe('doc-drift');
    expect(res.drift?.some((d) => /no longer exists/.test(d))).toBe(true);
  });

  it('flags an interpreter program committing to a different doc_hash', () => {
    const program = lowered.rules[0].program;
    expect(program).toBeDefined();
    const res = readPolicy(
      inputs({
        decompileCtx: {
          account: ACCOUNT,
          interpreterAddress: INTERPRETER,
          programs: { 1: { program: program!, docHash: '00'.repeat(32) } },
        },
      }),
    );
    expect(res.tier).toBe('doc-drift');
    expect(res.drift?.some((d) => /different doc_hash/.test(d))).toBe(true);
  });
});

describe('readPolicy: tier c (decompiled fallback)', () => {
  it('falls back when the account never applied a document', () => {
    const res = readPolicy(inputs({ appliedDocHash: null, eventDocJson: undefined }));
    expect(res.tier).toBe('decompiled');
    expect(res.decompiled?.rules.length).toBe(3);
    expect(res.doc).toBeUndefined();
  });

  it('falls back when event history no longer reaches the DocApplied event', () => {
    expect(readPolicy(inputs({ eventDocJson: undefined })).tier).toBe('decompiled');
  });

  it('falls back when the recovered doc fails hash verification', () => {
    const other = buildPolicyDoc({
      signers: [{ id: 'owner', kind: 'passkey', verifier: VERIFIER, publicKey: OWNER_KEY }],
      permissions: [{ name: 'other', on: { contract: TARGET }, by: ['owner'] }],
    });
    const res = readPolicy(inputs({ eventDocJson: canonicalJson(other) }));
    expect(res.tier).toBe('decompiled');
  });
});
