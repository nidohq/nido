# Runbooks

Build, deploy, operate, and respond. Commands run from the repo root.

## 1. Build and test from source

```bash
git clone --recurse-submodules https://github.com/nidohq/nido.git && cd nido
# or, in an existing clone:
git submodule update --init

just perch-infra       # Perch's deployed wasm and pin cache, by the hashes in
                       # vendor/perch/deployments/testnet.json (Stellar CLI, jq)
just build-contracts   # Nido's contracts; the factory embeds the fetched
                       # Perch account wasm
just test              # cargo test --workspace: integration tests replay the
                       # committed proofs
just check-vendor-drift  # vendor/perch at its pin, consumed wasm = the manifest's
npm install            # workspaces; postinstall builds the packages
```

Regenerate the real proofs after anything that changes a statement (a test's
setup, the controller, the circuit). The toolchain is checksum-pinned and
installed under the submodule:

```bash
just gen-zk-fixtures
# Zero-knowledge proving is randomized: proof bytes change, the metadata must not.
git diff --exit-code -- 'crates/integration-tests/fixtures/zk/*/fixture.json'
```

To keep the toolchain outside the submodule, set
`PERCH_ZK_TOOLCHAIN_DIR=<dir>` first.

Front end:

```bash
just test-e2e                                              # UI tier, no chain
PUBLIC_RELAYER_URL=https://nido.fly.dev \
PUBLIC_RELAYER_SIM_SOURCE=GAL42RUBXKQSVSJWBXFTBB4GFKMPQXA3SOJVGP6UMRJT2SGEIR63JFK2 \
  npx astro build --root ./packages/frontend
npx playwright test --project=testnet-chromium perch-recovery account-policy-doc-apply
```

The UI tier builds with `PUBLIC_PERCH_DEPLOYMENT=none`, so the recovery pages
say recovery is not deployed and nothing reaches a chain. The testnet specs
run against `perch.TESTNET` (Perch's deployment and Nido's factory) with real
passkey signatures (the test authenticator), real in-page proofs, and the
contracts' own authorization.

Onboarding is sponsored by the hosted relayer. When it is unavailable, build
without it and let the specs create accounts from Node
(`tests/support/directDeploy.ts`: a Friendbot-funded payer calls the
factory's permissionless `create_account`, and the passkey is seeded into the
account's origin); every recovery step still runs through the wallet:

```bash
npx astro build --root ./packages/frontend
NIDO_E2E_DIRECT_DEPLOY=1 npx playwright test --project=testnet-chromium perch-recovery account-policy-doc-apply
```

## 2. Deploying

Contract deploys are manual and follow audit sign-off; CI deploys only the
front end and workers. Record the commit, the `stellar-cli` version, and every
wasm hash in [DEPLOYED.md](../DEPLOYED.md).

### 2.1 Perch's stack

Perch deploys its compiler, interpreter, spending limit, WebAuthn verifier,
controller, pool, and adapter, installs the account wasm, and writes the
manifest (`deployments/<network>.json` in Perch). Nido doesn't deploy them.
Before using a manifest:

1. Run Perch's
   [`scripts/verify-deployment.sh`](https://github.com/stellar-registry/perch/blob/845c49a376c08aeeed9f5d3c63356b753dc617f4/scripts/verify-deployment.sh)
   (`vendor/perch/scripts/verify-deployment.sh`) against it: by hash and
   address only, it checks each contract at its content address, its code
   hash, the registry's records, the account installed, and what consumers
   resolve.
2. Run `just perch-infra` (refuses any byte that doesn't match) and the
   integration tests against the fetched stack.
3. Update `perch.TESTNET` (or the network's equivalent) and DEPLOYED.md;
   `deployment.test.ts` fails until `TESTNET` matches the manifest.

### 2.2 Nido's factory

`ADMIN=<multisig> scripts/deploy-factory.sh <identity> [network]` (or
`just deploy-factory`) does steps 1–6 and checks each:

1. Check that the staged account wasm (from `just perch-infra`) is the
   manifest's `perch-account` (`accountWasmHash`) and install it: the factory
   deploys by its hash.
2. Build Nido's contracts (skipped with `SKIP_BUILD`); the factory embeds
   that wasm.
3. Deploy the factory with the paying identity as its admin.
4. Pin Perch's WebAuthn verifier (`set_registry_pins`) and read the pin back.
   From then on the registry is off the account-creation path (F5).
5. Read back the account hash the factory deploys
   (`refresh_account_wasm_hash`) and check it against the manifest.
6. Hand the factory to `ADMIN` (`set_admin` needs only the current admin, so
   the multisig doesn't sign during the deploy) and read the admin back.
   Without `ADMIN` the paying identity stays admin, which is fine only on
   testnet.

If any step after 3 fails, the script stops and names the factory and the
step: don't register or use that factory; deploy a fresh one.

Not done by the script:

7. Set the factory in `perch.TESTNET` (and DEPLOYED.md), and decide whether
   to repoint the registry's `factory` name (`scripts/deploy-registry.sh`
   deploys a registry instance and registers names). The wallet uses the
   deployment's factory, so the registry name matters only to builds without
   one and to off-chain discovery.
8. **Smoke test:** create an account and check its `infra()` and admin rule,
   then run §1's testnet specs.

### 2.3 Front end

A push to `main` deploys (`deploy.yml`). The build uses `perch.TESTNET` unless
the `PUBLIC_PERCH_DEPLOYMENT` repository variable overrides it with a
manifest JSON or `none`. An override is not checked against Perch's manifest
(THREAT_MODEL 9).

**Order matters.** The deployment a wallet build names must exist before the
build reaches `main`. Accounts minted by an older factory are not migrated;
they keep the code and verifier they were minted with
([DEPLOYED.md](../DEPLOYED.md#compatibility-appendix)).

## 3. Governance

The keys that matter: the factory admin (the code and the verifier new
accounts get), the name-registry and policy admins, the registry-owner key,
and, for accounts minted by pre-Perch factories, the admin of Nido's former
WebAuthn verifier. Perch's contracts, including the verifier current accounts
name, have no admin.

The factory's `upgrade` takes effect as soon as the admin authorizes it; the
contract has no delay of its own. On testnet the factory admin is a single
throwaway key (DEPLOYED.md). Before mainnet (MAINNET_READINESS B1, B2):

- Every one of these keys sits behind a multisig, never a single key.
- Factory upgrades are announced with the new wasm hash and diff, and wait
  out a delay users can see; the contract enforces none, so the multisig's
  process must.
- Process: issue and review, multisig proposal, delay, execute, verify the new
  hash, update DEPLOYED.md.

Nido can't upgrade a user's account. Only its owner can, through the
seven-day `schedule_upgrade` path (plus the recovery condition under
`Protected`).

## 4. Key rotation

- **Deploy identity (`ci-publisher-testnet` on testnet, and its mainnet
  counterpart):** rotate yearly and after team changes.
  Keep it in the shared vault, never in CI secrets.
- **Relayer sponsor and channel keys:** move to KMS/HSM (MAINNET_READINESS A3).
  Rotate by provisioning a new key, updating the relayer config, funding it,
  and retiring the old one.
- **Multisig signers:** keep a roster; rotate through the multisig itself.

## 5. Relayer incidents

The relayer (`infra/relayer`, Fly.io) sponsors and submits transactions. For
an existing account it can't forge authorization, so there the worst case is
censorship or a drained sponsor budget. For an account being set up it is
worse: the relayer sees the setup salt before the account exists, and a
compromised host can create that account with its own key first
(THREAT_MODEL 10).

**Defences in place.** A per-IP token bucket in Caddy (30 relays per minute
per `Fly-Client-IP`) under the relayer's global 20 req/s; the channels
plugin's `FEE_LIMIT` (100 XLM per 24 h, one global bucket); Prometheus metrics
on `:8081`, scraped by Fly.

Alert definitions (configure them in Fly's Grafana; confirm the metric names
against `/debug/metrics/scrape` before relying on them):

| Alert | Condition | Action |
| --- | --- | --- |
| Relayer down | `/api/v1/health` fails 3 checks in a row | Outage, below |
| Budget at 80% | Sponsor spend ≥ 80% of `FEE_LIMIT` in the window | Investigate before raising |
| Error rate | Relayed-transaction failures > 5% over 5 min | Check RPC and channels |
| Rate-limit spike | Sustained 429s from one IP | Abuse or burst; tighten if abuse |
| Channel unregistered | A channel relayer missing or paused | Re-register or unpause |

A passing health check does not show that onboarding works: the relayer can
pass it while refusing account setups ("Too many transactions queued",
MAINNET_READINESS D7). After any relayer change, create one account through
it.

**Procedure.** Detect (alert or report; `fly logs -a nido`), classify
(outage, drain, abuse, key compromise), contain (lower `FEE_LIMIT` or pause a
relayer for drains, redeploy via `deploy-relayer.yml` for outages, rotate keys
for compromise), confirm recovery, and write a post-mortem outside this
runbook.

**Host compromise.** Treat every account set up through the relayer during
the window as possibly claimed. Stop onboarding first (pause the relayer, or
ship a wallet build without `PUBLIC_RELAYER_URL`, which refuses setup). Then
check each account created in the window on chain.

The admin key matching the passkey its user registered (with the deployment's
verifier) is **necessary but not sufficient** to clear an account. A
front-runner who created the address with its own key can authorize a document
that names the user's key as admin while keeping an attacker-controlled
ordinary rule or recovery configuration: `apply_doc` authenticates with the
account's *current* configuration and never requires the newly-named admin's
signature (the setup race, THREAT_MODEL 5, 10). Such an account passes an
admin-key-only check while still carrying retained attacker authority. Before
its first document the admin key is in the constructor's rule
(`get_context_rule(0)`); after, it is the admin signer in `applied_doc()` — but
read the **complete** rule set and controller state, not only the admin entry.

To clear an account, verify its full provenance against the user's intended
state: the creation transaction, the authorized-document history, the actual
account code (wasm hash), every current rule and signer, the recovery
configuration, and any pending upgrades. If that provenance cannot be
established, classify the address as affected rather than clearing it on the
admin-key check alone. Tell the owner of any account that fails the check — or
whose provenance cannot be established — to send nothing to it and to set up a
new Nido.

## 6. Recovery operations

### Keeping recovery state alive

Recovery state lives in persistent storage. Anyone can extend it to the
network maximum, no authorization needed (T2):

| Contract | Call |
| --- | --- |
| Controller | `renew(account)`, `renew_nullifier(account, nullifier)` |
| Pool | `renew_tree(tree_id)`, `renew_root(tree_id, root)`, `renew_leaves(tree_id, start, count)`, `renew_enrollment(account, enrollment_id)` |
| Account | `renew(fingerprints, enrollment_ids)` |

Nothing calls these on a schedule, and the wallet never calls them
(MAINNET_READINESS D3).

These calls renew the controller, pool, and account recovery records. They do
**not** extend the account's OZ context-rule, signer, and policy entries or the
installed-rule records (spec §3.6): OZ bumps such an entry's TTL only when it
reads it (to 30 days when fewer than 29 remain), so an idle account's rule
entries can still archive. Restoring those is part of the restoration procedure
below, not these `renew` calls — so permissionless renewal alone does not keep
an account recoverable (SECURITY_INVARIANTS T2, THREAT_MODEL 11/L6).

### Recovering an account whose state was archived

An archived entry is unavailable until restored, never reset (T1). A
transaction restores it in one of two ways: explicitly, with a
`RestoreFootprint` operation, or automatically, when the transaction's Soroban
data marks the archived entry for restoration. Either way, restored entries
count as writes. Restoring all of an account's recovery state inside the
recovery transaction itself exceeds the 132,096-byte per-transaction write
limit (`TX_MAX_WRITE_BYTES` in `crates/integration-tests/tests/it/costs.rs`;
about 169,208 bytes in a one-off measurement with the archival test, which no
test asserts). So restore first, one bounded group per transaction, then
recover.

Simulate each call below and act on the response:

- **Automatic restoration:** the simulation succeeds and its `transactionData`
  marks archived entries for restoration. Submit the call with that
  `transactionData` and its `minResourceFee`; it restores the entries and
  runs.
- **Explicit restore:** the simulation returns a `restorePreamble`. Submit a
  `RestoreFootprint` operation with the preamble's `transactionData` and
  `minResourceFee`, then simulate the call again and act on the new response.
- **Error:** stop and read the error; submit nothing.

1. Controller `renew(account)`.
2. Pool `renew_tree(tree_id)`, then `renew_enrollment(account, enrollment_id)`.
3. Account `renew([], [enrollment_id])`.
4. Any adapter read (for example `circuit_id`) and a `compile_doc` of the
   applied document, submitted as transactions, to bring back their code and
   instances.
5. Then `begin_lost_key` as usual. Treat every later transaction of the
   recovery (guardian approvals, ZK evidence, the completion) the same way.

This is the order `archived_recovery_state_is_restored_not_reset` follows.
The test host restores entries on access, so the test exercises neither RPC
response; no run of this procedure on a live network is recorded.

**The wallet does not implement this procedure.** Its submit paths
(`packages/frontend/src/lib/recoverySubmit.ts`, `primaryPasskeySigner.ts`,
`signing/submit.ts`) check only for a simulation error and then assemble the
call with whatever `transactionData` the simulation returned. A call whose
simulation marks entries for automatic restoration is submitted with those
markings, so it restores them if it fits the write limit. The wallet never
checks for a `restorePreamble` and never submits a `RestoreFootprint`
operation: when a simulation asks for an explicit restore, the call goes out
without it. With the hosted relayer, the channels plugin re-simulates and
builds the footprint itself; how it handles restoration is the upstream
plugin's and is not tested here. The new-account page refuses a restore
response ("restore needed"), and the SDK's deploy helper throws it to its
caller. Until the wallet handles both responses (MAINNET_READINESS D1), an
operator runs the steps above, with the Stellar CLI or any client, before the
user starts a recovery.

### User support

- **Lost passkey:** from a new device, open `/security/recover/` on the
  account's address and follow it.
- **A recovery the owner didn't start:** `Loss` owners cancel it on
  `/security/recovery/`. `Protected` owners need their guardians or kit to
  cancel; once the attempt is authorized, the account stays frozen until it
  is cancelled, completes, or expires.
- **"Already holds 8 keys" or "already has 11 rules":** Perch caps a document
  at 8 declared signers, 11 rules, and 8192 bytes. After the founding
  passkey, added devices and app-grant keys share 7 signer slots, and each
  takes a rule. Remove a device or revoke an app grant to make room.
- **Guardian approval:** the guardian opens the link on their own Nido. If
  the page refuses the link, the guardian should not approve, and should
  confirm with their friend by another channel.

## 7. Moving to a new Perch release

1. Update the submodule to the new revision and run §1, including
   `just gen-zk-fixtures`: the proofs change if anything that feeds a
   statement does (the circuit, the document canonicalisation, a test's
   setup), and CI fails on any drift.
2. A new controller, pool, or adapter is a new address (none of them can be
   upgraded in place). Existing accounts move by reconfiguring recovery to the
   new controller; under `Protected` that needs the current condition.
3. A new account wasm reaches existing accounts only through each owner's
   seven-day upgrade; new accounts get it from a new factory deployed as in
   §2.2.
4. Update `perch.TESTNET` and DEPLOYED.md (§2.1), and the audit manifest if
   the change lands before sign-off ([AUDIT_SCOPE.md](./AUDIT_SCOPE.md#audit-manifest)).
