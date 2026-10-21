import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/memoryStore.js";
import { issueCode } from "../src/builder.js";
import { checkAndClaim } from "../src/checker.js";

describe("checkAndClaim", () => {
  it("claims an issued code and binds the address", async () => {
    const store = new MemoryStore();
    const { code } = await issueCode(store, 60_000);

    const result = await checkAndClaim(store, code, "CADDRESS1");
    expect(result).toEqual({ ok: true, status: "claimed" });
    expect((await store.get(code))?.address).toBe("CADDRESS1");
  });

  it("is idempotent for the same address", async () => {
    const store = new MemoryStore();
    const { code } = await issueCode(store, 60_000);
    await checkAndClaim(store, code, "CADDRESS1");

    const result = await checkAndClaim(store, code, "CADDRESS1");
    expect(result).toEqual({ ok: true, status: "claimed" });
  });

  it("refuses a second address on an already-claimed code", async () => {
    const store = new MemoryStore();
    const { code } = await issueCode(store, 60_000);
    await checkAndClaim(store, code, "CADDRESS1");

    const result = await checkAndClaim(store, code, "CADDRESS2");
    expect(result).toEqual({ ok: false, reason: "claimed_by_other" });
    expect((await store.get(code))?.address).toBe("CADDRESS1"); // unchanged
  });

  it("refuses an unknown code", async () => {
    const store = new MemoryStore();
    expect(await checkAndClaim(store, "NOPE", "CADDRESS1")).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses an expired code", async () => {
    const store = new MemoryStore();
    const { code } = await issueCode(store, -1); // already expired

    expect(await checkAndClaim(store, code, "CADDRESS1")).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a used code", async () => {
    const store = new MemoryStore();
    const { code } = await issueCode(store, 60_000);
    await checkAndClaim(store, code, "CADDRESS1");
    await store.put({ ...(await store.get(code))!, status: "used", usedAt: Date.now() });

    expect(await checkAndClaim(store, code, "CADDRESS1")).toEqual({ ok: false, reason: "used" });
  });
});
