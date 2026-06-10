import { describe, it, expect, vi, beforeEach } from "vitest";
import { sanitizeIconUrl, parseTomlCurrencies, resolveTomlIcon } from "./icons.js";
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

  it("requires the issuer to match when the holding has one", async () => {
    expect(await resolveTomlIcon(holding({ issuer: "GDIFFERENT" }), fetchToml())).toBeUndefined();
  });

  it("negative-caches a toml without our currency", async () => {
    const miss = fetchToml('[[CURRENCIES]]\ncode = "ZZZ"\n');
    expect(await resolveTomlIcon(holding(), miss)).toBeUndefined();
    const second = fetchToml();
    expect(await resolveTomlIcon(holding(), second)).toBeUndefined();
    expect(second).not.toHaveBeenCalled();
  });

  it("skips unverified holdings, missing domains, and malformed domains", async () => {
    const f = fetchToml();
    expect(await resolveTomlIcon(holding({ verified: false }), f)).toBeUndefined();
    expect(await resolveTomlIcon(holding({ domain: undefined }), f)).toBeUndefined();
    expect(await resolveTomlIcon(holding({ domain: "evil.com/x?y=" }), f)).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
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
