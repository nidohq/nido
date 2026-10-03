import { defineConfig } from "astro/config";

export default defineConfig({
  // Canonical apex — used to build the absolute og:image URL in NidoLayout.
  // The same static build is served across the apex, name/contract subdomains,
  // and PR previews, so the card image points at one fixed origin.
  site: "https://nido.fyi",
  vite: {
    worker: {
      // bb.js (the ZK prover, loaded lazily by the recovery pages) spawns
      // module workers. Vite/Rollup's code-splitting build for module
      // workers can't emit "iife"/"umd" (its default `worker.format`).
      format: 'es',
    },
  },
});
