//! Trust-free, availability-only pool-indexer fetch handler. This worker
//! never signs anything and is never trusted: every route just serves back
//! what it has scanned from on-chain `LeafInserted` events, and clients
//! independently re-verify the root against the contract's `current_root`/
//! `is_known_root` (see `src/merkle.ts`'s doc comment). Shape mirrors
//! `infra/recovery-relay/src/handler.ts` (CORS, route dispatch, KV storage).
import { rebuildRoot, hexToFr, frToHex } from "./merkle.js";

export interface PoolEnv {
  POOL_LEAVES: KVNamespace;
}

export interface LeafRecord {
  index: number;
  leaf: string;
}

export type AppendResult = "inserted" | "duplicate" | "conflict";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "content-type",
};

// Zero-padded to 8 digits: DEPTH=24 -> at most 2^24 = 16,777,216 leaves,
// which fits in 8 decimal digits, and fixed-width zero-padding keeps
// lexicographic KV key order equal to numeric index order.
const LEAF_KEY_WIDTH = 8;
const LEAF_PREFIX = "leaf/";

function leafKey(index: number): string {
  return `${LEAF_PREFIX}${String(index).padStart(LEAF_KEY_WIDTH, "0")}`;
}

function indexFromKey(key: string): number {
  return Number(key.slice(LEAF_PREFIX.length));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

function empty(status: number): Response {
  return new Response(null, { status, headers: CORS_HEADERS });
}

/**
 * Appends `leaf` at `index`, idempotently: re-appending the identical
 * `(index, leaf)` pair (a benign re-scan) is a no-op (`"duplicate"`); a
 * DIFFERENT leaf value observed at an already-stored index (a would-be
 * silent overwrite) is rejected and left untouched (`"conflict"`) -- the
 * caller (scanner/cron) is expected to log this loudly, since it means an
 * event source disagreed with itself, not something this trust-free worker
 * can resolve.
 */
export async function appendLeaf(env: PoolEnv, index: number, leaf: string): Promise<AppendResult> {
  const key = leafKey(index);
  const existing = await env.POOL_LEAVES.get(key);
  if (existing !== null) {
    return existing === leaf ? "duplicate" : "conflict";
  }
  await env.POOL_LEAVES.put(key, leaf);
  return "inserted";
}

/** Lists all stored leaves with `index >= from`, sorted ascending by index. */
async function listLeavesFrom(env: PoolEnv, from: number): Promise<LeafRecord[]> {
  const records: LeafRecord[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await env.POOL_LEAVES.list({ prefix: LEAF_PREFIX, cursor });
    for (const { name } of page.keys) {
      const index = indexFromKey(name);
      if (index >= from) {
        const leaf = await env.POOL_LEAVES.get(name);
        if (leaf !== null) records.push({ index, leaf });
      }
    }
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  records.sort((a, b) => a.index - b.index);
  return records;
}

/** Parses the `from` query param: absent -> 0; present -> a non-negative
 * integer or `null` (caller responds 400). */
function parseFrom(url: URL): number | null {
  const raw = url.searchParams.get("from");
  if (raw === null) return 0;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

export async function handlePoolIndexer(request: Request, env: PoolEnv): Promise<Response> {
  const { method } = request;
  const url = new URL(request.url);
  const { pathname } = url;

  // CORS preflight
  if (method === "OPTIONS") {
    return empty(204);
  }

  // Health check
  if (method === "GET" && pathname === "/") {
    return json({ service: "pool-indexer" });
  }

  // GET /leaves?from=N -- append-only leaf list from cursor N (inclusive).
  if (method === "GET" && pathname === "/leaves") {
    const from = parseFrom(url);
    if (from === null) {
      return json({ error: "invalid `from` cursor: must be a non-negative integer" }, 400);
    }
    const leaves = await listLeavesFrom(env, from);
    return json({ leaves });
  }

  // GET /snapshot -- convenience root + full leaf list. The client re-verifies
  // this root against the contract's own `current_root`/`is_known_root`;
  // this worker never signs it and nothing downstream trusts it blindly.
  if (method === "GET" && pathname === "/snapshot") {
    const leaves = await listLeavesFrom(env, 0);
    const root = frToHex(rebuildRoot(leaves.map((l) => hexToFr(l.leaf))));
    return json({ root, nextIndex: leaves.length, leaves });
  }

  return json({ error: "not found" }, 404);
}
