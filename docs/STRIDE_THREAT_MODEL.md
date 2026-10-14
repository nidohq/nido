# STRIDE risk register

One row per threat in [THREAT_MODEL.md](./THREAT_MODEL.md), which holds the
analysis; this register restates none of it. Invariant IDs refer to
[SECURITY_INVARIANTS.md](./SECURITY_INVARIANTS.md) and gate IDs to
[MAINNET_READINESS.md](./MAINNET_READINESS.md). Threat numbers 1-13 are
THREAT_MODEL's [adversaries](./THREAT_MODEL.md#adversaries); L1-L6 are its
[limits within the audited behaviour](./THREAT_MODEL.md#limits-within-the-audited-behaviour).

STRIDE: **S** spoofing, **T** tampering, **R** repudiation, **I** information
disclosure, **D** denial of service, **E** elevation of privilege.

Status: **Open**, no shipped mitigation; **Partial**, mitigated with a named
residual; **Mitigated**, closed by the listed invariants within their
evidence's limits; **Accepted**, inherent in the audited design.

| Threat | STRIDE | THREAT_MODEL | Invariants | Gate | Status |
| --- | --- | --- | --- | --- | --- |
| Passkey thief, `Loss` account | E | 1 | R6 | none | Accepted: under `Loss` the key holder is the owner. |
| Passkey thief, `Protected` account | E | 1, L1 | R4, R5, R6, R7, R8, U2 | D2 | Partial: the condition gates recovery changes, upgrades, and the authorized window; without an enrolled baseline the thief can invalidate every lost-key attempt. |
| Colluding guardians or a ZK-secret thief | S, E | 2 | R3, R6 | none | Accepted: indistinguishable from the owner's factor; bounded by the delay, the uncapped `Loss` veto, and `Combined`. |
| Griefer: evidence-free attempts, stale evidence, replayed proofs | D | 3 | R1, R2, Z3 | none | Mitigated. |
| Phishing link to a guardian | S, T | 4 | W2, W3 | none | Partial: the link checks have unit tests, the page wiring has none; whose key a replacement is stays the guardian's out-of-band check. |
| Setup-key thief | S, I | 5, L5 | F2, W5 | A6 (A2 covers query strings only) | Open: the race before the first deploy is unresolved (nidohq/nido#245); F2 stops a takeover after it. |
| Script in the wallet origin | T, I, E | 6 | none | E1, E2, E4 | Partial: per-account origins and build-time bundling; the CSP is report-only and the reference string is not self-hosted. |
| Passkey verifier that accepts anything | E | 7 | V1, V2, F5 | none | Mitigated for accounts from Perch-era factories, whose verifiers have no admin. Testnet accounts minted by pre-Perch factories still trust the admin of Nido's former verifier (DEPLOYED.md, "Compatibility appendix"); none of those contracts deploys to mainnet. |
| Malicious or compromised factory admin | T, E | 8 | F3, F4, U1 | B1 | Open: B1 is not met. |
| Wrong deployment in the wallet build | S | 9 | W6 | A1 | Partial: the committed `perch.TESTNET` is checked against Perch's manifest; a `PUBLIC_PERCH_DEPLOYMENT` override is not. |
| Relayer censorship, sponsor drain, or outage | D | 10 | none | A3, D4, D7 | Partial: no authorization forgery for existing accounts; sponsor spend capped by the channels plugin's `FEE_LIMIT` (RUNBOOKS §5); relayer-sponsored onboarding is unproven and its queue refusals are unexplained. |
| Compromised relayer claims an account being set up | S, E | 10, L5 | F2 | A6 | Open: nothing prevents or detects it (nidohq/nido#245). |
| Storage expiry | D | 11, L6 | T1, T2 | D1, D3 | Partial: the chain restores archived state, never resets it; the wallet has no restoration or renewal workflow. |
| Supply-chain attacker | T | 12 | Z1, W6 | C1, C2 | Partial: see [SUPPLY_CHAIN.md](./SUPPLY_CHAIN.md). |
| Unsound ZK verifier delta | E | 13 | Z1, Z4 | D5 | Open: the delta is unaudited; the tests show that valid proofs verify and that a proof does not count for another statement, not that the verifier is sound. |
| Allowances granted before a freeze stay usable | E | L2 | R4 | E7 | Accepted: protocol limit; no account code can revoke them. |
| Replacing a spending policy resets its window | E | L3 | A5 | E7 | Accepted: audited semantics; persistent budgets are [deferred](./DEFERRED.md#persistent-spending-budgets-across-replacements). |
| Ordinary transactions are not revision-bound | T | L4 | A8, W10 | none | Accepted: audited semantics; revision-bound signatures are [deferred](./DEFERRED.md#revision-bound-ordinary-signatures). |

No threat is listed under repudiation: every authorization is an on-chain
signature checked by the account. The one off-chain step, a guardian's
out-of-band confirmation of a replacement key (threat 4), leaves no record,
and nothing in the protocol depends on proving it took place.

Trust assumptions and out-of-scope threats are THREAT_MODEL's
["Trusted"](./THREAT_MODEL.md#trusted) and
["Out of scope"](./THREAT_MODEL.md#out-of-scope).
