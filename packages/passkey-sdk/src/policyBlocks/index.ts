export * from './types.js';

import type { PolicyBlock, PolicyBlockModule } from './types.js';

/** Registry of installed policy-block modules. Modules register themselves
 *  via `registerPolicyBlockModule` at import time. */
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

export * from './loadBlocks.js';
export * from './multisigRecovery.js';
