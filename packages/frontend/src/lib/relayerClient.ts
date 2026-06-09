import type { Transaction } from "@stellar/stellar-sdk";
import { RELAYER_URL } from "./network";

/** Statuses emitted by the Channels plugin. */
export type RelayerStatus = "pending" | "sent" | "submitted" | "confirmed" | "failed" | "expired";

export interface RelayerTxResponse {
  transactionId: string | null;
  hash: string | null;
  status: RelayerStatus | null;
}

export class RelayerError extends Error {
  override name = "RelayerError";
  constructor(
    message: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function relayerEnabled(): boolean {
  return RELAYER_URL.length > 0;
}

/** POST {params} to the Caddy /relay route (which forwards to the Channels
 *  plugin with the relayer API key injected server-side — the browser never
 *  holds a key). Handles both response nestings: the plugin README documents
 *  {success, data: {...}}, while the relayer v1.5.0 example README shows
 *  {success, data: {result: {...}}}. */
async function call(params: Record<string, unknown>, baseUrl: string): Promise<RelayerTxResponse> {
  const resp = await fetch(`${baseUrl}/relay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ params }),
  });
  let body: { success?: boolean; data?: unknown; error?: string | null };
  try {
    body = await resp.json();
  } catch {
    throw new RelayerError(`Relayer returned non-JSON (HTTP ${resp.status})`);
  }
  if (body.success === false || (!resp.ok && body.error)) {
    const data = body.data as { code?: string; details?: unknown } | undefined;
    throw new RelayerError(body.error ?? `Relayer HTTP ${resp.status}`, data?.code, data?.details);
  }
  if (!resp.ok) throw new RelayerError(`Relayer HTTP ${resp.status}`);
  const data = body.data as ({ result?: RelayerTxResponse } & RelayerTxResponse) | undefined;
  const payload = data?.result ?? data;
  if (!payload || typeof payload !== "object") throw new RelayerError("Relayer returned an empty payload");
  return payload as RelayerTxResponse;
}

/** Submit host function + pre-signed auth entries (both base64 XDR).
 *  skipWait defaults to true: we poll ourselves rather than holding the
 *  plugin's 30s execution window open. */
export async function submitSorobanTransaction(
  args: { func: string; auth: string[]; skipWait?: boolean },
  baseUrl: string = RELAYER_URL,
): Promise<RelayerTxResponse> {
  return call({ func: args.func, auth: args.auth, skipWait: args.skipWait ?? true }, baseUrl);
}

export async function getRelayerTransaction(
  transactionId: string,
  baseUrl: string = RELAYER_URL,
): Promise<RelayerTxResponse> {
  return call({ getTransaction: { transactionId } }, baseUrl);
}

export async function waitForConfirmation(
  transactionId: string,
  baseUrl: string = RELAYER_URL,
  opts?: { intervalMs?: number; maxAttempts?: number },
): Promise<RelayerTxResponse> {
  const interval = opts?.intervalMs ?? 1500;
  const maxAttempts = opts?.maxAttempts ?? 40;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await getRelayerTransaction(transactionId, baseUrl);
    if (res.status === "confirmed") return res;
    if (res.status === "failed" || res.status === "expired") {
      throw new RelayerError(`Relayer transaction ${res.status}`, "ONCHAIN_FAILED", res);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new RelayerError("Timed out waiting for relayer confirmation", "WAIT_TIMEOUT");
}

/** Pull the base64 HostFunction + auth-entry XDRs off a built invoke tx —
 *  exactly the {func, auth} shape the Channels plugin consumes. */
export function extractFuncAndAuth(tx: Transaction): { func: string; auth: string[] } {
  const op = tx.toEnvelope().v1().tx().operations()[0].body().invokeHostFunctionOp();
  return {
    func: op.hostFunction().toXDR("base64"),
    auth: op.auth().map((a) => a.toXDR("base64")),
  };
}
