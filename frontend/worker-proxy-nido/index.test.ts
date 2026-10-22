import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index.js";

const here = (path: string) => new URL(path, import.meta.url);

/** The `KEY = "value"` lines of one wrangler.toml table. */
function tomlVars(table: string): Record<string, string> {
  const toml = readFileSync(here("./wrangler.toml"), "utf8");
  const start = toml.indexOf(`\n[${table}]\n`);
  if (start < 0) throw new Error(`no [${table}] in wrangler.toml`);
  const body = toml.slice(start + table.length + 4).split(/\n\[/)[0];
  return Object.fromEntries(
    [...body.matchAll(/^([A-Z_]+) = "([^"]*)"$/gm)].map((m) => [m[1], m[2]]),
  );
}

/** The value of one header rule in packages/frontend/public/_headers. */
function staticHeader(path: string, name: string): string {
  const lines = readFileSync(here("../../packages/frontend/public/_headers"), "utf8").split("\n");
  const rule = lines.indexOf(path);
  const line = lines.slice(rule + 1).find((l) => l.trim().startsWith(`${name}:`));
  if (rule < 0 || !line) throw new Error(`no ${name} for ${path} in _headers`);
  return line.trim().slice(name.length + 1).trim();
}

async function proxied(host: string, path: string, env: Record<string, string>) {
  const upstream = vi.fn(async (_url: string) => new Response("ok", { status: 200 }));
  vi.stubGlobal("fetch", upstream);
  const res: Response = await worker.fetch(new Request(`https://${host}${path}`), env);
  return { res, upstreamUrl: upstream.mock.calls[0][0] };
}

afterEach(() => vi.unstubAllGlobals());

describe("nido-proxy", () => {
  const production = tomlVars("vars");

  it("production serves the same CSP as the static origin", async () => {
    const { res } = await proxied("alice.nido.fyi", "/account/", production);
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toBe(
      staticHeader("/*", "Content-Security-Policy-Report-Only"),
    );
  });

  it("production serves the same storage-bridge policy as the static origin", async () => {
    const { res } = await proxied("alice.nido.fyi", "/nido-storage-bridge/", production);
    expect(res.headers.get("Content-Security-Policy")).toBe(
      staticHeader("/nido-storage-bridge/", "Content-Security-Policy"),
    );
  });

  it("routes previews and production to the configured Pages project", async () => {
    expect((await proxied("cabc--24.nido.fyi", "/", production)).upstreamUrl).toBe(
      "https://pr-24.nido-1am.pages.dev/",
    );
    expect((await proxied("24.test.nido.fyi", "/x", production)).upstreamUrl).toBe(
      "https://pr-24.nido-1am.pages.dev/x",
    );
    expect((await proxied("status-message.test.nido.fyi", "/", production)).upstreamUrl).toBe(
      "https://nido-1am.pages.dev/status-message/",
    );
  });

  it("the testnet environment sets every var the worker reads", () => {
    const testnet = tomlVars("env.testnet.vars");
    expect(Object.keys(testnet).sort()).toEqual(Object.keys(production).sort());
  });
});
