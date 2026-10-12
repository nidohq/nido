import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "buffer";

const h = vi.hoisted(() => ({
  simulateTransaction: null as any,
}));

// Keep stellar-sdk real except rpc.Server, whose network calls we stub —
// same pattern as the frontend's predictAddress.test.ts.
vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const orig = (await importOriginal()) as typeof import("@stellar/stellar-sdk");
  return {
    ...orig,
    rpc: {
      ...orig.rpc,
      Server: class {
        simulateTransaction = (...args: unknown[]) => h.simulateTransaction(...args);
      },
    },
  };
});

import { nativeToScVal, StrKey } from "@stellar/stellar-sdk";
import { getBalance, pollOnce } from "./poller.js";
import { addVisit, clearVisits, getVisit } from "./store.js";

const ADDRESS = StrKey.encodeContract(Buffer.alloc(32, 5));

afterEach(() => vi.restoreAllMocks());
beforeEach(() => clearVisits());

describe("getBalance", () => {
  it("returns the simulated balance as a bigint", async () => {
    h.simulateTransaction = vi.fn(async () => ({
      result: { retval: nativeToScVal(500n, { type: "i128" }) },
    }));

    await expect(getBalance(ADDRESS)).resolves.toBe(500n);
  });

  it("throws on a simulation error", async () => {
    h.simulateTransaction = vi.fn(async () => ({ error: "boom" }));

    await expect(getBalance(ADDRESS)).rejects.toThrow(/Balance check failed/);
  });
});

describe("pollOnce", () => {
  it("flips a funded visit to \"funded\" and calls onFunded", async () => {
    addVisit("visit-1", { address: ADDRESS, status: "pending", createdAt: Date.now() });
    h.simulateTransaction = vi.fn(async () => ({
      result: { retval: nativeToScVal(100n, { type: "i128" }) },
    }));
    const onFunded = vi.fn();

    await pollOnce(undefined, onFunded);

    expect(getVisit("visit-1")?.status).toBe("funded");
    expect(onFunded).toHaveBeenCalledWith("visit-1", expect.objectContaining({ status: "funded" }));
  });

  it("leaves a zero-balance visit pending and doesn't call onFunded", async () => {
    addVisit("visit-1", { address: ADDRESS, status: "pending", createdAt: Date.now() });
    h.simulateTransaction = vi.fn(async () => ({
      result: { retval: nativeToScVal(0n, { type: "i128" }) },
    }));
    const onFunded = vi.fn();

    await pollOnce(undefined, onFunded);

    expect(getVisit("visit-1")?.status).toBe("pending");
    expect(onFunded).not.toHaveBeenCalled();
  });

  it("logs and continues when a balance check fails, instead of throwing", async () => {
    addVisit("visit-1", { address: ADDRESS, status: "pending", createdAt: Date.now() });
    h.simulateTransaction = vi.fn(async () => ({ error: "boom" }));
    const onFunded = vi.fn();

    await expect(pollOnce(undefined, onFunded)).resolves.toBeUndefined();
    expect(getVisit("visit-1")?.status).toBe("pending");
  });
});
