/**
 * Client for the recovery-relay worker (infra/recovery-relay). Stores and reads
 * friend-signature blobs keyed by a capability `relayKey`. The relay is dumb;
 * callers validate blobs themselves (addFriendSignature).
 */
export interface RelaySignature {
  friend: string;
  blob: string;
}

function base(u: string): string {
  return u.replace(/\/+$/, "");
}

export async function putFriendSignature(
  relayBaseUrl: string,
  relayKey: string,
  friend: string,
  blob: string,
): Promise<void> {
  const url = `${base(relayBaseUrl)}/sig/${encodeURIComponent(friend)}?bucket=${encodeURIComponent(relayKey)}`;
  const resp = await fetch(url, { method: "PUT", body: blob });
  if (!resp.ok) throw new Error(`Relay PUT failed: HTTP ${resp.status}`);
}

export async function listFriendSignatures(
  relayBaseUrl: string,
  relayKey: string,
): Promise<RelaySignature[]> {
  const url = `${base(relayBaseUrl)}/sig?bucket=${encodeURIComponent(relayKey)}`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`Relay GET failed: HTTP ${resp.status}`);
  const body = (await resp.json()) as { signed?: RelaySignature[] };
  return Array.isArray(body.signed) ? body.signed : [];
}
