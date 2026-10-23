// packages/frontend/src/lib/transfer/sessionGrantReview.test.ts
import { describe, it, expect } from "vitest";
import { renderDocSessionGrant, renderSessionGrant, type DocSessionGrantView, type SessionGrantScope } from "./sessionGrantReview";

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

describe("renderDocSessionGrant", () => {
  const view: DocSessionGrantView = {
    origin: "https://game.example",
    ruleName: "guess-xlm",
    target: "CTARGET",
    signers: ["04" + "cd".repeat(64)],
    functions: ["transfer"],
    expiryLabel: "24 hours",
    capStroops: "20000000",
    capPeriod: "day",
    docHash: "ab".repeat(32),
  };

  it("shows each function as a method", () => {
    const html = renderDocSessionGrant({ ...view, functions: ["transfer", "approve"] });
    expect(html).toContain('<code class="fn-call">transfer()</code>, <code class="fn-call">approve()</code>');
    expect(renderDocSessionGrant({ ...view, functions: ["<b>x"] })).toContain("&lt;b&gt;x()");
  });

  it("says a rule allowing no token functions has no cap, not that it can spend any amount", () => {
    const html = renderDocSessionGrant({ ...view, functions: ["guess"], capStroops: null });
    expect(html).toContain("No cap — allows no token functions");
    expect(html).not.toContain("Any amount");
  });

  it.each([[["transfer"]], [["guess", "approve"]], [null]])(
    "keeps \"Any amount (no cap)\" for an uncapped rule that can move tokens (%j)",
    (functions) => {
      const html = renderDocSessionGrant({ ...view, functions, capStroops: null });
      expect(html).toContain("Any amount");
      expect(html).not.toContain("move tokens");
    },
  );

  it("says whom a transfer rule can pay: only its recipient, naming the rule whose contract it is", () => {
    const only = renderDocSessionGrant({ ...view, recipient: { address: "CBY4S4Z2TI5HXUKSHFV35PKHSIN4YIXU7MYS44UKY23ONSV7QUECYGUW", ruleName: "guess" } });
    expect(only).toContain("Can pay");
    expect(only).toContain("Only <span");
    expect(only).toContain("CBY4…YGUW");
    expect(only).toContain("the contract “guess” calls");
    const any = renderDocSessionGrant({ ...view, recipient: { address: null } });
    expect(any).toContain("Any address");
    // A rule that cannot call transfer has no Can pay row.
    expect(renderDocSessionGrant({ ...view, functions: ["guess"], capStroops: null })).not.toContain("Can pay");
  });

  it("names the rule and says which of several it is", () => {
    const html = renderDocSessionGrant({ ...view, position: { index: 1, count: 2 } });
    expect(html).toContain('data-grant-rule="guess-xlm"');
    expect(html).toContain("rule 2 of 2");
    expect(html).toContain("Up to 2 XLM");
  });

  it("reads as before for a request's only rule", () => {
    expect(renderDocSessionGrant({ ...view, position: { index: 0, count: 1 } })).not.toContain("rule 1 of 1");
    expect(renderDocSessionGrant(view)).not.toContain(" of ");
  });

  it("escapes a hostile rule name", () => {
    expect(renderDocSessionGrant({ ...view, ruleName: '"><img src=x>' })).not.toContain("<img");
  });
});
