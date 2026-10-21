/**
 * The `/demo/start` event-token gate and the demo service's visit * registration call. See
 * `docs/superpowers/specs/2026-10-12-meridian-onboarding-flow-design.md`
 * ("Access control") for why the token exists: the QR is a static, * public-ish link,
 * so a shared, revocable token is the thing that actually makes this "only through our QR code"
 * rather than "any URL anyone finds."
 */

/**
 * Checks the token carried on the QR's link against the one configured for
 * this event. When the `PUBLIC_DEMO_EVENT_TOKEN` env var is empty this check is 
 * disabled, and the check always passes.
 */
export function eventTokenMatches(expected: string, provided: string | null): boolean {
  if (!expected) return true;
  return provided === expected;
}

export interface DemoVisitRegistration {
  visit: string;
}

/** Registers a user's visit with the demo service based on the user's predicted address.
 * This is so that we can poll the chain to see when the address is funded and ready to go,
 * and then tell the printer to print the receipt.
 * 
 * This is a best-effort, if it fails we will not block the nido account setup - losing the
 * receipt correlation should never block the attendee from getting their account.
 */
export async function registerDemoVisit(
  serviceUrl: string,
  address: string,
): Promise<DemoVisitRegistration | null> {
  if (!serviceUrl) {
    console.warn("[nido demo] PUBLIC_DEMO_SERVICE_URL is not set — skipping visit registration.");
    return null;
  }

  const resp = await fetch(`${serviceUrl.replace(/\/+$/, "")}/visits`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!resp.ok) {
    throw new Error(`Demo service rejected visit registration: ${resp.status}`);
  }
  return (await resp.json()) as DemoVisitRegistration;
}
