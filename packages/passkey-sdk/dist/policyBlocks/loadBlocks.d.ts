import type { ChainRule, LocalOverlay, PolicyBlock, PolicyState } from './types.js';
export interface LoadPolicyBlocksArgs {
    rules: ChainRule[];
    /** Fetches the per-policy state map for a given rule. */
    fetchPolicyState: (rule: ChainRule) => Promise<PolicyState>;
    overlay: LocalOverlay;
}
/** Walk every rule, try each registered module's `fromChain`, return the
 *  first non-null block. Rules that no module claims are skipped silently;
 *  the Advanced section of the UI surfaces them as raw if desired. */
export declare function loadPolicyBlocks(args: LoadPolicyBlocksArgs): Promise<PolicyBlock[]>;
//# sourceMappingURL=loadBlocks.d.ts.map