/**
 * index.ts
 *
 * Entry point for the nido channels relayer plugin. Delegates directly to the upstream
 * OpenZeppelin `@openzeppelin/relayer-plugin-channels` handler.
 *
 * ## Rate limiting
 *
 * The upstream plugin already has a per-API-key fee/spend tracker
 * (`FeeTracker` in `@openzeppelin/relayer-plugin-channels`, gated on the
 * `apiKeyHeader` config and `feeLimit`/`feeResetPeriodMs`), which caps total fees
 * submitted per API key per reset period. That is a spend limit, not a per-IP request
 * counter, so it does not by itself provide per-IP anti-spam throttling.
 *
 * We deliberately do NOT reimplement a token bucket here: the real rate-limiting
 * control for recovery is on-chain (5 `initiate_recovery` calls per rolling 90 days,
 * enforced in `contracts/zk-recovery`), so a relayer-side limiter is only ever a coarse
 * anti-spam backstop, not a security boundary. Doing that per-IP correctly at this
 * layer needs shared state (the plugin's `kv` store) keyed by client IP extracted from
 * `context.headers`, which is a config/infra decision (which header to trust behind
 * which proxy) that belongs with the relayer's deployment config rather than this
 * plugin's code.
 *
 * TODO(rate-limit): add a per-IP token bucket keyed on `context.headers['x-forwarded-
 * for']` (or the deployment's actual trusted client-IP header) via `context.kv`,
 * suggested default: 10 requests / 10 minutes per IP across this plugin's routes. Until
 * then, the on-chain 5-per-90d cap is the only enforced anti-spam control.
 */
import type { PluginContext } from '@openzeppelin/relayer-sdk';
import { handler as channelsHandler } from '@openzeppelin/relayer-plugin-channels';

/**
 * Wrapped plugin handler exported for OpenZeppelin Relayer.
 */
export async function handler(context: PluginContext): Promise<any> {
  return channelsHandler(context);
}
