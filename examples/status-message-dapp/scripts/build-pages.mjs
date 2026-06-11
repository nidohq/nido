import { spawnSync } from "node:child_process"

function normalizeBase(value) {
	const trimmed = value.trim()
	if (!trimmed) {
		throw new Error("PAGES_BASE_PATH must not be empty")
	}
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
		return trimmed.endsWith("/") ? trimmed : `${trimmed}/`
	}

	const path = trimmed.replace(/^\/+|\/+$/g, "")
	return path ? `/${path}/` : "/"
}

function repoNameFromRemote() {
	const result = spawnSync("git", ["config", "--get", "remote.origin.url"], {
		encoding: "utf8",
	})
	if (result.status !== 0) {
		return undefined
	}

	const remote = result.stdout.trim()
	const match = remote.match(/[:/]([^/:]+?)(?:\.git)?$/)
	return match?.[1]
}

const explicitBase = process.env.PAGES_BASE_PATH
const githubRepoName = process.env.GITHUB_REPOSITORY?.split("/").pop()
const repoName = githubRepoName ?? repoNameFromRemote()

if (!explicitBase && !repoName) {
	console.error(
		"Could not determine the GitHub Pages base path. Set PAGES_BASE_PATH, or run in a repository with remote.origin.url.",
	)
	process.exit(1)
}

const base = normalizeBase(explicitBase ?? `/${repoName}/`)
console.log(`Building GitHub Pages example with base ${base}`)

const result = spawnSync("npx", ["vite", "build", `--base=${base}`], {
	stdio: "inherit",
	shell: process.platform === "win32",
})

process.exit(result.status ?? 1)
