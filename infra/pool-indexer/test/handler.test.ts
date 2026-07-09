import { describe, it, expect, beforeEach } from "vitest";
import { handlePoolIndexer, appendLeaf, type PoolEnv } from "../src/handler.js";

// Single-leaf depth-24 fixture, derived from `tests/vectors/zk-recovery/vectors.json`'s
// `circuit` vector (secret/acct_hi/acct_lo -> inner = P2_2(DOM_LEAF, secret) ->
// stored = P2_4(DOM_BIND, acct_hi, acct_lo, inner)), the exact `leaf` a
// `LeafInserted{index:0, leaf:stored}` event would carry on-chain for that
// witness. Recomputed independently via `@zkpassport/poseidon2` (same lib the
// SDK/circuit hash matches) -- see `src/merkle.ts`'s doc comment for the formula.
const LEAF_0 = "0x02df31d5d52038048f2a2ad23f55f2393e9a90aa8d33ed443a4c08ba1c655454";
// `tests/vectors/zk-recovery/vectors.json` -> `circuit.root`: the expected
// depth-24 root after inserting exactly LEAF_0 at index 0 (path_bits all
// zero, path_siblings = the zero-hash chain), i.e. the single-leaf case.
const EXPECTED_ROOT = "0x190d1a67e1b677ff01ffeb6551627e04f34e5caf9e51b66d145680d0cb0f42f5";

// Arbitrary distinct 32-byte hex values for leaves 1 and 2 -- only the
// `/leaves` cursor/idempotency behavior is exercised with these, not the
// merkle root, so they don't need to be real Poseidon2 outputs.
const LEAF_1 = "0x" + "11".repeat(32);
const LEAF_2 = "0x" + "22".repeat(32);

function fakeKV() {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list({ prefix }: { prefix?: string; cursor?: string } = {}) {
      const keys = [...store.keys()]
        .filter((k) => !prefix || k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: "" };
    },
    _store: store,
  };
}

function env(): PoolEnv {
  return { POOL_LEAVES: fakeKV() as unknown as PoolEnv["POOL_LEAVES"] };
}

function req(method: string, url: string) {
  return new Request(`https://pool-indexer.nido.fyi${url}`, { method });
}

describe("pool-indexer handler", () => {
  let e: PoolEnv;
  beforeEach(() => {
    e = env();
  });

  it("answers health on /", async () => {
    const res = await handlePoolIndexer(req("GET", "/"), e);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ service: "pool-indexer" });
  });

  it("returns leaves from a cursor (inclusive)", async () => {
    await appendLeaf(e, 0, LEAF_0);
    await appendLeaf(e, 1, LEAF_1);
    await appendLeaf(e, 2, LEAF_2);

    const res = await handlePoolIndexer(req("GET", "/leaves?from=1"), e);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { leaves: { index: number; leaf: string }[] };
    expect(body.leaves).toEqual([
      { index: 1, leaf: LEAF_1 },
      { index: 2, leaf: LEAF_2 },
    ]);
  });

  it("defaults /leaves to cursor 0 when `from` is omitted", async () => {
    await appendLeaf(e, 0, LEAF_0);
    await appendLeaf(e, 1, LEAF_1);

    const res = await handlePoolIndexer(req("GET", "/leaves"), e);
    const body = (await res.json()) as { leaves: { index: number; leaf: string }[] };
    expect(body.leaves).toEqual([
      { index: 0, leaf: LEAF_0 },
      { index: 1, leaf: LEAF_1 },
    ]);
  });

  it("is idempotent: appending the same index+leaf twice yields one entry", async () => {
    expect(await appendLeaf(e, 0, LEAF_0)).toBe("inserted");
    expect(await appendLeaf(e, 0, LEAF_0)).toBe("duplicate");

    const res = await handlePoolIndexer(req("GET", "/leaves?from=0"), e);
    const body = (await res.json()) as { leaves: { index: number; leaf: string }[] };
    expect(body.leaves).toHaveLength(1);
    expect(body.leaves[0]).toEqual({ index: 0, leaf: LEAF_0 });
  });

  it("rejects (does not overwrite) a conflicting leaf re-scanned at the same index", async () => {
    expect(await appendLeaf(e, 0, LEAF_0)).toBe("inserted");
    expect(await appendLeaf(e, 0, LEAF_1)).toBe("conflict");

    const res = await handlePoolIndexer(req("GET", "/leaves?from=0"), e);
    const body = (await res.json()) as { leaves: { index: number; leaf: string }[] };
    expect(body.leaves).toEqual([{ index: 0, leaf: LEAF_0 }]);
  });

  it("returns a snapshot whose root matches the vectors.json single-leaf fixture", async () => {
    await appendLeaf(e, 0, LEAF_0);

    const res = await handlePoolIndexer(req("GET", "/snapshot"), e);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      root: string;
      nextIndex: number;
      leaves: { index: number; leaf: string }[];
    };
    expect(body.root).toBe(EXPECTED_ROOT);
    expect(body.nextIndex).toBe(1);
    expect(body.leaves).toEqual([{ index: 0, leaf: LEAF_0 }]);
  });

  it("snapshot of an empty pool is the empty-tree root at nextIndex 0", async () => {
    const res = await handlePoolIndexer(req("GET", "/snapshot"), e);
    const body = (await res.json()) as { root: string; nextIndex: number; leaves: unknown[] };
    expect(body.nextIndex).toBe(0);
    expect(body.leaves).toEqual([]);
    expect(body.root).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects a malformed `from` cursor", async () => {
    const res = await handlePoolIndexer(req("GET", "/leaves?from=-1"), e);
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric `from` cursor", async () => {
    const res = await handlePoolIndexer(req("GET", "/leaves?from=abc"), e);
    expect(res.status).toBe(400);
  });

  it("sets permissive CORS headers", async () => {
    const res = await handlePoolIndexer(req("GET", "/"), e);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers OPTIONS preflight with 204", async () => {
    const res = await handlePoolIndexer(req("OPTIONS", "/leaves"), e);
    expect(res.status).toBe(204);
  });

  it("returns 404 for an unknown path", async () => {
    const res = await handlePoolIndexer(req("GET", "/nope"), e);
    expect(res.status).toBe(404);
  });
});
