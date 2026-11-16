// Repository-agnostic rules for PR titles, PR descriptions, and commit
// messages (CONTRIBUTING.md "Pull requests and commits"). Shared by
// check-pr.mjs (CI) and commitlint.config.mjs, so a PR title and a commit
// subject are held to the same rules.
//
// Nothing here knows about Nido. Settings come from .github/pr-checks.json;
// required sections come from the PR templates in .github/; rules only one
// repository needs live in the module that config's "rules" names (Nido's:
// nido-rules.mjs), which receives the config's "repo" object.
//
// Every check returns findings ({ rule, message }); none throws or exits.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function loadConfig(root) {
  return JSON.parse(readFileSync(join(root, ".github/pr-checks.json"), "utf8"));
}

// The repository's own rules: { body(view) -> findings, commit(view) -> findings },
// either optional. `view` is documented at each call below.
export async function loadRules(root, config) {
  if (!config.rules) return {};
  const mod = await import(pathToFileURL(resolve(root, config.rules)).href);
  return mod.createRules({ root, config: config.repo ?? {} });
}

// The required `## ` headings of each template, keyed by file name
// ("default" for .github/pull_request_template.md). The templates are the
// single source of truth: adding a heading there makes it required here.
export function loadTemplates(root) {
  const templates = { default: headingsOf(readFileSync(join(root, ".github/pull_request_template.md"), "utf8")) };
  let files = [];
  try {
    files = readdirSync(join(root, ".github/PULL_REQUEST_TEMPLATE"));
  } catch {
    // No variants: the default is the only template.
  }
  for (const file of files.filter((f) => f.endsWith(".md")).sort()) {
    templates[file] = headingsOf(readFileSync(join(root, ".github/PULL_REQUEST_TEMPLATE", file), "utf8"));
  }
  return templates;
}

export const norm = (s) => s.trim().toLowerCase();
export const stripComments = (s) => s.replace(/<!--[\s\S]*?(-->|$)/g, "");

function headingsOf(markdown) {
  return parseSections(markdown).map((s) => s.heading);
}

// Level-2 sections, ignoring headings inside code fences.
export function parseSections(markdown) {
  const sections = [];
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const m = !fenced && line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (m) sections.push({ heading: m[1], lines: [] });
    else if (sections.length) sections.at(-1).lines.push(line);
  }
  return sections.map((s) => ({ heading: s.heading, text: s.lines.join("\n") }));
}

// ---------------------------------------------------------------- headers

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^()]+)\))?(?<bang>!)?: (?<subject>.+)$/;

// A PR title or a commit subject: `type(scope)!: summary` (Conventional
// Commits). `what` names it in messages.
export function checkHeader(header, config, what = "Title") {
  const findings = [];
  const add = (rule, message) => findings.push({ rule, message });
  const m = header.match(HEADER);
  if (!m) {
    add("header-format", `${what} "${header}" is not \`type(scope): summary\` (Conventional Commits).`);
    return findings;
  }
  const { type, scope, subject } = m.groups;
  if (!config.types.includes(type)) add("type-enum", `Type "${type}" is not one of: ${config.types.join(", ")}.`);
  if (config.scopes) {
    for (const s of scope ? scope.split(",").map((x) => x.trim()) : []) {
      if (!config.scopes.includes(s)) add("scope-enum", `Scope "${s}" is not one of: ${config.scopes.join(", ")}.`);
    }
  }
  if (header.length > config.headerMaxLength) {
    add("header-max-length", `${what} is ${header.length} characters; keep it to ${config.headerMaxLength}.`);
  }
  if (/^[A-Z][a-z]+\b/.test(subject)) add("subject-case", `Start the summary lower-case: "${subject}".`);
  if (/\.$/.test(subject)) add("subject-full-stop", "Drop the full stop at the end of the summary.");
  if (/\b(WIP|DO NOT MERGE)\b/i.test(header)) {
    add("header-wip", `${what} says WIP / DO NOT MERGE; use a draft PR instead, so the title stays fit for history.`);
  }
  return findings;
}

// ---------------------------------------------------------------- bodies

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?";
const PROCESS_HEADING = new RegExp(
  "^#{1,6}\\s+(?:" +
    [
      "(?:intent|pipeline|prompt|agent (?:log|notes))\\b",
      "review (?:follow-?ups?|log|notes|rounds?|comments addressed)\\b",
      `.*(?:\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b${MONTH} \\d{1,2}\\b|\\bround \\d+\\b)`,
    ].join("|") +
    ")",
  "im",
);

// Headings that record how the change was made rather than what it is: agent
// prompts, pipeline output, dated review logs. In a body that becomes a
// commit message they end up in `main`'s history.
export function findProcessHeadings(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => PROCESS_HEADING.test(line))
    .map((line) => line.trim());
}

// Picks the template the body was written from: the one sharing the most
// headings, then the one missing the fewest.
export function matchTemplate(headings, templates) {
  const have = new Set(headings.map(norm));
  let best;
  for (const [name, required] of Object.entries(templates)) {
    const matched = required.filter((h) => have.has(norm(h))).length;
    const missing = required.length - matched;
    if (!best || matched > best.matched || (matched === best.matched && missing < best.missing)) {
      best = { name, required, matched, missing };
    }
  }
  // A body sharing no heading with any template was not written from one:
  // hold it to the default rather than to whichever template is shortest.
  return best.matched ? best : { name: "default", required: templates.default };
}

// The PR description. `files` is the PR's changed paths (empty when
// unknown); `ctx` is { config, templates, rules }.
export function checkBody(body, files, ctx) {
  const findings = [];
  const add = (rule, message) => findings.push({ rule, message });
  const { templates, rules } = ctx;

  if (!body.trim()) {
    add("body-empty", "The description is empty. It becomes the squash commit's message: start from the template.");
    return findings;
  }

  // A comment written about, in code, is not a leftover comment.
  const prose = body.replace(/^\s*(```|~~~)[\s\S]*?^\s*\1/gm, "").replace(/`[^`\n]*`/g, "");
  const comments = (prose.match(/<!--/g) || []).length;
  if (comments) {
    add("body-comments", `${comments} HTML comment(s) left in the description. Delete them: they land in the commit message on main.`);
  }

  for (const heading of findProcessHeadings(body)) {
    add("body-process-heading", `"${heading}" records process, not the change. Move it to a PR comment; the body becomes history.`);
  }

  const sections = parseSections(body);
  const byName = new Map(sections.map((s) => [norm(s.heading), s]));
  const template = matchTemplate(sections.map((s) => s.heading), templates);
  const missing = template.required.filter((h) => !byName.has(norm(h)));
  const label = template.name === "default" ? "the default template" : `template ${template.name}`;
  if (missing.length) {
    add("body-missing-section", `Missing ${missing.map((h) => `"## ${h}"`).join(", ")} (from ${label}). Answer "None." rather than delete a heading.`);
  }
  for (const h of template.required) {
    const s = byName.get(norm(h));
    if (s && !stripComments(s.text).trim()) add("body-empty-section", `"## ${h}" is empty. Answer it, or write "None."`);
  }

  // view: sections keyed by lower-cased heading ({ heading, text }), the
  // changed files, and the template the body was matched to.
  findings.push(...(rules.body?.({ byName, files, template: template.name }) ?? []));
  return findings;
}

// ---------------------------------------------------------------- commits

// The body of one commit message (everything after the subject), held to the
// PR description's structure in miniature: a Why for any commit type listed
// in config.whyTypes, no process headings, an upper-case BREAKING-CHANGE.
export function checkCommitBody(type, header, body, ctx) {
  const findings = [];
  const add = (rule, message) => findings.push({ rule, message });
  const text = body || "";
  if (ctx.config.whyTypes.includes(type) && !/^Why:/m.test(text)) {
    add("body-why", `A ${type} commit needs a "Why:" paragraph (see .gitmessage).`);
  }
  for (const heading of findProcessHeadings(text)) {
    add("body-process-heading", `"${heading}" records process, not the change.`);
  }
  if (/^Breaking-Change:/im.test(text) && !/^BREAKING[- ]CHANGE:/m.test(text)) {
    add("trailer-breaking", 'Write the trailer as "BREAKING-CHANGE:" (upper-case); Conventional Commits tools ignore other spellings.');
  }
  if (/^[a-z]+(\([^)]*\))?!:/.test(header) && !/^BREAKING[- ]CHANGE:/m.test(text)) {
    add("trailer-breaking", 'A "!" subject needs a "BREAKING-CHANGE:" trailer saying what breaks and how to migrate.');
  }
  // view: the commit's type, subject line, and body.
  findings.push(...(ctx.rules.commit?.({ type, header, body: text }) ?? []));
  return findings;
}
