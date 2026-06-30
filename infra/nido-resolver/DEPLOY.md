# Deploying nido-resolver

Serves `GET https://<subdomain>.nido.fyi/.well-known/nido.json` →
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
Network-specific values live in `wrangler.toml` `[vars]` (`NIDO_NETWORK`,
`NIDO_RPC_URL`, `NIDO_REGISTRY_ID`, `NIDO_NETWORK_PASSPHRASE`). Currently
testnet for both production and `--<N>` previews.

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
