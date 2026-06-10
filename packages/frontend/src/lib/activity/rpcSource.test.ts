import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  mapRpcEvents,
  ownEventsFilter,
  transferFilters,
  fetchAccountEvents,
  clearAccountEventsCache,
} from "./rpcSource.js";
import { rpc, nativeToScVal, Address, Asset, Networks } from "@stellar/stellar-sdk";

const SELF = "CCA2KXEUA4EQW3NL4QRCIZ2VRMA7V6A54DHXPA4RBTAGH72PCCYT5MSA";
const OTHER = "GCQZN6KXTEATCRNES3ZPTPZV4NNVK7CZKA6RHLMP2HPWP7SPDN7MFGBS";
const SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

// Shape mirrors rpc.Api.EventResponse: topic[] + value are parsed xdr.ScVals.
function ev(contractId: string, topics: any[], data: any, txHash: string, ts: string) {
  return {
    contractId: { toString: () => contractId },
    topic: topics,
    value: nativeToScVal(data, { type: "i128" }),
    txHash,
    ledgerClosedAt: ts,
  };
}

beforeEach(() => clearAccountEventsCache());
afterEach(() => vi.restoreAllMocks());

describe("mapRpcEvents", () => {
  it("groups events by tx hash and classifies them as a recent page", () => {
    const transfer = ev(
      SAC,
      [nativeToScVal("transfer", { type: "symbol" }), Address.fromString(OTHER).toScVal(), Address.fromString(SELF).toScVal(), nativeToScVal("native", { type: "string" })],
      99900000000n, "TX1", "2026-06-01T00:00:00Z",
    );
    const page = mapRpcEvents([transfer], SELF);
    expect(page.items[0]).toMatchObject({ kind: "payment", direction: "in", amount: "9,990" });
  });
});

describe("fetchRpcRecent", () => {
  const LATEST = 3_000_000;

  it("runs two parallel walks — own events and unpinned transfers — never mixed in one request", async () => {
    const { fetchRpcRecent } = await import("./rpcSource.js");
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({ sequence: LATEST } as any);
    const getEventsSpy = vi
      .spyOn(rpc.Server.prototype, "getEvents")
      .mockResolvedValue({ events: [], latestLedger: LATEST } as any);

    const page = await fetchRpcRecent(SELF);

    // One request per chunk per walk (MAX_CHUNKS = 6 each).
    expect(getEventsSpy).toHaveBeenCalledTimes(12);
    const reqs = getEventsSpy.mock.calls.map((c) => c[0] as any);
    const ownReqs = reqs.filter((r) => r.filters[0].contractIds?.[0] === SELF);
    const transferReqs = reqs.filter((r) => r.filters[0].contractIds === undefined);
    expect(ownReqs).toHaveLength(6);
    expect(transferReqs).toHaveLength(6);

    // Pinned and unpinned filters MUST stay in separate requests: stellar-rpc
    // narrows a request's scan to the union of mentioned contractIds, which
    // silently starves an unpinned filter sharing the request.
    for (const r of reqs) expect(r.filters).toHaveLength(1);
    expect(ownReqs[0].filters).toEqual(ownEventsFilter(SELF));
    const transferTopic = nativeToScVal("transfer", { type: "symbol" }).toXDR("base64");
    const selfTopic = Address.fromString(SELF).toScVal().toXDR("base64");
    expect(transferReqs[0].filters[0].topics).toEqual([
      [transferTopic, "*", selfTopic, "*"],
      [transferTopic, selfTopic, "*", "*"],
      [transferTopic, "*", selfTopic],
      [transferTopic, selfTopic, "*"],
    ]);
    expect(transferReqs[0].filters).toEqual(transferFilters(SELF));

    // each walk: first chunk anchored at the tip, then chained backward with no gap
    for (const walk of [ownReqs, transferReqs]) {
      expect(walk[0].endLedger).toBe(LATEST);
      expect(walk[0].startLedger).toBe(LATEST - 9000 + 1); // CHUNK_LEDGERS span
      expect(walk[1].endLedger).toBe(walk[0].startLedger - 1);
    }
    expect(Array.isArray(page.items)).toBe(true);
  });

  it("memoizes the walk per (address, depth) so the activity and assets cards share it", async () => {
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({ sequence: LATEST } as any);
    const getEventsSpy = vi
      .spyOn(rpc.Server.prototype, "getEvents")
      .mockResolvedValue({ events: [], latestLedger: LATEST } as any);

    await Promise.all([fetchAccountEvents(SELF, 2), fetchAccountEvents(SELF, 2)]);
    expect(getEventsSpy).toHaveBeenCalledTimes(2); // one 2-chunk walk, not two

    await fetchAccountEvents(SELF, 3); // different depth -> its own walk
    expect(getEventsSpy).toHaveBeenCalledTimes(5);
  });

  it("does NOT memoize a failed walk — the activity page's Retry must actually retry", async () => {
    const { fetchRpcRecent } = await import("./rpcSource.js");
    const err = new Error("rpc blip");
    vi.spyOn(rpc.Server.prototype, "getLatestLedger")
      .mockRejectedValueOnce(err) // own walk, first attempt
      .mockRejectedValueOnce(err) // transfers walk, first attempt
      .mockResolvedValue({ sequence: LATEST } as any);
    vi.spyOn(rpc.Server.prototype, "getEvents").mockResolvedValue({ events: [], latestLedger: LATEST } as any);

    await expect(fetchRpcRecent(SELF, 2)).rejects.toBe(err);
    // the cached rejection was evicted, so the retry runs a fresh walk
    await expect(fetchRpcRecent(SELF, 2)).resolves.toEqual({ items: [] });
  });

  it("never accepts a limit-truncated chunk: a full event page shrinks like a -32001", async () => {
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({ sequence: LATEST } as any);
    const full = { events: Array.from({ length: 1000 }, () => ({})), latestLedger: LATEST };
    const getEventsSpy = vi
      .spyOn(rpc.Server.prototype, "getEvents")
      .mockResolvedValueOnce(full as any) // 9000-ledger span overflows...
      .mockResolvedValue({ events: [], latestLedger: LATEST } as any); // ...3000 fits

    await expect(fetchAccountEvents(SELF, 1)).resolves.toEqual([]);

    const spans = getEventsSpy.mock.calls.map((c) => (c[0] as any).endLedger - (c[0] as any).startLedger + 1);
    expect(spans).toEqual([9000, 3000]);
  });

  it("merges both walks' events of one tx into one classified row group, newest first", async () => {
    const { fetchRpcRecent } = await import("./rpcSource.js");
    const USDC_SAC = new Asset("USDC", OTHER).contractId(Networks.TESTNET);
    const transferEv = (txHash: string, ledgerClosedAt: string) => ({
      contractId: { toString: () => USDC_SAC },
      topic: [
        nativeToScVal("transfer", { type: "symbol" }),
        Address.fromString(OTHER).toScVal(),
        Address.fromString(SELF).toScVal(),
        nativeToScVal(`USDC:${OTHER}`, { type: "string" }),
      ],
      value: nativeToScVal(50000000n, { type: "i128" }),
      txHash,
      ledgerClosedAt,
    });
    const ownEv = (txHash: string, ledgerClosedAt: string) => ({
      contractId: { toString: () => SELF },
      topic: [nativeToScVal("signer_added", { type: "symbol" })],
      value: nativeToScVal(1n, { type: "i128" }),
      txHash,
      ledgerClosedAt,
    });
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({ sequence: LATEST } as any);
    vi.spyOn(rpc.Server.prototype, "getEvents").mockImplementation((async (req: any) => ({
      latestLedger: LATEST,
      // own walk sees TXA's admin event; transfers walk sees TXA's payment
      // (same tx!) plus an older TXB payment
      events: req.filters[0].contractIds
        ? [ownEv("TXA", "2026-06-10T12:00:00Z")]
        : [transferEv("TXA", "2026-06-10T12:00:00Z"), transferEv("TXB", "2026-06-09T12:00:00Z")],
    })) as any);

    const page = await fetchRpcRecent(SELF, 1, new Set([USDC_SAC]));

    // TXA groups across walks: a payment row AND the admin row — no spurious
    // "Contract activity" filler — then TXB, older, last.
    expect(page.items.map((i) => [i.txHash, i.kind, i.title])).toEqual([
      ["TXA", "payment", "Received"],
      ["TXA", "signer", "Added a signer"],
      ["TXB", "payment", "Received"],
    ]);
    expect(page.items[0].assetUnverified).toBeUndefined(); // curated set passed through
  });

  it("shrinks the first chunk's span on a processing-limit error, then REJECTS if even the smallest span fails", async () => {
    const { fetchRpcRecent } = await import("./rpcSource.js");
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({ sequence: LATEST } as any);
    // Always throw the dense-range processing-limit error.
    const err = new Error("[-32001] request exceeded processing limit threshold");
    const getEventsSpy = vi.spyOn(rpc.Server.prototype, "getEvents").mockRejectedValue(err);

    // Failing the NEWEST chunk is a real RPC failure, not an empty account → reject
    // so the UI shows its error/retry state.
    await expect(fetchRpcRecent(SELF)).rejects.toBe(err);

    // Each walk's chunk 0 retries with shrinking spans 9000 → 3000 → 1000,
    // then throws; no chunk 1 anywhere.
    const byWalk = new Map<string, number[]>();
    for (const [req] of getEventsSpy.mock.calls as any[]) {
      const key = req.filters[0].contractIds ? "own" : "transfers";
      (byWalk.get(key) ?? byWalk.set(key, []).get(key)!).push(req.endLedger - req.startLedger + 1);
    }
    for (const spans of byWalk.values()) expect(spans).toEqual([9000, 3000, 1000]);
  });

  it("keeps the recent span (does not reject) when an OLDER chunk fails after the first succeeds", async () => {
    const { fetchRpcRecent } = await import("./rpcSource.js");
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({ sequence: LATEST } as any);
    vi.spyOn(rpc.Server.prototype, "getEvents").mockImplementation((async (req: any) => {
      if (req.endLedger === LATEST) return { events: [], latestLedger: LATEST } as any; // chunk 0 ok (both walks)
      throw new Error("[-32001] request exceeded processing limit threshold"); // older chunks fail at every span
    }) as any);

    const page = await fetchRpcRecent(SELF);
    expect(page.items).toEqual([]); // empty but resolved — we kept the (empty) recent span
  });

  it("honors maxChunks so the home card can scan a shallower window", async () => {
    const { fetchRpcRecent } = await import("./rpcSource.js");
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({ sequence: LATEST } as any);
    const getEventsSpy = vi
      .spyOn(rpc.Server.prototype, "getEvents")
      .mockResolvedValue({ events: [], latestLedger: LATEST } as any);

    await fetchRpcRecent(SELF, 2);
    expect(getEventsSpy).toHaveBeenCalledTimes(4); // 2 chunks × 2 walks
  });
});
