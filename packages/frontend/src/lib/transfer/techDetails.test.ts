import { describe, it, expect } from "vitest";
import { renderTechDetails } from "./techDetails";

describe("renderTechDetails", () => {
  it("renders the auth hash and raw xdr when provided", () => {
    const html = renderTechDetails({ txXdr: "AAAA==", authHashHex: "deadbeef", summary: { fee: "100", ops: [{ kind: "other", type: "x" }] } });
    expect(html).toContain("deadbeef");
    expect(html).toContain("AAAA==");
  });
  it("escapes a hostile xdr blob", () => {
    expect(renderTechDetails({ txXdr: "<img>" })).not.toContain("<img>");
  });
  it("returns a non-empty string with no inputs", () => {
    expect(renderTechDetails({}).length).toBeGreaterThan(0);
  });
});
