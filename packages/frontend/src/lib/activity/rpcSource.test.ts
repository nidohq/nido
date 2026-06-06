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
  it("groups events by tx hash and classifies them as a recent, partial page", () => {
    const transfer = ev(
      SAC,
      [nativeToScVal("transfer", { type: "symbol" }), Address.fromString(OTHER).toScVal(), Address.fromString(SELF).toScVal(), nativeToScVal("native", { type: "string" })],
      99900000000n, "TX1", "2026-06-01T00:00:00Z",
    );
    const page = mapRpcEvents([transfer], SELF);
    expect(page.source).toBe("rpc");
    expect(page.partial).toBe(true);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toMatchObject({ kind: "payment", direction: "in", amount: "9,990" });
  });
});

describe("fetchRpcRecent", () => {
  it("fetchRpcRecent fans out 3 filters with base64 topic encoding and returns a partial page", async () => {
    const { fetchRpcRecent } = await import("./rpcSource.js");
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({ sequence: 1000 } as any);
    const getEventsSpy = vi
      .spyOn(rpc.Server.prototype, "getEvents")
      .mockResolvedValue({ events: [], cursor: "" } as any);

    const page = await fetchRpcRecent(SELF);

    expect(getEventsSpy).toHaveBeenCalledTimes(3);
    // startLedger floored at 1 (1000 - 17280 < 1)
    expect((getEventsSpy.mock.calls[0][0] as any).startLedger).toBe(1);
    // filter 0 = account's own events (no topics); filters 1 & 2 = SAC transfer topic filters
    const f0 = (getEventsSpy.mock.calls[0][0] as any).filters[0];
    expect(f0.contractIds).toEqual([SELF]);
    expect(f0.topics).toBeUndefined();
    const transferTopic = nativeToScVal("transfer", { type: "symbol" }).toXDR("base64");
    const selfTopic = Address.fromString(SELF).toScVal().toXDR("base64");
    const f1 = (getEventsSpy.mock.calls[1][0] as any).filters[0];
    expect(f1.topics[0]).toEqual([transferTopic, "*", selfTopic, "*"]); // incoming
    const f2 = (getEventsSpy.mock.calls[2][0] as any).filters[0];
    expect(f2.topics[0]).toEqual([transferTopic, selfTopic, "*", "*"]); // outgoing
    expect(page).toMatchObject({ source: "rpc", partial: true, nextCursor: null });
  });
});
