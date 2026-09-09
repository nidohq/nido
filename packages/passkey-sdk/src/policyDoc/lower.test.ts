import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { StrKey } from '@stellar/stellar-sdk';
import { lowerDoc, parsePolicyDoc, scopedSessionKeyDoc, validateProgram, buildPolicyDoc } from './index.js';
import type { PolicyDoc } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const td = (n: string) => resolve(here, '../../../perch/testdata', n);

const ACCOUNT = StrKey.encodeContract(new Uint8Array(32).fill(0x54));
const TARGET = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';
const SESSION_G = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

describe('lowerDoc: ci-publish fixture', () => {
  const doc = parsePolicyDoc(JSON.parse(readFileSync(td('ci-publish.json'), 'utf8')));
  const lowered = lowerDoc(doc, { account: ACCOUNT });

  it('carries the golden doc hash', () => {
    expect(lowered.docHash).toBe('27cb38ef07bd8e4f86f07bef4d9272c070c2d9f05063d4c1ad1d4769b1d74a98');
  });

  it('lowers the bare self-admin rule policy-free onto the account itself', () => {
    const admin = lowered.rules[0];
    expect(admin.name).toBe('admin');
    expect(admin.contract).toBe(ACCOUNT);
    expect(admin.program).toBeUndefined();
    expect(admin.cap).toBeUndefined();
    expect(admin.validUntil).toBeUndefined();
    expect(admin.signers).toHaveLength(1);
    expect(admin.signers[0].kind).toBe('external');
  });

  it('lowers the constrained rule to the canonical interpreter program', () => {
    const ci = lowered.rules[1];
    expect(ci.contract).toBe(TARGET);
    // not-after-ledger is exclusive, OZ valid_until inclusive: X - 1.
    expect(ci.validUntil).toBe(54_999_999);
    expect(ci.program).toEqual({
      version: 1,
      ops: [
        { tag: 'MinSigners', values: [1] },
        { tag: 'FnIn', values: [['publish', 'publish_hash']] },
        { tag: 'ArgAddrIsSelf', values: [1] },
        { tag: 'All', values: [3] },
      ],
    });
    expect(validateProgram(ci.program!)).toBeNull();
    expect(lowered.usesInterpreter).toBe(true);
    expect(lowered.usesSpendingLimit).toBe(false);
  });
});

describe('lowerDoc: v1 scoped-session-key template', () => {
  const doc = scopedSessionKeyDoc({
    sessionAddress: SESSION_G,
    targetContract: TARGET,
    functions: ['transfer'],
    notAfterLedger: 1_000_000,
    cap: { limitStroops: 50_000_000n, periodLedgers: 17_280 },
  });

  it('produces a delegated signer and one capped, constrained rule', () => {
    expect(doc.signers).toEqual([{ id: 'session', address: SESSION_G }]);
    expect(doc.rules[0].cap).toEqual({ limit: '50000000', 'period-ledgers': 17_280 });
  });

  it('lowers to interpreter + spending-limit on the same rule', () => {
    const lowered = lowerDoc(doc, { account: ACCOUNT });
    expect(lowered.rules).toHaveLength(1);
    const rule = lowered.rules[0];
    expect(rule.signers).toEqual([{ kind: 'delegated', address: SESSION_G }]);
    expect(rule.validUntil).toBe(999_999);
    // A capped rule always attaches the interpreter too (INV-1): the
    // MinSigners floor must hold independently of spending-limit.
    expect(rule.program).toEqual({
      version: 1,
      ops: [
        { tag: 'MinSigners', values: [1] },
        { tag: 'FnIn', values: [['transfer']] },
        { tag: 'All', values: [2] },
      ],
    });
    expect(rule.cap).toEqual({ limitStroops: 50_000_000n, periodLedgers: 17_280 });
    expect(lowered.usesSpendingLimit).toBe(true);
  });

  it('carries the doc network binding through lowering', () => {
    expect(lowerDoc(doc, { account: ACCOUNT }).network).toBeUndefined();
    const bound = scopedSessionKeyDoc({
      sessionAddress: SESSION_G,
      targetContract: TARGET,
      network: 'Test SDF Network ; September 2015',
    });
    expect(lowerDoc(bound, { account: ACCOUNT }).network).toBe('Test SDF Network ; September 2015');
  });
});

describe('lowerDoc: fail-closed errors', () => {
  const base = (over: Partial<Record<string, unknown>>): PolicyDoc =>
    parsePolicyDoc({
      version: 1,
      signers: [{ id: 's', address: SESSION_G }],
      rules: [
        {
          name: 'r',
          scope: { type: 'contract', address: TARGET },
          principals: { type: 'all', signers: ['s'] },
          ...over,
        },
      ],
    });

  it('rejects an undeclared signer reference', () => {
    const doc = parsePolicyDoc({
      version: 1,
      signers: [],
      rules: [
        { name: 'r', scope: { type: 'self-admin' }, principals: { type: 'all', signers: ['ghost'] } },
      ],
    });
    expect(() => lowerDoc(doc, { account: ACCOUNT })).toThrow(/undeclared signer id "ghost"/);
  });

  it('rejects empty principals', () => {
    const doc = parsePolicyDoc({
      version: 1,
      signers: [{ id: 's', address: SESSION_G }],
      rules: [{ name: 'r', scope: { type: 'self-admin' }, principals: { type: 'all', signers: [] } }],
    });
    expect(() => lowerDoc(doc, { account: ACCOUNT })).toThrow(/non-empty/);
  });

  it('rejects self-authenticating principals (needs a policy-call op not in v1)', () => {
    const doc = parsePolicyDoc({
      version: 1,
      signers: [],
      rules: [
        {
          name: 'r',
          scope: { type: 'contract', address: TARGET },
          principals: {
            type: 'self-authenticating',
            policy: TARGET,
            'install-param-hex': '',
            ack: 'this-policy-authenticates-or-anyone-can-fire-this-rule',
          },
        },
      ],
    });
    expect(() => lowerDoc(doc, { account: ACCOUNT })).toThrow(/self-authenticating/);
  });

  it('rejects a cap on a self-admin scope', () => {
    const doc = parsePolicyDoc({
      version: 1,
      signers: [{ id: 's', address: SESSION_G }],
      rules: [
        {
          name: 'r',
          scope: { type: 'self-admin' },
          principals: { type: 'all', signers: ['s'] },
          cap: { limit: '10', 'period-ledgers': 100 },
        },
      ],
    });
    expect(() => lowerDoc(doc, { account: ACCOUNT })).toThrow(/contract scope/);
  });

  it('rejects a cap token that differs from the rule scope', () => {
    const doc = base({
      cap: { token: ACCOUNT, limit: '10', 'period-ledgers': 100 },
    });
    expect(() => lowerDoc(doc, { account: ACCOUNT })).toThrow(/silently meter a different contract/);
  });

  it('rejects a non-positive or non-decimal cap limit', () => {
    expect(() =>
      lowerDoc(base({ cap: { limit: '0', 'period-ledgers': 100 } }), { account: ACCOUNT }),
    ).toThrow(/out of range/);
    expect(() =>
      lowerDoc(base({ cap: { limit: '-5', 'period-ledgers': 100 } }), { account: ACCOUNT }),
    ).toThrow(/not a positive decimal/);
  });

  it('rejects a zero cap period', () => {
    expect(() =>
      lowerDoc(base({ cap: { limit: '10', 'period-ledgers': 0 } }), { account: ACCOUNT }),
    ).toThrow(/non-zero/);
  });

  it('rejects not-after-ledger 0 (would underflow OZ valid_until)', () => {
    expect(() => lowerDoc(base({ 'not-after-ledger': 0 }), { account: ACCOUNT })).toThrow(/>= 1/);
  });

  it('rejects duplicate signer ids and duplicate rule names', () => {
    expect(() =>
      lowerDoc(
        parsePolicyDoc({
          version: 1,
          signers: [
            { id: 's', address: SESSION_G },
            { id: 's', address: SESSION_G },
          ],
          rules: [],
        }),
        { account: ACCOUNT },
      ),
    ).toThrow(/duplicate signer id/);
    expect(() =>
      lowerDoc(
        buildPolicyDoc({
          signers: [{ id: 's', kind: 'delegated', address: SESSION_G }],
          permissions: [
            { name: 'r', on: 'self-admin', by: ['s'] },
            { name: 'r', on: 'self-admin', by: ['s'] },
          ],
        }),
        { account: ACCOUNT },
      ),
    ).toThrow(/duplicate rule name/);
  });
});

describe('validateProgram', () => {
  it('accepts the canonical shapes and rejects structural breakage', () => {
    expect(validateProgram({ version: 1, ops: [{ tag: 'MinSigners', values: [1] }] })).toBeNull();
    expect(validateProgram({ version: 2, ops: [{ tag: 'MinSigners', values: [1] }] })).toMatch(
      /unknown version/,
    );
    expect(validateProgram({ version: 1, ops: [] })).toMatch(/empty/);
    expect(
      validateProgram({ version: 1, ops: [{ tag: 'All', values: [0] }] }),
    ).toMatch(/arity/);
    expect(
      validateProgram({ version: 1, ops: [{ tag: 'Not', values: undefined as never }] }),
    ).toMatch(/underflow/);
    expect(
      validateProgram({
        version: 1,
        ops: [
          { tag: 'MinSigners', values: [1] },
          { tag: 'MinSigners', values: [1] },
        ],
      }),
    ).toMatch(/leaves 2 results/);
  });
});
