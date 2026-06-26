import { describe, it, expect, beforeEach } from "vitest";
import { stashSignRequest, loadSignRequest, signRequestFromParams, type SignRequest } from "./signRequest";

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

describe("signRequestFromParams (legacy dApp entry)", () => {
  it("maps a kind=tx dApp request to a dapp-tx SignRequest", () => {
    const p = new URLSearchParams({
      kind: "tx", xdr: "AAAA==", dapp: "https://app.example",
      return: "https://app.example/cb", network: "Test SDF Network ; September 2015",
    });
    expect(signRequestFromParams(p, C1)).toEqual({
      v: 1, kind: "dapp-tx", account: C1,
      operation: { type: "raw-xdr", xdr: "AAAA==" },
      title: "Confirm it's you",
      subtitle: "https://app.example wants this account to sign a transaction.",
      submitMode: "return-to-dapp",
      returnTarget: { type: "dapp", origin: "https://app.example", returnUrl: "https://app.example/cb" },
      networkPassphrase: "Test SDF Network ; September 2015",
    });
  });
  it("returns null when xdr is missing", () => {
    expect(signRequestFromParams(new URLSearchParams({ kind: "tx", dapp: "https://x" }), C1)).toBeNull();
  });
  it("returns null when account is null", () => {
    expect(signRequestFromParams(new URLSearchParams({ kind: "tx", xdr: "AAAA==", dapp: "https://x" }), null)).toBeNull();
  });
  it("returns null for non-tx kinds (message/authEntry handled elsewhere)", () => {
    expect(signRequestFromParams(new URLSearchParams({ kind: "message", message: "hi", dapp: "https://x" }), C1)).toBeNull();
  });
});
