import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveNameCached } from "./resolve.js";

afterEach(() => vi.unstubAllGlobals());

function stubSession(entries: Record<string, string>) {
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => entries[k] ?? null,
    setItem: (k: string, v: string) => {
      entries[k] = v;
    },
  });
}

describe("resolveNameCached", () => {
  it("a cached name never looks up the registry address", async () => {
    stubSession({
      "nido:name:joe": JSON.stringify({ contractId: "CJOE", timestamp: Date.now() }),
    });
    const registry = vi.fn(async () => "CREGISTRY");
    await expect(
      resolveNameCached("https://rpc.invalid", registry, "joe", "Test SDF Network ; September 2015"),
    ).resolves.toBe("CJOE");
    expect(registry).not.toHaveBeenCalled();
  });

  it("a cache miss resolves the registry thunk before reading the name", async () => {
    stubSession({});
    const registry = vi.fn(async () => {
      throw new Error("registry lookup");
    });
    await expect(
      resolveNameCached("https://rpc.invalid", registry, "joe", "Test SDF Network ; September 2015"),
    ).rejects.toThrow("registry lookup");
    expect(registry).toHaveBeenCalledTimes(1);
  });
});
