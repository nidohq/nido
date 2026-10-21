import { beforeEach, describe, expect, it, vi } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";

// A returning testnet user's storage, written before keys were namespaced.
const A = StrKey.encodeContract(Buffer.alloc(32, 0xa1));
const B = StrKey.encodeContract(Buffer.alloc(32, 0xb2));

describe("legacy wallet storage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("moves to the testnet namespace before the first read", async () => {
    localStorage.setItem("nido:accounts", JSON.stringify([A]));
    localStorage.setItem("nido:pending", JSON.stringify([{ contractId: B, setupKey: "salt-b" }]));
    localStorage.setItem(`nido:names:${A}`, "alpha");
    localStorage.setItem("nido:walletSession", JSON.stringify({ walletId: "g2c", walletAddress: A }));

    const { localNidoSnapshot } = await import("./nidoSharedStorage.js");
    expect(localNidoSnapshot(localStorage)).toEqual({
      accounts: [A],
      pending: [{ contractId: B, setupKey: "salt-b" }],
      names: { [A]: "alpha" },
    });

    expect(localStorage.getItem("nido:accounts")).toBeNull();
    expect(localStorage.getItem("nido:testnet:accounts")).toBe(JSON.stringify([A]));
    expect(localStorage.getItem("nido:testnet:walletSession")).not.toBeNull();
  });

  it("the SDK's account helpers read the moved list", async () => {
    localStorage.setItem("nido:accounts", JSON.stringify([A]));
    const { loadAccounts, loadAccountName } = await import("@nidohq/passkey-sdk");
    expect(loadAccounts()).toEqual([A]);
    expect(loadAccountName(A)).toBeNull();
  });
});
