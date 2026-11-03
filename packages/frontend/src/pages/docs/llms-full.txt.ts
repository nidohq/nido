// /docs/llms-full.txt: every Docs page's Markdown in one file, for AI agents
// (see src/lib/docs/llms.ts). Rendered at build time.
import type { APIRoute } from "astro";
import { docTexts, llmsFull, type MarkdownModule } from "../../lib/docs/llms";

const modules = import.meta.glob<MarkdownModule>("./*.md", { eager: true });

export const GET: APIRoute = () =>
  new Response(llmsFull(docTexts(modules)), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
