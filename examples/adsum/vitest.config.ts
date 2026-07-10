import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
	plugins: [react()],
	test: {
		// Pure lib tests run on node; component tests opt into jsdom with a
		// per-file `// @vitest-environment jsdom` comment.
		include: ["src/**/*.test.{ts,tsx}"],
		setupFiles: ["./src/test/setup.ts"],
		// Testing-library's auto-cleanup registers itself on the global
		// afterEach; without globals renders would leak across tests.
		globals: true,
	},
})
