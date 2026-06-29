// packages/frontend/src/lib/transfer/sessionGrantReview.test.ts
import { describe, it, expect } from "vitest";
import { renderSessionGrant, type SessionGrantScope } from "./sessionGrantReview";

const op = { kind: "session-grant" as const, contract: "CAAA…", name: "session-key", target: "CTARGET", validUntil: 123 };

describe("renderSessionGrant", () => {
  it("shows the app origin, cap, and expiry, escaping the origin", () => {
    const scope: SessionGrantScope = { origin: "https://app.example", limitStroops: "50000000", period: "day", expiryLabel: "7 days" };
    const html = renderSessionGrant(op, scope);
    expect(html).toContain("app.example");
    expect(html).toContain("5"); // 50000000 stroops = 5 XLM
    expect(html).toContain("per day");
    expect(html).toContain("7 days");
  });
  it("renders an unlimited cap when limitStroops is null", () => {
    const scope: SessionGrantScope = { origin: "https://x", limitStroops: null, period: "day", expiryLabel: "24 hours" };
    expect(renderSessionGrant(op, scope).toLowerCase()).toContain("any amount");
  });
  it("escapes a hostile origin", () => {
    const scope: SessionGrantScope = { origin: "https://x\"><img>", limitStroops: null, period: "day", expiryLabel: "x" };
    expect(renderSessionGrant(op, scope)).not.toContain("<img>");
  });
});
