import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";

// The migration as an apex page runs it, on a mainnet build, with the two
// things it asks of the outside world replaced: this browser holds every
// passkey, and the chain never answers.
vi.mock("./network", () => ({ NETWORK_NAME: "mainnet" }));
vi.mock("./nidoSharedStorage", () => ({
  BRIDGE_ANSWER_BUDGET_MS: 10_000,
  apexHostForHost: (host: string) => host,
  probeAccountOwnership: async () => true,
}));
vi.mock("./newAccount/verifyNewAccount", () => ({
  accountDeployed: () => new Promise<boolean>(() => {}),
}));

const ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 1));

describe("the sign-in list migration on a stalled connection", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("gives up on a chain read that never answers and leaves the entry for the next load", async () => {
    vi.resetModules();
    (await import("@nidohq/passkey-sdk/storage")).setStorageNetwork("mainnet");
    const { runAccountMigration } = await import("./runAccountMigration");
    localStorage.setItem("nido:testnet:accounts", JSON.stringify([ACCOUNT]));

    let result: unknown = "pending";
    void runAccountMigration().then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(9_000);
    expect(result).toBe("pending");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(result).toEqual({ ran: true, kept: [], dropped: [], undecided: [ACCOUNT] });
    expect(JSON.parse(localStorage.getItem("nido:testnet:accounts")!)).toEqual([ACCOUNT]);
    expect(localStorage.getItem("nido:mainnet:accounts:migrated:v1")).toBeNull();
  });
});
