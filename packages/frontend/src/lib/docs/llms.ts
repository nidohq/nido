// The Docs section as plain text for AI agents: /docs/llms.txt (an index, in
// the llms.txt shape: title, summary, sections of links) and
// /docs/llms-full.txt (every page's Markdown in reading order). Both are
// built from the same Markdown the HTML pages render, so they can't drift.
import { DOCS, docHref } from "./nav";

export interface DocText {
  slug: string;
  title: string;
  description: string;
  /** The page's Markdown body, without frontmatter. */
  body: string;
}

/** The parts of an Astro Markdown module these files read. */
export interface MarkdownModule {
  frontmatter: { title: string; description: string };
  rawContent(): string;
}

/** The docs pages in nav order, from `import.meta.glob("./*.md")` in
 *  src/pages/docs/. Throws when a nav entry has no page. */
export function docTexts(modules: Record<string, MarkdownModule>): DocText[] {
  return DOCS.map(({ slug }) => {
    const mod = modules[`./${slug}.md`];
    if (!mod) throw new Error(`No Markdown page for docs entry "${slug}"`);
    return {
      slug,
      title: mod.frontmatter.title,
      description: mod.frontmatter.description,
      body: plain(mod.rawContent()),
    };
  });
}

/** Inline HTML the pages use for display, as Markdown. */
function plain(markdown: string): string {
  return markdown.replace(/<span class="docs-tag">([^<]+)<\/span>/g, "**$1**").trim();
}

const HOST_NOTE =
  "Nido runs on Stellar testnet only. Paths are on the host you fetched this file from (https://test.nido.fyi for testnet).";

export function llmsIndex(pages: DocText[]): string {
  const home = pages.find((p) => p.slug === "index");
  const lines = [
    "# Nido docs",
    "",
    `> ${home?.description ?? ""}`,
    "",
    HOST_NOTE,
    "",
    "## Docs",
    "",
    ...DOCS.map((d) => {
      const page = pages.find((p) => p.slug === d.slug);
      return `- [${page?.title ?? d.label}](${docHref(d.slug)}): ${d.summary}`;
    }),
    "",
    "## Plain text",
    "",
    "- [All pages in one file](/docs/llms-full.txt): every page above as Markdown, in reading order",
    "",
    "## Source",
    "",
    "- [Nido app template](https://github.com/nidohq/scaffold-template): start with `stellar scaffold init --template nidohq/scaffold-template <name>`; its AGENTS.md has the rules for its code",
    "- [Nido](https://github.com/nidohq/nido): the wallet, its pages and the account factory",
    "",
  ];
  return lines.join("\n");
}

export function llmsFull(pages: DocText[]): string {
  const parts = pages.map((p) =>
    [`# ${p.title}`, "", p.description, "", `Page: ${docHref(p.slug)}`, "", p.body].join("\n"),
  );
  return [`<!-- ${HOST_NOTE} -->`, "", parts.join("\n\n---\n\n"), ""].join("\n");
}
