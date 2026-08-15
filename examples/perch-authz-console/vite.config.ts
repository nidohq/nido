import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// base is left default ('/') for local dev + Cloudflare/apex previews; the
// GitHub Pages build passes --base=/<repo>/ explicitly (see build:pages).
export default defineConfig({
  plugins: [
    // @stellar/stellar-sdk (via @nidohq/testkit) expects a Buffer global.
    nodePolyfills({ include: ['buffer'], globals: { Buffer: true } }),
  ],
  build: { target: 'esnext' },
});
