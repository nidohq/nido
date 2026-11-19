// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";

// The migration runs on a mainnet build here, so the storage network is set
// to mainnet before anything builds a key (the shared test setup sets testnet).
let migrateAccountList: typeof import("./accountMigration").migrateAccountList;
beforeAll(async () => {
  vi.resetModules();
  (await import("@nidohq/passkey-sdk/storage")).setStorageNetwork("mainnet");
  ({ migrateAccountList } = await import("./accountMigration"));
});

const MAIN = StrKey.encodeContract(Buffer.alloc(32, 1)); // mainnet, passkey held here
const VISITED = StrKey.encodeContract(Buffer.alloc(32, 2)); // mainnet, no passkey here
const TESTNET = StrKey.encodeContract(Buffer.alloc(32, 3)); // passkey held, not on mainnet
const SLOW = StrKey.encodeContract(Buffer.alloc(32, 4)); // its origin never answers

class MemoryStore {
  values = new Map<string, string>();
  constructor(initial: Record<string, unknown> = {}) {
    for (const [k, v] of Object.entries(initial)) this.values.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  getItem(k: string) {
    return this.values.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.values.set(k, v);
  }
  removeItem(k: string) {
    this.values.delete(k);
  }
  snapshot() {
    return Object.fromEntries(this.values);
  }
}

/** Passkey records this browser holds, and what mainnet has deployed. */
function world(store: MemoryStore, owned: string[], onMainnet: string[], silent: string[] = []) {
  const probes: string[] = [];
  const chainReads: string[] = [];
  return {
    probes,
    chainReads,
    deps: {
      network: "mainnet" as const,
      store,
      hasPasskey: async (c: string) => {
        probes.push(c);
        return silent.includes(c) ? null : owned.includes(c);
      },
      deployedHere: async (c: string) => {
        chainReads.push(c);
        return onMainnet.includes(c);
      },
    },
  };
}

describe("the sign-in list's one-time migration (mainnet build)", () => {
  it("keeps a mainnet entry this browser holds a passkey for", async () => {
    const store = new MemoryStore({ "nido:testnet:accounts": [MAIN], [`nido:testnet:names:${MAIN}`]: "alice" });
    const { deps } = world(store, [MAIN], [MAIN]);
    const result = await migrateAccountList(deps);
    expect(result).toEqual({ ran: true, kept: [MAIN], dropped: [], undecided: [] });
    expect(JSON.parse(store.getItem("nido:mainnet:accounts")!)).toEqual([MAIN]);
    expect(store.getItem("nido:mainnet:names:" + MAIN)).toBe("alice");
  });

  it("drops an entry this browser holds no passkey record for", async () => {
    const store = new MemoryStore({ "nido:testnet:accounts": [MAIN, VISITED], "nido:mainnet:accounts": [VISITED] });
    const { deps } = world(store, [MAIN], [MAIN, VISITED]);
    const result = await migrateAccountList(deps);
    expect(result.kept).toEqual([MAIN]);
    expect(result.dropped).toEqual([VISITED]);
    expect(JSON.parse(store.getItem("nido:mainnet:accounts")!)).toEqual([MAIN]);
  });

  it("drops an address the stored data doesn't place on mainnet and the chain doesn't either", async () => {
    const store = new MemoryStore({ "nido:testnet:accounts": [TESTNET, MAIN] });
    const { deps, chainReads } = world(store, [TESTNET, MAIN], [MAIN]);
    const result = await migrateAccountList(deps);
    expect(result.kept).toEqual([MAIN]);
    expect(result.dropped).toEqual([TESTNET]);
    expect(chainReads.sort()).toEqual([MAIN, TESTNET].sort());
  });

  it("asks the chain only about entries whose network the store doesn't say", async () => {
    const store = new MemoryStore({ "nido:mainnet:accounts": [MAIN] });
    const { deps, chainReads } = world(store, [MAIN], []);
    expect((await migrateAccountList(deps)).kept).toEqual([MAIN]);
    expect(chainReads).toEqual([]);
  });

  it("removes the mistaken testnet-namespace list and its setup entries once done", async () => {
    const store = new MemoryStore({
      "nido:testnet:accounts": [MAIN],
      "nido:testnet:pending": [{ contractId: SLOW, setupKey: "secret" }],
      "nido:testnet:pending:ts": { [SLOW]: 1 },
      [`passkey:${MAIN}:credentialId`]: "cred",
    });
    const { deps } = world(store, [MAIN], [MAIN]);
    await migrateAccountList(deps);
    for (const key of ["accounts", "pending", "pending:ts"]) expect(store.getItem(`nido:testnet:${key}`)).toBeNull();
    // No passkey record is touched.
    expect(store.getItem(`passkey:${MAIN}:credentialId`)).toBe("cred");
    expect(store.getItem("nido:mainnet:accounts:migrated:v1")).not.toBeNull();
  });

  it("is a no-op on a second run", async () => {
    const store = new MemoryStore({ "nido:testnet:accounts": [MAIN, VISITED] });
    await migrateAccountList(world(store, [MAIN], [MAIN, VISITED]).deps);
    const after = store.snapshot();

    // Even an entry written since, which the rule would drop, is left alone.
    store.setItem("nido:mainnet:accounts", JSON.stringify([MAIN, VISITED]));
    const again = world(store, [MAIN], [MAIN, VISITED]);
    expect(await migrateAccountList(again.deps)).toEqual({ ran: false, kept: [], dropped: [], undecided: [] });
    expect(again.probes).toEqual([]);
    expect(store.snapshot()).toEqual({ ...after, "nido:mainnet:accounts": JSON.stringify([MAIN, VISITED]) });
  });

  it("leaves an entry it couldn't check for the next run, and doesn't finish", async () => {
    const store = new MemoryStore({ "nido:testnet:accounts": [MAIN, SLOW, VISITED] });
    const first = await migrateAccountList(world(store, [MAIN], [MAIN, SLOW], [SLOW]).deps);
    expect(first).toEqual({ ran: true, kept: [MAIN], dropped: [VISITED], undecided: [SLOW] });
    expect(JSON.parse(store.getItem("nido:mainnet:accounts")!)).toEqual([MAIN]);
    // The legacy list survives until every entry is decided.
    expect(JSON.parse(store.getItem("nido:testnet:accounts")!)).toEqual([MAIN, SLOW, VISITED]);
    expect(store.getItem("nido:mainnet:accounts:migrated:v1")).toBeNull();

    const second = await migrateAccountList(world(store, [MAIN, SLOW], [MAIN, SLOW]).deps);
    expect(second.kept.sort()).toEqual([MAIN, SLOW].sort());
    expect(second.dropped).toEqual([VISITED]);
    expect(JSON.parse(store.getItem("nido:mainnet:accounts")!)).toEqual([MAIN, SLOW]);
    expect(store.getItem("nido:testnet:accounts")).toBeNull();
  });

  it("keeps an account the storage bridge lists while the probes are in flight", async () => {
    const ADDED = StrKey.encodeContract(Buffer.alloc(32, 5));
    const store = new MemoryStore({ "nido:testnet:accounts": [MAIN], "nido:mainnet:accounts": [VISITED] });
    const { deps } = world(store, [MAIN], [MAIN, VISITED]);
    const result = await migrateAccountList({
      ...deps,
      hasPasskey: async (c) => {
        // Another tab's account page hands its account to the apex meanwhile.
        if (c === VISITED) store.setItem("nido:mainnet:accounts", JSON.stringify([VISITED, ADDED]));
        return deps.hasPasskey(c);
      },
    });
    expect(result).toEqual({ ran: true, kept: [MAIN], dropped: [VISITED], undecided: [] });
    expect(JSON.parse(store.getItem("nido:mainnet:accounts")!)).toEqual([ADDED, MAIN]);
    expect(store.getItem("nido:mainnet:accounts:migrated:v1")).not.toBeNull();
  });

  it("treats a failed probe or chain read as undecided, never as a drop", async () => {
    const store = new MemoryStore({ "nido:testnet:accounts": [MAIN] });
    const result = await migrateAccountList({
      network: "mainnet",
      store,
      hasPasskey: async () => true,
      deployedHere: async () => {
        throw new Error("rpc down");
      },
    });
    expect(result).toEqual({ ran: true, kept: [], dropped: [], undecided: [MAIN] });
    expect(JSON.parse(store.getItem("nido:testnet:accounts")!)).toEqual([MAIN]);
  });
});
