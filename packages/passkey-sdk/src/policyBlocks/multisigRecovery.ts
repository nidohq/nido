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

    // Encode the install_param explicitly as a typed ScVal so Stellar SDK's
    // generic object→ScVal conversion doesn't pick the wrong integer width
    // (SimpleThresholdAccountParams.threshold is u32, but auto-conversion of
    // a plain { threshold: 2 } often defaults to a larger int type).
    const { nativeToScVal } = await import('@stellar/stellar-sdk');
    const installParam = nativeToScVal(
      { threshold: args.block.threshold },
      { type: { threshold: ['symbol', 'u32'] } as { threshold: ['symbol', 'u32'] } },
    );

    const callArgs = {
      context_type: { tag: 'CallContract' as const, values: [args.account] as readonly [string] },
      name: args.block.label ?? 'recovery',
      valid_until: undefined,
      signers: args.block.friends.map((f) => ({
        tag: 'Delegated' as const,
        values: [f.address] as readonly [string],
      })),
      // Bindings type is Map<string, any>; the value is the install_param the
      // policy's `install` will receive. Pre-encoded ScVal so the contract
      // sees exactly { threshold: u32 } and FromVal can decode it.
      policies: new Map<string, unknown>([[policyAddr, installParam]]),
    };

    // Log the structured args so a runtime spec-mismatch ("Received object …
    // did not match the provided type …") is diagnosable. Stellar SDK's
    // error stringifies both sides as [object Object]; this gives the actual
    // values.
    // eslint-disable-next-line no-console
    console.debug('[multisig-recovery] add_context_rule args:', {
      account: args.account,
      policyAddr,
      callArgs: JSON.parse(JSON.stringify(callArgs, (_k, v) =>
        v instanceof Map ? Object.fromEntries(v) : v,
      )),
      installParamScVal: installParam.toXDR('base64'),
    });

    let tx;
    try {
      tx = await client.add_context_rule(callArgs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Re-throw with context so the form's catch shows something useful
      // rather than just "Received object [object Object] …".
      throw new Error(
        `multisig-recovery.buildInstall failed: ${msg}\n` +
          `  account: ${args.account}\n` +
          `  policy: ${policyAddr}\n` +
          `  signers: ${callArgs.signers.length} friend(s)\n` +
          `  See browser console for the full encoded args.`,
      );
    }

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
