import { defineConfig } from "astro/config";
import { devRedirectHost } from "./src/lib/devHost.ts";

// Local development lives on `nido.localhost:<port>` (src/lib/devHost.ts says
// why); a request for bare `localhost` or `<c>.localhost` is sent there.
const nidoLocalhost = {
  name: "nido-localhost",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const host = req.headers.host && devRedirectHost(req.headers.host);
      if (!host) return next();
      res.statusCode = 307;
      res.setHeader("Location", `http://${host}${req.url ?? "/"}`);
      res.end();
    });
  },
};

export default defineConfig({
  // Canonical apex — used to build the absolute og:image URL in NidoLayout.
  // The same static build is served across the apex, name/contract subdomains,
  // and PR previews, so the card image points at one fixed origin.
  site: "https://nido.fyi",
  markdown: {
    // The Docs pages (src/pages/docs/*.md) sit on the light-only Warm Nest
    // palette; DocsLayout supplies the code block background.
    shikiConfig: { theme: "github-light" },
  },
  vite: {
    plugins: [nidoLocalhost],
    worker: {
      // bb.js (the ZK prover, loaded lazily by the recovery pages) spawns
      // module workers. Vite/Rollup's code-splitting build for module
      // workers can't emit "iife"/"umd" (its default `worker.format`).
      format: 'es',
    },
    optimizeDeps: {
      // Vite's esbuild-based dep pre-bundling mangles bb.js's own
      // `new URL(..., import.meta.url)` + fetch lookup of its WASM binary,
      // so the prebundled copy 404s and the dev server serves back its HTML
      // fallback instead ("expected magic word ..., found 3c 21 44 4f" --
      // the first bytes of "<!DOCTYPE"). Mirrors Perch's own working
      // browser setup (vendor/perch/packages/perch-zk/bench/browser/vite.config.js).
      exclude: ['@aztec/bb.js', '@noir-lang/noirc_abi', '@noir-lang/acvm_js'],
    },
  },
});
