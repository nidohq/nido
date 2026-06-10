import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { nativeToScVal, Address, rpc, xdr } from "@stellar/stellar-sdk";
import { extractTokenCandidates, discoverFromEvents } from "./discover.js";
import { NATIVE_SAC_ID } from "../network.js";
import { transferFilters, clearAccountEventsCache, type RawEvent } from "../activity/rpcSource.js";

const SELF = "CCA2KXEUA4EQW3NL4QRCIZ2VRMA7V6A54DHXPA4RBTAGH72PCCYT5MSA";
const OTHER = "GCQZN6KXTEATCRNES3ZPTPZV4NNVK7CZKA6RHLMP2HPWP7SPDN7MFGBS";
const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const SEP41_TOKEN = "CCXLTPPNPNJ45QG4JG2YQWLOC4IMSRJ7KCF5RYF5BGT62SZGA3XDGKXQ";

const sym = (s: string) => nativeToScVal(s, { type: "symbol" });
const addr = (a: string) => Address.fromString(a).toScVal();

function ev(contractId: string, topics: xdr.ScVal[], txHash = "TX"): RawEvent {
  return {
    contractId: { toString: () => contractId },
    topic: topics,
    value: nativeToScVal(100n, { type: "i128" }),
    txHash,
    ledgerClosedAt: "2026-06-01T00:00:00Z",
  };
}

describe("extractTokenCandidates", () => {
  it("extracts a SAC token with code/issuer from the 4-topic asset string", () => {
    const raw = [ev(USDC_SAC, [sym("transfer"), addr(OTHER), addr(SELF), nativeToScVal(`USDC:${OTHER}`, { type: "string" })])];
    expect(extractTokenCandidates(raw, SELF)).toEqual([
      { contractId: USDC_SAC, code: "USDC", issuer: OTHER, sac: true, source: "events" },
    ]);
  });

  it("treats a 3-topic transfer as a non-SAC SEP-41 token", () => {
    const raw = [ev(SEP41_TOKEN, [sym("transfer"), addr(SELF), addr(OTHER)])];
    expect(extractTokenCandidates(raw, SELF)).toEqual([
      { contractId: SEP41_TOKEN, code: undefined, issuer: undefined, sac: false, source: "events" },
    ]);
  });

  it("skips the native SAC, non-transfer events, and transfers not involving self", () => {
    const raw = [
      ev(NATIVE_SAC_ID, [sym("transfer"), addr(OTHER), addr(SELF), nativeToScVal("native", { type: "string" })]),
      ev(USDC_SAC, [sym("mint"), addr(SELF), nativeToScVal(`USDC:${OTHER}`, { type: "string" })]),
      ev(USDC_SAC, [sym("transfer"), addr(OTHER), addr(OTHER), nativeToScVal(`USDC:${OTHER}`, { type: "string" })]),
    ];
    expect(extractTokenCandidates(raw, SELF)).toEqual([]);
  });

  it("dedups multiple transfers of the same token", () => {
    const raw = [
      ev(USDC_SAC, [sym("transfer"), addr(OTHER), addr(SELF), nativeToScVal(`USDC:${OTHER}`, { type: "string" })], "TX1"),
      ev(USDC_SAC, [sym("transfer"), addr(SELF), addr(OTHER), nativeToScVal(`USDC:${OTHER}`, { type: "string" })], "TX2"),
    ];
    expect(extractTokenCandidates(raw, SELF)).toHaveLength(1);
  });

  it("normalizes an empty code from a malformed asset topic to absent", () => {
    const raw = [ev(USDC_SAC, [sym("transfer"), addr(OTHER), addr(SELF), nativeToScVal(`:${OTHER}`, { type: "string" })])];
    expect(extractTokenCandidates(raw, SELF)[0].code).toBeUndefined();
  });
});

describe("discoverFromEvents", () => {
  beforeEach(() => clearAccountEventsCache());
  afterEach(() => vi.restoreAllMocks());

  it("walks chunks with the shared transfer filters (one walk feeds activity AND discovery)", async () => {
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({ sequence: 3_000_000 } as never);
    const spy = vi
      .spyOn(rpc.Server.prototype, "getEvents")
      .mockResolvedValue({ events: [], latestLedger: 3_000_000 } as never);

    expect(await discoverFromEvents(SELF)).toEqual([]);

    expect(spy).toHaveBeenCalledTimes(2); // default maxChunks
    expect((spy.mock.calls[0][0] as { filters: unknown }).filters).toEqual(transferFilters(SELF));
  });

  it("resolves [] when the walk fails — discovery must never blank the card", async () => {
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockRejectedValue(new Error("rpc down"));
    expect(await discoverFromEvents(SELF)).toEqual([]);
  });
});
