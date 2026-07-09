import { describe, it, expect, beforeEach, vi, type MockInstance } from "vitest";
import { handlePoolIndexer, appendLeaf, type PoolEnv } from "../src/handler.js";
import { runScan, type EventsSource, type LeafEvent } from "../src/scanner.js";

// Arbitrary distinct 32-byte hex values -- only append/idempotency/conflict
// behavior is exercised here (not the merkle root), so these don't need to
// be real Poseidon2 outputs. Mirrors `test/handler.test.ts`'s fixtures.
const LEAF_0 = "0x" + "00".repeat(32);
const LEAF_1 = "0x" + "11".repeat(32);
const LEAF_2 = "0x" + "22".repeat(32);
const LEAF_0_CONFLICTING = "0x" + "99".repeat(32);

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

async function storedLeaves(e: PoolEnv): Promise<{ index: number; leaf: string }[]> {
  const res = await handlePoolIndexer(req("GET", "/leaves"), e);
  const body = (await res.json()) as { leaves: { index: number; leaf: string }[] };
  return body.leaves;
}

/** Fake `EventsSource` that always returns a fixed page of events,
 * regardless of the cursor passed in -- sufficient for exercising
 * `runScan`'s own sort/append/conflict orchestration in isolation, without
 * needing a real (or fake) paginating RPC source. */
function fakeSource(events: LeafEvent[]): EventsSource {
  return {
    async getEvents(_cursor: string | null): Promise<LeafEvent[]> {
      return events;
    },
  };
}

describe("pool-indexer scanner: runScan", () => {
  let e: PoolEnv;
  let errorSpy: MockInstance<(...args: unknown[]) => void>;

  beforeEach(() => {
    e = env();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("appends a fresh page of events (already in order)", async () => {
    const events = [
      { index: 0, leaf: LEAF_0 },
      { index: 1, leaf: LEAF_1 },
      { index: 2, leaf: LEAF_2 },
    ];
    const result = await runScan(e, fakeSource(events));

    expect(result).toEqual(events);
    expect(await storedLeaves(e)).toEqual(events);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("sorts out-of-order events within a page before appending", async () => {
    const outOfOrder = [
      { index: 2, leaf: LEAF_2 },
      { index: 0, leaf: LEAF_0 },
      { index: 1, leaf: LEAF_1 },
    ];
    const result = await runScan(e, fakeSource(outOfOrder));

    // `runScan` must sort by index before appending -- both its return value
    // and what ends up stored (queried back in ascending order) reflect
    // that, regardless of the input page's order.
    expect(result).toEqual([
      { index: 0, leaf: LEAF_0 },
      { index: 1, leaf: LEAF_1 },
      { index: 2, leaf: LEAF_2 },
    ]);
    expect(await storedLeaves(e)).toEqual([
      { index: 0, leaf: LEAF_0 },
      { index: 1, leaf: LEAF_1 },
      { index: 2, leaf: LEAF_2 },
    ]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("is idempotent: re-scanning a duplicate index stores no duplicate", async () => {
    const events = [
      { index: 0, leaf: LEAF_0 },
      { index: 1, leaf: LEAF_1 },
    ];
    const source = fakeSource(events);

    await runScan(e, source);
    // Simulate a re-scan (e.g. cursor overlap / retry) observing the exact
    // same events again.
    await runScan(e, source);

    const leaves = await storedLeaves(e);
    expect(leaves).toEqual(events);
    expect(leaves).toHaveLength(2);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("rejects (and logs) a conflicting leaf re-scanned at an existing index", async () => {
    expect(await appendLeaf(e, 0, LEAF_0)).toBe("inserted");

    const result = await runScan(e, fakeSource([{ index: 0, leaf: LEAF_0_CONFLICTING }]));

    expect(result).toEqual([{ index: 0, leaf: LEAF_0_CONFLICTING }]);
    // The conflict path must fire (loud log) ...
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/conflicting leaf re-scanned at index 0/);
    // ... and must NOT silently overwrite the existing stored leaf.
    expect(await storedLeaves(e)).toEqual([{ index: 0, leaf: LEAF_0 }]);
  });
});
