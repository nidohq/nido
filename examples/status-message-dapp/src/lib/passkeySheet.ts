/**
 * In-page "confirming…" sheet controller, Nido-styled.
 *
 * Ported from the g2c wallet's `packages/frontend/src/lib/passkeySheet.ts` so
 * the dApp can show the SAME confirmation affordance the wallet does — but
 * in-page, wrapping the local session-key ceremony (no wallet round-trip).
 *
 * The sheet's lifecycle is driven by a REAL promise the caller passes in
 * (`navigator.credentials.get()` via `signWithSessionPasskey`), NOT a fake
 * timer. It opens while the OS passkey dialog is up and closes when the promise
 * settles. The native biometric prompt itself is browser chrome we can't
 * restyle; this is the Nido-branded frame around it.
 *
 * Markup is provided once by `components/PasskeySheet.tsx`.
 */

const SCRIM_ID = "nido-passkey-scrim"
const FACEID_ID = "nido-passkey-faceid"
const TITLE_ID = "nido-passkey-title"
const SUB_ID = "nido-passkey-sub"
const DETAILS_ID = "nido-passkey-details"

/** How long the confirmed (green tick) state shows before the sheet closes. */
const DONE_FLASH_MS = 480

/** One "what you're approving" row in the sheet. */
export interface PasskeyDetail {
	label: string
	value: string
}

export interface PasskeySheetCopy {
	/** Heading shown while confirming (default "Confirm it's you"). */
	title?: string
	/** Sub text shown while confirming. */
	sub?: string
	/** Rows describing exactly what this signature authorises. */
	details?: PasskeyDetail[]
}

interface Els {
	scrim: HTMLElement
	faceid: HTMLElement | null
	title: HTMLElement | null
	sub: HTMLElement | null
	details: HTMLElement | null
}

function els(): Els | null {
	if (typeof document === "undefined") return null
	const scrim = document.getElementById(SCRIM_ID)
	if (!scrim) return null
	return {
		scrim,
		faceid: document.getElementById(FACEID_ID),
		title: document.getElementById(TITLE_ID),
		sub: document.getElementById(SUB_ID),
		details: document.getElementById(DETAILS_ID),
	}
}

/**
 * Render the approval rows. Values come from arbitrary user input (e.g. the
 * status message), so they are set via `textContent` ONLY — never innerHTML —
 * so the confirm dialog can't be turned into an injection vector.
 */
function renderDetails(container: HTMLElement, details: PasskeyDetail[]): void {
	container.replaceChildren()
	for (const d of details) {
		const row = document.createElement("div")
		row.className = "nps-detail"
		const label = document.createElement("span")
		label.className = "nps-detail-label"
		label.textContent = d.label
		const value = document.createElement("span")
		value.className = "nps-detail-value"
		value.textContent = d.value
		row.append(label, value)
		container.append(row)
	}
}

/** Open the sheet in its confirming state. No-op if the host isn't mounted. */
export function openPasskeySheet(copy: PasskeySheetCopy = {}): void {
	const e = els()
	if (!e) return
	if (copy.title && e.title) e.title.textContent = copy.title
	if (copy.sub && e.sub) e.sub.textContent = copy.sub
	if (e.details) renderDetails(e.details, copy.details ?? [])
	// Reset to the confirming state in case a prior run left it confirmed.
	e.faceid?.classList.remove("done")
	e.scrim.classList.add("show")
	e.scrim.style.pointerEvents = "auto"
}

/**
 * Switch the open sheet to its confirmed (green tick) state. Only called after
 * the real ceremony RESOLVES — never on a timer during it — so it can't imply
 * success before it happened.
 */
export function markPasskeySheetDone(): void {
	els()?.faceid?.classList.add("done")
}

/** Close the sheet. No-op if the host isn't mounted. */
export function closePasskeySheet(): void {
	const e = els()
	if (!e) return
	e.scrim.classList.remove("show")
	e.scrim.style.pointerEvents = "none"
}

/**
 * Run a real passkey ceremony with the confirming sheet open. Opens the sheet,
 * awaits the caller's promise (the genuine `navigator.credentials.*` call). On
 * success it briefly shows the confirmed (green tick) state before closing; on
 * failure it just closes — no false success. Resolves with the value or
 * re-throws.
 */
export async function withPasskeySheet<T>(
	ceremony: () => Promise<T>,
	copy: PasskeySheetCopy = {},
): Promise<T> {
	openPasskeySheet(copy)
	try {
		const result = await ceremony()
		markPasskeySheetDone()
		await new Promise((resolve) => setTimeout(resolve, DONE_FLASH_MS))
		return result
	} finally {
		closePasskeySheet()
	}
}
