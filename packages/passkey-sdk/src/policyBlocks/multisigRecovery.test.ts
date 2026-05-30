import { describe, it, expect } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { multisigRecoveryModule } from './multisigRecovery.js';
import type { ChainRule, LocalOverlay } from './types.js';

const POLICY = StrKey.encodeContract(new Uint8Array(32).fill(0x42));
const F1 = StrKey.encodeContract(new Uint8Array(32).fill(0x01));
const F2 = StrKey.encodeContract(new Uint8Array(32).fill(0x02));
const F3 = StrKey.encodeContract(new Uint8Array(32).fill(0x03));
const SELF = StrKey.encodeContract(new Uint8Array(32).fill(0xAA));

describe('multisigRecoveryModule', () => {
  it('claims a rule scoped to self with the multisig policy attached', () => {
    const rule: ChainRule = {
      ruleId: 5,
      contextType: { kind: 'call-contract', contract: SELF },
      name: 'recovery',
      signers: [
        { kind: 'delegated', address: F1 },
        { kind: 'delegated', address: F2 },
        { kind: 'delegated', address: F3 },
      ],
      policies: [POLICY],
      validUntil: null,
    };
    const overlay: LocalOverlay = {
      friendNicknames: { [F1]: 'Alice', [F2]: 'Bob' },
      sessionKeyMaterial: {},
      blockLabels: { 5: 'My recovery' },
    };
    const block = multisigRecoveryModule.fromChain(
      rule,
      { [POLICY]: { threshold: 2 } },
      overlay,
    );
    expect(block).toMatchObject({
      kind: 'multisig-recovery',
      ruleId: 5,
      threshold: 2,
      label: 'My recovery',
      friends: [
        { address: F1, inputAs: F1, nickname: 'Alice' },
        { address: F2, inputAs: F2, nickname: 'Bob' },
        { address: F3, inputAs: F3 },
      ],
    });
  });

  it('returns null for a rule with no attached policy (not a multisig rule)', () => {
    const rule: ChainRule = {
      ruleId: 1,
      contextType: { kind: 'call-contract', contract: SELF },
      name: 'session',
      signers: [],
      policies: [],
      validUntil: null,
    };
    expect(
      multisigRecoveryModule.fromChain(rule, {}, {
        friendNicknames: {}, sessionKeyMaterial: {}, blockLabels: {},
      }),
    ).toBeNull();
  });

  it('summarizes the block in plain English', () => {
    const s = multisigRecoveryModule.summarize({
      kind: 'multisig-recovery',
      threshold: 2,
      friends: [
        { address: F1, inputAs: 'alice', nickname: 'Alice' },
        { address: F2, inputAs: F2 },
        { address: F3, inputAs: 'carol' },
      ],
    });
    expect(s).toMatch(/2 of 3/);
    expect(s).toMatch(/rotate/);
  });
});
