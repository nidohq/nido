import { describe, it, expect, vi, afterEach } from "vitest";
import { mapRpcEvents } from "./rpcSource.js";
import { rpc, nativeToScVal, Address } from "@stellar/stellar-sdk";

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

  it("scans tip-anchored ledger chunks with all 3 filters combined per request", async () => {
    const { fetchRpcRecent } = await import("./rpcSource.js");
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({ sequence: LATEST } as any);
    const getEventsSpy = vi
      .spyOn(rpc.Server.prototype, "getEvents")
      .mockResolvedValue({ events: [], latestLedger: LATEST } as any);

    const page = await fetchRpcRecent(SELF);

    // One request per chunk (MAX_CHUNKS = 6), each carrying all three filters.
    expect(getEventsSpy).toHaveBeenCalledTimes(6);
    const req0 = getEventsSpy.mock.calls[0][0] as any;
    expect(req0.filters).toHaveLength(3);
    expect(req0.endLedger).toBe(LATEST);             // first chunk anchored at the tip
    expect(req0.startLedger).toBe(LATEST - 9000 + 1); // CHUNK_LEDGERS span

    // filter 0 = account's own events (no topics); filters 1 & 2 = SAC transfer topic filters
    expect(req0.filters[0].contractIds).toEqual([SELF]);
    expect(req0.filters[0].topics).toBeUndefined();
    const transferTopic = nativeToScVal("transfer", { type: "symbol" }).toXDR("base64");
    const selfTopic = Address.fromString(SELF).toScVal().toXDR("base64");
    expect(req0.filters[1].topics[0]).toEqual([transferTopic, "*", selfTopic, "*"]); // incoming
    expect(req0.filters[2].topics[0]).toEqual([transferTopic, selfTopic, "*", "*"]); // outgoing

    // chunks chain backward with no gap: chunk 1's endLedger = chunk 0's startLedger - 1
    const req1 = getEventsSpy.mock.calls[1][0] as any;
    expect(req1.endLedger).toBe(req0.startLedger - 1);
    expect(Array.isArray(page.items)).toBe(true);
  });

  it("shrinks a chunk's span on a processing-limit error, then stops if even the smallest span fails", async () => {
    const { fetchRpcRecent } = await import("./rpcSource.js");
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({ sequence: LATEST } as any);
    // Always throw the dense-SAC processing-limit error.
    const getEventsSpy = vi
      .spyOn(rpc.Server.prototype, "getEvents")
      .mockRejectedValue(new Error("[-32001] request exceeded processing limit threshold"));

    const page = await fetchRpcRecent(SELF);

    // Chunk 0 retries with shrinking spans 9000 → 3000 → 1000 (3 tries), then gives up; no chunk 1.
    expect(getEventsSpy).toHaveBeenCalledTimes(3);
    const spans = getEventsSpy.mock.calls.map((c) => (c[0] as any).endLedger - (c[0] as any).startLedger + 1);
    expect(spans).toEqual([9000, 3000, 1000]);
    expect(page.items).toEqual([]);
  });
});
