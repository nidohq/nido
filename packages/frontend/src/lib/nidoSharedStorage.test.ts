import { describe, expect, it } from "vitest";
import {
  apexHostForHost,
  localNidoSnapshot,
  mergeNidoSnapshot,
  sameNidoApexOrigin,
} from "./nidoSharedStorage.js";

const A = `C${"A".repeat(55)}`;
const B = `C${"B".repeat(55)}`;

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    Object.entries(initial).forEach(([key, value]) => this.values.set(key, value));
  }

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("apexHostForHost", () => {
  it("keeps production apex hosts unchanged", () => {
    expect(apexHostForHost("nido.fyi")).toBe("nido.fyi");
  });

  it("maps production account subdomains to the apex", () => {
    expect(apexHostForHost("alice.nido.fyi")).toBe("nido.fyi");
  });

  it("maps localhost account subdomains to localhost", () => {
    expect(apexHostForHost("alice.localhost:4399")).toBe("localhost:4399");
  });

  it("preserves numeric PR preview roots", () => {
    expect(apexHostForHost("24.mysoroban.xyz")).toBe("24.mysoroban.xyz");
    expect(apexHostForHost("alice--24.mysoroban.xyz")).toBe("24.mysoroban.xyz");
  });

  it("normalizes legacy PR preview roots to the numeric root", () => {
    expect(apexHostForHost("pr-24.mysoroban.xyz")).toBe("24.mysoroban.xyz");
    expect(apexHostForHost("alice--pr-24.mysoroban.xyz")).toBe("24.mysoroban.xyz");
  });
});

describe("sameNidoApexOrigin", () => {
  it("allows origins under the same apex", () => {
    expect(sameNidoApexOrigin("https://nido.fyi", "alice.nido.fyi")).toBe(true);
    expect(sameNidoApexOrigin("http://localhost:4399", "alice.localhost:4399")).toBe(true);
  });

  it("rejects other sites", () => {
    expect(sameNidoApexOrigin("https://example.com", "alice.nido.fyi")).toBe(false);
  });
});

describe("Nido account snapshot storage", () => {
  it("loads local accounts, pending rows, and cached names", () => {
    const store = new MemoryStorage({
      "nido:accounts": JSON.stringify([A, "not-an-account"]),
      "nido:pending": JSON.stringify([{ contractId: B, secretKey: "S123" }]),
      [`nido:names:${A}`]: "alpha",
      [`nido:names:${B}`]: "beta",
    });

    expect(localNidoSnapshot(store)).toEqual({
      accounts: [A],
      pending: [{ contractId: B, setupKey: "S123" }],
      names: { [A]: "alpha", [B]: "beta" },
    });
  });

  it("merges bridge accounts and removes pending rows once active", () => {
    const store = new MemoryStorage({
      "nido:accounts": JSON.stringify([A]),
      "nido:pending": JSON.stringify([{ contractId: B, secretKey: "S123" }]),
      [`nido:names:${A}`]: "alpha",
    });

    const changed = mergeNidoSnapshot(
      {
        accounts: [B],
        pending: [],
        names: { [B]: "beta" },
      },
      store,
    );

    expect(changed).toBe(true);
    expect(localNidoSnapshot(store)).toEqual({
      accounts: [A, B],
      pending: [],
      names: { [A]: "alpha", [B]: "beta" },
    });
  });
});
