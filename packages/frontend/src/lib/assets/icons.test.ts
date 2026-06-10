import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rpc } from "@stellar/stellar-sdk";
import { sanitizeIconUrl, parseTomlCurrencies, resolveTomlIcon, fetchIssuerHomeDomain } from "./icons.js";
import type { AssetHolding } from "./types.js";

const holding = (extra: Partial<AssetHolding> = {}): AssetHolding => ({
  contractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  code: "USDC",
  issuer: "GCQZN6KXTEATCRNES3ZPTPZV4NNVK7CZKA6RHLMP2HPWP7SPDN7MFGBS",
  domain: "centre.io",
  decimals: 7,
  raw: 1n,
  formatted: "1",
  verified: true,
  explorerUrl: "",
  ...extra,
});

const TOML = `
NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"

[[CURRENCIES]]
code = "OTHER"
issuer = "GAAAA"
image = "https://example.com/other.png"

[[CURRENCIES]]
code = "USDC"
issuer = "GCQZN6KXTEATCRNES3ZPTPZV4NNVK7CZKA6RHLMP2HPWP7SPDN7MFGBS"
display_decimals = "2"
image = "https://example.com/usdc.png"

[DOCUMENTATION]
ORG_NAME = "Centre"
image = "https://example.com/should-not-leak-into-currency.png"
`;

describe("sanitizeIconUrl", () => {
  it("accepts only well-formed https URLs", () => {
    expect(sanitizeIconUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(sanitizeIconUrl("http://example.com/a.png")).toBeUndefined();
    expect(sanitizeIconUrl("javascript:alert(1)")).toBeUndefined();
    expect(sanitizeIconUrl("ipfs://Qm...")).toBeUndefined();
    expect(sanitizeIconUrl("not a url")).toBeUndefined();
    expect(sanitizeIconUrl("")).toBeUndefined();
    expect(sanitizeIconUrl(42)).toBeUndefined();
  });
});

describe("parseTomlCurrencies", () => {
  it("extracts code/issuer/image from [[CURRENCIES]] tables only", () => {
    expect(parseTomlCurrencies(TOML)).toEqual([
      { code: "OTHER", issuer: "GAAAA", image: "https://example.com/other.png" },
      {
        code: "USDC",
        issuer: "GCQZN6KXTEATCRNES3ZPTPZV4NNVK7CZKA6RHLMP2HPWP7SPDN7MFGBS",
        image: "https://example.com/usdc.png",
      },
    ]);
  });

  it("handles CRLF and empty input", () => {
    expect(parseTomlCurrencies('[[CURRENCIES]]\r\ncode = "A"\r\n')).toEqual([{ code: "A" }]);
    expect(parseTomlCurrencies("")).toEqual([]);
  });
});

describe("resolveTomlIcon", () => {
  beforeEach(() => localStorage.clear());

  const fetchToml = (body = TOML, ok = true) =>
    vi.fn().mockResolvedValue({ ok, text: async () => body }) as unknown as typeof fetch;

  it("resolves the matching currency's image and caches it", async () => {
    const f = fetchToml();
    expect(await resolveTomlIcon(holding(), f)).toBe("https://example.com/usdc.png");
    expect(f).toHaveBeenCalledWith("https://centre.io/.well-known/stellar.toml");
    // cached: second call doesn't fetch
    expect(await resolveTomlIcon(holding(), fetchToml("UNUSED"))).toBe("https://example.com/usdc.png");
  });

  it("prefers the exact code+issuer entry when several share a code", async () => {
    const twoUsdc = fetchToml(
      `[[CURRENCIES]]\ncode = "USDC"\nissuer = "GOTHER"\nimage = "https://example.com/other-usdc.png"\n` +
        `[[CURRENCIES]]\ncode = "USDC"\nissuer = "${holding().issuer}"\nimage = "https://example.com/usdc.png"\n`,
    );
    expect(await resolveTomlIcon(holding(), twoUsdc)).toBe("https://example.com/usdc.png");
  });

  it("falls back to a code-only match when the issuer isn't listed (anchors rarely publish testnet issuers)", async () => {
    expect(await resolveTomlIcon(holding({ issuer: "GDIFFERENT" }), fetchToml())).toBe(
      "https://example.com/usdc.png",
    );
  });

  it("negative-caches a toml without our currency", async () => {
    const miss = fetchToml('[[CURRENCIES]]\ncode = "ZZZ"\n');
    expect(await resolveTomlIcon(holding(), miss)).toBeUndefined();
    const second = fetchToml();
    expect(await resolveTomlIcon(holding(), second)).toBeUndefined();
    expect(second).not.toHaveBeenCalled();
  });

  it("skips unverified holdings, domainless+issuerless holdings, and malformed domains", async () => {
    const f = fetchToml();
    expect(await resolveTomlIcon(holding({ verified: false }), f)).toBeUndefined();
    expect(await resolveTomlIcon(holding({ domain: undefined, issuer: undefined }), f)).toBeUndefined();
    expect(await resolveTomlIcon(holding({ domain: "evil.com/x?y=" }), f)).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });

  it("falls back to the issuer's on-chain home_domain when the list gave none", async () => {
    const lookup = vi.fn().mockResolvedValue("centre.io");
    const f = fetchToml();
    expect(await resolveTomlIcon(holding({ domain: undefined }), f, lookup)).toBe(
      "https://example.com/usdc.png",
    );
    expect(lookup).toHaveBeenCalledWith(holding().issuer);
    expect(f).toHaveBeenCalledWith("https://centre.io/.well-known/stellar.toml");
  });

  it("negative-caches an issuer that declares no home_domain", async () => {
    const lookup = vi.fn().mockResolvedValue(undefined);
    expect(await resolveTomlIcon(holding({ domain: undefined }), fetchToml(), lookup)).toBeUndefined();
    // cached: a later load does no lookup and no fetch
    const lookup2 = vi.fn();
    const f2 = fetchToml();
    expect(await resolveTomlIcon(holding({ domain: undefined }), f2, lookup2)).toBeUndefined();
    expect(lookup2).not.toHaveBeenCalled();
    expect(f2).not.toHaveBeenCalled();
  });

  it("does not cache a failed home_domain lookup (transient RPC error)", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("rpc down"));
    expect(await resolveTomlIcon(holding({ domain: undefined }), fetchToml(), failing)).toBeUndefined();
    const lookup = vi.fn().mockResolvedValue("centre.io");
    expect(await resolveTomlIcon(holding({ domain: undefined }), fetchToml(), lookup)).toBe(
      "https://example.com/usdc.png",
    );
  });

  it("does not negative-cache transient failures", async () => {
    expect(await resolveTomlIcon(holding(), fetchToml("", false))).toBeUndefined();
    expect(
      await resolveTomlIcon(holding(), vi.fn().mockRejectedValue(new Error("net")) as unknown as typeof fetch),
    ).toBeUndefined();
    // no cache entry written — a later attempt fetches again and succeeds
    expect(await resolveTomlIcon(holding(), fetchToml())).toBe("https://example.com/usdc.png");
  });

  it("rejects non-https images", async () => {
    const f = fetchToml(`[[CURRENCIES]]\ncode = "USDC"\nissuer = "${holding().issuer}"\nimage = "http://example.com/usdc.png"\n`);
    expect(await resolveTomlIcon(holding(), f)).toBeUndefined();
  });
});

describe("fetchIssuerHomeDomain", () => {
  afterEach(() => vi.restoreAllMocks());

  const entry = (domain: string) => ({
    val: { account: () => ({ homeDomain: () => domain }) },
  });

  it("reads the issuer account's home_domain from its ledger entry", async () => {
    vi.spyOn(rpc.Server.prototype, "getLedgerEntries").mockResolvedValue({
      latestLedger: 1,
      entries: [entry("centre.io")],
    } as never);
    expect(await fetchIssuerHomeDomain(holding().issuer!)).toBe("centre.io");
  });

  it("resolves undefined for a missing account or an empty domain", async () => {
    const spy = vi
      .spyOn(rpc.Server.prototype, "getLedgerEntries")
      .mockResolvedValueOnce({ latestLedger: 1, entries: [] } as never)
      .mockResolvedValueOnce({ latestLedger: 1, entries: [entry("")] } as never);
    expect(await fetchIssuerHomeDomain(holding().issuer!)).toBeUndefined();
    expect(await fetchIssuerHomeDomain(holding().issuer!)).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("propagates RPC failures so callers can avoid negative-caching", async () => {
    vi.spyOn(rpc.Server.prototype, "getLedgerEntries").mockRejectedValue(new Error("rpc down"));
    await expect(fetchIssuerHomeDomain(holding().issuer!)).rejects.toThrow("rpc down");
  });
});
