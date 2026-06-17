import { describe, it, expect, beforeEach } from "vitest";
import { handleRelay, type RelayEnv } from "../src/handler.js";

const FRIEND1 = "C" + "A".repeat(55);
const FRIEND2 = "C" + "B".repeat(55);

function fakeKV() {
  const store = new Map<string, string>();
  return {
    async get(key: string) { return store.has(key) ? store.get(key)! : null; },
    async put(key: string, value: string) { store.set(key, value); },
    async delete(key: string) { store.delete(key); },
    async list({ prefix }: { prefix?: string } = {}) {
      const keys = [...store.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cursor: "" };
    },
    _store: store,
  };
}
function env(): RelayEnv { return { RECOVERY_SIGS: fakeKV() as unknown as RelayEnv["RECOVERY_SIGS"] }; }
function req(method: string, url: string, body?: string) {
  return new Request(`https://relay.nido.fyi${url}`, { method, body });
}

describe("recovery-relay handler", () => {
  let e: RelayEnv;
  beforeEach(() => { e = env(); });

  it("stores then lists a signature for a bucket", async () => {
    const put = await handleRelay(req("PUT", `/sig/${FRIEND1}?bucket=KEYABC0000000000`, "blob1"), e);
    expect(put.status).toBe(204);
    const get = await handleRelay(req("GET", "/sig?bucket=KEYABC0000000000"), e);
    expect(get.status).toBe(200);
    const json = (await get.json()) as { signed: { friend: string; blob: string }[] };
    expect(json.signed).toEqual([{ friend: FRIEND1, blob: "blob1" }]);
  });
  it("isolates buckets", async () => {
    await handleRelay(req("PUT", `/sig/${FRIEND1}?bucket=KEYAAAAAAAAAAAAA`, "blobA"), e);
    const get = await handleRelay(req("GET", "/sig?bucket=KEYBBBBBBBBBBBBB"), e);
    const json = (await get.json()) as { signed: unknown[] };
    expect(json.signed).toEqual([]);
  });
  it("rejects a PUT with no bucket", async () => {
    const put = await handleRelay(req("PUT", `/sig/${FRIEND1}`, "blob"), e);
    expect(put.status).toBe(400);
  });
  it("rejects an oversized blob", async () => {
    const big = "x".repeat(64 * 1024 + 1);
    const put = await handleRelay(req("PUT", `/sig/${FRIEND1}?bucket=KEYABC0000000000`, big), e);
    expect(put.status).toBe(413);
  });
  it("answers health on /", async () => {
    const res = await handleRelay(req("GET", "/"), e);
    expect(res.status).toBe(200);
  });
  it("sets permissive CORS headers", async () => {
    const res = await handleRelay(req("GET", "/sig?bucket=KEYABC0000000000"), e);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
  it("answers OPTIONS preflight with 204", async () => {
    const res = await handleRelay(req("OPTIONS", "/sig?bucket=KEYABC0000000000"), e);
    expect(res.status).toBe(204);
  });
  it("rejects an invalid friend address", async () => {
    const put = await handleRelay(req("PUT", "/sig/CFRIEND?bucket=KEYABC0000000000", "blob"), e);
    expect(put.status).toBe(400);
  });
  it("lists multiple signatures in one bucket", async () => {
    await handleRelay(req("PUT", `/sig/${FRIEND1}?bucket=KEYABC0000000000`, "blob1"), e);
    await handleRelay(req("PUT", `/sig/${FRIEND2}?bucket=KEYABC0000000000`, "blob2"), e);
    const get = await handleRelay(req("GET", "/sig?bucket=KEYABC0000000000"), e);
    const json = (await get.json()) as { signed: { friend: string; blob: string }[] };
    expect(json.signed).toHaveLength(2);
    const friends = json.signed.map((s) => s.friend);
    expect(friends).toContain(FRIEND1);
    expect(friends).toContain(FRIEND2);
  });
  it("returns 404 for an unknown path", async () => {
    const res = await handleRelay(req("GET", "/nope"), e);
    expect(res.status).toBe(404);
  });
});
