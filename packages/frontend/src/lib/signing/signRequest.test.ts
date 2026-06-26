import { describe, it, expect, beforeEach } from "vitest";
import { stashSignRequest, loadSignRequest, type SignRequest } from "./signRequest";

const C1 = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

function fakeStore(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  } as Storage;
}

const sample: SignRequest = {
  v: 1, kind: "name-claim", account: C1,
  operation: { type: "register", name: "alice" },
  title: "Claim alice", submitMode: "relayer",
  returnTarget: { type: "route", url: "https://alice.nido.fyi/account/?namepasskey=1" },
};

describe("stash/load SignRequest", () => {
  let store: Storage;
  beforeEach(() => { store = fakeStore(); });

  it("round-trips a request through the store", () => {
    const id = stashSignRequest(sample, store);
    expect(typeof id).toBe("string");
    expect(loadSignRequest(id, store)).toEqual(sample);
  });
  it("returns null for an unknown id", () => {
    expect(loadSignRequest("nope", store)).toBeNull();
  });
  it("returns null for a wrong-version blob", () => {
    store.setItem("nido:signreq:x", JSON.stringify({ v: 2 }));
    expect(loadSignRequest("x", store)).toBeNull();
  });
  it("returns null for malformed json", () => {
    store.setItem("nido:signreq:y", "{not json");
    expect(loadSignRequest("y", store)).toBeNull();
  });
});
