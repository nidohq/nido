# Deploying recovery-relay

## One-time setup
1. Create the KV namespace (needs a CF token with **Workers KV Storage:Edit**):
   ```bash
   cd infra/recovery-relay && npx wrangler kv namespace create RECOVERY_SIGS
   ```
   Put the returned `id` into `wrangler.toml` (replace `REPLACE_WITH_KV_NAMESPACE_ID`), commit.

2. The CI token (`CLOUDFLARE_API_TOKEN`, repo secret on nidohq/nido) must include:
   **Workers Scripts:Edit**, **Workers KV Storage:Edit**, and **Workers Routes:Edit** on the `nido.fyi` zone (for the `relay.nido.fyi/*` route).

## Deploy
Automatic on push to `main` via `.github/workflows/deploy.yml` (step "Deploy recovery-relay worker"). Manual: `npx wrangler deploy --config infra/recovery-relay/wrangler.toml`.

## Verify
`curl https://relay.nido.fyi/` → `{"service":"recovery-relay"}`.
