import { allPolicyBlockKinds, getPolicyBlockModule } from './registry.js';
/** Walk every rule, try each registered module's `fromChain`, return the
 *  first non-null block. Rules that no module claims are skipped silently;
 *  the Advanced section of the UI surfaces them as raw if desired. */
export async function loadPolicyBlocks(args) {
    const kinds = allPolicyBlockKinds();
    const out = [];
    for (const rule of args.rules) {
        const state = await args.fetchPolicyState(rule);
        for (const kind of kinds) {
            const mod = getPolicyBlockModule(kind);
            if (!mod)
                continue;
            const block = mod.fromChain(rule, state, args.overlay);
            if (block) {
                out.push(block);
                break;
            }
        }
    }
    return out;
}
//# sourceMappingURL=loadBlocks.js.map