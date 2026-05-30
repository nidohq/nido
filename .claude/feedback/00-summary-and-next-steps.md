# Review Summary & Next Steps

## Overview

100 adversarial reviewers across 7 domains reviewed PR #15 (name-registry contract), PR #16 (frontend name resolution), and the overall g2c architecture. Below is the consolidated summary.

---

## Issue Counts by Severity

| Severity | Contract | Frontend | Architecture | UX | Testing | Economics | Red Team | Total |
|----------|----------|----------|-------------|-----|---------|-----------|----------|-------|
| CRITICAL | 1 | 2 | 3 | 0 | 1 | 0 | 2 | **9** |
| HIGH | 3 | 3 | 3 | 2 | 4 | 2 | 1 | **18** |
| MEDIUM | 5 | 5 | 6 | 3 | 4 | 5 | 1 | **29** |
| LOW | 6 | 5 | 8 | 10 | 3 | 3 | 0 | **35** |
| **Total** | **15** | **15** | **20** | **15** | **12** | **10** | **4** | **91** |

---

## Top 10 Issues (Must Address)

### 1. Permissionless `extend_ttl` (Contract — Reviewers 1, 3, 92)
Anyone can keep any name alive forever. Add `owner.require_auth()`.

### 2. No events emitted (Contract — Reviewer 2)
No audit trail for register/transfer/release. Add event publishing.

### 3. Secret key in localStorage plaintext (Frontend — Reviewer 17, 95)
`g2c:name-keypair` stores full secret. Use sessionStorage or encrypt.

### 4. Callback URL not validated (Frontend — Reviewers 19, 94)
Signing redirect accepts any callback origin. Validate against current origin.

### 5. No contract tests in CI (Architecture — Reviewer 32)
Contract changes can break production undetected. Add to GitHub Actions.

### 6. Hardcoded network config (Architecture — Reviewers 31, 37)
Testnet URLs/IDs scattered across pages. Centralize and add mainnet support.

### 7. `extend_ttl` untested (Testing — Reviewer 69)
Only public function with zero test coverage.

### 8. Name squatting unmitigated (Economics — Reviewers 81, 83, 91)
Free registration enables mass squatting. Add fee scaling or reserved names.

### 9. No name availability check (UX — Reviewer 55)
User waits 10+ seconds before learning a name is taken. Add pre-check.

### 10. Signing redirect UX (UX — Reviewers 51, 52)
3 page loads, 2 redirects, no progress indicator. Disorienting on mobile.

---

## Recommended Next Steps (Prioritized PRs)

### PR A — Contract Hardening (1-2 days)
- [ ] Add `owner.require_auth()` to `extend_ttl`
- [ ] Add event emission for all state changes (`register`, `release`, `transfer`)
- [ ] Add `#[contracterror]` enum for typed errors
- [ ] Add reserved name list (`admin`, `support`, `root`, `system`, `help`, `null`)
- [ ] Add test for `extend_ttl` (with and without auth)
- [ ] Add test without `mock_all_auths` to verify auth rejection
- [ ] Add integration test for `transfer` and `lookup`

### PR B — Frontend Security Fixes (1-2 days)
- [ ] Validate callback URL origin before redirect (same-origin check)
- [ ] Move name-keypair to sessionStorage instead of localStorage
- [ ] Add expiry timestamp to stored transaction data (reject stale)
- [ ] Sanitize `formatSignResult` output (use textContent, not innerHTML)
- [ ] Validate contractId format after extraction from hostname

### PR C — Config Centralization (0.5 days)
- [ ] Extract all hardcoded constants (RPC_URL, FACTORY_CONTRACT_ID, NAME_REGISTRY_ID, VERIFIER_WASM_HASH) to shared `packages/frontend/src/lib/config.ts`
- [ ] Add network detection (testnet vs mainnet based on hostname or env var)
- [ ] Add testnet banner in UI

### PR D — CI/CD Pipeline (1 day)
- [ ] Add `just check && just test && just build-contracts` to GitHub Actions
- [ ] Add Playwright e2e tests to CI (build → serve → test)
- [ ] Add `cargo audit` and `npm audit` to CI
- [ ] Add contract WASM hash verification step

### PR E — UX Improvements (1-2 days)
- [ ] Add name availability check (debounced, as user types)
- [ ] Add progress stepper for claim flow (Step 1/3, 2/3, 3/3)
- [ ] On-chain reverse lookup on page load (`registry.lookup(contractId)`) for cross-device name display
- [ ] Add "Copy URL" button next to shareable name URL
- [ ] Show human-readable errors (hide RPC details behind "Show details")

### PR F — Protocol Economics (Future)
- [ ] Design and implement fee structure for name registration
- [ ] Add commit-reveal scheme to prevent front-running
- [ ] Add cooldown period between release and re-registration
- [ ] Consider governance mechanism for parameter updates

---

## Architectural Debt (Track, Don't Block)

These items should be tracked but don't need to block current PRs:

1. **Buffer polyfill removal** — Replace all `Buffer` usage with `Uint8Array`
2. **soroban-sdk-tools dependency** — Evaluate if native soroban-sdk storage suffices
3. **Cloudflare Worker edge resolution** — Cache name→address in KV for instant resolution
4. **Contract upgrade path** — Design proxy pattern or migration strategy
5. **Secret key in URL** — Move G_temp from query param to sessionStorage (blocks mainnet)
6. **Observability** — Add Sentry, analytics, RPC health monitoring
7. **Multi-browser e2e tests** — Firefox and WebKit coverage
8. **Property-based contract tests** — Fuzz the bidirectional map invariant

---

## Verdict

The name registry contract is **functionally correct** and the frontend integration **works end-to-end** (verified by Playwright tests against real testnet). The core cryptographic flow is **sound** — passkey signatures are verified on-chain, replay is prevented by nonces.

**For testnet**: Ship PRs A and B to address critical security issues. PRs C-E are high-value quality improvements.

**For mainnet**: All PRs A-E are required, plus an external security audit of the smart account + name registry contracts, plus the secret-key-in-URL fix.
