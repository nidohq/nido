import { describe, it, expect } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import { renderTransferReview, renderGenericOp, type TransferView } from "./review";
import type { OpSummary } from "./txSummary";

const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 0xee));
const FROM = StrKey.encodeContract(Buffer.alloc(32, 0xaa));
const TO = StrKey.encodeContract(Buffer.alloc(32, 0xbb));

const base: TransferView = {
  token: TOKEN,
  from: FROM,
  to: TO,
  amountRaw: 12_500_000n,
  decimals: 7,
  code: "XLM",
  verified: true,
};

describe("renderTransferReview", () => {
  it("formats the amount with the token's decimals when known", () => {
    expect(renderTransferReview(base)).toContain("1.25");
  });

  it("falls back to the raw integer amount when decimals are unknown", () => {
    const html = renderTransferReview({ ...base, decimals: undefined, code: undefined });
    expect(html).toContain("12500000");
  });

  it("renders a network-fee line only when a fee is given", () => {
    expect(renderTransferReview(base)).not.toContain("Network fee");
    const withFee = renderTransferReview({ ...base, feeStroops: 1_234_500n });
    expect(withFee).toContain("Network fee");
    expect(withFee).toContain("0.12345"); // 1,234,500 stroops = 0.12345 XLM
  });

  it("tags unverified tokens and shows their contract id, but not verified ones", () => {
    expect(renderTransferReview(base)).not.toContain("unverified");
    const unv = renderTransferReview({ ...base, verified: false, code: "USDC" });
    expect(unv).toContain("unverified");
    expect(unv).toContain(TOKEN); // contract id surfaced so a spoof is checkable
  });

  it("only renders a logo for verified holdings with an icon", () => {
    expect(renderTransferReview({ ...base, verified: false, icon: "https://evil.example/x.png" }))
      .not.toContain("<img");
    expect(renderTransferReview({ ...base, verified: true, icon: "https://ex.test/x.png" }))
      .toContain("<img");
  });

  // --- security: every untrusted field must be HTML-escaped ---
  it("escapes a malicious asset code (no raw markup reaches the DOM)", () => {
    const html = renderTransferReview({
      ...base,
      verified: false,
      code: `<img src=x onerror="alert(1)">`,
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("escapes a malicious icon URL inside the src attribute", () => {
    const html = renderTransferReview({
      ...base,
      verified: true,
      icon: `https://x/"><script>alert(1)</script>`,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes recipient and sender labels", () => {
    const html = renderTransferReview({
      ...base,
      toLabel: `<b>evil</b>`,
      fromLabel: `</span><script>x</script>`,
    });
    expect(html).not.toContain("<b>evil</b>");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;b&gt;evil");
  });
});

describe("renderGenericOp", () => {
  it("summarizes a contract invoke with its function and contract", () => {
    const op: OpSummary = { kind: "invoke", contract: TOKEN, fn: "mint", argsCount: 2 };
    const html = renderGenericOp(op);
    expect(html).toContain("mint");
    expect(html).toContain("2 args");
  });

  it("pluralizes a single argument correctly", () => {
    const op: OpSummary = { kind: "invoke", contract: TOKEN, fn: "burn", argsCount: 1 };
    expect(renderGenericOp(op)).toContain("1 arg");
    expect(renderGenericOp(op)).not.toContain("1 args");
  });

  it("names a classic operation type", () => {
    const op: OpSummary = { kind: "other", type: "payment" };
    expect(renderGenericOp(op)).toContain("payment");
  });

  it("escapes the function name of an invoke", () => {
    const op: OpSummary = { kind: "invoke", contract: TOKEN, fn: `<script>x</script>`, argsCount: 0 };
    const html = renderGenericOp(op);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
