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

export interface PasskeySheetCopy {
	/** Heading shown while confirming (default "Confirm it's you"). */
	title?: string
	/** Sub text shown while confirming. */
	sub?: string
}

interface Els {
	scrim: HTMLElement
	faceid: HTMLElement | null
	title: HTMLElement | null
	sub: HTMLElement | null
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
	}
}

/** Open the sheet in its confirming state. No-op if the host isn't mounted. */
export function openPasskeySheet(copy: PasskeySheetCopy = {}): void {
	const e = els()
	if (!e) return
	if (copy.title && e.title) e.title.textContent = copy.title
	if (copy.sub && e.sub) e.sub.textContent = copy.sub
	e.faceid?.classList.remove("done")
	e.scrim.classList.add("show")
	e.scrim.style.pointerEvents = "auto"
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
 * awaits the caller's promise (the genuine `navigator.credentials.*` call), and
 * always closes it afterward — resolving with the value or re-throwing.
 */
export async function withPasskeySheet<T>(
	ceremony: () => Promise<T>,
	copy: PasskeySheetCopy = {},
): Promise<T> {
	openPasskeySheet(copy)
	try {
		return await ceremony()
	} finally {
		closePasskeySheet()
	}
}
