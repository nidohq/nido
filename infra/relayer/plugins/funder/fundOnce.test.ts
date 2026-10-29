import { describe, it, expect, vi } from "vitest";
import { fundOnce, fundedKey, type FundKV, type FundOnceDeps, type TopUpLookup } from "./fundOnce";

const DEST = "CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL";
const TOPUP = 50_000_000n;
const T0 = 1_800_000_000;

function memoryKV(): FundKV & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  const held = new Set<string>();
  return {
    store,
    async get<T>(key: string) {
      return (store.has(key) ? structuredClone(store.get(key)) : null) as T | null;
    },
    async set(key, value) {
      store.set(key, structuredClone(value));
      return true;
    },
    async del(key) {
      return store.delete(key);
    },
    async withLock(key, fn, opts) {
      if (held.has(key)) {
        if (opts?.onBusy === "skip") return null;
        throw new Error("lock busy");
      }
      held.add(key);
      try {
        return await fn();
      } finally {
        held.delete(key);
      }
    },
  };
}

// A chain where each top-up gets a fresh hash and the destination's balance
// grows when one lands (`land`).
function fakeChain(opts: { balance?: bigint } = {}) {
  let balance = opts.balance ?? 0n;
  let clock = T0;
  let nextId = 0;
  const lookups = new Map<string, TopUpLookup>();
  const sendOutcome: { next: "accept" | "reject" | "throw" } = { next: "accept" };
  const kv = memoryKV();

  const deps: FundOnceDeps = {
    kv,
    topUpStroops: TOPUP,
    now: () => clock,
    nativeBalance: vi.fn(async () => balance),
    lookupTopUp: vi.fn(async (hash: string) => {
      return (
        lookups.get(hash) ?? {
          status: "NOT_FOUND",
          latestLedgerCloseTime: clock,
          oldestLedgerCloseTime: T0 - 3600,
        }
      );
    }),
    prepareTopUp: vi.fn(async () => {
      const hash = `tx${nextId++}`;
      return {
        hash,
        validUntil: clock + 60,
        async send() {
          if (sendOutcome.next === "throw") throw new Error("socket hang up");
          if (sendOutcome.next === "reject") return { accepted: false as const, reason: "txBadSeq" };
          return { accepted: true as const };
        },
      };
    }),
  };

  return {
    deps,
    kv,
    sendOutcome,
    advance: (sec: number) => (clock += sec),
    land(hash: string) {
      lookups.set(hash, { status: "SUCCESS" });
      balance += TOPUP;
    },
    fail(hash: string) {
      lookups.set(hash, { status: "FAILED" });
    },
    setLookup: (hash: string, lookup: TopUpLookup) => lookups.set(hash, lookup),
  };
}

describe("fundOnce (once-per-destination funding)", () => {
  it("funds a destination once; a retry gets the same top-up back, not a second one", async () => {
    const chain = fakeChain();

    const first = await fundOnce(DEST, chain.deps);
    expect(first).toEqual({ alreadyFunded: false, hash: "tx0", status: "PENDING" });

    // Retried before the first top-up landed (the stuck finish step).
    expect(await fundOnce(DEST, chain.deps)).toEqual({ alreadyFunded: true, hash: "tx0", status: "PENDING" });

    chain.land("tx0");
    // Retried after it landed, even once the account has spent below a top-up.
    expect(await fundOnce(DEST, chain.deps)).toEqual({ alreadyFunded: true, hash: "tx0", status: "SUCCESS" });

    expect(chain.deps.prepareTopUp).toHaveBeenCalledTimes(1);
  });

  it("does not top up a destination whose balance already covers it, and remembers that", async () => {
    const chain = fakeChain({ balance: TOPUP });

    expect(await fundOnce(DEST, chain.deps)).toEqual({ alreadyFunded: true, hash: null, status: "FUNDED" });
    expect(chain.kv.store.get(fundedKey(DEST))).toMatchObject({ hash: null });
    expect(await fundOnce(DEST, chain.deps)).toEqual({ alreadyFunded: true, hash: null, status: "FUNDED" });
    expect(chain.deps.prepareTopUp).not.toHaveBeenCalled();
  });

  it("serializes concurrent requests for one destination", async () => {
    const chain = fakeChain();
    const [a, b] = await Promise.allSettled([fundOnce(DEST, chain.deps), fundOnce(DEST, chain.deps)]);

    expect(a).toMatchObject({ status: "fulfilled", value: { alreadyFunded: false, hash: "tx0" } });
    expect(b).toMatchObject({ status: "rejected" });
    expect((b as PromiseRejectedResult).reason.message).toContain("already in progress");
    expect(chain.deps.prepareTopUp).toHaveBeenCalledTimes(1);
  });

  it("tops up again when the recorded top-up failed on chain", async () => {
    const chain = fakeChain();
    await fundOnce(DEST, chain.deps);
    chain.fail("tx0");

    expect(await fundOnce(DEST, chain.deps)).toEqual({ alreadyFunded: false, hash: "tx1", status: "PENDING" });
  });

  it("tops up again when the recorded top-up's window closed inside the RPC's history without it", async () => {
    const chain = fakeChain();
    await fundOnce(DEST, chain.deps);
    chain.advance(120);
    chain.setLookup("tx0", {
      status: "NOT_FOUND",
      latestLedgerCloseTime: T0 + 120,
      oldestLedgerCloseTime: T0 - 3600,
    });

    expect(await fundOnce(DEST, chain.deps)).toEqual({ alreadyFunded: false, hash: "tx1", status: "PENDING" });
  });

  it("keeps counting the destination funded when the RPC's history no longer reaches the top-up", async () => {
    const chain = fakeChain();
    await fundOnce(DEST, chain.deps);
    chain.advance(30 * 86400);
    chain.setLookup("tx0", {
      status: "NOT_FOUND",
      latestLedgerCloseTime: T0 + 30 * 86400,
      oldestLedgerCloseTime: T0 + 23 * 86400,
    });

    expect(await fundOnce(DEST, chain.deps)).toEqual({ alreadyFunded: true, hash: null, status: "FUNDED" });
    expect(chain.deps.prepareTopUp).toHaveBeenCalledTimes(1);
  });

  it("forgets a top-up the RPC refused, so the next request can fund", async () => {
    const chain = fakeChain();
    chain.sendOutcome.next = "reject";
    await expect(fundOnce(DEST, chain.deps)).rejects.toThrow("Funding transaction failed: txBadSeq");
    expect(chain.kv.store.has(fundedKey(DEST))).toBe(false);

    chain.sendOutcome.next = "accept";
    expect(await fundOnce(DEST, chain.deps)).toEqual({ alreadyFunded: false, hash: "tx1", status: "PENDING" });
  });

  it("keeps a top-up whose submission outcome is unknown, so a retry waits on it", async () => {
    const chain = fakeChain();
    chain.sendOutcome.next = "throw";
    await expect(fundOnce(DEST, chain.deps)).rejects.toThrow("socket hang up");

    chain.sendOutcome.next = "accept";
    expect(await fundOnce(DEST, chain.deps)).toEqual({ alreadyFunded: true, hash: "tx0", status: "PENDING" });
    expect(chain.deps.prepareTopUp).toHaveBeenCalledTimes(1);
  });
});
