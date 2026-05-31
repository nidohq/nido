const modules = new Map();
export function registerPolicyBlockModule(mod) {
    modules.set(mod.kind, mod);
}
export function getPolicyBlockModule(kind) {
    return modules.get(kind);
}
export function allPolicyBlockKinds() {
    return [...modules.keys()];
}
//# sourceMappingURL=registry.js.map