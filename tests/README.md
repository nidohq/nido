# Tests

Three tiers:

- **Unit (TestAuthenticator):** `just test-support` — Vitest, Node, validates
  the passkey shim crypto against the SDK parsers.
- **Fast UI e2e (`@fast`):** `just test-e2e` — Playwright on
  chromium/firefox/webkit using the in-page shim. No chain. Builds the
  frontend first.
- **Chromium CDP fidelity lane:** `just test-e2e-cdp` — real virtual
  authenticator; `*.cdp.spec.ts`.

The shim (`tests/support/auth/`) overrides `navigator.credentials` with a
deterministic P-256 vault keyed by credentialId. See
`docs/superpowers/specs/2026-06-02-cross-browser-passkey-test-harness-design.md`.

dapp/SEP-7, multi-actor recovery, and TestingBot are added in later phases.

## Testnet tier (`@testnet`, quarantined)

`just test-e2e-testnet` — real Stellar testnet: creates + deploys a smart
account (v0.7) and drives the name-claim signing round-trip using the shim for
passkey auth (the synthetic P-256 signature is accepted on-chain). Runs under
the `testnet-chromium` / `testnet-webkit` projects (retries: 2), kept out of
`@fast` so chain flakiness never blocks routine runs.

- Slow (~15s–3min/test) and dependent on testnet + friendbot availability.
- The recipe sources `tests/.env.testnet` if present. Set
  `NIDO_TEST_BANK_SECRET=<funded testnet G-account secret>` there to pre-seed the
  name-tx fee-payer (`localStorage['g2c:name-keypair']`) and skip friendbot;
  without it the app funds its own submitter via friendbot. That file is
  gitignored — never commit the secret.
- Names are unique per run (timestamped). On-chain release is not in the UI and
  is deferred — names are not cleaned up.

### Bugs this tier surfaced (see PR description)
1. **Bug #1 (fixed):** name-claim signed the bare `buildAuthHash` instead of
   `computeAuthDigest(…, [0])`.
2. **Bug #2 (fixed on-chain):** the registry's `factory` name pointed at the
   deprecated pre-v0.7 factory, so the app deployed unsignable accounts;
   repointed to the v0.7 factory.
3. **Bug #3 (open, pinned):** v0.7 `__check_auth` rejects the external
   `registry.register` context under the Default rule with `UnvalidatedContext`
   (#3002). The lifecycle test **pins** this — flip its final assertion to
   expect success once the contract auth-model authorizes the context. (No prior
   test caught it: `register_name_via_smart_account` uses `env.mock_all_auths()`.)

## Create-run perf tier (`just perf-create`)

Real CDP virtual authenticator (genuine WebAuthn ceremony) on real testnet,
timing the full create→deploy→fund lifecycle and printing a per-phase
`% of total` table aggregated over N runs. Investigation tool, not a CI gate.
See [`support/perf/README.md`](support/perf/README.md).
