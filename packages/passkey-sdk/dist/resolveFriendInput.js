import { StrKey } from '@stellar/stellar-sdk';
const G2C_NAME_RE = /^[a-z][a-z0-9]{0,14}$/;
export async function resolveFriendInput(input, opts) {
    const trimmed = input.trim();
    if (!trimmed)
        return null;
    if (StrKey.isValidContract(trimmed)) {
        return { kind: 'contract', address: trimmed, input: trimmed };
    }
    if (StrKey.isValidEd25519PublicKey(trimmed)) {
        return { kind: 'account', address: trimmed, input: trimmed };
    }
    if (G2C_NAME_RE.test(trimmed)) {
        const resolved = await opts.resolveName(trimmed);
        if (!resolved)
            return null;
        return { kind: 'name', address: resolved, input: trimmed };
    }
    return null;
}
//# sourceMappingURL=resolveFriendInput.js.map