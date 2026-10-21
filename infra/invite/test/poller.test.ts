import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/memoryStore.js";
import { pollOnce } from "../src/poller.js";

vi.mock("../src/chain.js", () => ({
  accountExists: vi.fn(async () => true),
  isFunded: vi.fn(async () => false),
}));
const chain = await import("../src/chain.js");

describe("pollOnce", () => {
  it("expires an issued code past its TTL", async () => {
    const store = new MemoryStore();
    await store.put({ code: "A", status: "issued", issuedAt: 0, expiresAt: Date.now() - 1 });

    await pollOnce(store);

    expect((await store.get("A"))?.status).toBe("expired");
  });

  it("expires a claimed code past its TTL without touching the chain", async () => {
    const store = new MemoryStore();
    await store.put({
      code: "A",
      status: "claimed",
      address: "CDOESNOTEXIST",
      issuedAt: 0,
      claimedAt: 0,
      expiresAt: Date.now() - 1,
    });

    await pollOnce(store);

    expect((await store.get("A"))?.status).toBe("expired");
  });

  it("leaves a live claimed code alone when the address doesn't exist on chain", async () => {
    vi.mocked(chain.accountExists).mockResolvedValueOnce(false);
    const store = new MemoryStore();
    await store.put({
      code: "A",
      status: "claimed",
      address: "CDOESNOTEXIST",
      issuedAt: 0,
      claimedAt: 0,
      expiresAt: Date.now() + 60_000,
    });

    await pollOnce(store);

    expect((await store.get("A"))?.status).toBe("claimed");
  });

  it("leaves a claimed code alone once deployed but not yet funded", async () => {
    vi.mocked(chain.accountExists).mockResolvedValueOnce(true);
    vi.mocked(chain.isFunded).mockResolvedValueOnce(false);
    const store = new MemoryStore();
    await store.put({
      code: "A",
      status: "claimed",
      address: "CDEPLOYEDONLY",
      issuedAt: 0,
      claimedAt: 0,
      expiresAt: Date.now() + 60_000,
    });

    await pollOnce(store);

    expect((await store.get("A"))?.status).toBe("claimed");
  });

  it("marks a claimed code used once deployed AND funded", async () => {
    vi.mocked(chain.accountExists).mockResolvedValueOnce(true);
    vi.mocked(chain.isFunded).mockResolvedValueOnce(true);
    const store = new MemoryStore();
    await store.put({
      code: "A",
      status: "claimed",
      address: "CREADY",
      issuedAt: 0,
      claimedAt: 0,
      expiresAt: Date.now() + 60_000,
    });

    await pollOnce(store);

    expect((await store.get("A"))?.status).toBe("used");
  });
});
