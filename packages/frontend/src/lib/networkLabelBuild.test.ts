// @vitest-environment node
// What a user sees on each network's build: onboarding (/new-account/) and
// the account page they land on afterwards label the network the build
// targets, and only a testnet build calls itself a no-real-funds demo. The
// pages are built for real with PUBLIC_STELLAR_NETWORK set, as
// deploy-production.yml and deploy-testnet.yml build them, and the emitted
// HTML is what's checked. The same builds back the installed-app checks:
// every page links a valid web app manifest and home-screen icons, and the
// app's name says which network it is.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
  { network: "mainnet", label: "Mainnet", other: "Testnet", appName: "Nido" },
  { network: "testnet", label: "Testnet", other: "Mainnet", appName: "Nido Testnet" },
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

/** Every emitted page except the storage bridge, which is only ever framed
 *  (never installed) and whose CSP is default-src 'none'. */
function installablePages(network: string): string[] {
  return readdirSync(outDirs.get(network)!, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".html") && !f.startsWith("nido-storage-bridge"));
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(network: string, src: string): string {
  const png = readFileSync(join(outDirs.get(network)!, src));
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}

const chips = (doc: Document) => Array.from(doc.querySelectorAll(".chip"), (c) => c.textContent!.trim());

describe.each(NETWORKS)("a $network build", ({ network, label, other, appName }) => {
  it.each(["new-account", "account"])("labels /%s/ with its own network", (path) => {
    const shown = chips(page(network, path));
    expect(shown).toContain(label);
    expect(shown).not.toContain(other);
  });

  it("links the manifest and home-screen icons from every page", () => {
    const pages = installablePages(network);
    expect(pages).toContain("account/index.html");
    for (const file of pages) {
      const doc = new JSDOM(readFileSync(join(outDirs.get(network)!, file), "utf8")).window.document;
      const attr = (selector: string, name: string) => [file, doc.querySelector(selector)?.getAttribute(name)];
      expect(attr('link[rel="manifest"]', "href")).toEqual([file, "/manifest.webmanifest"]);
      expect(attr('link[rel="apple-touch-icon"]', "href")).toEqual([file, "/apple-touch-icon.png"]);
      expect(attr('meta[name="apple-mobile-web-app-title"]', "content")).toEqual([file, appName]);
      expect(attr('meta[name="apple-mobile-web-app-capable"]', "content")).toEqual([file, "yes"]);
      expect(attr('meta[name="theme-color"]', "content")).toEqual([file, "#FFF8F0"]);
    }
    expect(pngSize(network, "apple-touch-icon.png")).toBe("180x180");
  });

  it("ships an installable manifest that opens the origin it was installed from", () => {
    const manifest = JSON.parse(readFileSync(join(outDirs.get(network)!, "manifest.webmanifest"), "utf8"));
    expect(manifest).toMatchObject({
      name: appName,
      short_name: appName,
      // Origin-relative: each account subdomain installs as its own app.
      start_url: "/",
      scope: "/",
      display: "standalone",
      theme_color: "#FFF8F0",
      background_color: "#FFF8F0",
    });
    expect(manifest.id).toBeUndefined();
    for (const icon of manifest.icons) {
      expect(icon.src).toMatch(/^\/[^/]/);
      expect(icon.type).toBe("image/png");
      expect(pngSize(network, icon.src)).toBe(icon.sizes);
    }
    const sizes = (purpose: string) => manifest.icons.filter((i: { purpose: string }) => i.purpose === purpose).map((i: { sizes: string }) => i.sizes);
    expect(sizes("any")).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(sizes("maskable")).toContain("512x512");
  });

  it(network === "testnet" ? "calls the landing page a demo with no real funds" : "never calls itself a demo with no real funds", () => {
    expect(page(network, "").body.textContent!.includes("no real funds")).toBe(network === "testnet");
  });
});
