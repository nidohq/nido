import { describe, it, expect } from "vitest";
import { assetRowHtml } from "./rowHtml.js";
import type { AssetHolding } from "./types.js";

const base: AssetHolding = {
  contractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  code: "USDC",
  issuer: "GCQZN6KXTEATCRNES3ZPTPZV4NNVK7CZKA6RHLMP2HPWP7SPDN7MFGBS",
  domain: "centre.io",
  decimals: 7,
  raw: 1_5000000n,
  formatted: "1.5",
  verified: true,
  explorerUrl: "https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
};

describe("assetRowHtml", () => {
  it("renders code, domain subtitle, amount, and explorer link", () => {
    const html = assetRowHtml(base);
    expect(html).toContain(">USDC<");
    expect(html).toContain(">centre.io<");
    expect(html).toContain(">1.5<");
    expect(html).toContain(`href="${base.explorerUrl}"`);
    expect(html).toContain('class="ricon asset-initial">U<');
  });

  it("falls back to a shortened issuer, then contract id, for the subtitle", () => {
    expect(assetRowHtml({ ...base, domain: undefined })).toContain("GCQZ…FGBS");
    expect(assetRowHtml({ ...base, domain: undefined, issuer: undefined })).toContain("CBIE…DAMA");
  });

  it("tags unverified tokens and never shows their self-reported domain/issuer", () => {
    const html = assetRowHtml({ ...base, verified: false, domain: "centre.io" });
    expect(html).toContain("CBIE…DAMA · unverified");
    expect(html).not.toContain("centre.io");
  });

  it("renders the logo for verified holdings with an icon", () => {
    const html = assetRowHtml({ ...base, icon: "https://x.test/usdc.png" });
    expect(html).toContain('<img class="asset-icon" src="https://x.test/usdc.png"');
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain(`data-contract="${base.contractId}"`);
  });

  it("never renders an icon on unverified rows, and escapes icon URLs", () => {
    expect(assetRowHtml({ ...base, verified: false, icon: "https://x.test/spoof.png" })).not.toContain("<img");
    expect(assetRowHtml(base)).not.toContain("<img"); // no icon set
    const html = assetRowHtml({ ...base, icon: 'https://x.test/a.png"onload="alert(1)' });
    expect(html).not.toContain('"onload=');
  });

  it("escapes attacker-influenced fields (codes/domains come from lists and events)", () => {
    const html = assetRowHtml({
      ...base,
      code: '<img src=x onerror=alert(1)>',
      domain: '"><script>x</script>',
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img");
  });
});
