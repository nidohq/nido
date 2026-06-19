import { describe, it, expect } from "vitest";
import { markUsed, readLastUsed } from "./lastUsed";

function fakeStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
}

const C1 = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

describe("lastUsed", () => {
  it("markUsed writes a numeric timestamp under the prefixed key", () => {
    const store = fakeStore();
    markUsed(C1, store, 1234);
    expect(store.getItem(`nido:lastUsed:${C1}`)).toBe("1234");
  });

  it("readLastUsed collects prefixed keys into a record", () => {
    const store = fakeStore({ [`nido:lastUsed:${C1}`]: "42", "nido:accounts": "[]" });
    expect(readLastUsed(store)).toEqual({ [C1]: 42 });
  });

  it("readLastUsed ignores non-numeric values", () => {
    const store = fakeStore({ [`nido:lastUsed:${C1}`]: "nope" });
    expect(readLastUsed(store)).toEqual({});
  });
});
