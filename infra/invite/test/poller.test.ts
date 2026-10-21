import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/memoryStore.js";
import { pollOnce } from "../src/poller.js";

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
});
