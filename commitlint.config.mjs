// Commit message rules, the commit-sized version of the PR description
// (CONTRIBUTING.md "Pull requests and commits"; template: .gitmessage).
// CI runs it over each PR's commits (.github/workflows/pr-description.yml);
// locally: npx @commitlint/cli@21.2.3 --edit, or --from main.
//
// Self-contained (no `extends`), so the CI step needs only @commitlint/cli.
// The rules are scripts/pr-lint/core.mjs plus the repository's own module
// (.github/pr-checks.json "rules"), the same ones the PR title meets.
// Level 1 warns and 2 fails; .github/pr-checks.json "blocking" picks which.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCommitBody, checkHeader, loadConfig, loadRules } from "./scripts/pr-lint/core.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const config = loadConfig(root);
const ctx = { config, rules: await loadRules(root, config) };
const level = config.blocking ? 2 : 1;

// One commitlint rule per shared rule, so a title and a subject get the same
// wording. Each reports the shared findings whose rule name matches.
// `pr-lint/repo` reports what the repository's own rules found.
const fromShared = (check, rule) => (parsed) => {
  const hits = check(parsed).filter((f) => (rule === "repo" ? !coreRules.includes(f.rule) : f.rule === rule));
  return [hits.length === 0, hits.map((f) => f.message).join(" ")];
};
const header = (parsed) => checkHeader(parsed.header ?? "", config, "Subject");
const body = (parsed) => {
  const raw = (parsed.raw ?? "").split("\n").slice(1).join("\n");
  return checkCommitBody(parsed.type ?? "", parsed.header ?? "", raw, ctx);
};

const headerRules = ["header-format", "type-enum", "scope-enum", "header-max-length", "subject-case", "subject-full-stop", "header-wip"];
const bodyRules = ["body-why", "body-process-heading", "trailer-breaking", "repo"];
const coreRules = [...headerRules, ...bodyRules];

export default {
  parserPreset: {
    parserOpts: {
      headerPattern: /^(\w*)(?:\((.*)\))?!?: (.*)$/,
      breakingHeaderPattern: /^(\w*)(?:\((.*)\))?!: (.*)$/,
      headerCorrespondence: ["type", "scope", "subject"],
      noteKeywords: ["BREAKING CHANGE", "BREAKING-CHANGE"],
    },
  },
  plugins: [
    {
      rules: Object.fromEntries([
        ...headerRules.map((r) => [`pr-lint/${r}`, fromShared(header, r)]),
        ...bodyRules.map((r) => [`pr-lint/${r}`, fromShared(body, r)]),
      ]),
    },
  ],
  rules: {
    "body-leading-blank": [level, "always"],
    "footer-leading-blank": [level, "always"],
    "body-max-line-length": [level, "always", 100],
    ...Object.fromEntries([...headerRules, ...bodyRules].map((r) => [`pr-lint/${r}`, [level, "always"]])),
  },
  ...(config.helpUrl && { helpUrl: config.helpUrl }),
};
