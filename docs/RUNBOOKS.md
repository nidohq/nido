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
npm install            # workspaces; postinstall builds the packages
```

Regenerate the real proofs after anything that changes a statement (a test's
setup, the controller, the circuit). The toolchain is checksum-pinned and
installed under the submodule:

```bash
just gen-zk-fixtures
git diff --exit-code crates/integration-tests/fixtures/zk   # proofs are deterministic
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
run against `perch.TESTNET` (Perch's release and Nido's factory) with real
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
wasm hash.

### 2.1 Perch's stack

Perch's release workstream (stellar-registry/perch#99 WS4) deploys the
compiler, interpreter, spending limit, WebAuthn verifier, controller, pool,
and adapter, installs the account wasm, and writes the manifest
(`vendor/perch/deployments/<network>.json`). Nido doesn't deploy them. Before
using a manifest:

1. Run Perch's `scripts/verify-deployment.sh` against it: by hash and address
   only, it checks each contract at its content address, its code hash, the
   registry's records, the account installed, and what consumers resolve.
2. Run `just perch-infra` (refuses any byte that doesn't match) and the
   integration tests against the fetched stack.
3. Update `perch.TESTNET` (or the network's equivalent) and DEPLOYED.md;
   `deployment.test.ts` fails until `TESTNET` matches the manifest.

### 2.2 Nido's factory

`scripts/deploy-factory.sh <identity> [network]` (or `just deploy-factory`)
does steps 1–4 and checks each:

1. Install the manifest's `perch-account` wasm (the one `just perch-infra`
   fetched, checked against `accountWasmHash`): the factory deploys by its
   hash.
2. Build Nido's contracts; the factory embeds that wasm.
3. Deploy the factory with `ADMIN=<multisig>` (the default admin is the
   paying identity, fine only on testnet).
4. Pin Perch's WebAuthn verifier (`set_registry_pins`), read the pin back, and
   read back the account hash the factory deploys. From then on the registry
   is off the account-creation path (F5).
5. **Not done by the script:** set the factory in `perch.TESTNET` (and
   DEPLOYED.md), and decide whether to repoint the registry's `factory` name
   (`scripts/deploy-registry.sh` deploys a registry instance and registers
   names). The wallet uses the deployment's factory, so the registry name
   matters only to builds without one and to off-chain discovery.
6. **Smoke test:** create an account and check its `infra()` and admin rule,
   then run §1's testnet specs.

### 2.3 Front end

A push to `main` deploys (`deploy.yml`). The build uses `perch.TESTNET` unless
the `PUBLIC_PERCH_DEPLOYMENT` repository variable overrides it with a
manifest JSON or `none`.

**Order matters.** The deployment a wallet build names must exist before the
build reaches `main`. Accounts minted by an older factory are not migrated:
epic #99 uses fresh deployments only.

## 3. Governance

The keys that matter: the factory admin (the code and the verifier new
accounts get), the name-registry and policy admins, the registry-owner key,
and, for accounts minted by older factories, the admin of Nido's former
WebAuthn verifier. Perch's contracts, including the verifier current accounts
name, have no admin.

- All of them sit behind a multisig, never a single key, before mainnet.
- Factory upgrades are announced with the new wasm hash and diff, and wait
  out a delay users can see.
- Process: issue and review, multisig proposal, delay, execute, verify the new
  hash, update DEPLOYED.md.
- Nido can't upgrade a user's account. Only its owner can, through the
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

The relayer (`infra/relayer`, Fly.io) sponsors and submits transactions. It
can't forge account authorization, so the worst case is censorship or a
drained sponsor budget.

**Defences in place.** A per-IP token bucket in Caddy (30 relays per minute
per `Fly-Client-IP`) under the relayer's global 20 req/s; the channels
plugin's `FEE_LIMIT` (100 XLM per 24 h, one global bucket); Prometheus metrics
on `:8081`, scraped by Fly.

| Alert | Condition | Action |
| --- | --- | --- |
| Relayer down | `/api/v1/health` fails 3 checks in a row | Outage, below |
| Budget at 80% | Sponsor spend ≥ 80% of `FEE_LIMIT` in the window | Investigate before raising |
| Error rate | Relayed-transaction failures > 5% over 5 min | Check RPC and channels |
| Rate-limit spike | Sustained 429s from one IP | Abuse or burst; tighten if abuse |
| Channel unregistered | A channel relayer missing or paused | Re-register or unpause |

Confirm metric names against `/debug/metrics/scrape` after the first deploy
with metrics on.

**Procedure.** Detect (alert or report; `fly logs -a nido`), classify
(outage, drain, abuse, key compromise), contain (lower `FEE_LIMIT` or pause a
relayer for drains, redeploy via `deploy-relayer.yml` for outages, rotate keys
for compromise), confirm recovery, write the post-mortem here.

## 6. Recovery operations

### Keeping recovery state alive

Recovery state lives in persistent storage. Anyone can extend it to the
network maximum, no authorization needed (T2):

| Contract | Call |
| --- | --- |
| Controller | `renew(account)`, `renew_nullifier(account, nullifier)` |
| Pool | `renew_tree(tree_id)`, `renew_root(tree_id, root)`, `renew_leaves(tree_id, start, count)`, `renew_enrollment(account, enrollment_id)` |
| Account | `renew(fingerprints, enrollment_ids)` |

Nothing calls these on a schedule yet (MAINNET_READINESS D3).

### Recovering an account whose state was archived

An archived entry is unavailable, never reset (T1). On a live network it comes
back through a `RestoreFootprint` operation, or automatically when a
transaction's footprint marks it for restoration, and restored entries count
as writes. Restoring all of an account's recovery state inside the recovery
transaction itself exceeds the 132,096-byte write limit (about 169,208 bytes
measured). Restore first, one bounded group at a time, by simulating each of
these calls and submitting the restoration its simulation asks for (RPC
returns a `restorePreamble`), then recover:

1. Controller `renew(account)`.
2. Pool `renew_tree(tree_id)` and `renew_enrollment(account, enrollment_id)`.
3. Account `renew([], [enrollment_id])`.
4. Any adapter read (for example `circuit_id`) and a `compile_doc` of the
   applied document, to bring back their code and instances.
5. Then `begin_lost_key` as usual.

This is the order `archived_recovery_state_is_restored_not_reset` follows (the
test host restores on access). The wallet doesn't do it yet.

### User support

- **Lost passkey:** from a new device, open `/security/recover/` on the
  account's address and follow it.
- **A recovery the owner didn't start:** `Loss` owners cancel it on
  `/security/recovery/`. `Protected` owners need their guardians or kit to
  cancel; the account stays frozen until it is cancelled, completes, or
  expires.
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
4. Update `perch.TESTNET` and DEPLOYED.md (§2.1).
