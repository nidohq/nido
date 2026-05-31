import type { PolicyBlock, PolicyBlockModule } from './types.js';
export declare function registerPolicyBlockModule<B extends PolicyBlock>(mod: PolicyBlockModule<B>): void;
export declare function getPolicyBlockModule<B extends PolicyBlock>(kind: B['kind']): PolicyBlockModule<B> | undefined;
export declare function allPolicyBlockKinds(): PolicyBlock['kind'][];
//# sourceMappingURL=registry.d.ts.map