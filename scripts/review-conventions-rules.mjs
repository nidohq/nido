// Nido's one review-conventions rule that needs code (the rest are
// declarative, in .github/review-conventions.json; the checker is the shared
// bitswell-hq/review-conventions, see CONTRIBUTING.md "Where the rules live").
//
// security-trailer-missing: a commit that changes a security-relevant path
// carries a `Security:` trailer (invariant IDs, or "none"), the commit-sized
// version of the contract-sections rule's "## Security impact". The paths are
// read from that rule, so the two never drift.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export function createRules({ root }) {
  const config = JSON.parse(readFileSync(join(root, ".github/review-conventions.json"), "utf8"));
  const paths = config.rules.find((r) => r.id === "contract-sections")?.when?.paths ?? [];
  // The entries are directories ("contracts/"), so a prefix match is the glob.
  const security = (file) => paths.some((p) => (p.endsWith("/") ? file.startsWith(p) : file === p));

  return {
    commit(view) {
      const files = view.files;
      // Unknown outside `review-conventions commits` and the commit-msg hook.
      if (!files) return [];
      const touched = files.filter(security);
      if (!touched.length || view.trailers.some((t) => t.token === "Security")) return [];
      return [
        {
          rule: "security-trailer-missing",
          message: `This commit changes ${touched[0]}${touched.length > 1 ? ` and ${touched.length - 1} more security-relevant file(s)` : ""}; add a "Security:" trailer with docs/SECURITY_INVARIANTS.md IDs, or "Security: none".`,
        },
      ];
    },
  };
}
