/**
 * Demo-only configuration for `/demo/start`. Empty string disables each
 * feature, same convention as `RELAYER_URL` in `lib/network.ts` — unset at
 * build time until the demo service and the event token actually exist.
 */

/** Demo service base URL (registers visits, polls the chain, notifies the kiosk). */
export const DEMO_SERVICE_URL: string = (import.meta.env.PUBLIC_DEMO_SERVICE_URL ?? "").replace(/\/+$/, "");

/** Shared token carried on the QR's link (`?key=`). Empty = no gate. */
export const DEMO_EVENT_TOKEN: string = import.meta.env.PUBLIC_DEMO_EVENT_TOKEN ?? "";
