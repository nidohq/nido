import { Buffer } from 'buffer';
import { Client as SmartAccountClient } from 'smart-account';
import { extractXdrOperations } from '../assembledTx.js';
import type {
  ChainRule, LocalOverlay, PolicyBlockModule, PolicyState,
  ScopedSessionKeyBlock, TxBuild,
} from './types.js';
import { registerPolicyBlockModule } from './registry.js';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

export const scopedSessionKeyModule: PolicyBlockModule<ScopedSessionKeyBlock> = {
  kind: 'scoped-session-key',

  async buildInstall(args): Promise<TxBuild> {
    if (!args.verifierAddress) {
      throw new Error('scoped-session-key: verifierAddress fetcher required');
    }
    const verifierAddr = await args.verifierAddress();

    const client = new SmartAccountClient({
      contractId: args.account,
      networkPassphrase: TESTNET_PASSPHRASE,
      rpcUrl: args.rpcUrl,
    });

    const tx = await client.add_context_rule({
      context_type: { tag: 'CallContract', values: [args.block.targetContract] as readonly [string] },
      name: args.block.label ?? 'session',
      valid_until: args.block.validUntil,
      signers: [{
        tag: 'External' as const,
        values: [verifierAddr, Buffer.from(args.block.sessionPubkey)] as readonly [string, Buffer],
      }],
      policies: new Map(),
    });

    return {
      operations: extractXdrOperations(tx, 'scoped-session-key'),
      description: `Delegate session key to ${args.block.targetContract}`,
    };
  },

  async buildRevoke(args): Promise<TxBuild> {
    const client = new SmartAccountClient({
      contractId: args.account,
      networkPassphrase: TESTNET_PASSPHRASE,
      rpcUrl: args.rpcUrl,
    });
    const tx = await client.remove_context_rule({ context_rule_id: args.ruleId });
    return {
      operations: extractXdrOperations(tx, 'scoped-session-key'),
      description: 'Revoke session key',
    };
  },

  fromChain(rule: ChainRule, _state: PolicyState, overlay: LocalOverlay): ScopedSessionKeyBlock | null {
    if (rule.policies.length > 0) return null;
    if (rule.contextType.kind !== 'call-contract') return null;
    if (rule.signers.length !== 1) return null;
    const s = rule.signers[0];
    if (s.kind !== 'external') return null;

    const target = rule.contextType.contract;
    const material = overlay.sessionKeyMaterial[target];

    return {
      kind: 'scoped-session-key',
      ruleId: rule.ruleId,
      targetContract: target,
      sessionPubkey: s.publicKey,
      credentialId: material?.credentialId ?? 'unknown',
      validUntil: rule.validUntil ?? undefined,
      label: material?.label ?? overlay.blockLabels[rule.ruleId],
    };
  },

  summarize(block: ScopedSessionKeyBlock): string {
    const exp = block.validUntil != null ? ` (expires at ledger ${block.validUntil})` : '';
    return `Session key for ${block.targetContract}${exp}`;
  },

  defaultDraft(): ScopedSessionKeyBlock {
    return {
      kind: 'scoped-session-key',
      targetContract: '',
      sessionPubkey: new Uint8Array(65),
      credentialId: '',
    };
  },
};

registerPolicyBlockModule(scopedSessionKeyModule);
