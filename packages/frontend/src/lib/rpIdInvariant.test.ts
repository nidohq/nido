// @vitest-environment node
// Every WebAuthn credential is bound to the page's own hostname: the account
// subdomain (`<c-address>.nido.fyi`, `<c-address>.test.nido.fyi`, previews
// `<c-address>--<N>.<apex>`). Never to an apex: a credential with rpId
// `nido.fyi` would be usable from every testnet and preview origin, and the
// on-chain verifier checks neither rpId nor origin. This scans every rpId the
// wallet, the SDK and the example dApp pass to WebAuthn and requires each to
// be `window.location.hostname`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const ROOTS = [
  "packages/frontend/src",
  "packages/passkey-sdk/src",
  "packages/stellar-wallets-kit-module/src",
  "examples/status-message-dapp/src",
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "node_modules" ? [] : sources(path);
    return /\.(ts|js|astro)$/.test(entry) && !/\.test\.ts$/.test(entry) ? [path] : [];
  });
}

const EXPR = String.raw`([A-Za-z_$][\w$.]*|["'\x60][^"'\x60]*["'\x60])`;

/** `text` without comments, which describe rpIds in prose ("rpId = its subdomain"). */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

/** Every expression a file passes as an rpId: `rpId: X` / `rpId = X` and `rp: { id: X }`. */
function rpIdExpressions(source: string): string[] {
  const text = code(source);
  const exprs: string[] = [];
  for (const m of text.matchAll(new RegExp(String.raw`\brpId\s*[:=]\s*` + EXPR, "g"))) {
    if (m[1] !== "string") exprs.push(m[1]); // skip `rpId: string` annotations
  }
  // One level of nested braces, for `${...}` in the relying party's name.
  for (const m of text.matchAll(/\brp:\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
    const id = m[1].match(new RegExp(String.raw`\bid:\s*` + EXPR));
    if (id) exprs.push(id[1]);
  }
  return exprs;
}

/** Whether `expr`, in `file`, is the page hostname. */
function isPageHostname(expr: string, text: string, file: string): boolean {
  const hostnameVar = /\bconst hostname = window\.location\.hostname;/.test(text);
  switch (expr) {
    case "window.location.hostname":
      return true;
    case "hostname":
      return hostnameVar;
    case "rpId":
      return hostnameVar && /\bconst rpId = hostname;/.test(text);
    case "opts.rpId":
      // createSessionPasskey's parameter: its callers are scanned as `rpId: X`.
      return file === "packages/passkey-sdk/src/sessionKey.ts";
    default:
      return false;
  }
}

const sites = ROOTS.flatMap((root) =>
  sources(join(REPO, root)).flatMap((path) => {
    const text = readFileSync(path, "utf8");
    const file = relative(REPO, path);
    return rpIdExpressions(text).map((expr) => ({ file, expr, ok: isPageHostname(expr, text, file) }));
  }),
);

describe("WebAuthn rpId", () => {
  it("is the page hostname everywhere", () => {
    expect(sites.filter((s) => !s.ok)).toEqual([]);
  });

  it("is never a literal host", () => {
    expect(sites.filter((s) => /^["'`]/.test(s.expr))).toEqual([]);
  });

  it("finds the registration and signing ceremonies", () => {
    const files = new Set(sites.map((s) => s.file));
    for (const file of [
      "packages/frontend/src/pages/new-account/index.astro",
      "packages/frontend/src/pages/account/index.astro",
      "packages/frontend/src/lib/walletSign.ts",
      "packages/frontend/src/lib/primaryPasskeySigner.ts",
      "packages/frontend/src/lib/recovery/recoverPage.ts",
      "packages/frontend/src/lib/delegationHandover.ts",
      "packages/frontend/src/components/PolicyBuilder.ts",
      "packages/passkey-sdk/src/sessionKey.ts",
    ]) {
      expect(files, file).toContain(file);
    }
  });
});
