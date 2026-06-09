# Nido Relayer

## What this is

Self-hosted OpenZeppelin Relayer v1.5.0 with the Channels plugin and a Caddy sidecar running as a single Fly app `nido-relayer` (org `aha-684`, region `iad`). Browsers call `POST /relay` with no credentials; Caddy injects the relayer API key server-side, terminates CORS, and forwards to the plugin. The relayer's own authenticated API is never exposed publicly — management calls require a local tunnel. This setup provides gas abstraction for Nido smart accounts (issue #72): users sign only a `SorobanAuthorizationEntry`, channel accounts source the transaction, and the fund account fee-bumps it. The result is a zero-credential, zero-gas-setup flow for wallet users.

## One-time bootstrap

Run from the repo root unless noted.

```bash
# 1. Create the Fly app
fly apps create nido-relayer --org aha-684

# 2. Create the Redis instance (record the redis:// URL it prints — you need it for secrets)
fly redis create --name nido-relayer-redis --org aha-684 --region iad --no-replicas

# 3. Generate keystores
#    Choose a strong passphrase (>=12 chars, upper, lower, digit, special) and save it
#    to 1Password (vault theahaco) BEFORE running this — it is not recoverable.
KEYSTORE_PASSPHRASE='<generate and save to 1Password first>' \
  ./infra/relayer/scripts/create-keys.sh /tmp/relayer-keys

# 4. Set all 8 Fly secrets in one call
fly secrets set -a nido-relayer \
  REDIS_URL="<redis-url-from-step-2>" \
  API_KEY="$(openssl rand -hex 32)" \
  STORAGE_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  KEYSTORE_PASSPHRASE="<same passphrase used in step 3>" \
  PLUGIN_ADMIN_SECRET="$(openssl rand -hex 32)" \
  KEYSTORE_FUND_B64="$(base64 -w0 /tmp/relayer-keys/fund.json)" \
  KEYSTORE_CHANNEL_001_B64="$(base64 -w0 /tmp/relayer-keys/channel-001.json)" \
  KEYSTORE_CHANNEL_002_B64="$(base64 -w0 /tmp/relayer-keys/channel-002.json)"

# 5. Deploy (--ha=false is mandatory — see Scaling warning below)
fly deploy --config infra/relayer/fly.toml --remote-only --ha=false
```

After deploy, save every generated secret value plus the three keystore JSON files to 1Password vault `theahaco`, then clean up:

```bash
rm -rf /tmp/relayer-keys
```

## Fund + activate

After the first deploy the relayer logs the G-address of each account as it syncs sequence numbers. Look for lines shaped like:

```
Syncing sequence for relayer: channel-001 (G...)
Syncing sequence for relayer: channel-002 (G...)
Syncing sequence for relayer: channels-fund (G...)
```

Retrieve them:

```bash
fly logs -a nido-relayer | grep "Syncing sequence"
```

Fund all three accounts on testnet via Friendbot:

```bash
curl "https://friendbot.stellar.org?addr=G<fund-address>"
curl "https://friendbot.stellar.org?addr=G<channel-001-address>"
curl "https://friendbot.stellar.org?addr=G<channel-002-address>"
```

Restart so the relayer picks up the funded balances:

```bash
fly apps restart nido-relayer
```

Activate the channel pool (the plugin will not process transactions until this is done). Open two terminals:

**Terminal 1** — open the management tunnel:
```bash
fly proxy 8090:8090 -a nido-relayer
```

**Terminal 2** — run the activation script:
```bash
API_KEY=<value-from-fly-secrets> \
PLUGIN_ADMIN_SECRET=<value-from-fly-secrets> \
  ./infra/relayer/scripts/activate-channels.sh http://localhost:8090
```

A `200` response with a success body confirms the channel accounts are registered. Record the **fund account G-address** — the frontend build needs it as the env var `PUBLIC_RELAYER_SIM_SOURCE`.

## Smoke test

Health check (unauthenticated, through Caddy):

```bash
curl https://nido-relayer.fly.dev/api/v1/health
```

Expected response: `OK`

Relay plugin reachability — a nonexistent transaction id returns a structured error, which proves the plugin executes:

```bash
curl -fsS -X POST https://nido-relayer.fly.dev/relay \
  -H "Content-Type: application/json" \
  -d '{"params":{"getTransaction":{"id":"0000000000000000000000000000000000000000000000000000000000000000"}}}'
```

Expected: a JSON error body (not a 404 or connection refused). Any structured JSON response from the plugin counts as passing.

## Scaling warning

**Run exactly one machine.** Every `fly deploy` command must include `--ha=false`; without it Fly provisions two machines, and two relayer instances sharing one Redis instance and the same signer keys will race on sequence numbers and double-process queue entries, causing transaction failures and potential fund loss. Never scale this app horizontally without assigning distinct signer keys to each instance.

## Ops notes

- **Memory**: the default 512 MB VM (`shared-cpu-1x`) may be tight once the ts-node Channels plugin is loaded. If the first plugin call OOMs, bump the machine to 1024 MB (`fly scale memory 1024 -a nido-relayer`).
- **Rate limiting**: the rate limit (20 req/s, burst 60) is global across all origins and CORS is wildcard (`*`). Per-origin tightening is a mainnet TODO.
- **Version pin**: pinned to OZ Relayer v1.5.0 deliberately — Stellar support is under active development and minor upgrades may be breaking. Review the changelog before bumping.
- **Max fee**: the relayer's default `max_fee` is 1,000,000 stroops per transaction. Adjust in `config/networks/stellar.json` if needed.
- **Memos**: memos are not supported on Soroban operations; do not set memo fields in relay requests.
- **Secret rotation**: before mainnet, replace the user-level Fly token with a scoped deploy token and migrate signers from local keystores to a KMS (e.g., AWS KMS or HashiCorp Vault).
- **CI deploys**: deploys also run via GitHub Actions (`infra/relayer/.github/workflows/deploy-relayer.yml`, added in the next task) using the 1Password → Fly token chain. That workflow also passes `--ha=false`.
