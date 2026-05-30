import { describe, it, expect, vi } from 'vitest';
import { loadPolicyBlocks } from './loadBlocks.js';
import type { ChainRule, LocalOverlay, PolicyBlock, PolicyBlockModule } from './types.js';
import { registerPolicyBlockModule } from './index.js';

const FAKE_MULTISIG_ADDR = 'C' + 'M'.repeat(55);
const FAKE_TARGET = 'C' + 'T'.repeat(55);

const multisigRule: ChainRule = {
  ruleId: 1,
  contextType: { kind: 'call-contract', contract: 'C' + 'S'.repeat(55) },
  name: 'recovery',
  signers: [
    { kind: 'delegated', address: 'C' + '1'.repeat(55) },
    { kind: 'delegated', address: 'C' + '2'.repeat(55) },
  ],
  policies: [FAKE_MULTISIG_ADDR],
  validUntil: null,
};
const sessionRule: ChainRule = {
  ruleId: 2,
  contextType: { kind: 'call-contract', contract: FAKE_TARGET },
  name: 'session',
  signers: [{ kind: 'external', verifier: 'C' + 'V'.repeat(55), publicKey: new Uint8Array(65) }],
  policies: [],
  validUntil: 12345,
};

describe('loadPolicyBlocks', () => {
  it('dispatches each rule to its block module and skips unknown ones', async () => {
    const multisigMod: PolicyBlockModule<Extract<PolicyBlock, { kind: 'multisig-recovery' }>> = {
      kind: 'multisig-recovery',
      buildInstall: vi.fn() as any,
      buildRevoke: vi.fn() as any,
      defaultDraft: vi.fn() as any,
      summarize: () => '',
      fromChain: (rule) =>
        rule.policies.includes(FAKE_MULTISIG_ADDR)
          ? { kind: 'multisig-recovery', ruleId: rule.ruleId, threshold: 2, friends: [] }
          : null,
    };
    const sessionMod: PolicyBlockModule<Extract<PolicyBlock, { kind: 'scoped-session-key' }>> = {
      kind: 'scoped-session-key',
      buildInstall: vi.fn() as any,
      buildRevoke: vi.fn() as any,
      defaultDraft: vi.fn() as any,
      summarize: () => '',
      fromChain: (rule) =>
        rule.contextType.kind === 'call-contract' && rule.policies.length === 0
          ? {
              kind: 'scoped-session-key',
              ruleId: rule.ruleId,
              targetContract: rule.contextType.contract,
              sessionPubkey: new Uint8Array(65),
              credentialId: 'unknown',
              validUntil: rule.validUntil ?? undefined,
            }
          : null,
    };
    registerPolicyBlockModule(multisigMod);
    registerPolicyBlockModule(sessionMod);

    const fakeOverlay: LocalOverlay = {
      friendNicknames: {},
      sessionKeyMaterial: {},
      blockLabels: {},
    };
    const blocks = await loadPolicyBlocks({
      rules: [multisigRule, sessionRule],
      fetchPolicyState: async () => ({}),
      overlay: fakeOverlay,
    });
    expect(blocks.map((b) => b.kind)).toEqual(['multisig-recovery', 'scoped-session-key']);
  });
});
