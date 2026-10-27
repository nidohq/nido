// /docs/llms.txt: an index of the Docs section for AI agents (see
// src/lib/docs/llms.ts). Rendered at build time.
import type { APIRoute } from "astro";
import { docTexts, llmsIndex, type MarkdownModule } from "../../lib/docs/llms";

const modules = import.meta.glob<MarkdownModule>("./*.md", { eager: true });

export const GET: APIRoute = () =>
  new Response(llmsIndex(docTexts(modules)), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
