import type { ChainRule, LocalOverlay, PolicyBlock, PolicyState } from './types.js';
import { allPolicyBlockKinds, getPolicyBlockModule } from './registry.js';

export interface LoadPolicyBlocksArgs {
  rules: ChainRule[];
  /** Fetches the per-policy state map for a given rule. */
  fetchPolicyState: (rule: ChainRule) => Promise<PolicyState>;
  overlay: LocalOverlay;
}

/** Walk every rule, try each registered module's `fromChain`, return the
 *  first non-null block. Rules that no module claims are skipped silently;
 *  the Advanced section of the UI surfaces them as raw if desired. */
export async function loadPolicyBlocks(
  args: LoadPolicyBlocksArgs,
): Promise<PolicyBlock[]> {
  const kinds = allPolicyBlockKinds();
  const out: PolicyBlock[] = [];
  for (const rule of args.rules) {
    const state = await args.fetchPolicyState(rule);
    for (const kind of kinds) {
      const mod = getPolicyBlockModule(kind);
      if (!mod) continue;
      const block = mod.fromChain(rule, state, args.overlay);
      if (block) {
        out.push(block);
        break;
      }
    }
  }
  return out;
}
