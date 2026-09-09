import { describe, it, expect } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import type { ChainRule } from '../policyBlocks/types.js';
import {
  buildPolicyDoc,
  decompileRules,
  docHash,
  lowerDoc,
  scopedSessionKeyDoc,
} from './index.js';
import type { DecompileContext, LoweredDoc, LoweredRule } from './index.js';

const ACCOUNT = StrKey.encodeContract(new Uint8Array(32).fill(0x54));
const TARGET = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';
const INTERPRETER = StrKey.encodeContract(new Uint8Array(32).fill(0x11));
const SPENDING_LIMIT = StrKey.encodeContract(new Uint8Array(32).fill(0x22));
const MULTISIG = StrKey.encodeContract(new Uint8Array(32).fill(0x33));
const SESSION_G = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

const CTX: DecompileContext = {
  account: ACCOUNT,
  interpreterAddress: INTERPRETER,
  spendingLimitAddress: SPENDING_LIMIT,
  multisigPolicyAddress: MULTISIG,
};

/** Synthesize the ChainRule OZ would store for a lowered rule, plus the
 *  fetched-context entries a caller would supply. */
function toChain(lowered: LoweredDoc, rule: LoweredRule, ruleId: number): {
  chainRule: ChainRule;
  ctx: Pick<DecompileContext, 'programs' | 'spendingLimits'>;
} {
  const policies: string[] = [];
  const ctx: { programs: NonNullable<DecompileContext['programs']>; spendingLimits: NonNullable<DecompileContext['spendingLimits']> } = {
    programs: {},
    spendingLimits: {},
  };
  if (rule.program) {
    policies.push(INTERPRETER);
    ctx.programs[ruleId] = { program: rule.program, docHash: lowered.docHash };
  }
  if (rule.cap) {
    policies.push(SPENDING_LIMIT);
    ctx.spendingLimits[ruleId] = rule.cap;
  }
  return {
    chainRule: {
      ruleId,
      contextType: { kind: 'call-contract', contract: rule.contract },
      name: rule.name,
      signers: rule.signers,
      policies,
      validUntil: rule.validUntil ?? null,
    },
    ctx,
  };
}

describe('decompileRules: round-trip of the v1 template', () => {
  const original = scopedSessionKeyDoc({
    sessionAddress: SESSION_G,
    targetContract: TARGET,
    functions: ['transfer'],
    notAfterLedger: 1_000_000,
    cap: { limitStroops: 50_000_000n, periodLedgers: 17_280 },
  });
  const lowered = lowerDoc(original, { account: ACCOUNT });
  const { chainRule, ctx } = toChain(lowered, lowered.rules[0], 7);
  const result = decompileRules([chainRule], { ...CTX, ...ctx });

  it('maps the rule back to the original doc-rule semantics', () => {
    expect(result.rules).toHaveLength(1);
    const entry = result.rules[0];
    expect(entry.kind).toBe('doc');
    if (entry.kind !== 'doc') return;
    expect(entry.rule).toEqual({
      name: 'session',
      scope: { type: 'contract', address: TARGET },
      principals: { type: 'all', signers: ['delegated-1'] },
      functions: ['transfer'],
      'not-after-ledger': 1_000_000,
      cap: { limit: '50000000', 'period-ledgers': 17_280 },
    });
    expect(entry.signers).toEqual([{ id: 'delegated-1', address: SESSION_G }]);
  });

  it('reports the doc_hash the on-chain program committed to', () => {
    expect(result.committedDocHashes).toEqual([docHash(original)]);
  });

  it('assembles a valid doc view whose semantics survive re-lowering', () => {
    expect(result.doc).not.toBeNull();
    expect(result.docHash).not.toBeNull();
    const relowered = lowerDoc(result.doc!, { account: ACCOUNT });
    expect(relowered.rules).toEqual(lowered.rules);
  });
});

describe('decompileRules: bare and self-admin rules', () => {
  const doc = buildPolicyDoc({
    signers: [{ id: 'admin', kind: 'delegated', address: SESSION_G }],
    permissions: [{ name: 'admin', on: 'self-admin', by: ['admin'] }],
  });
  const lowered = lowerDoc(doc, { account: ACCOUNT });

  it('maps a policy-free CallContract(self) rule back to self-admin', () => {
    const { chainRule } = toChain(lowered, lowered.rules[0], 0);
    const result = decompileRules([chainRule], CTX);
    const entry = result.rules[0];
    expect(entry.kind).toBe('doc');
    if (entry.kind !== 'doc') return;
    expect(entry.rule.scope).toEqual({ type: 'self-admin' });
    expect(entry.committedDocHash).toBeUndefined();
  });

  it('dedupes one signer appearing in several rules', () => {
    const a = toChain(lowered, lowered.rules[0], 0).chainRule;
    const b: ChainRule = { ...a, ruleId: 1, name: 'second', contextType: { kind: 'call-contract', contract: TARGET } };
    const result = decompileRules([a, b], CTX);
    expect(result.doc?.signers).toEqual([{ id: 'delegated-1', address: SESSION_G }]);
  });
});

describe('decompileRules: raw fallbacks', () => {
  const passkey = new Uint8Array(65).fill(7);
  const bare = (over: Partial<ChainRule>): ChainRule => ({
    ruleId: 3,
    contextType: { kind: 'call-contract', contract: TARGET },
    name: 'r',
    signers: [{ kind: 'external', verifier: INTERPRETER, publicKey: passkey }],
    policies: [],
    validUntil: null,
    ...over,
  });

  const reasonOf = (rule: ChainRule, ctx: DecompileContext = CTX): string => {
    const entry = decompileRules([rule], ctx).rules[0];
    expect(entry.kind).toBe('raw');
    return entry.kind === 'raw' ? entry.reason : '';
  };

  it('default-context rules fall back to raw', () => {
    expect(reasonOf(bare({ contextType: { kind: 'default' } }))).toMatch(/no doc equivalent/);
  });

  it('zero-signer rules fall back to raw', () => {
    expect(reasonOf(bare({ signers: [] }))).toMatch(/zero-signer/);
  });

  it('multisig (threshold) rules fall back to raw with a clear reason', () => {
    expect(reasonOf(bare({ policies: [MULTISIG] }))).toMatch(/threshold/);
  });

  it('unrecognized policies fall back to raw', () => {
    const other = StrKey.encodeContract(new Uint8Array(32).fill(0x99));
    expect(reasonOf(bare({ policies: [other] }))).toMatch(/unrecognized policy/);
  });

  it('interpreter rules without a fetched program fall back to raw', () => {
    expect(reasonOf(bare({ policies: [INTERPRETER] }))).toMatch(/not fetched/);
  });

  it('M-of-N interpreter programs fall back to raw', () => {
    const rule = bare({
      policies: [INTERPRETER],
      signers: [
        { kind: 'delegated', address: SESSION_G },
        { kind: 'external', verifier: INTERPRETER, publicKey: passkey },
      ],
    });
    const ctx: DecompileContext = {
      ...CTX,
      programs: {
        3: {
          program: {
            version: 1,
            ops: [
              { tag: 'MinSigners', values: [1] },
              { tag: 'All', values: [1] },
            ],
          },
          docHash: 'ab'.repeat(32),
        },
      },
    };
    expect(reasonOf(rule, ctx)).toMatch(/M-of-N quorum/);
  });

  it('non-canonical interpreter programs fall back to raw', () => {
    const rule = bare({ policies: [INTERPRETER], signers: [{ kind: 'delegated', address: SESSION_G }] });
    const program = (ops: NonNullable<DecompileContext['programs']>[number]['program']['ops']): DecompileContext => ({
      ...CTX,
      programs: { 3: { program: { version: 1, ops }, docHash: 'ab'.repeat(32) } },
    });
    expect(
      reasonOf(rule, program([
        { tag: 'LedgerBefore', values: [10] },
        { tag: 'All', values: [1] },
      ])),
    ).toMatch(/starts with LedgerBefore/);
    expect(
      reasonOf(rule, program([
        { tag: 'MinSigners', values: [1] },
        { tag: 'LedgerBefore', values: [10] },
        { tag: 'All', values: [2] },
      ])),
    ).toMatch(/LedgerBefore has no doc equivalent/);
    expect(
      reasonOf(rule, program([
        { tag: 'MinSigners', values: [1] },
        { tag: 'Not', values: undefined as never },
      ])),
    ).toMatch(/does not end with All/);
  });

  it('a raw rule never leaks signer declarations into the doc view', () => {
    const result = decompileRules([bare({ policies: [MULTISIG] })], CTX);
    expect(result.doc).toBeNull();
    expect(result.docHash).toBeNull();
  });
});
