// Nido's own PR and commit rules, loaded by core.mjs through
// .github/pr-checks.json ("rules"; settings under "repo"). Everything here
// knows about Nido's security documents; core.mjs knows about none of it.
//
//   - A PR touching a security-relevant path (repo.contractPaths) needs the
//     contract template's sections (repo.contractSections), unless it was
//     written from mechanical.md: a re-pin regenerates those paths, and its
//     "## Hand edits" names the lines to review.
//   - "## Invariants" / "## Security impact" may cite only IDs that
//     docs/SECURITY_INVARIANTS.md defines, and Invariants names an evidence
//     kind from that document's "Evidence kinds" table.
//   - A commit's `Security:` trailer lists such IDs, or says "none".

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./core.mjs";

// docs/SECURITY_INVARIANTS.md table rows start `| F1 |`. The ID prefixes
// (F, W, R...) are what a citation looks like, so an unknown `W12` is flagged
// while a Perch spec decision such as `D7` is left alone.
export function loadInvariantIds(root) {
  const doc = readFileSync(join(root, "docs/SECURITY_INVARIANTS.md"), "utf8");
  const ids = new Set([...doc.matchAll(/^\| ([A-Z]+\d+[a-z]?) \|/gm)].map((m) => m[1]));
  const prefixes = new Set([...ids].map((id) => id.match(/^[A-Z]+/)[0]));
  return { ids, prefixes };
}

// Cited IDs with a known prefix that docs/SECURITY_INVARIANTS.md lacks.
export function unknownInvariantIds(text, invariants) {
  const cited = [...text.matchAll(/\b([A-Z]{1,2})(\d{1,3})[a-z]?\b/g)].filter((m) => invariants.prefixes.has(m[1]));
  return [...new Set(cited.map((m) => m[0]).filter((id) => !invariants.ids.has(id)))];
}

const EVIDENCE_KIND = /\b(Mocked|Enforcing|Real-proof|Unit \((?:CI|local)\)|Browser|Testnet|Review)\b/;

export function createRules({ root, config }) {
  const invariants = loadInvariantIds(root);

  function body({ byName, files, template }) {
    const findings = [];
    const add = (rule, message) => findings.push({ rule, message });

    const touched = files.filter((f) => config.contractPaths.some((p) => f.startsWith(p)));
    const absent = config.contractSections.filter((h) => !byName.has(h.toLowerCase()));
    if (touched.length && absent.length && template !== "mechanical.md") {
      add(
        "body-contract-sections",
        `This PR changes ${touched.length} security-relevant file(s) (e.g. ${touched[0]}); add ${absent.map((h) => `"## ${h}"`).join(", ")} (gh pr create --template contract.md).`,
      );
    }

    for (const name of ["invariants", "security impact"]) {
      const s = byName.get(name);
      if (!s) continue;
      const text = stripComments(s.text);
      const unknown = unknownInvariantIds(text, invariants);
      if (unknown.length) {
        add("body-invariant-id", `"## ${s.heading}" cites ${unknown.join(", ")}, which docs/SECURITY_INVARIANTS.md does not define.`);
      }
      if (name === "invariants" && text.trim() && !/^\s*None\b/i.test(text.trim()) && !EVIDENCE_KIND.test(text)) {
        add("body-evidence-kind", '"## Invariants" names no evidence kind (Mocked / Enforcing / Real-proof / Unit (CI) / Unit (local) / Browser / Testnet / Review).');
      }
    }
    return findings;
  }

  function commit({ body: text }) {
    const findings = [];
    for (const m of text.matchAll(/^Security:\s*(.*)$/gm)) {
      const value = m[1].trim();
      if (/^none\b/i.test(value)) continue;
      const unknown = unknownInvariantIds(value, invariants);
      if (!value || unknown.length) {
        findings.push({
          rule: "trailer-security",
          message: `"Security: ${value}" must list docs/SECURITY_INVARIANTS.md IDs or say "none"${unknown.length ? `; unknown: ${unknown.join(", ")}` : ""}.`,
        });
      }
    }
    return findings;
  }

  return { body, commit };
}
