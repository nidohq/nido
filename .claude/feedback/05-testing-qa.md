# Testing & QA Reviewers (66-80)

## Reviewer 66 — E2E Test Architect
**Severity: HIGH** — The Playwright test creates a new testnet account on every run (~$0 on testnet, but $X on mainnet). No test account reuse. No cleanup of registered names. After 1000 test runs, 1000 orphaned names exist on testnet. Add teardown that calls `release()`.

## Reviewer 67 — Test Isolation Specialist
**Severity: MEDIUM** — The e2e test uses a single port (4399/4400) without checking if it's already in use. Parallel test runs will fail with EADDRINUSE. Use dynamic port allocation.

## Reviewer 68 — Negative Test Specialist
**Severity: HIGH** — No tests for: RPC timeout, RPC error responses, Friendbot rate limiting, name already taken on-chain (not just simulation), passkey registration failure on older browsers, double-click on claim button, navigating away mid-claim.

## Reviewer 69 — Contract Test Coverage Auditor
**Severity: CRITICAL** — `extend_ttl` has zero test coverage. It's the only public function without any test. It's also the most dangerous function (permissionless, affects all names). Write tests for: extend on existing name, extend on nonexistent name, verify TTL actually changed.

## Reviewer 70 — Authorization Test Specialist
**Severity: HIGH** — All unit tests use `env.mock_all_auths()`. No test verifies that unauthorized calls actually fail. A bug in `require_auth()` placement would be invisible. Write tests without `mock_all_auths` that verify auth rejection.

## Reviewer 71 — Stress Test Engineer
**Severity: MEDIUM** — No load testing. What happens when 100 users try to register names simultaneously? No test for contention on the name registry. No test for RPC rate limiting under load.

## Reviewer 72 — Regression Test Designer
**Severity: MEDIUM** — No snapshot tests for the contract ABI. If a function signature changes, no test catches it. The integration test trait `NameRegistryInterface` must be manually kept in sync with the contract. Add generated client bindings.

## Reviewer 73 — Browser Compatibility Tester
**Severity: MEDIUM** — Playwright tests only run in Chromium (default). No Firefox or WebKit coverage. WebAuthn behavior differs across browsers. The virtual authenticator API is Chromium-specific (CDP). Add multi-browser test config.

## Reviewer 74 — Flaky Test Investigator
**Severity: MEDIUM** — The e2e test has multiple `waitForURL` with 60s timeouts. If Soroban testnet is slow, tests pass slowly. If it's down, tests fail after 60s with unhelpful timeout errors. Add explicit RPC health check before running testnet tests.

## Reviewer 75 — Security Test Specialist
**Severity: HIGH** — No tests for: XSS payloads in name input, SQL injection in name (irrelevant but good defense-in-depth), script injection via `?callback=javascript:...`, HTML injection via `?sign=<script>...`, localStorage manipulation between test steps.

## Reviewer 76 — Contract Invariant Tester
**Severity: MEDIUM** — No property-based tests. The bidirectional map invariant (for every name→addr, there exists addr→name and vice versa) should be tested with randomized inputs. Use proptest or quickcheck for Rust fuzz testing.

## Reviewer 77 — Visual Regression Tester
**Severity: LOW** — No visual regression tests. If CSS changes break the name section layout (hidden class not working, z-index issues), no test catches it. Add Playwright visual comparison tests.

## Reviewer 78 — Test Data Management Specialist
**Severity: LOW** — Test names are generated with `Date.now().toString(36).slice(-6)` which could theoretically collide. Use a UUID or incrementing counter for guaranteed uniqueness.

## Reviewer 79 — CI Integration Tester
**Severity: HIGH** — The Playwright tests aren't in CI. They only run locally. Add a GitHub Actions workflow that builds, serves, and runs the e2e suite on every PR. Gate merges on test pass.

## Reviewer 80 — Test Documentation Reviewer
**Severity: LOW** — No test plan document. No mapping from requirements to test cases. No coverage report. Add `just test-coverage` and document what each test validates.
