import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/memoryStore.js";

describe("nextPendingPrint", () => {
  it("returns undefined when nothing is waiting", async () => {
    const store = new MemoryStore();
    expect(await store.nextPendingPrint()).toBeUndefined();
  });

  it("ignores codes that aren't used yet", async () => {
    const store = new MemoryStore();
    await store.put({ code: "A", status: "claimed", address: "C1", issuedAt: 0, expiresAt: 1e15 });
    expect(await store.nextPendingPrint()).toBeUndefined();
  });

  it("ignores codes already delivered", async () => {
    const store = new MemoryStore();
    await store.put({
      code: "A",
      status: "used",
      address: "C1",
      issuedAt: 0,
      usedAt: 10,
      deliveredAt: 20,
      expiresAt: 1e15,
    });
    expect(await store.nextPendingPrint()).toBeUndefined();
  });

  it("returns the oldest used-and-undelivered code, FIFO by usedAt", async () => {
    const store = new MemoryStore();
    await store.put({ code: "NEWER", status: "used", address: "C1", issuedAt: 0, usedAt: 20, expiresAt: 1e15 });
    await store.put({ code: "OLDER", status: "used", address: "C2", issuedAt: 0, usedAt: 10, expiresAt: 1e15 });

    expect((await store.nextPendingPrint())?.code).toBe("OLDER");
  });
});
