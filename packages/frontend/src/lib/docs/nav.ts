// The Docs section's pages, in reading order. One source for the sidebar,
// the previous/next links, the docs home and /docs/llms.txt. Each entry is a
// Markdown page at src/pages/docs/<slug>.md (the home is index.md):
// docTexts() in llms.ts fails the build when an entry has no page, and
// tests/e2e/ui/docs.spec.ts checks each entry's built page, its links and
// its anchors.

export interface DocPage {
  /** File name under src/pages/docs/ without `.md`; "index" is /docs/. */
  slug: string;
  /** Sidebar label. */
  label: string;
  /** One line for the docs home and llms.txt. */
  summary: string;
}

export const DOCS: readonly DocPage[] = [
  {
    slug: "index",
    label: "Overview",
    summary: "What Nido is for an app developer, and where to start.",
  },
  {
    slug: "getting-started",
    label: "Getting started",
    summary:
      "From `stellar scaffold init` to a passkey account and a first call your app makes without a prompt.",
  },
  {
    slug: "concepts",
    label: "Concepts",
    summary:
      "Smart accounts and passkeys, sessions, grants and spending caps, expiry, and who pays for what.",
  },
  {
    slug: "sessions",
    label: "Request a session",
    summary:
      "Ask for grants with limits, show the owner what they approve, and handle refusals with sentences people can act on.",
  },
  {
    slug: "fees",
    label: "Fees and storage",
    summary: "What account creation, grants and session calls cost on testnet, and why.",
  },
  {
    slug: "troubleshooting",
    label: "Troubleshooting",
    summary: "Known pitfalls, what causes them, and what to do.",
  },
  {
    slug: "ai-agents",
    label: "For AI agents",
    summary:
      "The rules a coding agent needs, how to verify work against testnet, and plain-text entry points.",
  },
];

export const docHref = (slug: string): string =>
  slug === "index" ? "/docs/" : `/docs/${slug}/`;
