#!/usr/bin/env node
// Checks a PR's title and description against CONTRIBUTING.md "Pull requests
// and commits". Run by .github/workflows/pr-description.yml; the rules are in
// core.mjs plus the repository's own module (.github/pr-checks.json "rules").
//
// CI passes the PR through the environment: PR_TITLE, PR_BODY, PR_DRAFT
// ("true"/"false"), and BASE_SHA/HEAD_SHA for the changed-file list. Locally:
//   node scripts/pr-lint/check-pr.mjs --title "fix(factory): ..." --body-file body.md [--base main]
//
// Findings print as GitHub annotations and a step summary. They fail the
// check only when .github/pr-checks.json sets "blocking": true and the PR is
// ready for review; otherwise the check passes with warnings.

import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { checkBody, checkHeader, loadConfig, loadRules, loadTemplates } from "./core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const { values: args } = parseArgs({
  options: { title: { type: "string" }, "body-file": { type: "string" }, base: { type: "string" } },
});

const title = args.title ?? process.env.PR_TITLE ?? "";
const body = args["body-file"] ? readFileSync(args["body-file"], "utf8") : (process.env.PR_BODY ?? "");
const draft = process.env.PR_DRAFT === "true";
const base = args.base ?? process.env.BASE_SHA;
const head = process.env.HEAD_SHA ?? "HEAD";

let files = [];
if (base) {
  const out = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], { cwd: root, encoding: "utf8" });
  files = out.split("\n").filter(Boolean);
}

const config = loadConfig(root);
const ctx = { config, templates: loadTemplates(root), rules: await loadRules(root, config) };
const findings = [...checkHeader(title, config), ...checkBody(body, files, ctx)];

const fail = config.blocking && !draft && findings.length > 0;
const level = config.blocking ? "error" : "warning";
for (const f of findings) {
  console.log(`::${level} title=PR ${f.rule}::${f.message.replace(/%/g, "%25").replace(/\r?\n/g, "%0A")}`);
}

const mode = config.blocking ? "blocking" : "warn only";
const summary = [
  "## PR title and description",
  "",
  findings.length
    ? `${findings.length} finding(s); mode: ${mode}${draft ? ", draft PR" : ""}. See CONTRIBUTING.md "Pull requests and commits".`
    : `No findings (mode: ${mode}).`,
  "",
  ...(findings.length ? ["| Rule | Finding |", "| --- | --- |", ...findings.map((f) => `| \`${f.rule}\` | ${f.message.replace(/\|/g, "\\|")} |`)] : []),
  "",
].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
else console.log(summary);

process.exit(fail ? 1 : 0);
