import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"
import wasm from "vite-plugin-wasm"

// https://vite.dev/config/
//
// The base path is intentionally NOT set here because this app ships to two
// targets with different bases:
//   • GitHub Pages (live): project URL for the current repository
//       built via `npm run build:pages`
//   • Cloudflare PR preview / local dev: served at an apex → base "/"
//       built via the default `vite build`
// Keeping base out of the config lets the default (`/`) stay correct for the
// apex/local case while the Pages build opts in explicitly.
export default defineConfig({
	plugins: [
		react(),
		nodePolyfills({
			include: ["buffer"],
			globals: {
				Buffer: true,
			},
		}),
		wasm(),
	],
	build: {
		target: "esnext",
	},
	optimizeDeps: {
		exclude: ["@stellar/stellar-xdr-json"],
	},
	define: {
		global: "window",
	},
	envPrefix: "PUBLIC_",
	server: {
		proxy: {
			"/friendbot": {
				target: "http://localhost:8000/friendbot",
				changeOrigin: true,
			},
		},
	},
})
