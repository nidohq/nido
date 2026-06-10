import { describe, it, expect } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { scopedSessionKeyModule, formatSpendingLimit } from './scopedSessionKey.js';
import type { ChainRule, LocalOverlay } from './types.js';

const TARGET = StrKey.encodeContract(new Uint8Array(32).fill(0x54));
const VERIFIER = StrKey.encodeContract(new Uint8Array(32).fill(0x56));

describe('scopedSessionKeyModule', () => {
  it('claims a CallContract rule with one external signer and no policies', () => {
    const pub = new Uint8Array(65);
    pub[0] = 0x04;
    const rule: ChainRule = {
      ruleId: 9,
      contextType: { kind: 'call-contract', contract: TARGET },
      name: 'session',
      signers: [{ kind: 'external', verifier: VERIFIER, publicKey: pub }],
      policies: [],
      validUntil: 99999,
    };
    const overlay: LocalOverlay = {
      friendNicknames: {},
      sessionKeyMaterial: {
        [TARGET]: {
          privateKey: new Uint8Array(32),
          credentialId: 'sk-1',
          label: 'status-message',
        },
      },
      blockLabels: {},
    };
    const block = scopedSessionKeyModule.fromChain(rule, {}, overlay);
    expect(block).toMatchObject({
      kind: 'scoped-session-key',
      ruleId: 9,
      targetContract: TARGET,
      validUntil: 99999,
      label: 'status-message',
      credentialId: 'sk-1',
    });
  });

  it('returns null for rules with attached policies (those are multisig)', () => {
    const policyAddr = StrKey.encodeContract(new Uint8Array(32).fill(0x70));
    const friend = StrKey.encodeContract(new Uint8Array(32).fill(0x58));
    const rule: ChainRule = {
      ruleId: 1,
      contextType: { kind: 'call-contract', contract: TARGET },
      name: 'recovery',
      signers: [{ kind: 'delegated', address: friend }],
      policies: [policyAddr],
      validUntil: null,
    };
    expect(
      scopedSessionKeyModule.fromChain(rule, {}, {
        friendNicknames: {}, sessionKeyMaterial: {}, blockLabels: {},
      }),
    ).toBeNull();
  });

  it('summarizes with expiry text when valid_until is set', () => {
    const s = scopedSessionKeyModule.summarize({
      kind: 'scoped-session-key',
      targetContract: TARGET,
      sessionPubkey: new Uint8Array(65),
      credentialId: 'sk-1',
      validUntil: 12345,
    });
    expect(s).toMatch(/expires/);
    expect(s).not.toMatch(/limit/);
  });

  it('claims a rule whose single policy carries spending-limit state', () => {
    const limitPolicy = StrKey.encodeContract(new Uint8Array(32).fill(0x71));
    const rule: ChainRule = {
      ruleId: 4,
      contextType: { kind: 'call-contract', contract: TARGET },
      name: 'session-key',
      signers: [{ kind: 'external', verifier: VERIFIER, publicKey: new Uint8Array(65) }],
      policies: [limitPolicy],
      validUntil: 7777,
    };
    const state = {
      [limitPolicy]: { spendingLimit: { stroops: 50_000_000n, periodLedgers: 17280 } },
    };
    const block = scopedSessionKeyModule.fromChain(rule, state, {
      friendNicknames: {}, sessionKeyMaterial: {}, blockLabels: {},
    });
    expect(block).toMatchObject({
      kind: 'scoped-session-key',
      ruleId: 4,
      targetContract: TARGET,
      limitStroops: 50_000_000n,
      limitPeriodLedgers: 17280,
    });
  });

  it('returns null for rules with two or more policies, even if one carries a limit', () => {
    const limitPolicy = StrKey.encodeContract(new Uint8Array(32).fill(0x71));
    const otherPolicy = StrKey.encodeContract(new Uint8Array(32).fill(0x72));
    const rule: ChainRule = {
      ruleId: 6,
      contextType: { kind: 'call-contract', contract: TARGET },
      name: 'session-key',
      signers: [{ kind: 'external', verifier: VERIFIER, publicKey: new Uint8Array(65) }],
      policies: [limitPolicy, otherPolicy],
      validUntil: null,
    };
    const state = {
      [limitPolicy]: { spendingLimit: { stroops: 50_000_000n, periodLedgers: 17280 } },
      [otherPolicy]: {},
    };
    expect(
      scopedSessionKeyModule.fromChain(rule, state, {
        friendNicknames: {}, sessionKeyMaterial: {}, blockLabels: {},
      }),
    ).toBeNull();
  });

  it('returns null when the attached policy has no spending-limit state', () => {
    const policyAddr = StrKey.encodeContract(new Uint8Array(32).fill(0x70));
    const rule: ChainRule = {
      ruleId: 5,
      contextType: { kind: 'call-contract', contract: TARGET },
      name: 'something-else',
      signers: [{ kind: 'external', verifier: VERIFIER, publicKey: new Uint8Array(65) }],
      policies: [policyAddr],
      validUntil: null,
    };
    expect(
      scopedSessionKeyModule.fromChain(rule, { [policyAddr]: { threshold: 2 } }, {
        friendNicknames: {}, sessionKeyMaterial: {}, blockLabels: {},
      }),
    ).toBeNull();
  });

  it('summarize appends the limit text when limit fields are present', () => {
    const s = scopedSessionKeyModule.summarize({
      kind: 'scoped-session-key',
      targetContract: TARGET,
      sessionPubkey: new Uint8Array(65),
      credentialId: 'sk-1',
      validUntil: 12345,
      limitStroops: 50_000_000n,
      limitPeriodLedgers: 17280,
    });
    expect(s).toContain(' · limit 5 XLM per day');
    expect(s).toMatch(/expires/);
  });
});

describe('formatSpendingLimit', () => {
  it('maps the known period ledger counts to labels', () => {
    expect(formatSpendingLimit(50_000_000n, 17280)).toBe('5 XLM per day');
    expect(formatSpendingLimit(25_000_000n, 120960)).toBe('2.5 XLM per week');
    expect(formatSpendingLimit(1_000_000_000n, 518400)).toBe('100 XLM per 30 days');
  });

  it('falls back to "per N ledgers" for unknown periods', () => {
    expect(formatSpendingLimit(10_000_000n, 99)).toBe('1 XLM per 99 ledgers');
  });

  it('formats fractional stroops without floats and trims trailing zeros', () => {
    expect(formatSpendingLimit(1n, 17280)).toBe('0.0000001 XLM per day');
    expect(formatSpendingLimit(12_345_000n, 17280)).toBe('1.2345 XLM per day');
  });
});
