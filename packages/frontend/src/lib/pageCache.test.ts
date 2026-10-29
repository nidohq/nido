import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nidoKey } from "@nidohq/passkey-sdk";
import {
  FRESH_MS,
  MAX_AGE_MS,
  cachedRead,
  clearPageCache,
  readPageCache,
  writePageCache,
} from "./pageCache";

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.useRealTimers());

const T0 = 1_700_000_000_000;

// A page view: what one widget does on load — render whatever it is handed and
// record every network fetch it had to make.
function pageView(key: string, value: unknown) {
  const renders: unknown[] = [];
  const load = vi.fn(async () => value);
  const done = cachedRead(key, load, (v) => renders.push(v));
  return { renders, load, done };
}

describe("cachedRead across page switches (#346)", () => {
  it("a page switch within the fresh window renders at once and makes no fetch", async () => {
    vi.useFakeTimers({ now: T0 });
    const first = pageView("balance:xlm:CA", "12.5000000");
    expect(first.renders).toEqual([]); // cold: skeleton until the fetch lands
    await first.done;
    expect(first.load).toHaveBeenCalledTimes(1);

    vi.setSystemTime(T0 + FRESH_MS - 1); // navigate away and straight back
    const second = pageView("balance:xlm:CA", "99.0000000");
    expect(second.renders).toEqual(["12.5000000"]); // synchronous: no loading state
    await second.done;
    expect(second.load).not.toHaveBeenCalled();
    expect(second.renders).toEqual(["12.5000000"]);
  });

  it("a stale entry renders at once, then refreshes quietly in the background", async () => {
    vi.useFakeTimers({ now: T0 });
    writePageCache("assets:CA", ["old"]);
    vi.setSystemTime(T0 + FRESH_MS + 1);
    const view = pageView("assets:CA", ["new"]);
    expect(view.renders).toEqual([["old"]]);
    await view.done;
    expect(view.load).toHaveBeenCalledTimes(1);
    expect(view.renders).toEqual([["old"], ["new"]]);
    expect(readPageCache("assets:CA")?.value).toEqual(["new"]);
  });

  it("an entry past the max age is ignored: skeleton and a fresh load", async () => {
    vi.useFakeTimers({ now: T0 });
    writePageCache("assets:CA", ["ancient"]);
    vi.setSystemTime(T0 + MAX_AGE_MS + 1);
    const view = pageView("assets:CA", ["new"]);
    expect(view.renders).toEqual([]);
    await view.done;
    expect(view.renders).toEqual([["new"]]);
  });

  it("a failed background refresh keeps the cached render; a cold failure rejects", async () => {
    vi.useFakeTimers({ now: T0 });
    writePageCache("activity:full:CA", { items: [1] });
    vi.setSystemTime(T0 + FRESH_MS + 1);
    const renders: unknown[] = [];
    const fail = () => Promise.reject(new Error("rpc down"));
    await expect(cachedRead("activity:full:CA", fail, (v) => renders.push(v))).resolves.toBeUndefined();
    expect(renders).toEqual([{ items: [1] }]);

    await expect(cachedRead("activity:full:CB", fail, () => {})).rejects.toThrow("rpc down");
  });

  it("two widgets reading one key on a page share one fetch", async () => {
    let resolve!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const a: string[] = [];
    const b: string[] = [];
    const pa = cachedRead("balance:xlm:CA", load, (v) => a.push(v));
    const pb = cachedRead("balance:xlm:CA", load, (v) => b.push(v));
    resolve("1.0000000");
    await Promise.all([pa, pb]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toEqual(["1.0000000"]);
    expect(b).toEqual(["1.0000000"]);
  });
});

describe("pageCache storage", () => {
  it("round-trips bigint balances", () => {
    writePageCache("assets:CA", [{ raw: 123456789012345678901234567890n, code: "USDC" }]);
    expect(readPageCache("assets:CA")?.value).toEqual([{ raw: 123456789012345678901234567890n, code: "USDC" }]);
  });

  it("clearPageCache drops cached reads and nothing else", () => {
    writePageCache("balance:xlm:CA", "1");
    writePageCache("assets:CA", []);
    sessionStorage.setItem("nido:name:joe", "{}");
    sessionStorage.setItem(nidoKey("sign:req:1"), "{}");
    clearPageCache();
    expect(readPageCache("balance:xlm:CA")).toBeNull();
    expect(readPageCache("assets:CA")).toBeNull();
    expect(sessionStorage.getItem("nido:name:joe")).toBe("{}");
    expect(sessionStorage.getItem(nidoKey("sign:req:1"))).toBe("{}");
  });

  it("keys live under the network namespace", () => {
    writePageCache("balance:xlm:CA", "1");
    expect(sessionStorage.getItem(nidoKey("cache:balance:xlm:CA"))).not.toBeNull();
  });
});
