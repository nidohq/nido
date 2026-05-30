import type { PolicyBlock, PolicyBlockModule } from './types.js';

const modules = new Map<PolicyBlock['kind'], PolicyBlockModule<PolicyBlock>>();

export function registerPolicyBlockModule<B extends PolicyBlock>(
  mod: PolicyBlockModule<B>,
): void {
  modules.set(mod.kind, mod as unknown as PolicyBlockModule<PolicyBlock>);
}

export function getPolicyBlockModule<B extends PolicyBlock>(
  kind: B['kind'],
): PolicyBlockModule<B> | undefined {
  return modules.get(kind) as PolicyBlockModule<B> | undefined;
}

export function allPolicyBlockKinds(): PolicyBlock['kind'][] {
  return [...modules.keys()];
}
