import { describe, it, expect } from "vitest";
import { handleResolve, type Registry } from "../src/handler.js";

const CONTRACT = "CDRBWQZV7EBKU53FTGWF2OCZE7Z52MFAWCG5CEMTR4HZHIFFX4RZBFMM"; // 56-char strkey
const PATH = "/.well-known/nido.json";

/** Build a Registry stub; resolve/lookup return the given values (or throw). */
function reg(over: Partial<Registry> = {}): Registry {
  return {
    resolve: async () => null,
    lookup: async () => null,
    ...over,
  };
}

function req(host: string, opts: { path?: string; method?: string } = {}): Request {
  return new Request(`https://${host}${opts.path ?? PATH}`, { method: opts.method ?? "GET" });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("nido-resolver handler", () => {
  it("forward: resolves a name subdomain to its address", async () => {
    const res = await handleResolve(req("alice.nido.fyi"), reg({ resolve: async () => CONTRACT }), "testnet");
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ name: "alice", address: CONTRACT, network: "testnet" });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("forward: 404 when the name is unregistered", async () => {
    const res = await handleResolve(req("ghost.nido.fyi"), reg({ resolve: async () => null }), "testnet");
    expect(res.status).toBe(404);
    expect(await body(res)).toEqual({ error: "name not found", name: "ghost", network: "testnet" });
  });

  it("reverse: contract subdomain returns its registered name", async () => {
    const res = await handleResolve(req(`${CONTRACT.toLowerCase()}.nido.fyi`), reg({ lookup: async () => "alice" }), "testnet");
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ name: "alice", address: CONTRACT, network: "testnet" });
  });

  it("reverse: name is null for a contract with no registered name", async () => {
    const res = await handleResolve(req(`${CONTRACT.toLowerCase()}.nido.fyi`), reg({ lookup: async () => null }), "testnet");
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ name: null, address: CONTRACT, network: "testnet" });
  });

  it("tolerates the --<N> preview suffix on a name", async () => {
    let asked = "";
    const res = await handleResolve(req("alice--126.nido.fyi"), reg({ resolve: async (n) => { asked = n; return CONTRACT; } }), "testnet");
    expect(asked).toBe("alice");
    expect(res.status).toBe(200);
    expect((await body(res)).name).toBe("alice");
  });

  it("tolerates the --<N> preview suffix on a contract", async () => {
    let asked = "";
    const res = await handleResolve(req(`${CONTRACT.toLowerCase()}--126.nido.fyi`), reg({ lookup: async (a) => { asked = a; return "alice"; } }), "testnet");
    expect(asked).toBe(CONTRACT);
    expect(res.status).toBe(200);
  });

  it("rejects a reserved dApp subdomain", async () => {
    const res = await handleResolve(req("status-message.nido.fyi"), reg(), "testnet");
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("not a Nido account");
  });

  it("rejects a numeric preview root", async () => {
    const res = await handleResolve(req("126.nido.fyi"), reg(), "testnet");
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("not a Nido account");
  });

  it("rejects a malformed subdomain", async () => {
    const res = await handleResolve(req("not_a_name.nido.fyi"), reg(), "testnet");
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("not a Nido account");
  });

  it("404s a non-well-known path", async () => {
    const res = await handleResolve(req("alice.nido.fyi", { path: "/account/" }), reg({ resolve: async () => CONTRACT }), "testnet");
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("not found");
  });

  it("answers an OPTIONS preflight with CORS", async () => {
    const res = await handleResolve(req("alice.nido.fyi", { method: "OPTIONS" }), reg(), "testnet");
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("405s a non-GET method", async () => {
    const res = await handleResolve(req("alice.nido.fyi", { method: "POST" }), reg(), "testnet");
    expect(res.status).toBe(405);
    expect((await body(res)).error).toBe("method not allowed");
  });

  it("502 when forward resolution throws (RPC down)", async () => {
    const res = await handleResolve(req("alice.nido.fyi"), reg({ resolve: async () => { throw new Error("rpc down"); } }), "testnet");
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await body(res)).error).toBe("resolver upstream unavailable");
  });

  it("502 when reverse lookup throws (RPC down)", async () => {
    const res = await handleResolve(req(`${CONTRACT.toLowerCase()}.nido.fyi`), reg({ lookup: async () => { throw new Error("rpc down"); } }), "testnet");
    expect(res.status).toBe(502);
  });

  it("reflects the configured network", async () => {
    const res = await handleResolve(req("alice.nido.fyi"), reg({ resolve: async () => CONTRACT }), "public");
    expect((await body(res)).network).toBe("public");
  });
});
