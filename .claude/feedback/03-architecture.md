# Architecture & Infrastructure Reviewers (31-50)

## Reviewer 31 — CTO / Technical Director
**Severity: HIGH** — All contract IDs, RPC URLs, and registry addresses are hardcoded across 4+ pages. No centralized config. Deploying to mainnet requires searching and replacing strings in every page. Extract to a shared `config.ts` module.

## Reviewer 32 — DevOps Engineer
**Severity: HIGH** — No contract tests in CI. GitHub Actions only builds/deploys frontend. Contract changes could break production without CI catching it. Add `just check && just test && just build-contracts` to the workflow.

## Reviewer 33 — Site Reliability Engineer
**Severity: HIGH** — Zero observability. No error tracking (Sentry), no analytics (Plausible), no RPC health monitoring. When production breaks, you'll learn from user complaints on Twitter. Add Sentry at minimum.

## Reviewer 34 — Cloud Infrastructure Architect
**Severity: MEDIUM** — Cloudflare Worker doesn't do edge-level name resolution. Every name subdomain visit requires client-side JavaScript to resolve → RPC call → redirect. This adds 1-3 seconds of blank page. Worker could cache name→address in KV for instant resolution.

## Reviewer 35 — Dependency Management Specialist
**Severity: CRITICAL** — `soroban-sdk-tools` is pinned to a git commit by an individual developer (BlaineHeffron). If this person stops maintaining the repo, g2c cannot upgrade soroban-sdk. Evaluate whether native `soroban-sdk` storage can replace this dependency.

## Reviewer 36 — Security Auditor (Dependencies)
**Severity: HIGH** — `stellar-accounts` pinned to OZ git rev from months ago. No visibility into whether security patches have been released since. Run `cargo audit` and contact OZ to verify the pinned rev is secure.

## Reviewer 37 — Network Isolation Specialist
**Severity: CRITICAL (mainnet)** — Hardcoded `Networks.TESTNET` throughout. No mainnet config, no environment detection, no network selector in UI. Users could confuse testnet and mainnet accounts. Add network banner and environment-based config.

## Reviewer 38 — Deployment Pipeline Engineer
**Severity: MEDIUM** — Contract WASM hashes are hardcoded in factory source (`ACCOUNT_HASH`, `VERIFIER`). If WASM changes, hashes must be manually updated. No CI step verifies hash freshness. Add hash computation to build pipeline.

## Reviewer 39 — API Design Reviewer
**Severity: MEDIUM** — The signing redirect protocol (`?sign=<hash>&callback=<url>`) is undocumented. No spec, no versioning, no error codes. Third-party dApps can't reliably integrate. Write a specification document.

## Reviewer 40 — Monorepo Architect
**Severity: LOW** — The workspace mixes Rust contracts and TypeScript packages. Build commands are split between `justfile` (Rust), `package.json` scripts (TS), and manual npm commands. Consider a unified task runner or document the full build sequence.

## Reviewer 41 — Frontend Architect
**Severity: MEDIUM** — Name resolution logic is duplicated between `index.astro` and `account/index.astro`. Both have the same pattern: detect name → resolve → redirect. Extract to a shared module or Astro component.

## Reviewer 42 — State Management Reviewer
**Severity: LOW** — The claim flow uses localStorage to persist state across redirects (txXdr, lastLedger, pendingName, keypairSecret). This is fragile — if the user clears localStorage mid-flow, or opens a new tab, the state is lost with no recovery. Consider URL-based state or a more robust pattern.

## Reviewer 43 — Performance Engineer
**Severity: LOW** — The account page loads the full `@stellar/stellar-sdk` bundle (~500KB). For users who just want to view their account, this is excessive. Consider code splitting to load the SDK only when signing or claiming.

## Reviewer 44 — Internationalization Specialist
**Severity: LOW** — All error messages and UI text are hardcoded English strings. No i18n framework. Name validation only allows ASCII (a-z, 0-9), excluding Unicode/emoji names. This may limit adoption in non-English markets.

## Reviewer 45 — Contract Upgrade Architect
**Severity: MEDIUM** — Neither the name registry nor the smart account contract has an upgrade path. If the name registry needs to add features (fees, reserved names), a new contract must be deployed and all names migrated manually. Consider a proxy pattern.

## Reviewer 46 — Data Migration Specialist
**Severity: LOW** — If the name registry contract is redeployed (new address), all existing name→address mappings are lost. The frontend hardcodes `NAME_REGISTRY_ID`. No migration path exists.

## Reviewer 47 — Cost Analyst
**Severity: MEDIUM** — Name registration requires funding a throwaway keypair via Friendbot (testnet). On mainnet, this means the user must pay for both the funding transaction and the registration transaction. No cost estimate is shown to the user before claiming.

## Reviewer 48 — Multi-chain Researcher
**Severity: LOW** — The name registry is Stellar-specific with no cross-chain resolution. If the user also has accounts on other chains, their name only works on Stellar. Consider a standardized naming format (like ENS or HNS).

## Reviewer 49 — Scaling Architect
**Severity: LOW** — The name registry stores all names in a single contract. At scale (millions of names), this could hit Soroban storage limits or cause high contention. No sharding or partitioning strategy.

## Reviewer 50 — Technical Writer
**Severity: MEDIUM** — No architecture documentation for the name system. No diagrams showing the claim flow, the signing redirect cycle, or the resolution path. New contributors will struggle to understand the system.
