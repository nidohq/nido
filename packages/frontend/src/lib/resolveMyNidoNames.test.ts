import { describe, it, expect, vi } from "vitest";
import { resolveMissingNames } from "./resolveMyNidoNames.js";
import type { MyNidoRow } from "./myNidoModel.js";

const active = (contractId: string, name: string | null = null): MyNidoRow => ({
  contractId,
  name,
  status: "active",
});

const pending = (contractId: string): MyNidoRow => ({
  contractId,
  name: null,
  status: "pending",
  resumeKey: "S1",
});

describe("resolveMissingNames", () => {
  it("does nothing for an empty row list", async () => {
    const lookup = vi.fn();
    const persist = vi.fn();

    const resolved = await resolveMissingNames([], lookup, persist);

    expect(lookup).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(resolved.size).toBe(0);
  });

  it("resolves, persists, and returns the on-chain name for a nameless active row", async () => {
    const lookup = vi.fn().mockResolvedValue("alice");
    const persist = vi.fn();

    const resolved = await resolveMissingNames([active("CABC")], lookup, persist);

    expect(lookup).toHaveBeenCalledWith("CABC");
    expect(persist).toHaveBeenCalledWith("CABC", "alice");
    expect(resolved).toEqual(new Map([["CABC", "alice"]]));
  });

  it("does not look up rows that already have a local name", async () => {
    const lookup = vi.fn().mockResolvedValue("shouldNotHappen");
    const persist = vi.fn();

    const resolved = await resolveMissingNames(
      [active("CABC", "alice")],
      lookup,
      persist,
    );

    expect(lookup).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(resolved.size).toBe(0);
  });

  it("never looks up pending rows (they can't have a registered name yet)", async () => {
    const lookup = vi.fn().mockResolvedValue("alice");
    const persist = vi.fn();

    const resolved = await resolveMissingNames([pending("CPEND")], lookup, persist);

    expect(lookup).not.toHaveBeenCalled();
    expect(resolved.size).toBe(0);
  });

  it("ignores a null lookup (unregistered) without persisting", async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const persist = vi.fn();

    const resolved = await resolveMissingNames([active("CABC")], lookup, persist);

    expect(persist).not.toHaveBeenCalled();
    expect(resolved.size).toBe(0);
  });

  it("is best-effort: one row's lookup error doesn't sink the others", async () => {
    const lookup = vi.fn(async (id: string) => {
      if (id === "CBAD") throw new Error("rpc down");
      return "bob";
    });
    const persist = vi.fn();

    const resolved = await resolveMissingNames(
      [active("CBAD"), active("CGOOD")],
      lookup,
      persist,
    );

    expect(resolved).toEqual(new Map([["CGOOD", "bob"]]));
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith("CGOOD", "bob");
  });

  it("rejects a name the registry contract could never have issued", async () => {
    // The resolved name flows into a subdomain href and localStorage, so a
    // lookup backed by a hostile registry/RPC must not get arbitrary strings
    // through. Valid names are ^[a-z][a-z0-9]{0,14}$ (contract validate_name).
    for (const hostile of [
      "evil.example/x", // URL authority breakout via dot + slash
      "ALICE", // uppercase — contract lowercases only
      "0alice", // must start with a letter
      "alicealicealice1", // 16 chars — over the 15-char cap
      "ali ce", // whitespace
    ]) {
      const lookup = vi.fn().mockResolvedValue(hostile);
      const persist = vi.fn();

      const resolved = await resolveMissingNames([active("CABC")], lookup, persist);

      expect(persist, hostile).not.toHaveBeenCalled();
      expect(resolved.size, hostile).toBe(0);
    }
  });
});
