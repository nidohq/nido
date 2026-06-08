import { defineConfig } from "astro/config";

export default defineConfig({
  // Canonical apex — used to build the absolute og:image URL in NidoLayout.
  // The same static build is served across the apex, name/contract subdomains,
  // and PR previews, so the card image points at one fixed origin.
  site: "https://nido.fyi",
});
