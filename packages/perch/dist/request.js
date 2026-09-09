// An ERC-7715-shaped permission *request* that maps 1:1 onto a perch PolicyDoc.
//
// perch is the on-chain enforcement half of a 7715-style split: a dapp/wallet
// asks for a scoped, time-bounded, optionally-capped delegation, and that
// request lowers to a canonical PolicyDoc whose `doc_hash` the Rust compiler
// then lowers to an on-chain Plan. This module is the request → PolicyDoc half;
// producing the Plan is Rust-side (compile()) / a TS follow-up on #8.
//
// The mapping is deliberately total and lossless: `requestToPolicyDoc` produces
// a document that `parsePolicyDoc` accepts (fail-closed) and that canonicalizes
// to the same bytes — and therefore the same `doc_hash` — the Rust model would.
import { parsePolicyDoc } from './schema.js';
/** Lower a request to its canonical PolicyDoc, validating fail-closed. The
 *  returned document canonicalizes (and hashes) identically to the same policy
 *  authored directly or built by the Rust model. */
export function requestToPolicyDoc(req) {
    const rules = req.permissions.map((p) => ({
        name: p.name,
        scope: p.on === 'self-admin' ? { type: 'self-admin' } : { type: 'contract', address: p.on.contract },
        principals: { type: 'all', signers: p.by },
        ...(p.functions !== undefined ? { functions: p.functions } : {}),
        ...(p.args !== undefined ? { args: p.args } : {}),
        ...(p.until !== undefined ? { 'not-after-ledger': p.until } : {}),
        ...(p.cap !== undefined ? { cap: p.cap } : {}),
    }));
    const doc = {
        version: 1,
        ...(req.network !== undefined ? { network: req.network } : {}),
        signers: req.signers,
        rules,
    };
    // Fail closed: a request that does not map to a valid PolicyDoc throws.
    return parsePolicyDoc(doc);
}
//# sourceMappingURL=request.js.map