# Runbooks

Build, deploy, operate, and respond. Commands run from the repo root.

## 1. Build and test from source

```bash
git clone --recurse-submodules https://github.com/nidohq/nido.git && cd nido
# or, in an existing clone:
git submodule update --init

just perch-infra       # Perch's deployed wasm and pin cache, by the hashes in
                       # vendor/perch/deployments/testnet.json (Stellar CLI,
                       # curl, jq; endpoint choice: "RPC endpoints" below)
just build-contracts   # Nido's contracts; the factory compiles in the pin
                       # just perch-infra wrote (contracts/factory/wasm/)
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
PUBLIC_RELAYER_SIM_SOURCE=GCYVFKNTVZA5AY3KJWPW4NU4247UDDFFOCT4C3WCOKUDQQABIZRZ46I3 \
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
testnet factory's `create_account` (no manager, so only a fresh setup key
signs), and the passkey is seeded into the
account's origin); every recovery step still runs through the wallet:

```bash
npx astro build --root ./packages/frontend
NIDO_E2E_DIRECT_DEPLOY=1 npx playwright test --project=testnet-chromium perch-recovery account-policy-doc-apply
```

### RPC endpoints

`just perch-infra`, `just check-factory`, and `scripts/deploy-factory.sh` read
the chain through the
endpoint `scripts/stellar-rpc.sh` chooses. It is the one place the fallback
list lives, and it has the same variables as Perch's helper of the same name
(and defers to it once vendor/perch carries it):

| Variable | Meaning |
| --- | --- |
| `RPC_URL`, else `STELLAR_RPC_URL` | Override. Used as given: never probed, never fallen back from. |
| `PERCH_RPC_FALLBACKS` | Ordered, space-separated fallbacks. Unset: testnet uses Gateway.fm (`https://soroban-rpc.testnet.stellar.gateway.fm`); mainnet and every other network have none. Empty: none. |
| `PERCH_RPC_MAX_LAG` | Ledgers a fallback may trail the newest other source (default 10). |
| `PERCH_HORIZON_URL` | Freshness reference (default horizon-testnet / horizon; empty disables). |
| `PERCH_RPC_PROBE_ATTEMPTS`, `PERCH_RPC_CALL_ATTEMPTS`, `PERCH_RPC_TIMEOUT` | Probe tries (3), per-call tries before moving (3), curl timeout in seconds (10). |

Without an override, the manifest's `rpc_url` is used while it answers
`getNetwork` with the manifest's passphrase and `getLatestLedger`. Only while
it is down (no response, HTTP 5xx) is a fallback considered, and only one on
the manifest's network whose ledger is within `PERCH_RPC_MAX_LAG` of another
source (another candidate or Horizon). A stale fallback, a wrong-network one,
or one nothing can vouch for is refused. A primary that answers wrongly is
reported, not routed around. Hash, content-address, and contract errors never
cause a fallback. Each choice and call logs its endpoint on stderr (`rpc: ...`).

`just perch-infra` and `just check-factory` move to the next fallback mid-run
when a read fails at the endpoint after its own retries. `deploy-factory.sh` chooses
once, before it submits anything, and never moves mid-run. CI's Contracts job
passes the repository variable `RPC_URL` to both, so an outage that also takes
the default fallback down can be routed around without a code change.

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
   [`scripts/verify-deployment.sh`](https://github.com/stellar-registry/perch/blob/603f7d5504f2d4d9338c135771cea18ac70dbe0c/scripts/verify-deployment.sh)
   (`vendor/perch/scripts/verify-deployment.sh`) against it: by hash and
   address only, it checks each contract at its content address, its code
   hash, the registry's records, the account installed, and what consumers
   resolve.
2. Run `just perch-infra` (refuses any byte that doesn't match) and the
   integration tests against the fetched stack.
3. Update `perch.TESTNET` (or the network's equivalent) and DEPLOYED.md;
   `deployment.test.ts` fails until `TESTNET` matches the manifest.

### 2.2 Nido's factory

`ADMIN=<admin account> MANAGER=<manager account> scripts/deploy-factory.sh <identity> [network]`
(or `just deploy-factory`) does steps 1–7 and checks each:

1. Check that the staged account wasm (from `just perch-infra`) is the
   manifest's `perch-account` (`accountWasmHash`), install it, and read the
   installed code back from the ledger by that hash. The factory carries
   only the hash, so `create_account` fails until this exact code is
   installed.
2. Check the factory's account pin (`contracts/factory/wasm/perch-account.sha256`,
   which `STELLAR_NETWORK=<network> just perch-infra` writes from the
   manifest) is the manifest's `perch-account`, then build Nido's contracts
   (skipped with `SKIP_BUILD`). The factory compiles the pin in with Perch's
   `registry_contract!`; a missing pin fails the build.
3. Check the factory wasm carries that hash before deploying it, so a
   `SKIP_BUILD` wasm built for another network or Perch commit is refused.
4. Deploy the factory with the paying identity as its admin, Perch's
   WebAuthn verifier pinned, and `MANAGER`, if set, as the address that must
   authorize every `create_account` (none by default; testnet keeps none, so
   creation stays permissionless there). All three are constructor
   arguments. From the first account on, the registry is off the
   account-creation path (F5).
5. Read the verifier pin, the manager, and the account hash the factory
   deploys (`account_wasm_hash`) back, and check the hash against the
   manifest.
6. Hand the factory to `ADMIN` (`set_admin` needs only the current admin, so
   the multisig doesn't sign during the deploy) and read the admin back.
   Without `ADMIN` the paying identity stays admin, which is fine only on
   testnet.
7. Write the factory record,
   `packages/passkey-sdk/src/perch/factory.<network>.json`: the address,
   wasm hash, the pin, manager, and account hash read back in step 5, the
   admin, and the commits and toolchain it was built from.

If any step after 4 fails, the script stops and names the factory and the
step: don't register or use that factory; deploy a fresh one.

Two checks hold the record to the truth. `deployment.test.ts` fails unless
the record's account and verifier are the manifest's `perch-account` and
`perch-webauthn-verifier`, so a re-pin that moves either can't merge until
the factory is redeployed (or upgraded, §3) and the record committed with
it. `just check-factory` (run in CI) reads the factory's instance
storage and simulates its `account_wasm_hash` over RPC, and fails unless
they match the record and the account hash is the manifest's (a factory
built at an earlier Perch commit than `vendor/perch` is reported instead,
since `deployment.test.ts` already holds it).

Not done by the script:

8. Set the factory in `perch.TESTNET` (and DEPLOYED.md), and decide whether
   to repoint the registry's `factory` name (`scripts/deploy-registry.sh`
   deploys a registry instance and registers names). The wallet uses the
   deployment's factory, so the registry name matters only to builds without
   one and to off-chain discovery.
9. **Smoke test:** create an account and check its `infra()` and admin rule,
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

Who can change what Nido's users depend on, at this revision:

| What changes | Who | How | Delay | What to watch |
| --- | --- | --- | --- | --- |
| The account code new accounts get (the `perch-account` whose hash the factory pins) | Factory admin | `upgrade(<factory wasm hash>)`; the new factory wasm brings its own pinned account hash | None in the factory; the admin account's (below) | Factory event `upgraded` |
| The verifier new accounts' passkeys name | Factory admin | `pin_verifier(<verifier>)` | The admin account's | Factory event `verifier_pinned` |
| Who may create an account | Factory admin | `set_manager(<manager>)`, or `set_manager(None)` to let anyone | The admin account's | Factory event `manager_changed`; `manager()` |
| Who the factory admin is | Factory admin | `set_admin` | The admin account's | Factory event `admin_changed` |
| Which accounts are created | The manager, if one is set | Its authorization of each `create_account` | None | Factory event `account_created` |
| Whose passkey an account gets | Only the holder of that account's setup key | The setup key's signature over the passkey (F6) | n/a | `account_created` carries the setup key and passkey |
| An existing account's code, rules, or verifier | Only that account | Its own `schedule_upgrade` / `execute_upgrade` and `apply_doc` | Seven days for an upgrade (U1) | The account's own events |
| The registry's `verifier` and `factory` names, and the registry itself | The registry owner key | The registry's own entry points | None in Nido's control | Registry address changes (B2). Off the account-creation path for a pinned factory (F5) |
| The name service (`contracts/name-registry`) | Name-registry admin | `admin-sep` `set_admin` / `upgrade` | None: its `upgrade` takes effect at once | Its admin and wasm hash (B2) |
| Nido's pre-Perch policies | Each policy's admin | `admin-sep` `set_admin` / `upgrade` | None | D6 decides whether they stay |
| Perch's verifier, controller, pool, adapter, compiler, and policies | Nobody: no admin, no upgrade entry point | A new deployment at a new address | n/a | Perch's manifest |
| The passkey checks of accounts minted by pre-Perch factories (testnet only) | The admin of Nido's former WebAuthn verifier | That verifier's own upgrade | None | THREAT_MODEL 7 |

**The factory takes every admin call at once.** It calls only
`admin.require_auth()`, and each change emits its event in the same
transaction. Any delay, quorum, or cancellation belongs to the admin, which on
mainnet is a smart account that enforces a 24-hour delay (17,280 ledgers at
five seconds) between announcing a factory change and making it
(MAINNET_READINESS B1). Keeping that out of the factory keeps the factory
small, and lets the delay mechanism change without a factory redeploy. Deploy
with `ADMIN=<the admin account's C-address>`, or rotate an existing factory
with `set_admin`. `factory_governance.rs` drives a factory whose admin is a
Nido account authorizing through a rule its document scopes to the factory.
On testnet the factory admin is a single throwaway key (DEPLOYED.md).

Candidate mechanisms for the admin account's delay; none is built or chosen
yet:

- **An OpenZeppelin timelock as the admin.** OZ's `stellar-governance` crate,
  at the rev Nido pins, has a `Timelock` module (schedule, execute, cancel,
  a minimum delay in ledgers) and a `timelock-controller` example with
  proposer, executor, and canceller roles. The factory admin would be such a
  controller with a 17,280-ledger minimum delay, and its roles held by a
  multisig Perch account. Needs: deploying and reviewing the controller (an
  OZ example, not part of Perch's deployment), and a runbook for its roles.
- **A delay policy on the admin's Perch account.** The admin account's rule
  scoped to the factory would carry a policy that lets a call through only
  if the same call was announced at least 17,280 ledgers earlier. Perch
  documents attach only its interpreter and spending-limit policies today,
  and neither keeps an announcement queue, so this needs a new policy
  contract that Perch's document format can name, and its review.
- **Tansu.** Tansu's DAO contract holds a proposal open for at least 24 hours
  and then waits another 24 hours before it can execute, and runs an
  approved proposal's outcome call through a stateless executor whose own
  authority is deliberately worthless. The factory admin would be an adapter
  contract, like Tansu's own `registry-tansu-manager`, that makes the
  factory call only for a proposal Tansu marked approved and executed.
  Needs: that adapter for the factory's four admin calls, a Tansu project
  for Nido, and a decision on who votes.

**What to watch.** Alert on every `upgraded`, `verifier_pinned`,
`manager_changed`, and `admin_changed`, and on the admin account's own
announcement of a factory change; outside a planned change, any of them means
the admin key is in use without a reason. The delay only helps if someone is
watching and the admin account can cancel: a compromised admin can announce,
and the same admin can act once the delay passes. Watch `account_created`
for volume against invites issued, and for setup keys and passkeys that
don't match what the wallet submitted.

**The manager.** The manager decides only whether an account is created:
the setup-key signature, checked by the factory itself, decides whose passkey
it gets, so a compromised manager can admit accounts it shouldn't but can't
claim anyone's address. On mainnet the manager is a Perch account whose
`onboard` rule, scoped to the factory's `create_account`, has one signer: a
relayer key checked by Perch's Ed25519 verifier, with the relayer checking
invites off-chain. Changing how admission works (rotating that key, adding
a voucher rule, an emergency rule) is a document change on the manager, not
a factory change; changing which account is the manager is `set_manager`,
behind the admin's delay. Neither the manager account nor its document is
deployed yet.

A factory change, before mainnet and after:

1. Issue and review, with the new factory wasm's hash and source diff, the
   new verifier's address and manifest entry, or the new manager. For an
   upgrade, install the new factory wasm and the account wasm whose hash it
   pins (`stellar contract upload`); the next `create_account` fails until
   the account wasm is installed.
2. The admin account announces the change and starts its delay. Publish the
   change and when it can be made.
3. Wait out the delay. Anyone can check the announced wasm, verifier, or
   manager. Cancel through the admin account if review finds a problem.
   Wallets that should not create accounts under the coming change stop
   before it lands.
4. The admin account makes the call. From the next invocation, accounts
   are deployed from the account hash the new wasm pins.
5. Verify the factory's wasm hash, `pinned_verifier()`, `manager()`, and
   `account_wasm_hash()`, then mint one account and check its code and admin
   rule. Update the factory record
   (`packages/passkey-sdk/src/perch/factory.<network>.json`: `wasm_hash`,
   `account_wasm_hash`, `pinned_verifier`, `manager`) and DEPLOYED.md, and
   run `just check-factory`, which checks the account hash against the
   record and the manifest.

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
different: the relayer sees the setup public key and the user's passkey
before the account exists, and can withhold the setup, but can't bind
another passkey to the address (THREAT_MODEL 10). On a factory with a
manager whose signer the relayer holds, a compromised host can also admit
accounts it shouldn't.

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

**Host compromise.** A factory with the setup-key binding (this tree's)
installs only the passkey the setup key signed, so the relayer can't claim
the accounts it relays; contain the host, rotate the manager's relayer key
through a manager document change, and review `account_created` for
admissions nobody invited. For accounts created by a factory that predates
the binding (testnet's deployed factory, DEPLOYED.md), treat every account
set up through the relayer during the window as possibly claimed. A wallet build with the new-account check
refuses a claimed address before activating or funding it
(SECURITY_INVARIANTS W11), so its users see setup stop and start again on a
new address; the check below is still needed for accounts older builds
activated, and the claims themselves (a denial of setup) continue until the
relayer is contained. Stop onboarding first (pause the relayer, or
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
(MAINNET_READINESS D3). Each account's records live at its own controller
(`recovery_controller()`) and the pool its document names. For an account
enrolled before a Perch redeploy, those are not the current manifest's
(THREAT_MODEL, "Several Perch generations").

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
  confirm with their friend by another channel. A reconfiguration that hands
  recovery to a new controller, proof checker, pool, circuit, friend, or kit
  is called out in red above the settings; the guardian should approve only
  if their friend names each one (a move to a new Perch release, §7, shows
  the new controller this way). The first approval for an account on a
  controller the guardian has no rule for adds one; a guardian keeps one
  rule per controller.
- **Recovery set up before a Perch redeploy:** it keeps working at the
  controller it enrolled with. `/security/recovery/` offers "Move my
  recovery", which keeps every setting. Under `Protected` the guardians or the
  recovery kit approve the move first. A ZK mode on an earlier pool needs a
  new recovery kit, and the old one stops working. While an attempt is
  authorized, nothing can move.

## 7. Moving to a new Perch release

1. Update the submodule to the new revision and run §1, including
   `just gen-zk-fixtures`: the proofs change if anything that feeds a
   statement does (the circuit, the document canonicalisation, a test's
   setup), and CI fails on any drift.
2. A new controller, pool, or adapter is a new address (none of them can be
   upgraded in place), with no state. Existing accounts keep theirs, and the
   wallet keeps serving them there: it reads and writes recovery at each
   account's adopted controller, never the deployment's. Owners move when
   they choose, with "Move my recovery" on `/security/recovery/`, which is a
   reconfiguration to the new controller. Under `Protected` that needs the
   current condition, recorded at the controller being left, and a ZK factor
   needs a new kit when its pool or adapter moved. Old generations stay in
   use until every account on them has moved, so keep renewing their state
   (§6). See THREAT_MODEL, "Several Perch generations".
3. A new account wasm reaches existing accounts only through each owner's
   seven-day upgrade; new accounts get it from a new factory deployed as in
   §2.2, or from a scheduled upgrade of the current one (§3), in the same
   change as the re-pin: the factory record must name the new account.
4. Update `perch.TESTNET` and DEPLOYED.md (§2.1), and the audit manifest if
   the change lands before sign-off ([AUDIT_SCOPE.md](./AUDIT_SCOPE.md#audit-manifest)).
