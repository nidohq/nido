<!--
Contract / security PR: contracts/, the factory, passkey signing, recovery,
packages/passkey-sdk/src/perch/, infra/relayer/, or a docs/SECURITY_INVARIANTS.md
property. This body becomes the squash commit's message on main: delete every
comment before you mark the PR ready. Any section may be answered "None: <why>."
-->

## Why

<!-- The problem and why this approach. Closes #N / Refs #N. Known shortcomings. -->

## What changes

<!-- Behaviour delta for an account owner, guardian, dApp or the relayer; then what
deliberately does NOT change. -->

## Security impact

<!-- Trust-boundary delta: who can now do what they could not before, or can no longer do.
"None: <why the change cannot affect authorization>" is a valid answer.
Audit scope: the docs/AUDIT_SCOPE.md responsibility-matrix stream this touches, and
whether THREAT_MODEL.md, MAINNET_READINESS.md or DEFERRED.md changed (or should). -->

## Invariants

<!-- Each docs/SECURITY_INVARIANTS.md ID this relies on or changes (F1, W3, R2...), the
test that pins it, and its evidence kind: Mocked / Enforcing / Real-proof / Unit (CI) /
Unit (local) / Browser / Testnet / Review. CI checks that every cited ID exists.
mock_all_auths never runs __check_auth, so a Mocked test is not evidence for rule
selection. "Unit (local)" suites run in no CI job: say you ran them.
Name the mutation you ran: "removing X fails tests A, B". -->

## Deployment impact

<!-- Wasm: which of Nido's contracts change bytes (factory, policies), and whether the
Perch pin moved. Addresses: what reaches deployed accounts (nothing / a factory
redeploy / their upgrade). Budgets: metered cost before -> after for affected entry
points (`costs.rs`), or "Unchanged: <how you know>". -->

## How to review

<!-- Start at: `path::symbol`. Risky: 1-3 places and their failure mode. Skim: the
mechanical parts and the command that produced them. -->

## Evidence

<!-- Command -> result with counts, e.g. `cargo test -p nido-integration-tests --test it`
88 passed. A test that fails without this change. What was not run, and why. -->

## Decisions for review

<!-- The alternative you rejected and why, as a question a reviewer can answer. "None." -->

## Deferred

<!-- Known gaps accepted for this PR, each with residual risk and exit criterion;
link the docs/DEFERRED.md entry. "None." -->

## After merge

<!-- Factory redeploy, DEPLOYED.md, relayer deploy, mainnet steps, and who owns each. "Nothing." -->
