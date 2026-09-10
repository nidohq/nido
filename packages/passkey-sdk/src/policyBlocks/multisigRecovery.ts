import type {
  ChainRule, LocalOverlay, MultisigRecoveryBlock,
  PolicyBlockModule, PolicyState, TxBuild,
} from './types.js';
import { registerPolicyBlockModule } from './registry.js';

// Recovery *completion* (key rotation) lives in its own module; re-exported
// here per the public-API layout (buildInstall/buildRevoke + buildRotation
// all hang off the multisig-recovery block).
export {
  buildRotation,
  planRotation,
  describeRotation,
} from './multisigRotation.js';
export type {
  RotationRequest,
  RotationRuleState,
  RotationPlan,
  RotationCall,
  RotationTxBuild,
  BuildRotationArgs,
  NewPasskeySigner,
} from './multisigRotation.js';

/// DOC-ONLY (spike): the account no longer exports `add_multisig_recovery`
/// or `remove_context_rule` — `apply_doc` is the sole policy write path.
/// M-of-N friend recovery is NOT expressible in doc v1 (its `principals`
/// are all-signers only), so this block currently has NO install/revoke
/// route at all: a real product cost of the doc-only ruling, recorded in
/// the spike PR. The read-side (`fromChain`/`summarize`) still renders
/// existing rules.
const DOC_ONLY_ERROR =
  'doc-only: the account has no rule mutators; M-of-N friend recovery is not yet expressible as a policy document (doc v1 has all-signers principals only)';

export const multisigRecoveryModule: PolicyBlockModule<MultisigRecoveryBlock> = {
  kind: 'multisig-recovery',

  async buildInstall(_args): Promise<TxBuild> {
    throw new Error(`multisig-recovery.buildInstall: ${DOC_ONLY_ERROR}`);
  },

  async buildRevoke(_args): Promise<TxBuild> {
    throw new Error(`multisig-recovery.buildRevoke: ${DOC_ONLY_ERROR}`);
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
