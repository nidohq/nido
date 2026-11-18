import { describe, expect, it } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import {
  answerBridgePageMessage,
  answerBridgeRequest,
  answerOwnerProbe,
  apexHostForHost,
  bridgeSyncNeeded,
  NIDO_OWNER_REQUEST,
  bridgeRequester,
  contributionFromRequester,
  localNidoSnapshot,
  mergeNidoSnapshot,
  NIDO_STORAGE_REQUEST,
  snapshotForRequester,
} from "./nidoSharedStorage.js";

const A = StrKey.encodeContract(Buffer.alloc(32, 1));
const B = StrKey.encodeContract(Buffer.alloc(32, 2));
const a = A.toLowerCase();
const b = B.toLowerCase();

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

  it("keeps the testnet apex its own apex, never nido.fyi", () => {
    expect(apexHostForHost("test.nido.fyi")).toBe("test.nido.fyi");
    expect(apexHostForHost("alice.test.nido.fyi")).toBe("test.nido.fyi");
    expect(apexHostForHost("status-message.test.nido.fyi")).toBe("test.nido.fyi");
    expect(apexHostForHost("126.test.nido.fyi")).toBe("126.test.nido.fyi");
    expect(apexHostForHost("alice--126.test.nido.fyi")).toBe("126.test.nido.fyi");
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

  it("never collapses a host to a bare public suffix (pages.dev)", () => {
    // Each site directly under a public suffix is its OWN apex, so distinct
    // *.pages.dev deployments cannot share one apex.
    expect(apexHostForHost("nido-xyz.pages.dev")).toBe("nido-xyz.pages.dev");
    expect(apexHostForHost("evil.pages.dev")).toBe("evil.pages.dev");
    // A real account subdomain of the Nido Pages project still maps to the
    // project root (so the legitimate same-project bridge keeps working).
    expect(apexHostForHost("alice.nido-xyz.pages.dev")).toBe("nido-xyz.pages.dev");
  });
});

describe("bridgeRequester", () => {
  it("accepts an origin below the testnet apex on the testnet bridge", () => {
    expect(bridgeRequester(`https://${a}.test.nido.fyi`, "test.nido.fyi")).toEqual({ kind: "account", contractId: A });
    expect(bridgeRequester("https://alice.test.nido.fyi", "test.nido.fyi")).toEqual({ kind: "name" });
  });

  it("refuses reserved-name hosts", () => {
    for (const label of ["www", "nido", "relay", "status-message"]) {
      expect(bridgeRequester(`https://${label}.nido.fyi`, "nido.fyi")).toBeNull();
    }
  });

  it("keeps the two apexes' bridges apart", () => {
    expect(bridgeRequester(`https://${a}.test.nido.fyi`, "nido.fyi")).toBeNull();
    expect(bridgeRequester(`https://${a}.nido.fyi`, "test.nido.fyi")).toBeNull();
    // The testnet apex itself is not a requester on the nido.fyi bridge.
    expect(bridgeRequester("https://test.nido.fyi", "nido.fyi")).toBeNull();
  });

  it("accepts an https account origin and names its account", () => {
    expect(bridgeRequester(`https://${a}.nido.fyi`, "nido.fyi")).toEqual({ kind: "account", contractId: A });
  });

  it("accepts a preview account origin under its preview root", () => {
    expect(bridgeRequester(`https://${a}--24.nido.fyi`, "24.nido.fyi")).toEqual({
      kind: "account",
      contractId: A,
    });
  });

  it("accepts a name origin without naming an account", () => {
    expect(bridgeRequester("https://alice.nido.fyi", "nido.fyi")).toEqual({ kind: "name" });
  });

  it("accepts plain http only on a loopback dev host", () => {
    expect(bridgeRequester(`http://${a}.localhost:4399`, "localhost:4399")).toEqual({
      kind: "account",
      contractId: A,
    });
    expect(bridgeRequester(`http://${a}.nido.fyi`, "nido.fyi")).toBeNull();
    expect(bridgeRequester("http://alice.nido.fyi", "nido.fyi")).toBeNull();
  });

  it("refuses the built-in dApps and service hosts", () => {
    expect(bridgeRequester("https://status-message.nido.fyi", "nido.fyi")).toBeNull();
    expect(bridgeRequester("https://status-message--24.nido.fyi", "24.nido.fyi")).toBeNull();
    expect(bridgeRequester("https://relay.nido.fyi", "nido.fyi")).toBeNull();
  });

  it("refuses an account-shaped label that isn't a valid contract address", () => {
    const badChecksum = `${a.slice(0, -1)}${a.endsWith("a") ? "b" : "a"}`;
    expect(bridgeRequester(`https://${badChecksum}.nido.fyi`, "nido.fyi")).toBeNull();
  });

  it("refuses the apex itself, deeper subdomains and other label shapes", () => {
    expect(bridgeRequester("https://nido.fyi", "nido.fyi")).toBeNull();
    expect(bridgeRequester("https://x.alice.nido.fyi", "nido.fyi")).toBeNull();
    expect(bridgeRequester("https://some-app.nido.fyi", "nido.fyi")).toBeNull();
  });

  it("refuses other sites, including other *.pages.dev projects", () => {
    expect(bridgeRequester("https://example.com", "nido.fyi")).toBeNull();
    expect(bridgeRequester("https://evil-nido.fyi", "nido.fyi")).toBeNull();
    expect(bridgeRequester("https://evil.pages.dev", "nido-xyz.pages.dev")).toBeNull();
    expect(bridgeRequester("https://alice.nido-xyz.pages.dev", "nido-xyz.pages.dev")).toEqual({ kind: "name" });
  });

  it("refuses non-http schemes and junk", () => {
    expect(bridgeRequester("null", "nido.fyi")).toBeNull();
    expect(bridgeRequester(`ftp://${a}.nido.fyi`, "nido.fyi")).toBeNull();
  });
});

describe("what the bridge shares", () => {
  const snapshot = {
    accounts: [A],
    pending: [
      { contractId: A, setupKey: "salt-a" },
      { contractId: B, setupKey: "salt-b" },
    ],
    names: { [A]: "alpha" },
  };

  it("gives an account origin only its own setup entry", () => {
    expect(snapshotForRequester(snapshot, { kind: "account", contractId: B }).pending).toEqual([
      { contractId: B, setupKey: "salt-b" },
    ]);
  });

  it("gives a name origin no setup entries", () => {
    expect(snapshotForRequester(snapshot, { kind: "name" }).pending).toEqual([]);
  });

  it("accepts only an account origin's own entries", () => {
    const incoming = {
      accounts: [A, B],
      pending: [{ contractId: B, setupKey: "planted" }],
      names: { [A]: "alpha", [B]: "mallory" },
    };
    expect(contributionFromRequester(incoming, { kind: "account", contractId: A })).toEqual({
      accounts: [A],
      pending: [],
      names: { [A]: "alpha" },
    });
    expect(contributionFromRequester(incoming, { kind: "name" })).toEqual({
      accounts: [],
      pending: [],
      names: {},
    });
  });
});

describe("answerBridgeRequest", () => {
  const request = (snapshot: unknown) => ({ type: NIDO_STORAGE_REQUEST, id: "r1", snapshot });
  const apexStore = () =>
    new MemoryStorage({
      "nido:testnet:accounts": JSON.stringify([A]),
      "nido:testnet:pending": JSON.stringify([{ contractId: B, setupKey: "salt-b" }]),
    });

  it("answers its embedding account origin with that account's setup entry", () => {
    const store = apexStore();
    const res = answerBridgeRequest(
      { origin: `https://${B.toLowerCase()}.nido.fyi`, data: request(null), fromParent: true },
      "nido.fyi",
      store,
    );
    expect(res?.snapshot.pending).toEqual([{ contractId: B, setupKey: "salt-b" }]);
    expect(res?.snapshot.accounts).toEqual([A]);
  });

  it("never sends another account's setup key", () => {
    const res = answerBridgeRequest(
      { origin: `https://${a}.nido.fyi`, data: request(null), fromParent: true },
      "nido.fyi",
      apexStore(),
    );
    expect(res?.snapshot.pending).toEqual([]);
  });

  it("ignores a message that didn't come from the embedding window", () => {
    expect(
      answerBridgeRequest(
        { origin: `https://${a}.nido.fyi`, data: request(null), fromParent: false },
        "nido.fyi",
        apexStore(),
      ),
    ).toBeNull();
  });

  it("ignores a built-in dApp and leaves the apex's storage untouched", () => {
    const store = apexStore();
    const before = localNidoSnapshot(store);
    expect(
      answerBridgeRequest(
        {
          origin: "https://status-message.nido.fyi",
          data: request({ accounts: [B], pending: [], names: {} }),
          fromParent: true,
        },
        "nido.fyi",
        store,
      ),
    ).toBeNull();
    expect(localNidoSnapshot(store)).toEqual(before);
  });

  it("drops a malformed account id rather than storing it", () => {
    const store = apexStore();
    const poisoned = `C"><img src=x onerror=alert(1)>${"A".repeat(26)}`;
    answerBridgeRequest(
      {
        origin: `https://${a}.nido.fyi`,
        data: request({ accounts: [poisoned, A], pending: [], names: {} }),
        fromParent: true,
      },
      "nido.fyi",
      store,
    );
    expect(localNidoSnapshot(store).accounts).toEqual([A]);
  });

  it("ignores a malformed request", () => {
    expect(
      answerBridgeRequest(
        { origin: `https://${a}.nido.fyi`, data: { type: "other", id: "r1" }, fromParent: true },
        "nido.fyi",
        apexStore(),
      ),
    ).toBeNull();
  });
});

describe("Nido account snapshot storage", () => {
  it("loads local accounts, pending rows, and cached names", () => {
    const store = new MemoryStorage({
      "nido:testnet:accounts": JSON.stringify([A, "not-an-account"]),
      "nido:testnet:pending": JSON.stringify([{ contractId: B, secretKey: "S123" }]),
      [`nido:testnet:names:${A}`]: "alpha",
      [`nido:testnet:names:${B}`]: "beta",
    });

    expect(localNidoSnapshot(store)).toEqual({
      accounts: [A],
      pending: [{ contractId: B, setupKey: "S123" }],
      names: { [A]: "alpha", [B]: "beta" },
    });
  });

  it("merges bridge accounts and removes pending rows once active", () => {
    const store = new MemoryStorage({
      "nido:testnet:accounts": JSON.stringify([A]),
      "nido:testnet:pending": JSON.stringify([{ contractId: B, secretKey: "S123" }]),
      [`nido:testnet:names:${A}`]: "alpha",
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

describe("unfinished setups whose secret expired", () => {
  it("keeps a secret-less pending entry as an address", () => {
    const store = new MemoryStorage({
      "nido:testnet:pending": JSON.stringify([{ contractId: B }, { contractId: A, setupKey: "salt-a" }]),
    });
    expect(localNidoSnapshot(store).pending).toEqual([{ contractId: B }, { contractId: A, setupKey: "salt-a" }]);
  });

  it("never takes back a secret this origin already dropped", () => {
    const store = new MemoryStorage({ "nido:testnet:pending": JSON.stringify([{ contractId: B }]) });
    mergeNidoSnapshot({ accounts: [], pending: [{ contractId: B, setupKey: "salt-b" }], names: {} }, store);
    expect(localNidoSnapshot(store).pending).toEqual([{ contractId: B }]);
  });
});

describe("what the apex has confirmed", () => {
  const accountHost = { host: `${b}.nido.fyi` };

  it("needs a sync while this origin's own account is unconfirmed", () => {
    const store = new MemoryStorage({ "nido:testnet:accounts": JSON.stringify([B]) });
    expect(bridgeSyncNeeded(accountHost, store)).toBe(true);
    store.setItem(`nido:testnet:bridge:confirmed:${B}`, "pending");
    expect(bridgeSyncNeeded(accountHost, store)).toBe(true);
    store.setItem(`nido:testnet:bridge:confirmed:${B}`, "active");
    expect(bridgeSyncNeeded(accountHost, store)).toBe(false);
  });

  it("needs nothing on the apex, on a name origin, or without an own account", () => {
    const store = new MemoryStorage({ "nido:testnet:accounts": JSON.stringify([A, B]) });
    expect(bridgeSyncNeeded({ host: "nido.fyi" }, store)).toBe(false);
    expect(bridgeSyncNeeded({ host: "alice.nido.fyi" }, store)).toBe(false);
    expect(bridgeSyncNeeded(accountHost, new MemoryStorage())).toBe(false);
  });
});

describe("the ownership probe (apex asks an account origin)", () => {
  const probe = { type: NIDO_OWNER_REQUEST, id: "p1" };
  const withPasskey = () =>
    new MemoryStorage({ [`passkey:${B}:credentialId`]: "cred", [`passkey:${B}:publicKey`]: "04ab" });

  it("answers its own apex whether this origin holds the account's passkey record", () => {
    const ask = (store: MemoryStorage) =>
      answerOwnerProbe({ origin: "https://nido.fyi", data: probe, fromParent: true }, `${b}.nido.fyi`, store);
    expect(ask(withPasskey())).toEqual({ type: "nido:owner:response:v1", id: "p1", contractId: B, hasPasskey: true });
    expect(ask(new MemoryStorage({ [`passkey:${B}:credentialId`]: "cred" }))?.hasPasskey).toBe(false);
    expect(ask(new MemoryStorage({ [`passkey:${A}:credentialId`]: "x", [`passkey:${A}:publicKey`]: "y" }))?.hasPasskey).toBe(
      false,
    );
  });

  it("answers its own testnet apex and a loopback dev apex", () => {
    expect(
      answerOwnerProbe(
        { origin: "https://test.nido.fyi", data: probe, fromParent: true },
        `${b}.test.nido.fyi`,
        withPasskey(),
      )?.hasPasskey,
    ).toBe(true);
    expect(
      answerOwnerProbe({ origin: "http://localhost:4321", data: probe, fromParent: true }, `${b}.localhost:4321`, withPasskey())
        ?.hasPasskey,
    ).toBe(true);
  });

  it("answers no one else", () => {
    const ask = (origin: string, host = `${b}.nido.fyi`, fromParent = true, data: unknown = probe) =>
      answerOwnerProbe({ origin, data, fromParent }, host, withPasskey());
    expect(ask("https://nido.fyi", `${b}.nido.fyi`, false)).toBeNull();
    expect(ask("http://nido.fyi")).toBeNull();
    expect(ask("https://test.nido.fyi")).toBeNull();
    expect(ask(`https://${a}.nido.fyi`)).toBeNull();
    expect(ask("https://evil.example")).toBeNull();
    expect(ask("https://nido.fyi", "alice.nido.fyi")).toBeNull();
    expect(ask("https://nido.fyi", "nido.fyi")).toBeNull();
    expect(ask("https://nido.fyi", `${b}.nido.fyi`, true, { type: "nido:owner:request:v0", id: "p1" })).toBeNull();
  });

  it("the bridge page is the storage bridge on the apex and the probe elsewhere", () => {
    const fromAccount = { origin: `https://${b}.nido.fyi`, data: probe, fromParent: true };
    expect(answerBridgePageMessage(fromAccount, "nido.fyi")).toBeNull();
    const fromApex = { origin: "https://nido.fyi", data: { type: NIDO_STORAGE_REQUEST, id: "r1", snapshot: null }, fromParent: true };
    expect(answerBridgePageMessage(fromApex, `${b}.nido.fyi`)).toBeNull();
  });
});
