/**
 * Demo-only configuration for `/demo/start`. Empty string disables each
 * feature, same convention as `RELAYER_URL` in `lib/network.ts` — unset at
 * build time until `infra/invite` is actually deployed.
 */

/** `infra/invite`'s base URL — the Checker validates the invitation code
 *  carried on the QR link before account creation proceeds. */
export const INVITE_SERVICE_URL: string = (import.meta.env.PUBLIC_INVITE_SERVICE_URL ?? "").replace(/\/+$/, "");

/** Shared `x-api-key` for `infra/invite` — see that service's README for why
 *  this is only a soft gate (it has to ship in this public JS bundle). */
export const INVITE_SERVICE_API_KEY: string = import.meta.env.PUBLIC_INVITE_SERVICE_API_KEY ?? "";
