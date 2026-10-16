# Nido Relayer Runbook

## Purpose

The `nido` Fly app provides testnet gas abstraction for Nido smart accounts.
Wallets and dApps send a pre-signed Soroban authorization entry to the relayer;
the user does not sign a transaction envelope and does not pay XLM fees.

The deployed stack is:

- OpenZeppelin Relayer `v1.5.0`
- OpenZeppelin Channels plugin
- Caddy sidecar
- self-hosted Redis — a separate `nido-redis` Fly app (stock `redis:7-alpine`
  image + `nido_redis_data` volume), reached over private 6PN at
  `nido-redis.internal:6379`. Replaced managed Upstash, whose per-op PAYG billing
  made the relayer's always-on worker polling expensive (it hit the budget cap
  and throttled, taking the relayer down). It's a sibling app, not a sidecar,
  because the relayer's Wolfi/Chainguard base image has no `redis` apk package.
- three Turnkey-backed Stellar signers (fund + two channels), each a
  separate Turnkey wallet account under the same org/API user
- single Fly machine in org `aha-684`, region `iad`

Public browser traffic only reaches:

- `GET https://nido.fly.dev/api/v1/health`
- `POST https://nido.fly.dev/relay`

The OpenZeppelin authenticated API is not exposed publicly. Use a local Fly
tunnel for management operations.

## Request Flow

1. Frontend or dApp simulates an invoke transaction in recording mode.
2. User signs only the `SorobanAuthorizationEntry` with a passkey or delegated
   session passkey.
3. Client extracts:

   ```json
   {
     "func": "<HostFunction XDR>",
     "auth": ["<signed SorobanAuthorizationEntry XDR>"]
   }
   ```

4. Browser posts to `POST /relay` with no secret.
5. Caddy adds `Authorization: Bearer $API_KEY`, adds `x-api-key: nido-wallet`,
   rewrites to `/api/v1/plugins/channels/call`, and forwards to the relayer on
   `127.0.0.1:8090`.
6. Channels plugin re-simulates in enforce mode. This runs smart-account
   `__check_auth` and any policies, including spending limits.
7. A channel G-account becomes the inner transaction source.
8. The fund G-account fee-bumps and pays the Stellar fee.
9. Client polls the relayer transaction id until the plugin reports
   `confirmed`, `failed`, or `expired`.

## Current Testnet Accounts

These are public keys only. Secrets live in 1Password and Fly secrets.

| Relayer id | Role | Public G-address |
| --- | --- | --- |
| `channels-fund` | fee-bump fee source; simulation source | `GCYVFKNTVZA5AY3KJWPW4NU4247UDDFFOCT4C3WCOKUDQQABIZRZ46I3` |
| `channel-001` | inner transaction source | `GAPGVNKNFHOCER46FQ4WHMWXWA2DLUYY3HYXTBSIPIMPMRCE7Y6URAGA` |
| `channel-002` | inner transaction source | `GBYC4XMYN7WNBWZ363M3MD6BWUGIX633EIOTOOASSZ3IZUGS44HBA7JZ` |

If keys are rotated, update this table and update all frontend build env that
uses `PUBLIC_RELAYER_SIM_SOURCE`.

Verify current addresses from boot logs:

```bash
fly logs -a nido --no-tail | grep "Syncing sequence"
```

Expected log shape:

```text
Syncing sequence for relayer: channel-001 (G...)
Syncing sequence for relayer: channel-002 (G...)
Syncing sequence for relayer: channels-fund (G...)
```

## Relayer Key Custody: Turnkey

The relay signers and their keys are all managed by Turnkey as wallet accounts under one shared org.

**Getting access:** 
Ask an existing team member to invite you via the Turnkey console. You'll need org access before you can
create keys or read the API credentials below.

**Creating the keys (already done for testnet):** 
In the Turnkey console (app.turnkey.com), create new wallet accounts under the Nido wallet. Note the
org id, the API user's API public/private key pair, and each account's address (doubles as its `private_key_id` — see `config/config.json`). Save the API private key to 1Password; it is not recoverable from Turnkey after creation.

## One-Time Bootstrap
This section describes the relayer bootstrap process that has already occurred, it is just for documentation. Please see the Turnkey section to learn how to get access and use the Nido Turnkey account.

Run commands from the repo root unless noted.

1. Create the fly.io app
    ```
    fly apps create nido --org aha-684
    ```

2. Stand up the self-hosted Redis app. The relayer reaches it at redis://nido-redis.internal:6379 (set in fly.toml).
    ```
    fly apps create nido-redis --org aha-684
    fly volumes create nido_redis_data -a nido-redis -r iad -n 1 -s 1
    fly deploy infra/relayer-redis -a nido-redis --remote-only --ha=false
    ```

3. Create three* signing keys in the Turnkey UI: app.turnkey.com

    We created one wallet ("Nido"), with three wallet accounts under it (one fund account and two channel account). Each one is a ED25519 key. Note the org id, the API user's API public/private key pair, and each account's address (this doubles as its private_key_id). We saved the API private key to 1Password as it is not recoverable from Turnkey after creation.

    \*Currently there are only 3 signing keys, but we may need to create more channel keys if we see a throughput issue with the relayer.


4. Generate write-only secrets.
    ```
    API_KEY=$(openssl rand -hex 32)
    PLUGIN_ADMIN_SECRET=$(openssl rand -hex 32)
    STORAGE_ENCRYPTION_KEY=$(openssl rand -base64 32)
    ```

5. Set the Fly secrets.
    ```
    fly secrets set -a nido \
      API_KEY="$API_KEY" \
      STORAGE_ENCRYPTION_KEY="$STORAGE_ENCRYPTION_KEY" \
      PLUGIN_ADMIN_SECRET="$PLUGIN_ADMIN_SECRET" \
      TURNKEY_API_PRIVATE_KEY="<from the Turnkey Setup section above>"
    ```
    REDIS_URL is not set here, but fly.toml sets REDIS_URL=redis://nido-redis.internal:6379.

6. Deploy.
    ```
    fly deploy infra/relayer --remote-only --ha=false
    ```

    After deploy, confirm every generated secret value — including the Turnkey API private key and org/account ids - is stored in 1Password vault `theahaco`.

## Migrating Off Managed Upstash (one-time)

For the already-deployed app that still points at Upstash. The fix moves Redis
to a sibling `nido-redis` app (see `../relayer-redis/fly.toml` and `fly.toml`).

**One-shot:** `scripts/migrate-redis-selfhost.sh` does all of the below
idempotently (volume, secret unset, deploy, health gate, channel re-activation,
relay probe). Pass `API_KEY` + `PLUGIN_ADMIN_SECRET` to auto re-activate, and
`--destroy-upstash` to tear down Upstash at the end.

The two secrets accept literals or `op://` references. Find their item/field
names with `op item list --vault theahaco`, then either let the script load the
op token from the iac `.env` and resolve the refs:

```bash
API_KEY='op://theahaco/<item>/<field>' \
PLUGIN_ADMIN_SECRET='op://theahaco/<item>/<field>' \
  ./infra/relayer/scripts/migrate-redis-selfhost.sh \
    --env-file ~/c/theahaco/iac/.env --destroy-upstash
```

or wrap the whole run in `op run` (needs `OP_SERVICE_ACCOUNT_TOKEN` exported):

```bash
op run --env-file=relayer-secrets.env -- \
  ./infra/relayer/scripts/migrate-redis-selfhost.sh --destroy-upstash
```

flyctl auth is separate — `flyctl auth login` once; the op token only feeds the
two activation secrets.

The manual breakdown, if you'd rather step through it: these steps cut the live
app over.

```bash
# 1. Stand up the sibling Redis app + its volume, then deploy it.
fly apps create nido-redis --org aha-684
fly volumes create nido_redis_data -a nido-redis -r iad -n 1 -s 1
fly deploy infra/relayer-redis -a nido-redis --remote-only --ha=false

# 2. Remove the Upstash REDIS_URL secret. A secret OVERRIDES the fly.toml env,
# so the redis://nido-redis.internal URL only takes effect once Upstash's is
# gone. --stage defers the change to the relayer deploy below.
fly secrets unset REDIS_URL -a nido --stage

# 3. Deploy the relayer. REDIS_URL now resolves to redis://nido-redis.internal:6379.
fly deploy infra/relayer -a nido --remote-only --ha=false
```

The new Redis starts empty, so the channel pool is unregistered — re-run the
activation below once (`## Fund And Activate`). AOF persists it across all
subsequent deploys. Confirm the cutover, then delete the Upstash DB to stop the
bleed:

```bash
fly redis destroy nido-relayer-redis      # stops the PAYG meter
```

Drop the stale `REDIS_URL` entry from 1Password (vault `theahaco`) too.

## Fund And Activate

After first deploy, fund all three testnet G-accounts via Friendbot:

```bash
curl "https://friendbot.stellar.org?addr=<fund-address>"
curl "https://friendbot.stellar.org?addr=<channel-001-address>"
curl "https://friendbot.stellar.org?addr=<channel-002-address>"
```

Restart so the relayer re-syncs funded balances:

```bash
fly apps restart nido
```

Activate the channel pool. The plugin will not relay transactions until the
pool is configured.

Terminal 1:

```bash
fly proxy 8090:8090 -a nido
```

Terminal 2:

```bash
API_KEY=<value-from-1Password> \
PLUGIN_ADMIN_SECRET=<value-from-1Password> \
  ./infra/relayer/scripts/activate-channels.sh http://localhost:8090
```

A `200` response with a success body confirms `channel-001` and `channel-002`
are registered.

## Smoke Tests

Health check:

```bash
curl -sS https://nido.fly.dev/api/v1/health
```

Expected response:

```text
OK
```

Plugin reachability:

```bash
curl -sS -X POST https://nido.fly.dev/relay \
  -H "Content-Type: application/json" \
  -d '{"params":{"getTransaction":{"transactionId":"nonexistent"}}}'
```

Expected: structured JSON from the plugin. It can be an error, but it must not
be a 404, HTML, or connection refusal.

End-to-end proof:

```bash
node scripts/relayer-proof.mjs https://nido.fly.dev
```

Expected: `PROOF OK`. The script asserts:

- transaction confirmed on testnet
- envelope is fee-bump
- fee source is not the user
- inner source is not the user
- user balance and sequence do not change
- landed host function and auth entry match the submitted request

## Deploys

Relayer deploys are handled by `.github/workflows/deploy-relayer.yml`.

Important invariants:

- Workflow only deploys on `main` changes under `infra/relayer/**` or manual
  dispatch.
- Workflow loads the Fly token via 1Password.
- Workflow uses `flyctl deploy infra/relayer --remote-only --ha=false`.
- Do not deploy with `--config infra/relayer/fly.toml` from repo root; Docker
  `COPY` paths rely on `infra/relayer` being the build context.

Frontend builds must set:

```bash
PUBLIC_RELAYER_URL=https://nido.fly.dev
PUBLIC_RELAYER_SIM_SOURCE=GCYVFKNTVZA5AY3KJWPW4NU4247UDDFFOCT4C3WCOKUDQQABIZRZ46I3
```

`PUBLIC_RELAYER_SIM_SOURCE` is the fund account public key. It is only a
simulation source for recording-mode simulation; browser code never signs with
it and never spends from it.

## Secret Handling

- Fly secrets are write-only. `fly secrets list` shows digests only.
- Save each generated value to 1Password at creation time.
- Escape hatch for a lost deployed value:

  ```bash
  fly ssh console -a nido -C "printenv API_KEY"
  ```

- The bootstrap commands place secret material on the shell command line. Use a
  shell with `HISTCONTROL=ignorespace` and prefix secret commands with a space,
  or read values through `op read`.
- Signer backend is Turnkey (A3 progress) for all three signers — no local
  keystore material on disk or in the container image. `TURNKEY_API_PRIVATE_KEY`
  stays in the relayer process's env for its whole lifetime (every signature
  calls out to Turnkey), unlike the old keystore flow, which only needed its
  raw secrets briefly at startup and could unset them right after. Known
  residual exposure: the relayer spawns the Channels plugin (a third-party npm
  package) without `env_clear()`, so the plugin subprocess inherits
  `TURNKEY_API_PRIVATE_KEY` for the whole process lifetime too — confirmed, no
  env filtering happens in the relayer's plugin-spawning code
  (`script_executor.rs`). A leaked Turnkey API credential is revocable/rotatable
  without moving funds (unlike a leaked raw keystore), but this isn't the full
  "plugin can't read signing secrets" fix either.
- Before mainnet: provision separate Turnkey wallet accounts for mainnet (do
  not reuse the testnet ones), and confirm Turnkey's org policy for the
  mainnet API user is configured for unattended signing (no required human
  approval) the same way as testnet.

## Hard Safety Rules

### Run One Machine

Run exactly one Fly machine.

Every deploy must include `--ha=false`. Two relayer instances sharing Redis and
the same signer keys can race on sequence numbers and double-process queued
transactions, causing transaction failures and possible fund loss.

Do not scale horizontally unless each instance has distinct signer keys and the
Channels plugin queueing model has been re-reviewed.

### Keep Management Private

Public Caddy exposes only `/relay` and `/api/v1/health`.

Do not expose port `8090` publicly. Use `fly proxy 8090:8090 -a nido` for
management calls.

### Bound Fee Spend

`FEE_LIMIT=1000000000` stroops and `FEE_RESET_PERIOD_SECONDS=86400` cap fee
spend to 100 XLM/day globally. Without `FEE_LIMIT`, plugin fee tracking is
disabled.

Caddy stamps one shared `x-api-key`, so the budget is global, not per origin or
per user. Per-client API keys and origin-locked CORS are required before
mainnet.

## Operations

Check app health:

```bash
fly status -a nido
fly logs -a nido --no-tail
curl -sS https://nido.fly.dev/api/v1/health
```

Check public account balances:

```bash
curl -sS "https://horizon-testnet.stellar.org/accounts/<G-address>" | jq '.balances'
```

Check a relayed transaction:

```bash
curl -sS "https://horizon-testnet.stellar.org/transactions/<tx-hash>" \
  | jq '{hash, successful, source_account, fee_account, fee_charged, ledger}'
```

Healthy relayed transaction properties:

- `successful: true`
- `fee_account` is the fund account
- `source_account` is one of the channel accounts
- neither account is the user's C-address or G-address

If the first plugin call OOMs, increase memory:

```bash
fly scale memory 1024 -a nido
```

## Incident Response

### Relayer Returns 404

Likely Caddy route mismatch or wrong public path.

Check:

```bash
fly logs -a nido --no-tail
curl -i https://nido.fly.dev/api/v1/health
curl -i -X POST https://nido.fly.dev/relay -H "Content-Type: application/json" -d '{"params":{}}'
```

### Relayer Returns Auth Errors

Likely Caddy did not inject `Authorization`, `API_KEY` secret is wrong, or the
request hit port `8090` directly.

Check:

```bash
fly ssh console -a nido -C "printenv API_KEY | wc -c"
fly logs -a nido --no-tail | grep -i auth
```

### Transactions Stay Pending Or Expire

Check channel activation and balances:

```bash
fly proxy 8090:8090 -a nido
API_KEY=<value-from-1Password> \
PLUGIN_ADMIN_SECRET=<value-from-1Password> \
  ./infra/relayer/scripts/activate-channels.sh http://localhost:8090
```

Then verify all three accounts are funded.

### Plugin Execution Timed Out

Account creation can take longer than a normal transfer because the factory
deploys a smart-account contract. Keep the Channels plugin timeout above the
default 30s window; `config/config.json` uses 120s.

### Fee Budget Exhausted

Symptoms: relayer rejects otherwise valid requests after enough successful
traffic.

Options:

- wait for `FEE_RESET_PERIOD_SECONDS`
- raise `FEE_LIMIT` temporarily and redeploy
- top up fund account if needed
- inspect traffic before raising limits

## Versioning

OpenZeppelin Relayer is pinned to `v1.5.0` intentionally. Stellar support is
still moving. Before upgrading:

1. Read OZ Relayer changelog and Channels plugin changelog.
2. Re-run `scripts/relayer-proof.mjs`.
3. Re-run wallet gasless transfer preview.
4. Re-run session-key tipping flow.
5. Confirm Caddy route and auth injection still match plugin API shape.

## Rate limiting & metrics

- **Per-IP token bucket (Caddy):** `/relay` is capped at **30 requests/min per client IP**
  (keyed on `Fly-Client-IP`, since Caddy sits behind Fly's proxy) via the `caddy-ratelimit`
  plugin (pinned `@v0.1.0`) compiled into the image (`xcaddy` stage in the `Dockerfile`). This
  raises the cost of one client draining the shared daily sponsor budget. Layered under the
  relayer's own global 20 req/s ceiling (`RATE_LIMIT_REQUESTS_PER_SECOND`).
  - **Trust assumption:** soundness depends on fly-proxy **overwriting** `Fly-Client-IP` on
    inbound public traffic (verify on Fly); a client-supplied header would let an attacker
    rotate it and defeat the bucket. Even trusted, per-IP keying is evadable via an IPv6 `/64`,
    so the **global `FEE_LIMIT` (100 XLM/24h) is the true drain backstop** — this limiter raises
    the cost of abuse, it is not a hard per-client guarantee.
- **Metrics:** `METRICS_ENABLED=true` runs the Prometheus server on `:8081`
  (`/debug/metrics/scrape`), scraped by Fly's managed Prometheus (`[metrics]` in `fly.toml`),
  private to the org (not on the public `:8080`). Dashboards + alerts in `grafana.fly.dev`;
  alert definitions in `docs/RUNBOOKS.md` §5.

## Known Limitations

- CORS is wildcard.
- Fee budget is a single global bucket (per-IP rate limiting bounds one client's share; true
  per-*client* fee accounting needs per-client keys — future work).
- Signers are Turnkey-backed on testnet (A3 progress); mainnet needs its own
  separate Turnkey wallet accounts, not a reuse of the testnet ones.
- Memos are not supported on Soroban operations; do not include memos in relay
  requests.
- The relayer is now used for account creation; recovery rotation still has its
  own submission flow.
