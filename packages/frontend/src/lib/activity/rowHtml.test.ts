import { describe, it, expect } from "vitest";
import { activityRowHtml } from "./rowHtml.js";
import type { ActivityItem } from "./types.js";

const base: ActivityItem = {
  id: "x",
  txHash: "abc",
  timestamp: 1_780_000_000,
  kind: "other",
  title: "Contract activity",
  explorerUrl: "https://explorer/tx/abc",
};

describe("activityRowHtml", () => {
  it("HTML-escapes every interpolated field (no raw markup injection)", () => {
    const html = activityRowHtml({
      ...base,
      kind: "payment",
      direction: "in",
      title: "<img src=x onerror=alert(1)>",
      subtitle: "from <b>x</b>",
      amount: "1",
      asset: 'EVIL"><script>alert(1)</script>',
      explorerUrl: 'https://explorer/tx/"><script>',
    });
    // No raw injected tags survive, and the malicious URL can't break out of href.
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('tx/"><'); // explorerUrl attribute-breakout attempt
    // The dangerous content is present only in escaped form.
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders a normal payment row with the expected structure and safe link rel", () => {
    const html = activityRowHtml({
      ...base,
      kind: "payment",
      direction: "in",
      title: "Received",
      subtitle: "from GABC…XYZ",
      amount: "9,990",
      asset: "XLM",
    });
    expect(html).toContain('class="row"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Received");
    expect(html).toContain("9,990");
    expect(html).toContain("XLM");
  });
});
