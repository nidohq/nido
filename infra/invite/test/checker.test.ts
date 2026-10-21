import { describe, expect, it } from "vitest";
import { Store } from "../src/store.js";
import { issueCode } from "../src/builder.js";
import { checkAndClaim } from "../src/checker.js";

describe("checkAndClaim", () => {
  it("claims an issued code and binds the address", () => {
    const store = new Store();
    const { code } = issueCode(store, 60_000);

    const result = checkAndClaim(store, code, "CADDRESS1");
    expect(result).toEqual({ ok: true, status: "claimed" });
    expect(store.get(code)?.address).toBe("CADDRESS1");
  });

  it("is idempotent for the same address", () => {
    const store = new Store();
    const { code } = issueCode(store, 60_000);
    checkAndClaim(store, code, "CADDRESS1");

    const result = checkAndClaim(store, code, "CADDRESS1");
    expect(result).toEqual({ ok: true, status: "claimed" });
  });

  it("refuses a second address on an already-claimed code", () => {
    const store = new Store();
    const { code } = issueCode(store, 60_000);
    checkAndClaim(store, code, "CADDRESS1");

    const result = checkAndClaim(store, code, "CADDRESS2");
    expect(result).toEqual({ ok: false, reason: "claimed_by_other" });
    expect(store.get(code)?.address).toBe("CADDRESS1"); // unchanged
  });

  it("refuses an unknown code", () => {
    const store = new Store();
    expect(checkAndClaim(store, "NOPE", "CADDRESS1")).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses an expired code", () => {
    const store = new Store();
    const { code } = issueCode(store, -1); // already expired

    expect(checkAndClaim(store, code, "CADDRESS1")).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a used code", () => {
    const store = new Store();
    const { code } = issueCode(store, 60_000);
    checkAndClaim(store, code, "CADDRESS1");
    store.put({ ...store.get(code)!, status: "used", usedAt: Date.now() });

    expect(checkAndClaim(store, code, "CADDRESS1")).toEqual({ ok: false, reason: "used" });
  });
});
