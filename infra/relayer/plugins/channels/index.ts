/**
 * index.ts
 *
 * Entry point for the nido channels relayer plugin. Delegates directly to the upstream
 * OpenZeppelin `@openzeppelin/relayer-plugin-channels` handler.
 *
 * ## Rate limiting
 *
 * The upstream plugin has a per-API-key fee/spend tracker (`FeeTracker` in
 * `@openzeppelin/relayer-plugin-channels`, gated on the `apiKeyHeader` config and
 * `feeLimit`/`feeResetPeriodMs`), which caps total fees submitted per API key per
 * reset period. That is a spend limit, not a per-IP request counter. The deployment's
 * global `FEE_LIMIT` (100 XLM/24h, `infra/relayer/fly.toml`) is the true drain
 * backstop, and a per-IP token bucket in front of the relayer (`infra/relayer/Caddyfile`,
 * zone `relay_per_ip`) raises the cost of request flooding. None of these is a security
 * boundary.
 *
 * There is NO on-chain recovery rate limit in the current stack: Perch's recovery
 * controller enforces none. (A former Nido contract, `contracts/zk-recovery`, capped
 * `initiate_recovery` at 5 per rolling 90 days; it is retired, not in this tree, and
 * not deployed to mainnet — AUDIT_SCOPE "Retired Nido contracts".) On-chain auth on
 * each submitted call is the only enforced gate (AGENTS.md "Relayer channels plugin").
 *
 * TODO(rate-limit): if finer per-IP control is wanted inside this plugin rather than at
 * the Caddy layer, add a token bucket keyed on the deployment's trusted client-IP header
 * (e.g. `context.headers['x-forwarded-for']`) via the plugin's `kv` store. Until then,
 * the Caddy bucket and the global `FEE_LIMIT` are the anti-spam controls.
 */
import type { PluginContext } from '@openzeppelin/relayer-sdk';
import { handler as channelsHandler } from '@openzeppelin/relayer-plugin-channels';

/**
 * Wrapped plugin handler exported for OpenZeppelin Relayer.
 */
export async function handler(context: PluginContext): Promise<any> {
  return channelsHandler(context);
}
