import { describe, expect, it } from "vitest";
import { dropUnfinishableSetups } from "./pendingCleanup";

function setups(rows: { contractId: string; setupKey?: string }[], chain: Record<string, boolean | "error">) {
  const list = [...rows];
  return {
    list,
    deps: {
      unfinished: () => list,
      deployed: async (id: string) => {
        if (chain[id] === "error") throw new Error("RPC unreachable");
        return chain[id] === true;
      },
      remove: (id: string) => list.splice(list.findIndex((p) => p.contractId === id), 1),
    },
  };
}

describe("unfinished setups that can never finish", () => {
  it("drops one whose secret expired and whose address holds no account", async () => {
    const { list, deps } = setups([{ contractId: "CDEAD" }], { CDEAD: false });
    await expect(dropUnfinishableSetups(deps)).resolves.toBe(true);
    expect(list).toEqual([]);
  });

  it("keeps one whose account exists: it can still be finished from its row", async () => {
    const { list, deps } = setups([{ contractId: "CLIVE" }], { CLIVE: true });
    await expect(dropUnfinishableSetups(deps)).resolves.toBe(false);
    expect(list).toEqual([{ contractId: "CLIVE" }]);
  });

  it("keeps one still holding its secret, and one whose address can't be read now", async () => {
    const { list, deps } = setups(
      [{ contractId: "CNEW", setupKey: "salt" }, { contractId: "CUNKNOWN" }],
      { CNEW: false, CUNKNOWN: "error" },
    );
    await expect(dropUnfinishableSetups(deps)).resolves.toBe(false);
    expect(list.map((p) => p.contractId)).toEqual(["CNEW", "CUNKNOWN"]);
  });
});
