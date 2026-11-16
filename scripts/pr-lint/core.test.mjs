// node --test scripts/pr-lint/*.test.mjs
// The repository-agnostic rules, against inline templates and config, so the
// tests travel with core.mjs. nido-rules.test.mjs covers this repository's
// templates and rules.

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkBody, checkCommitBody, checkHeader } from "./core.mjs";

const config = {
  types: ["feat", "fix", "docs", "chore"],
  scopes: ["app", "lib"],
  headerMaxLength: 72,
  whyTypes: ["feat", "fix"],
};
const templates = {
  default: ["Why", "What changes", "Evidence"],
  "docs.md": ["Why", "Reader and purpose"],
  "big.md": ["Why", "What changes", "Evidence", "Risk", "Rollback"],
};
const ctx = { config, templates, rules: {} };
const rules = (findings) => findings.map((f) => f.rule);
const body = (...headings) => headings.map((h) => `## ${h}\n\nNone.\n`).join("\n");
const ok = body("Why", "What changes", "Evidence");

test("a filled-in template passes", () => {
  assert.deepEqual(checkBody(ok, [], ctx), []);
  assert.deepEqual(checkBody(body("Why", "Reader and purpose"), [], ctx), []);
});

test("leftover comments and an empty body are flagged", () => {
  assert.deepEqual(rules(checkBody(`${ok}\n<!-- delete me -->\n`, [], ctx)), ["body-comments"]);
  assert.deepEqual(rules(checkBody("  \n", [], ctx)), ["body-empty"]);
  assert.deepEqual(checkBody(`${ok}\nWe flag a leftover \`<!--\` comment.\n\n\`\`\`\n<!-- x -->\n\`\`\`\n`, [], ctx), []);
});

test("process headings are flagged", () => {
  for (const h of ["## Intent", "## Pipeline", "### Review follow-ups (Oct 8)", "## Round 2", "## Notes 2026-10-08"]) {
    assert.ok(rules(checkBody(`${ok}\n${h}\n\ntext\n`, [], ctx)).includes("body-process-heading"), h);
  }
  assert.ok(!rules(checkBody(`${ok}\n### Review order\n`, [], ctx)).includes("body-process-heading"));
});

test("headings inside code fences are not sections", () => {
  assert.deepEqual(checkBody(`${ok}\n\`\`\`\n## Intent\n\`\`\`\n`, [], ctx), [{ rule: "body-process-heading", message: '"## Intent" records process, not the change. Move it to a PR comment; the body becomes history.' }]);
  assert.ok(!rules(checkBody(`${ok}\n\`\`\`\n## Rollback\n\`\`\`\n`, [], ctx)).includes("body-missing-section"));
});

test("missing and empty sections are flagged", () => {
  const found = rules(checkBody("## Why\n\nBecause.\n\n## What changes\n\n<!-- x -->\n", [], ctx));
  assert.ok(found.includes("body-missing-section"));
  assert.ok(found.includes("body-empty-section"));
});

test("the template is recognised from its headings", () => {
  const msg = (b) => checkBody(b, [], ctx).find((f) => f.rule === "body-missing-section").message;
  assert.match(msg(body("Why", "What changes", "Evidence", "Risk")), /big\.md/);
  assert.match(msg("Fixes the relayer.\n"), /the default template/);
});

test("repository rules receive the sections and files", () => {
  let seen;
  const withRules = { ...ctx, rules: { body: (view) => ((seen = view), [{ rule: "repo", message: "x" }]) } };
  assert.deepEqual(rules(checkBody(ok, ["a.rs"], withRules)), ["repo"]);
  assert.deepEqual(seen.files, ["a.rs"]);
  assert.equal(seen.byName.get("why").heading, "Why");
  assert.equal(seen.template, "default");
});

test("titles", () => {
  assert.deepEqual(checkHeader("fix(app): refuse a second setup key", config), []);
  assert.deepEqual(checkHeader("feat(app,lib)!: sign in on a new device", config), []);
  assert.deepEqual(rules(checkHeader("Feat/the printer - 3", config)), ["header-format"]);
  assert.deepEqual(rules(checkHeader("feat(wallet): x", config)), ["scope-enum"]);
  assert.deepEqual(rules(checkHeader("perf: x", config)), ["type-enum"]);
  assert.deepEqual(rules(checkHeader("fix: Fund each account once.", config)), ["subject-case", "subject-full-stop"]);
  assert.deepEqual(rules(checkHeader("fix: WebAuthn verifier pin", config)), []);
  assert.ok(rules(checkHeader(`fix: ${"x".repeat(80)}`, config)).includes("header-max-length"));
  assert.ok(rules(checkHeader("feat: mainnet switchover DO NOT MERGE", config)).includes("header-wip"));
});

test("commit bodies", () => {
  assert.deepEqual(checkCommitBody("fix", "fix(app): x", "Why: y.\n\nRefs: #12", ctx), []);
  assert.deepEqual(rules(checkCommitBody("fix", "fix: x", "", ctx)), ["body-why"]);
  assert.deepEqual(checkCommitBody("chore", "chore: x", "", ctx), []);
  assert.deepEqual(rules(checkCommitBody("feat", "feat!: x", "Why: y", ctx)), ["trailer-breaking"]);
  assert.deepEqual(rules(checkCommitBody("feat", "feat: x", "Why: y\n\nBreaking-Change: z", ctx)), ["trailer-breaking"]);
  assert.deepEqual(checkCommitBody("feat", "feat!: x", "Why: y\n\nBREAKING-CHANGE: z", ctx), []);
  assert.deepEqual(rules(checkCommitBody("chore", "chore: x", "## Intent\nCreate draft PRs", ctx)), ["body-process-heading"]);
});
