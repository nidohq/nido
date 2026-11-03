// @vitest-environment node
// The llms.txt and llms-full.txt builders: the index lists every page in
// nav order, the full file carries each page's Markdown without display HTML,
// and a nav entry with no page fails the build. The built pages, their links
// and anchors are checked by tests/e2e/ui/docs.spec.ts.
import { describe, expect, it } from "vitest";
import { DOCS, docHref } from "./nav";
import { docTexts, llmsFull, llmsIndex, type MarkdownModule } from "./llms";

describe("llms.txt", () => {
  const modules: Record<string, MarkdownModule> = Object.fromEntries(
    DOCS.map((d) => [
      `./${d.slug}.md`,
      {
        frontmatter: { title: `Title ${d.slug}`, description: `About ${d.slug}` },
        rawContent: () => `## ${d.slug}\n\nRevoking is <span class="docs-tag">Not available yet</span>.\n`,
      },
    ]),
  );

  it("indexes every page in nav order", () => {
    const index = llmsIndex(docTexts(modules));
    const positions = DOCS.map((d) => index.indexOf(`(${docHref(d.slug)})`));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(index).toContain("> About index");
    expect(index).toContain("(/docs/llms-full.txt)");
  });

  it("puts every page's Markdown in the full file, without display HTML", () => {
    const full = llmsFull(docTexts(modules));
    for (const d of DOCS) {
      expect(full).toContain(`# Title ${d.slug}`);
      expect(full).toContain(`Page: ${docHref(d.slug)}`);
    }
    expect(full).toContain("**Not available yet**");
    expect(full).not.toContain("<span");
  });

  it("refuses a nav entry with no page", () => {
    const { "./fees.md": _, ...missing } = modules;
    expect(() => docTexts(missing)).toThrow(/fees/);
  });
});
