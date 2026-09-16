/**
 * index.ts
 *
 * Entry point for the nido channels relayer plugin. Wraps the upstream OpenZeppelin
 * `@openzeppelin/relayer-plugin-channels` handler with a host-function allowlist gate
 * (see `allowlist.ts`) so only recovery/genesis contract calls ride the channel path.
 *
 * ## Interception point
 *
 * `PluginContext.params` is `any` (see `@openzeppelin/relayer-sdk`'s `PluginContext`)
 * and is parsed by the upstream handler itself (`validateAndParseRequest` in
 * `@openzeppelin/relayer-plugin-channels/dist/plugin/validation.js`, not part of that
 * package's public API) into one of three request shapes:
 *   - `{ func, auth, skipWait }`     — base64 InvokeHostFunction XDR + auth entries.
 *     This is the shape `packages/passkey-sdk/src/relayer.ts::submitSorobanTransaction`
 *     always sends, and is the primary surface this gate exists for.
 *   - `{ xdr, skipWait }`            — a full (signed or unsigned) transaction XDR,
 *     submit-only path.
 *   - `{ getTransaction }` / `{ management }` — no transaction is submitted; nothing to
 *     gate.
 *
 * Rather than re-implement (or depend on internal, unexported helpers of) the upstream
 * request parser, this wrapper inspects `context.params` directly, BEFORE calling into
 * the upstream `handler`, and decodes the real InvokeHostFunction XDR itself via
 * `@stellar/stellar-sdk` (the same library the upstream plugin uses). This is safe
 * because the allowlist decodes the ACTUAL host function bytes — it never trusts a
 * caller-declared function name — so it can't be fooled by a mismatched `params` shape
 * that the upstream parser would separately reject anyway.
 *
 * For the `{ xdr }` shape we best-effort extract the invoked host function (unwrapping
 * a fee-bump envelope if present) and gate it too, as defense in depth. If the XDR
 * doesn't decode to a single `invokeHostFunction` operation (e.g. a plain classic-op
 * submit-only transaction), there is no Soroban contract call to gate and the request
 * is passed through unchanged — the upstream handler's own validation governs it.
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
 * then, the allowlist above plus the on-chain 5-per-90d cap are the enforced controls.
 */
import type { PluginContext } from '@openzeppelin/relayer-sdk';
import { xdr } from '@stellar/stellar-sdk';
import { handler as channelsHandler } from '@openzeppelin/relayer-plugin-channels';
import { assertAllowedOrReject } from './allowlist';

/**
 * Best-effort extraction of the base64 InvokeHostFunction XDR implied by a full
 * transaction XDR (the `{ xdr }` request shape), so the allowlist gate can be applied
 * uniformly regardless of which shape the caller used.
 *
 * Returns `null` when the envelope doesn't decode, or isn't a single
 * `invokeHostFunction` operation — i.e. there's nothing Soroban-shaped to gate.
 */
function extractFuncXdrFromTransactionXdr(xdrBase64: string): string | null {
  let envelope: xdr.TransactionEnvelope;
  try {
    envelope = xdr.TransactionEnvelope.fromXDR(xdrBase64, 'base64');
  } catch {
    return null;
  }

  const txSwitch = envelope.switch();
  const innerTx =
    txSwitch === xdr.EnvelopeType.envelopeTypeTxFeeBump()
      ? envelope.feeBump().tx().innerTx().v1().tx()
      : txSwitch === xdr.EnvelopeType.envelopeTypeTx()
        ? envelope.v1().tx()
        : null;
  if (innerTx === null) {
    return null;
  }

  const ops = innerTx.operations();
  if (ops.length !== 1) {
    return null;
  }

  const body = ops[0].body();
  if (body.switch() !== xdr.OperationType.invokeHostFunction()) {
    return null;
  }

  return body.invokeHostFunctionOp().hostFunction().toXDR('base64');
}

/**
 * Pre-submit allowlist gate. Throws (via `assertAllowedOrReject`) when the request
 * carries a disallowed contract invocation. No-ops for request shapes that don't
 * submit a contract invocation (`getTransaction`, `management`).
 */
function gateRequest(context: PluginContext): void {
  const params = context?.params;
  if (!params || typeof params !== 'object') {
    return;
  }

  if (typeof params.func === 'string') {
    assertAllowedOrReject(params.func);
    return;
  }

  if (typeof params.xdr === 'string') {
    const extracted = extractFuncXdrFromTransactionXdr(params.xdr);
    if (extracted !== null) {
      assertAllowedOrReject(extracted);
    }
    return;
  }

  // `getTransaction` / `management` requests: no host function to gate.
}

/**
 * Wrapped plugin handler exported for OpenZeppelin Relayer. Gates on the allowlist
 * before delegating to the upstream channels handler.
 */
export async function handler(context: PluginContext): Promise<any> {
  gateRequest(context);
  return channelsHandler(context);
}
