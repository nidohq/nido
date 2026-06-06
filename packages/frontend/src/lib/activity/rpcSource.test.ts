import { describe, it, expect } from "vitest";
import { mapRpcEvents } from "./rpcSource.js";
import { nativeToScVal, Address } from "@stellar/stellar-sdk";

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
