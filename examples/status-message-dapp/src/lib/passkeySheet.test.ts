// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest"
import { withPasskeySheet, openPasskeySheet } from "./passkeySheet"

/** Mount the host markup the controller drives (mirrors PasskeySheet.tsx ids). */
function mountHost(): HTMLElement {
	document.body.innerHTML = `
		<div class="nps-scrim" id="nido-passkey-scrim" style="pointer-events:none;">
			<div class="nps-faceid" id="nido-passkey-faceid"><div class="nps-frame"></div></div>
			<div id="nido-passkey-title"></div>
			<div id="nido-passkey-sub"></div>
			<div id="nido-passkey-details"></div>
		</div>`
	return document.getElementById("nido-passkey-faceid")!
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("withPasskeySheet", () => {
	beforeEach(() => {
		mountHost()
	})

	it("returns the ceremony result and flashes the success (done) state on success", async () => {
		const faceid = document.getElementById("nido-passkey-faceid")!
		const p = withPasskeySheet(() => Promise.resolve("signed-xdr"))
		// Shortly after the ceremony resolves we should be mid success-flash.
		await tick(50)
		expect(faceid.classList.contains("done")).toBe(true)
		await expect(p).resolves.toBe("signed-xdr")
	})

	it("does NOT show the success state when the ceremony fails (no false success)", async () => {
		const faceid = document.getElementById("nido-passkey-faceid")!
		await expect(
			withPasskeySheet(() => Promise.reject(new Error("cancelled"))),
		).rejects.toThrow("cancelled")
		expect(faceid.classList.contains("done")).toBe(false)
	})

	it("opens the sheet while the ceremony runs and closes it after", async () => {
		const scrim = document.getElementById("nido-passkey-scrim")!
		let shownDuring = false
		const p = withPasskeySheet(async () => {
			shownDuring = scrim.classList.contains("show")
			return "ok"
		})
		await p
		expect(shownDuring).toBe(true)
		expect(scrim.classList.contains("show")).toBe(false)
	})
})

describe("approval details", () => {
	beforeEach(() => {
		mountHost()
	})

	it("renders each detail as a label/value row", () => {
		openPasskeySheet({
			details: [
				{ label: "New status", value: "gm soroban" },
				{ label: "Account", value: "CABC…WXYZ" },
			],
		})
		const rows = document.querySelectorAll("#nido-passkey-details .nps-detail")
		expect(rows.length).toBe(2)
		expect(rows[0]?.querySelector(".nps-detail-label")?.textContent).toBe("New status")
		expect(rows[0]?.querySelector(".nps-detail-value")?.textContent).toBe("gm soroban")
		expect(rows[1]?.querySelector(".nps-detail-value")?.textContent).toBe("CABC…WXYZ")
	})

	it("renders a detail value as text, never as HTML (XSS-safe)", () => {
		// The status message is arbitrary user input; it must not become live DOM.
		openPasskeySheet({
			details: [{ label: "New status", value: '<img src=x onerror="alert(1)">' }],
		})
		const container = document.getElementById("nido-passkey-details")!
		expect(container.querySelector("img")).toBeNull()
		expect(container.querySelector(".nps-detail-value")?.textContent).toBe(
			'<img src=x onerror="alert(1)">',
		)
	})

	it("clears prior details when reopened without any", () => {
		openPasskeySheet({ details: [{ label: "New status", value: "x" }] })
		openPasskeySheet({})
		expect(document.querySelectorAll("#nido-passkey-details .nps-detail").length).toBe(0)
	})
})
