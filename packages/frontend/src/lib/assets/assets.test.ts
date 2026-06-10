import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Address, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { loadAssets, mergeCandidates, sortHoldings } from "./assets.js";
import { sacBalanceLedgerKey } from "./balances.js";
import { NATIVE_SAC_ID } from "../network.js";
import type { AssetCandidate, AssetHolding } from "./types.js";

const SELF = "CCA2KXEUA4EQW3NL4QRCIZ2VRMA7V6A54DHXPA4RBTAGH72PCCYT5MSA";
const ISSUER = "GCQZN6KXTEATCRNES3ZPTPZV4NNVK7CZKA6RHLMP2HPWP7SPDN7MFGBS";
const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const DEAD_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const SEP41_TOKEN = "CCXLTPPNPNJ45QG4JG2YQWLOC4IMSRJ7KCF5RYF5BGT62SZGA3XDGKXQ";
const JUNK_TOKEN = "CABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNSZ";

const cand = (contractId: string, extra: Partial<AssetCandidate> = {}): AssetCandidate => ({
  contractId,
  sac: false,
  source: "events",
  ...extra,
});

describe("mergeCandidates", () => {
  it("dedups by contract id; earlier groups win but gaps are backfilled", () => {
    const merged = mergeCandidates(
      [cand(USDC_SAC, { code: "USDC", source: "curated", sac: true })],
      [cand(USDC_SAC, { code: "WRONG", issuer: ISSUER, domain: "centre.io" })],
    );
    expect(merged).toEqual([
      {
        contractId: USDC_SAC,
        code: "USDC",          // first group's value kept
        issuer: ISSUER,        // gap backfilled from the later group
        domain: "centre.io",
        decimals: undefined,
        sac: true,
        source: "curated",
      },
    ]);
  });

  it("treats an empty-string code as a gap, not a value", () => {
    const merged = mergeCandidates(
      [cand(USDC_SAC, { code: "" })],
      [cand(USDC_SAC, { code: "USDC" })],
    );
    expect(merged[0].code).toBe("USDC");
  });

  it("backfills icons from a later list entry (Soroswap icon onto the native candidate)", () => {
    const merged = mergeCandidates(
      [cand(NATIVE_SAC_ID, { code: "XLM", source: "native", sac: true })],
      [cand(NATIVE_SAC_ID, { code: "XLM", source: "curated", icon: "https://x.test/xlm.png" })],
    );
    expect(merged[0]).toMatchObject({ source: "native", sac: true, icon: "https://x.test/xlm.png" });
  });

  it("ORs the sac flag so an event-only SAC sighting upgrades a stored entry", () => {
    const merged = mergeCandidates(
      [cand(USDC_SAC, { source: "stored", sac: false })],
      [cand(USDC_SAC, { sac: true })],
    );
    expect(merged[0].sac).toBe(true);
  });
});

describe("sortHoldings", () => {
  const holding = (contractId: string, code: string): AssetHolding => ({
    contractId, code, decimals: 7, raw: 1n, formatted: "1", verified: false, explorerUrl: "",
  });

  it("puts XLM first, then alphabetical by code", () => {
    const sorted = sortHoldings([
      holding(USDC_SAC, "USDC"),
      holding("C1", "AQUA"),
      holding(NATIVE_SAC_ID, "XLM"),
    ]);
    expect(sorted.map((h) => h.code)).toEqual(["XLM", "AQUA", "USDC"]);
  });
});

// ---------------------------------------------------------------------------
// loadAssets wiring
// ---------------------------------------------------------------------------

/** A SAC Balance entry value: map { amount: i128, authorized, clawback } — the
 *  shape testnet RPC actually returns for contract holders. */
function balanceVal(amount: bigint): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("amount"), val: nativeToScVal(amount, { type: "i128" }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("authorized"), val: xdr.ScVal.scvBool(true) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("clawback"), val: xdr.ScVal.scvBool(false) }),
  ]);
}

/** Duck-typed LedgerEntryResult: loadAssets only touches key + val.contractData().val(). */
const entryFor = (token: string, amount: bigint) => ({
  key: sacBalanceLedgerKey(token, SELF),
  val: { contractData: () => ({ val: () => balanceVal(amount) }) },
});

const transferEvent = (contractId: string, topics: xdr.ScVal[]) => ({
  contractId: { toString: () => contractId },
  topic: topics,
  value: nativeToScVal(1n, { type: "i128" }),
  txHash: "TX1",
  ledgerClosedAt: "2026-06-01T00:00:00Z",
});

/** Route simulateTransaction responses by invoked (contract, function). */
function mockSimulationRouter(routes: Record<string, Record<string, xdr.ScVal | "throw" | "error">>) {
  return vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockImplementation((async (tx: {
    operations: { func: xdr.HostFunction }[];
  }) => {
    const invoke = tx.operations[0].func.invokeContract();
    const contract = Address.fromScAddress(invoke.contractAddress()).toString();
    const fn = invoke.functionName().toString();
    const result = routes[contract]?.[fn];
    if (result === undefined || result === "throw") throw new Error(`unexpected simulate ${contract}.${fn}`);
    if (result === "error") return { error: "host invocation failed", latestLedger: 1 };
    return { result: { retval: result }, latestLedger: 1 };
  }) as never);
}

describe("loadAssets (wiring)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists XLM (always) plus curated SACs with nonzero batched balances; zero-balance SACs are hidden", async () => {
    // top50 gives the asset set; soroswap contributes the XLM icon that
    // backfills the native candidate.
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("soroswap")
          ? [{ network: "testnet", assets: [{ code: "XLM", contract: NATIVE_SAC_ID, icon: "https://x.test/xlm.png" }] }]
          : {
              assets: [
                { code: "USDC", issuer: ISSUER, contract: USDC_SAC, domain: "centre.io" },
                { code: "DEAD", issuer: ISSUER, contract: DEAD_SAC },
              ],
            },
    })));
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({ sequence: 3_000_000 } as never);
    vi.spyOn(rpc.Server.prototype, "getEvents").mockResolvedValue({
      events: [transferEvent(USDC_SAC, [
        nativeToScVal("transfer", { type: "symbol" }),
        Address.fromString(ISSUER).toScVal(),
        Address.fromString(SELF).toScVal(),
        nativeToScVal(`USDC:${ISSUER}`, { type: "string" }),
      ])],
      latestLedger: 3_000_000,
    } as never);
    // DEAD_SAC has no Balance entry — it must not appear.
    vi.spyOn(rpc.Server.prototype, "getLedgerEntries").mockResolvedValue({
      latestLedger: 3_000_000,
      entries: [entryFor(NATIVE_SAC_ID, 125_000_000n), entryFor(USDC_SAC, 250_000_000n)],
    } as never);

    const holdings = await loadAssets(SELF);

    expect(holdings.map((h) => [h.code, h.formatted, h.verified])).toEqual([
      ["XLM", "12.5", true],
      ["USDC", "25", true],
    ]);
    expect(holdings[0].icon).toBe("https://x.test/xlm.png"); // soroswap backfill
    // Curated assets are not persisted — the list itself is the durable source.
    expect(localStorage.getItem(`g2c:assets:known:${SELF}`) ?? "[]").not.toContain(USDC_SAC);
  });

  it("probes non-SAC tokens, keeps confirmed holders, drops zeros and failures, persists confirmed finds", async () => {
    // Curated list: one non-SAC entry (no issuer) that the account does NOT hold.
    const CURATED_SOBA = "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ assets: [{ code: "SOBA", contract: CURATED_SOBA }] }),
    }));
    // Events discover one real SEP-41 token (3-topic transfer); a junk token
    // sits in the persisted store from a previous session and now fails.
    localStorage.setItem(
      `g2c:assets:known:${SELF}`,
      JSON.stringify([{ contractId: JUNK_TOKEN, sac: false, source: "events" }]),
    );
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({ sequence: 3_000_000 } as never);
    vi.spyOn(rpc.Server.prototype, "getEvents").mockResolvedValue({
      events: [transferEvent(SEP41_TOKEN, [
        nativeToScVal("transfer", { type: "symbol" }),
        Address.fromString(ISSUER).toScVal(),
        Address.fromString(SELF).toScVal(),
      ])],
      latestLedger: 3_000_000,
    } as never);
    vi.spyOn(rpc.Server.prototype, "getLedgerEntries").mockResolvedValue({
      latestLedger: 3_000_000,
      entries: [entryFor(NATIVE_SAC_ID, 10_000_000n)],
    } as never);
    mockSimulationRouter({
      [CURATED_SOBA]: { balance: nativeToScVal(0n, { type: "i128" }) },
      [SEP41_TOKEN]: {
        balance: nativeToScVal(42_000_000n, { type: "i128" }),
        decimals: nativeToScVal(6, { type: "u32" }),
        symbol: nativeToScVal("WERT", { type: "string" }),
      },
      [JUNK_TOKEN]: { balance: "throw" },
    });

    const holdings = await loadAssets(SELF);

    expect(holdings.map((h) => [h.code, h.formatted, h.verified])).toEqual([
      ["XLM", "1", true],
      ["WERT", "42", false],  // probe symbol + 6 decimals, unverified
    ]);
    // Confirmed find persisted; failed junk pruned.
    const stored = localStorage.getItem(`g2c:assets:known:${SELF}`)!;
    expect(stored).toContain(SEP41_TOKEN);
    expect(stored).not.toContain(JUNK_TOKEN);
  });

  it("shows XLM at 0 when discovery and the curated list fail but the balance read is up", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockRejectedValue(new Error("rpc down"));
    vi.spyOn(rpc.Server.prototype, "getLedgerEntries").mockResolvedValue({
      latestLedger: 1,
      entries: [],
    } as never);

    const holdings = await loadAssets(SELF);
    expect(holdings.map((h) => [h.code, h.formatted])).toEqual([["XLM", "0"]]);
  });

  it("rejects when the balance read itself fails (the card shows its error state)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockRejectedValue(new Error("rpc down"));
    vi.spyOn(rpc.Server.prototype, "getLedgerEntries").mockRejectedValue(new Error("rpc down"));

    await expect(loadAssets(SELF)).rejects.toThrow("rpc down");
  });
});
