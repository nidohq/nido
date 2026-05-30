import { Client as SmartAccountClient } from 'smart-account';
import type { AssembledTransaction } from '@stellar/stellar-sdk/contract';
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
    const policyAddr = await args.policyAddress('multisig');

    const client = new SmartAccountClient({
      contractId: args.account,
      networkPassphrase: TESTNET_PASSPHRASE,
      rpcUrl: args.rpcUrl,
    });

    const tx = await client.add_context_rule({
      context_type: { tag: 'CallContract', values: [args.account] as readonly [string] },
      name: args.block.label ?? 'recovery',
      valid_until: undefined,
      signers: args.block.friends.map((f) => ({
        tag: 'Delegated' as const,
        values: [f.address] as readonly [string],
      })),
      policies: new Map([
        [policyAddr, { threshold: args.block.threshold }],
      ]),
    });

    return {
      operations: extractOperations(tx),
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
      operations: extractOperations(tx),
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

/** Pull the Soroban Operation[] out of an AssembledTransaction.
 *  The exact property path depends on the SDK version; adjust if needed. */
function extractOperations(tx: AssembledTransaction<unknown>): import('@stellar/stellar-sdk').Operation[] {
  // Common shapes across @stellar/stellar-sdk 12-14:
  //   tx.built.operations
  const built = (tx as unknown as { built?: { operations?: unknown[] } }).built;
  if (!built || !built.operations) {
    throw new Error('multisig-recovery: could not extract operations from AssembledTransaction');
  }
  return Array.from(built.operations) as import('@stellar/stellar-sdk').Operation[];
}

registerPolicyBlockModule(multisigRecoveryModule);
