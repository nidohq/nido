import { defineConfig } from "astro/config";

export default defineConfig({
  // Canonical apex — used to build the absolute og:image URL in NidoLayout.
  // The same static build is served across the apex, name/contract subdomains,
  // and PR previews, so the card image points at one fixed origin.
  site: "https://nido.fyi",
  vite: {
    worker: {
      // `prover.worker.ts` is a `type: "module"` Worker (see
      // `lib/zk/prover.ts`). Vite/Rollup's code-splitting build for module
      // workers can't emit "iife"/"umd" (its default `worker.format`) —
      // `astro build` hard-fails with "Invalid value \"iife\" for option
      // \"worker.format\"" the moment any page imports the zk prover.
      format: 'es',
    },
  },
});
