import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseAssetList,
  pluckSoroswapNetwork,
  fetchCuratedAssets,
  fetchCuratedSacIds,
  clearCuratedAssetsCache,
  CURATED_LIST_URL,
  SOROSWAP_LIST_URL,
} from "./curated.js";
import { NATIVE_SAC_ID } from "../network.js";

const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const ISSUER = "GCQZN6KXTEATCRNES3ZPTPZV4NNVK7CZKA6RHLMP2HPWP7SPDN7MFGBS";

const TOP50_DOC = {
  name: "top50",
  assets: [
    { code: "USDC", issuer: ISSUER, contract: USDC_SAC, domain: "centre.io", decimals: 7 },
    { code: "BAD", contract: "not-a-contract" }, // invalid id: dropped
    { code: "SOBA", contract: "CCXLTPPNPNJ45QG4JG2YQWLOC4IMSRJ7KCF5RYF5BGT62SZGA3XDGKXQ" }, // no issuer: non-SAC
  ],
};

const SOROSWAP_DOC = [
  { network: "mainnet", assets: [{ code: "NOPE", contract: USDC_SAC, icon: "https://x.test/no.png" }] },
  {
    network: "testnet",
    assets: [
      { code: "XLM", contract: NATIVE_SAC_ID, icon: "https://x.test/xlm.png", decimals: 7 },
      { code: "USDC", contract: USDC_SAC, icon: "https://x.test/usdc.png", decimals: 7 },
    ],
  },
];

beforeEach(() => {
  localStorage.clear();
  clearCuratedAssetsCache();
});
afterEach(() => vi.unstubAllGlobals());

describe("parseAssetList", () => {
  it("keeps valid entries (including native, for icon backfill) and flags SAC by issuer presence", () => {
    const parsed = parseAssetList({
      assets: [
        { code: "USDC", issuer: ISSUER, contract: USDC_SAC, domain: "centre.io", decimals: 7 },
        { code: "XLM", contract: NATIVE_SAC_ID, icon: "https://x.test/xlm.png" },
        { code: "BAD", contract: "not-a-contract" },
      ],
    });
    expect(parsed).toEqual([
      { contractId: USDC_SAC, code: "USDC", issuer: ISSUER, domain: "centre.io", decimals: 7, icon: undefined, sac: true, source: "curated" },
      { contractId: NATIVE_SAC_ID, code: "XLM", issuer: undefined, domain: undefined, decimals: undefined, icon: "https://x.test/xlm.png", sac: false, source: "curated" },
    ]);
  });

  it("returns [] for junk documents", () => {
    for (const junk of [null, {}, { assets: "x" }, 42]) expect(parseAssetList(junk)).toEqual([]);
  });

  it("normalizes empty strings, implausible decimals, and unsafe icons to absent", () => {
    const [parsed] = parseAssetList({
      assets: [{
        code: "",
        issuer: "",
        domain: "",
        decimals: 4294967295,
        icon: "javascript:alert(1)",
        contract: USDC_SAC,
      }],
    });
    expect(parsed.code).toBeUndefined();
    expect(parsed.issuer).toBeUndefined();
    expect(parsed.domain).toBeUndefined();
    expect(parsed.decimals).toBeUndefined();
    expect(parsed.icon).toBeUndefined();
    expect(parsed.sac).toBe(false); // no issuer -> not a SAC
  });
});

describe("pluckSoroswapNetwork", () => {
  it("selects this build's network from the multi-network array", () => {
    expect(pluckSoroswapNetwork(SOROSWAP_DOC)).toBe(SOROSWAP_DOC[1]);
    expect(pluckSoroswapNetwork({ assets: [] })).toBeNull();
    expect(pluckSoroswapNetwork([])).toBeNull();
  });
});

function routedFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const doc = routes[url];
    if (doc === undefined) return { ok: false, status: 404 };
    return { ok: true, json: async () => doc };
  });
}

describe("fetchCuratedAssets", () => {
  it("merges both lists (top50 first) and caches each document", async () => {
    vi.stubGlobal("fetch", routedFetch({ [CURATED_LIST_URL]: TOP50_DOC, [SOROSWAP_LIST_URL]: SOROSWAP_DOC }));

    const assets = await fetchCuratedAssets();

    // 2 valid top50 entries first, then 2 testnet soroswap entries (with icons).
    expect(assets).toHaveLength(4);
    expect(assets[0].code).toBe("USDC");
    expect(assets.find((a) => a.contractId === NATIVE_SAC_ID)?.icon).toBe("https://x.test/xlm.png");
    expect(localStorage.getItem("g2c:assets:curated")).toBe(JSON.stringify(TOP50_DOC));
    expect(localStorage.getItem("g2c:assets:curated:soroswap")).toBe(JSON.stringify(SOROSWAP_DOC));
  });

  it("falls back per-list to the cached copy when the network fails", async () => {
    localStorage.setItem("g2c:assets:curated", JSON.stringify(TOP50_DOC));
    localStorage.setItem("g2c:assets:curated:soroswap", JSON.stringify(SOROSWAP_DOC));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchCuratedAssets()).toHaveLength(4);
  });

  it("returns [] when both network and cache are unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    expect(await fetchCuratedAssets()).toEqual([]);
  });

  it("is memoized per page load: a second consumer reuses the same fetch", async () => {
    const fetchMock = routedFetch({ [CURATED_LIST_URL]: TOP50_DOC, [SOROSWAP_LIST_URL]: SOROSWAP_DOC });
    vi.stubGlobal("fetch", fetchMock);
    await fetchCuratedAssets();
    await fetchCuratedAssets();
    expect(fetchMock).toHaveBeenCalledTimes(2); // once per list, not per caller
  });
});

describe("fetchCuratedSacIds", () => {
  it("collects the curated SAC ids plus native", async () => {
    vi.stubGlobal("fetch", routedFetch({ [CURATED_LIST_URL]: TOP50_DOC, [SOROSWAP_LIST_URL]: SOROSWAP_DOC }));
    const ids = await fetchCuratedSacIds();
    expect(ids.has(USDC_SAC)).toBe(true);       // issuer-backed entry -> its SAC id
    expect(ids.has(NATIVE_SAC_ID)).toBe(true);  // always trusted
    // issuerless (non-SAC) entries can't emit verified SAC transfers
    expect(ids.has("CCXLTPPNPNJ45QG4JG2YQWLOC4IMSRJ7KCF5RYF5BGT62SZGA3XDGKXQ")).toBe(false);
  });

  it("degrades to native-only when the lists are unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect([...(await fetchCuratedSacIds())]).toEqual([NATIVE_SAC_ID]);
  });
});
