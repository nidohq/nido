import { describe, it, expect } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { scopedSessionKeyModule } from './scopedSessionKey.js';
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
  });
});
