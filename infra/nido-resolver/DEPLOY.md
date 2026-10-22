# Deploying nido-resolver

Serves `GET https://<subdomain>.<apex>/.well-known/nido.json` →
`{ name, address, network }` — name→address (forward) and address→name
(reverse) resolution against the on-chain name registry. Read-only.

## One-time setup
The CI token (`CLOUDFLARE_API_TOKEN`, repo secret on nidohq/nido) must include
**Workers Scripts:Edit** and **Workers Routes:Edit** on the `nido.fyi` zone (for
the `*.nido.fyi/.well-known/nido.json` route). These are the same scopes the
`nido-proxy` worker already needs, so no new permissions if that one deploys.

The route is intentionally **more specific** than `nido-proxy`'s
`*.nido.fyi/*`; Cloudflare dispatches the most specific matching route, so the
proxy keeps serving every other path unchanged.

## Config
Network-specific values live in `wrangler.toml` `[vars]`, one set per wrangler
environment:

| Var | Meaning |
|---|---|
| `NIDO_NETWORK` | Network name echoed in every answer (`testnet`) |
| `NIDO_RPC_URL` | Soroban RPC the registry is read through |
| `NIDO_REGISTRY_ID` | Name registry contract |
| `NIDO_NETWORK_PASSPHRASE` | Network passphrase for the registry reads |
| `NIDO_APEXES` | Comma-separated apexes whose one-label subdomains are accounts, read longest first (`test.nido.fyi,nido.fyi`). An apex itself is never read as a name, so `test.nido.fyi/.well-known/nido.json` is "not a Nido account" rather than a lookup of `test`. |

The top-level environment is production: testnet on `*.nido.fyi`, which also
reaches `*.test.nido.fyi` (a route's leading `*` crosses dots), for both
production and `--<N>` previews. `[env.testnet]` is testnet on
`*.test.nido.fyi` alone and has no routes yet. Add its
`*.test.nido.fyi/.well-known/nido.json` route only together with nido-proxy's
`*.test.nido.fyi/*` route, once an advanced certificate covering
`*.test.nido.fyi` is active: the proxy route is a more specific hostname than
this worker's production route, so it would take `.well-known/nido.json` for
those hosts and break name resolution.

## Deploy
Automatic on push to `main` via `.github/workflows/deploy.yml` (step
"Deploy nido-resolver worker"). Manual: `npx wrangler deploy --config
infra/nido-resolver/wrangler.toml`.

## Verify
```bash
# forward (registered name) -> its contract address
curl https://<name>.nido.fyi/.well-known/nido.json
# reverse (contract subdomain) -> its name (or null)
curl https://<contract>.nido.fyi/.well-known/nido.json
# unregistered name -> 404; a normal page path still proxies (proxy untouched)
curl -i https://<unregistered>.nido.fyi/.well-known/nido.json
curl -I https://<name>.nido.fyi/account/
```
