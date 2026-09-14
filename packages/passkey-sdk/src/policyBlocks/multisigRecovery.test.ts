import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import type { ChainRule, LocalOverlay } from './types.js';
import { RECOVERY_CONTROLLER_TESTNET_ID } from '../recoveryStage3/deployment.js';

const POLICY = StrKey.encodeContract(new Uint8Array(32).fill(0x42));
const F1 = StrKey.encodeContract(new Uint8Array(32).fill(0x01));
const F2 = StrKey.encodeContract(new Uint8Array(32).fill(0x02));
const F3 = StrKey.encodeContract(new Uint8Array(32).fill(0x03));
const SELF = StrKey.encodeContract(new Uint8Array(32).fill(0xAA));
const ACCOUNT = StrKey.encodeContract(new Uint8Array(32).fill(0xBB));
const OTHER_CONTROLLER = StrKey.encodeContract(new Uint8Array(32).fill(0xCC));

// `buildInstall` calls `checkAccountWiring`/`buildWireAccountTx`
// (`../recoveryStage3/accountWiring.js`), which read the account's own
// `recovery_controller()` via `@nidohq/smart-account`'s generated Client —
// a live RPC call in production. Mock the Client so `buildInstall`'s three
// wiring branches (unwired / wired-to-target / wired-to-different-controller)
// are unit-testable without a network.
let mockRecoveryController: string | null = null;
vi.mock('@nidohq/smart-account', () => ({
  Client: class {
    async recovery_controller() {
      return { result: mockRecoveryController };
    }
    async enroll_zk_recovery() {
      return {
        built: {
          operations: () => [
            { switch: () => ({ name: () => 'invokeHostFunction' }), toXDR: () => new Uint8Array() },
          ],
        },
      };
    }
  },
}));

// `buildWireAccountTx` extracts operations via `assembledTx.js`'s
// `extractXdrOperations` — mock it directly rather than reconstructing a
// real AssembledTransaction shape, since the 'unwired' test only cares that
// TWO operations come back (wire + enroll), not their exact XDR bytes.
vi.mock('../assembledTx.js', () => ({
  extractXdrOperations: () => ['WIRE_OP_PLACEHOLDER'],
}));

const { multisigRecoveryModule } = await import('./multisigRecovery.js');

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

  it('claims a Stage 3 rule (guardians from PolicyState, not on-chain signers)', () => {
    const rule: ChainRule = {
      ruleId: 7,
      contextType: { kind: 'call-contract', contract: SELF },
      name: 'zk-recovery',
      signers: [], // zero-signer CallContract(self) — guardians live off-chain in RecoveryConfig
      policies: [RECOVERY_CONTROLLER_TESTNET_ID],
      validUntil: null,
    };
    const overlay: LocalOverlay = {
      friendNicknames: { [F1]: 'Alice' },
      sessionKeyMaterial: {},
      blockLabels: {},
    };
    const block = multisigRecoveryModule.fromChain(
      rule,
      { [RECOVERY_CONTROLLER_TESTNET_ID]: { guardians: [F1, F2], threshold: 1 } },
      overlay,
    );
    expect(block).toMatchObject({
      kind: 'multisig-recovery',
      ruleId: 7,
      threshold: 1,
      friends: [
        { address: F1, inputAs: F1, nickname: 'Alice' },
        { address: F2, inputAs: F2 },
      ],
    });
  });

  it('does not claim a Stage 3 rule with an unreadable/absent config', () => {
    const rule: ChainRule = {
      ruleId: 7,
      contextType: { kind: 'call-contract', contract: SELF },
      name: 'zk-recovery',
      signers: [],
      policies: [RECOVERY_CONTROLLER_TESTNET_ID],
      validUntil: null,
    };
    const overlay: LocalOverlay = { friendNicknames: {}, sessionKeyMaterial: {}, blockLabels: {} };
    expect(
      multisigRecoveryModule.fromChain(rule, { [RECOVERY_CONTROLLER_TESTNET_ID]: {} }, overlay),
    ).toBeNull();
  });

  describe('buildInstall', () => {
    beforeEach(() => {
      mockRecoveryController = null;
    });

    const block = { kind: 'multisig-recovery' as const, threshold: 1, friends: [{ address: F1, inputAs: F1 }] };
    const baseArgs = { account: ACCOUNT, block, factoryAddress: '', rpcUrl: 'https://example.invalid' };

    it('wires then enrolls a fresh (unwired) account — two operations', async () => {
      mockRecoveryController = null;
      const built = await multisigRecoveryModule.buildInstall(baseArgs);
      expect(built.operations).toHaveLength(2);
    });

    it('just enrolls an account already wired to the Stage 3 controller — one operation', async () => {
      mockRecoveryController = RECOVERY_CONTROLLER_TESTNET_ID;
      const built = await multisigRecoveryModule.buildInstall(baseArgs);
      expect(built.operations).toHaveLength(1);
    });

    it('refuses (with an accurate, non-doc-schema error) an account wired to a different controller', async () => {
      mockRecoveryController = OTHER_CONTROLLER;
      await expect(multisigRecoveryModule.buildInstall(baseArgs)).rejects.toThrow(
        /already wired to a different recovery controller/,
      );
      await expect(multisigRecoveryModule.buildInstall(baseArgs)).rejects.toThrow(
        new RegExp(OTHER_CONTROLLER),
      );
      // The old, stale claim must be gone.
      await expect(multisigRecoveryModule.buildInstall(baseArgs)).rejects.not.toThrow(
        /doc v1 has all-signers principals only/,
      );
    });
  });

  it('buildRevoke explains the real 7-day migration constraint, not a fake one-step revoke', async () => {
    await expect(
      multisigRecoveryModule.buildRevoke({ account: ACCOUNT, ruleId: 7, rpcUrl: 'https://example.invalid' }),
    ).rejects.toThrow(/7-day|initiate_recovery_rule_removal/);
  });
});
