import { describe, it, expect } from "vitest";
import {
  classifyNameState,
  selectClaimer,
  formatClaimerLabel,
  buildClaimHandoffUrl,
  parseReturnIntent,
  buildClaimReturnUrl,
} from "./claimFlow";

// Valid strkey C-addresses (reused from other lib tests).
const C1 = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const C2 = "CCV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XMCW";

describe("classifyNameState", () => {
  it("invalid for bad syntax", () => {
    expect(classifyNameState("Alice", null)).toBe("invalid"); // uppercase
    expect(classifyNameState("1abc", null)).toBe("invalid"); // leading digit
    expect(classifyNameState("toolongname12345", null)).toBe("invalid"); // 16 chars
    expect(classifyNameState("", null)).toBe("invalid");
  });
  it("taken when resolved", () => {
    expect(classifyNameState("alice", C1)).toBe("taken");
  });
  it("available when valid and unresolved", () => {
    expect(classifyNameState("alice", null)).toBe("available");
    expect(classifyNameState("a", null)).toBe("available");
    expect(classifyNameState("alice15charsok", null)).toBe("available");
  });
});

describe("selectClaimer", () => {
  it("param wins when a valid contract id", () => {
    expect(selectClaimer(C1, [C2], {})).toEqual({ contractId: C1, source: "param" });
  });
  it("lowercased param is normalised to upper", () => {
    expect(selectClaimer(C1.toLowerCase(), [], {})).toEqual({ contractId: C1, source: "param" });
  });
  it("ignores an invalid param", () => {
    expect(selectClaimer("not-a-contract", [C1], {})).toEqual({ contractId: C1, source: "single" });
  });
  it("none when no accounts and no param", () => {
    expect(selectClaimer(null, [], {})).toEqual({ contractId: null, source: "none" });
  });
  it("single account", () => {
    expect(selectClaimer(null, [C1], {})).toEqual({ contractId: C1, source: "single" });
  });
  it("multi → most-recently-used by lastUsed", () => {
    expect(selectClaimer(null, [C1, C2], { [C1]: 10, [C2]: 99 })).toEqual({
      contractId: C2,
      source: "recent",
    });
  });
  it("multi → falls back to list order when no timestamps", () => {
    expect(selectClaimer(null, [C1, C2], {})).toEqual({ contractId: C1, source: "recent" });
  });
});

describe("formatClaimerLabel", () => {
  it("uses the name when present", () => {
    expect(formatClaimerLabel(C1, "bob")).toBe("bob");
  });
  it("shortens the contract id when nameless", () => {
    expect(formatClaimerLabel(C1, null)).toBe("CAAA…BSC4");
  });
});

describe("buildClaimHandoffUrl", () => {
  it("targets the unnamed claimer's contract-id subdomain", () => {
    const url = buildClaimHandoffUrl({
      apexHost: "nido.fyi",
      fromHost: "alice.nido.fyi",
      claimName: "alice",
      claimerContractId: C1,
      claimerName: null,
    });
    expect(url).toBe(
      `https://${C1.toLowerCase()}.nido.fyi/account/?claim=alice&account=${C1}&from=alice.nido.fyi`,
    );
  });
  it("targets a named claimer's name subdomain", () => {
    const url = buildClaimHandoffUrl({
      apexHost: "nido.fyi",
      fromHost: "alice.nido.fyi",
      claimName: "alice",
      claimerContractId: C1,
      claimerName: "bob",
    });
    expect(url).toBe(`https://bob.nido.fyi/account/?claim=alice&account=${C1}&from=alice.nido.fyi`);
  });
  it("honours a custom protocol (dev http)", () => {
    const url = buildClaimHandoffUrl({
      apexHost: "localhost:4321",
      fromHost: "alice.localhost:4321",
      claimName: "alice",
      claimerContractId: C1,
      claimerName: null,
      protocol: "http:",
    });
    expect(url.startsWith("http://")).toBe(true);
  });
});

describe("parseReturnIntent", () => {
  it("parses claim:<name>", () => {
    expect(parseReturnIntent("claim:alice")).toEqual({ kind: "claim", name: "alice" });
  });
  it("lowercases the name", () => {
    expect(parseReturnIntent("claim:Alice")).toEqual({ kind: "claim", name: "alice" });
  });
  it("rejects invalid names", () => {
    expect(parseReturnIntent("claim:1bad")).toBeNull();
    expect(parseReturnIntent("claim:")).toBeNull();
  });
  it("null for absent/other", () => {
    expect(parseReturnIntent(null)).toBeNull();
    expect(parseReturnIntent("something")).toBeNull();
  });
});

describe("buildClaimReturnUrl", () => {
  it("returns to the name subdomain account page with the new account param", () => {
    const url = buildClaimReturnUrl({ apexHost: "nido.fyi", name: "alice", contractId: C1 });
    expect(url).toBe(`https://alice.nido.fyi/account/?account=${C1}`);
  });
});
