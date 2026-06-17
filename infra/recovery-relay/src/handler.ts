export interface RelayEnv {
  RECOVERY_SIGS: KVNamespace;
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,PUT,OPTIONS",
  "access-control-allow-headers": "content-type",
};

const BUCKET_RE = /^[A-Za-z0-9_-]{16,128}$/;
const FRIEND_RE = /^C[A-Z2-7]{55}$/;
const MAX_BLOB = 64 * 1024;
const TTL = 24 * 60 * 60;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

function empty(status: number): Response {
  return new Response(null, { status, headers: CORS_HEADERS });
}

export async function handleRelay(request: Request, env: RelayEnv): Promise<Response> {
  const { method } = request;
  const url = new URL(request.url);
  const { pathname } = url;

  // CORS preflight
  if (method === "OPTIONS") {
    return empty(204);
  }

  // Health check
  if (method === "GET" && pathname === "/") {
    return json({ service: "recovery-relay" });
  }

  // PUT /sig/:friend?bucket=KEY
  if (method === "PUT" && pathname.startsWith("/sig/")) {
    const friend = pathname.slice("/sig/".length);
    const bucket = url.searchParams.get("bucket");

    if (!bucket || !BUCKET_RE.test(bucket)) {
      return json({ error: "missing or invalid bucket" }, 400);
    }
    if (!FRIEND_RE.test(friend)) {
      return json({ error: "invalid friend address" }, 400);
    }

    const blob = await request.text();
    if (new TextEncoder().encode(blob).length > MAX_BLOB) {
      return json({ error: "payload too large" }, 413);
    }

    await env.RECOVERY_SIGS.put(`${bucket}:${friend}`, blob, { expirationTtl: TTL });
    return empty(204);
  }

  // GET /sig?bucket=KEY
  if (method === "GET" && pathname === "/sig") {
    const bucket = url.searchParams.get("bucket");

    if (!bucket || !BUCKET_RE.test(bucket)) {
      return json({ error: "missing or invalid bucket" }, 400);
    }

    const prefix = `${bucket}:`;
    const { keys } = await env.RECOVERY_SIGS.list({ prefix });
    const signed: { friend: string; blob: string }[] = [];

    for (const { name } of keys) {
      const blob = await env.RECOVERY_SIGS.get(name);
      if (blob !== null) {
        signed.push({ friend: name.slice(prefix.length), blob });
      }
    }

    return json({ signed });
  }

  return json({ error: "not found" }, 404);
}
