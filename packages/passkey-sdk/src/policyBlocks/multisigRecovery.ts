import { Client as SmartAccountClient } from 'smart-account';
import { extractXdrOperations } from '../assembledTx.js';
import type {
  ChainRule, LocalOverlay, MultisigRecoveryBlock,
  PolicyBlockModule, PolicyState, TxBuild,
} from './types.js';
import { registerPolicyBlockModule } from './registry.js';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

export const multisigRecoveryModule: PolicyBlockModule<MultisigRecoveryBlock> = {
  kind: 'multisig-recovery',

  async buildInstall(args): Promise<TxBuild> {
    if (!args.policyAddress) {
      throw new Error('multisig-recovery: policyAddress fetcher required');
    }
    const multisigPolicy = await args.policyAddress('multisig');

    const client = new SmartAccountClient({
      contractId: args.account,
      networkPassphrase: TESTNET_PASSPHRASE,
      rpcUrl: args.rpcUrl,
    });

    // Smart-account exposes a typed wrapper that constructs the policies map
    // server-side. The bindings give us a fully-typed call — no Map<string,
    // any> to wrestle with — and threshold ends up as a proper u32 in the
    // install param.
    let tx;
    try {
      tx = await client.add_multisig_recovery({
        name: args.block.label ?? 'recovery',
        valid_until: undefined,
        friends: args.block.friends.map((f) => ({
          tag: 'Delegated' as const,
          values: [f.address] as readonly [string],
        })),
        multisig_policy: multisigPolicy,
        threshold: args.block.threshold,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `multisig-recovery.buildInstall failed: ${msg}\n` +
          `  account: ${args.account}\n` +
          `  policy: ${multisigPolicy}\n` +
          `  threshold: ${args.block.threshold}\n` +
          `  friends: ${args.block.friends.length}`,
      );
    }

    return {
      operations: extractXdrOperations(tx, 'multisig-recovery'),
      description: `Set up ${args.block.threshold}-of-${args.block.friends.length} recovery`,
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
      operations: extractXdrOperations(tx, 'multisig-recovery'),
      description: 'Remove recovery rule',
    };
  },

  fromChain(rule: ChainRule, state: PolicyState, overlay: LocalOverlay): MultisigRecoveryBlock | null {
    if (rule.policies.length === 0) return null;
    if (rule.contextType.kind !== 'call-contract') return null;
    const policyAddr = rule.policies[0];
    const ps = state[policyAddr] as { threshold?: number } | undefined;
    const threshold = ps?.threshold;
    if (typeof threshold !== 'number') return null;
    return {
      kind: 'multisig-recovery',
      ruleId: rule.ruleId,
      threshold,
      friends: rule.signers
        .filter((s): s is { kind: 'delegated'; address: string } => s.kind === 'delegated')
        .map((s) => ({
          address: s.address,
          inputAs: s.address,
          nickname: overlay.friendNicknames[s.address],
        })),
      label: overlay.blockLabels[rule.ruleId],
    };
  },

  summarize(block: MultisigRecoveryBlock): string {
    const n = block.friends.length;
    return `${block.threshold} of ${n} friend${n === 1 ? '' : 's'} can rotate this account's signers and rules`;
  },

  defaultDraft(): MultisigRecoveryBlock {
    return { kind: 'multisig-recovery', threshold: 2, friends: [], label: 'Recovery' };
  },
};

registerPolicyBlockModule(multisigRecoveryModule);
