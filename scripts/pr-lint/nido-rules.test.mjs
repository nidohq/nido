// node --test scripts/pr-lint/*.test.mjs
// Nido's rules and Nido's real templates, config, and
// docs/SECURITY_INVARIANTS.md, so a template or invariant edit that breaks
// the checker fails here.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkBody, checkCommitBody, loadConfig, loadRules, loadTemplates } from "./core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const config = loadConfig(root);
const ctx = { config, templates: loadTemplates(root), rules: await loadRules(root, config) };
const rules = (findings) => findings.map((f) => f.rule);

// A template with every comment replaced by an answer.
function filled(file) {
  const path = file === "default" ? ".github/pull_request_template.md" : `.github/PULL_REQUEST_TEMPLATE/${file}`;
  return readFileSync(join(root, path), "utf8")
    .replace(/<!--[\s\S]*?-->\n?/g, "")
    .replace(/^(## .+)$/gm, "$1\n\nNone.")
    .replace(/^## Invariants\n\nNone\./m, "## Invariants\n\nF2: `create_account_twice_refused`, Mocked.");
}

test("the re-pin workflow writes a body that passes", () => {
  const wf = readFileSync(join(root, ".github/workflows/perch-repin.yml"), "utf8");
  const block = wf.match(/\n( +)\{\n([\s\S]*?)\n\1\} > "\$body"/)[2];
  const body = [...block.matchAll(/^\s*(?:echo(?: "(.*)")?|cat .*)$/gm)].map((m) => (m[0].trim().startsWith("cat") ? "| a | b |" : m[1] ?? "")).join("\n");
  assert.match(body, /## Hand edits/);
  assert.deepEqual(checkBody(body, ["packages/passkey-sdk/src/perch/deployment.ts"], ctx), []);
});

test("every template, filled in, passes", () => {
  assert.deepEqual(Object.keys(ctx.templates), ["default", "contract.md", "docs.md", "mechanical.md", "stack.md", "wallet.md"]);
  for (const name of Object.keys(ctx.templates)) {
    assert.deepEqual(checkBody(filled(name), [], ctx), [], name);
  }
});

test("an untouched template is flagged for its comments", () => {
  const raw = readFileSync(join(root, ".github/pull_request_template.md"), "utf8");
  assert.ok(rules(checkBody(raw, [], ctx)).includes("body-comments"));
});

test("contract paths need the contract sections", () => {
  assert.ok(rules(checkBody(filled("default"), ["contracts/factory/src/contract.rs"], ctx)).includes("body-contract-sections"));
  assert.deepEqual(checkBody(filled("contract.md"), ["contracts/factory/src/contract.rs"], ctx), []);
  assert.deepEqual(checkBody(filled("default"), ["packages/frontend/src/app.ts"], ctx), []);
  assert.deepEqual(checkBody(filled("mechanical.md"), ["packages/passkey-sdk/src/perch/deployment.ts"], ctx), []);
});

test("invariant IDs must exist, and other citations are left alone", () => {
  const body = filled("contract.md").replace(/F2: /, "F2, W99, spec D7, P256: ");
  const found = checkBody(body, [], ctx).filter((f) => f.rule === "body-invariant-id");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /W99/);
  assert.doesNotMatch(found[0].message, /D7|P256|F2/);
});

test("an Invariants section names an evidence kind", () => {
  assert.ok(rules(checkBody(filled("contract.md").replace(/, Mocked\./, "."), [], ctx)).includes("body-evidence-kind"));
});

test("the Security trailer cites real invariant IDs", () => {
  assert.deepEqual(checkCommitBody("fix", "fix(factory): x", "Why: y.\n\nSecurity: F2, W3", ctx), []);
  assert.deepEqual(checkCommitBody("chore", "chore: x", "Security: none", ctx), []);
  assert.deepEqual(rules(checkCommitBody("chore", "chore: x", "Security: W99", ctx)), ["trailer-security"]);
  assert.deepEqual(rules(checkCommitBody("chore", "chore: x", "Security:", ctx)), ["trailer-security"]);
});
