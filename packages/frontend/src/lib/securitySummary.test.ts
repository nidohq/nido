import { describe, it, expect } from "vitest";
import { summarizePolicyBlocks } from "./securitySummary";

describe("summarizePolicyBlocks", () => {
  it("returns no recovery and zero delegations for an empty policy", () => {
    expect(summarizePolicyBlocks([])).toEqual({ recovery: null, delegations: 0 });
  });

  it("surfaces the recovery quorum (threshold of friends)", () => {
    const blocks = [
      { kind: "multisig-recovery", threshold: 3, friends: [1, 2, 3, 4, 5] },
    ];
    expect(summarizePolicyBlocks(blocks)).toEqual({
      recovery: { threshold: 3, friends: 5 },
      delegations: 0,
    });
  });

  it("counts each scoped session key as one delegation", () => {
    const blocks = [
      { kind: "scoped-session-key" },
      { kind: "scoped-session-key" },
    ];
    expect(summarizePolicyBlocks(blocks)).toEqual({ recovery: null, delegations: 2 });
  });

  it("keeps the FIRST recovery rule when several exist", () => {
    const blocks = [
      { kind: "multisig-recovery", threshold: 2, friends: [1, 2, 3] },
      { kind: "multisig-recovery", threshold: 4, friends: [1, 2, 3, 4, 5, 6] },
    ];
    expect(summarizePolicyBlocks(blocks).recovery).toEqual({ threshold: 2, friends: 3 });
  });

  it("ignores unrelated block kinds", () => {
    const blocks = [
      { kind: "passkey-signer" },
      { kind: "multisig-recovery", threshold: 2, friends: [1, 2] },
      { kind: "scoped-session-key" },
      { kind: "something-else" },
    ];
    expect(summarizePolicyBlocks(blocks)).toEqual({
      recovery: { threshold: 2, friends: 2 },
      delegations: 1,
    });
  });
});
