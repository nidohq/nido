/**
 * Calls `infra/invite`'s Checker (`POST /codes/:code/check`) to validate the
 * invitation code carried on `/demo/start`'s QR link and atomically bind the
 * predicted C-address to it — see `demo-plan.md` at the repo root for the
 * full flow and why this call is a hard gate (not best-effort): an invalid,
 * expired, or already-used code must stop the setup flow before
 * `create_account` ever runs.
 */
export type CheckInvitationResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "expired" | "used" | "claimed_by_other" | "missing_address" | "service_error" };

export async function checkInvitationCode(
  serviceUrl: string,
  apiKey: string,
  code: string,
  address: string,
): Promise<CheckInvitationResult> {
  if (!serviceUrl) {
    throw new Error("PUBLIC_INVITE_SERVICE_URL is not set.");
  }

  console.log("`${serviceUrl}/codes/${encodeURIComponent(code)}/check: ", `${serviceUrl}/codes/${encodeURIComponent(code)}/check`);
  const resp = await fetch(`${serviceUrl}/codes/${encodeURIComponent(code)}/check`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: JSON.stringify({ address }),
  });

  if (resp.ok) return { ok: true };

  const body = await resp.json().catch(() => null);
  const reason = body?.reason;
  if (
    reason === "not_found" ||
    reason === "expired" ||
    reason === "used" ||
    reason === "claimed_by_other" ||
    reason === "missing_address"
  ) {
    return { ok: false, reason };
  }
  return { ok: false, reason: "service_error" };
}
