// @vitest-environment node
// What a user sees on each network's build: onboarding (/new-account/) and
// the account page they land on afterwards label the network the build
// targets, and only a testnet build calls itself a no-real-funds demo. The
// pages are built for real with PUBLIC_STELLAR_NETWORK set, as
// deploy-production.yml and deploy-testnet.yml build them, and the emitted
// HTML is what's checked.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const FRONTEND = fileURLToPath(new URL("../../", import.meta.url));
const ASTRO_PKG = createRequire(import.meta.url).resolve("astro/package.json");
const ASTRO_BIN = join(dirname(ASTRO_PKG), JSON.parse(readFileSync(ASTRO_PKG, "utf8")).bin.astro);

const NETWORKS = [
  { network: "mainnet", label: "Mainnet", other: "Testnet" },
  { network: "testnet", label: "Testnet", other: "Mainnet" },
] as const;

const outDirs = new Map<string, string>();

beforeAll(() => {
  for (const { network } of NETWORKS) {
    const outDir = mkdtempSync(join(tmpdir(), `nido-${network}-`));
    execFileSync(process.execPath, [ASTRO_BIN, "build", "--outDir", outDir], {
      cwd: FRONTEND,
      env: { ...process.env, PUBLIC_STELLAR_NETWORK: network },
      stdio: "pipe",
    });
    outDirs.set(network, outDir);
  }
}, 180_000);

afterAll(() => {
  for (const dir of outDirs.values()) rmSync(dir, { recursive: true, force: true });
});

function page(network: string, path: string): Document {
  return new JSDOM(readFileSync(join(outDirs.get(network)!, path, "index.html"), "utf8")).window.document;
}

const chips = (doc: Document) => Array.from(doc.querySelectorAll(".chip"), (c) => c.textContent!.trim());

describe.each(NETWORKS)("a $network build", ({ network, label, other }) => {
  it.each(["new-account", "account"])("labels /%s/ with its own network", (path) => {
    const shown = chips(page(network, path));
    expect(shown).toContain(label);
    expect(shown).not.toContain(other);
  });

  it(network === "testnet" ? "calls the landing page a demo with no real funds" : "never calls itself a demo with no real funds", () => {
    expect(page(network, "").body.textContent!.includes("no real funds")).toBe(network === "testnet");
  });
});
