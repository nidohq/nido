/**
 * dApp-side delegation flow ("log in with Nido = create a passkey for THIS dApp").
 *
 * Ported from the Nido frontend (`packages/frontend/src/lib/delegationHandover.ts`)
 * so this example is self-contained — a dApp dev can copy this file as-is.
 *
 * Design: the dApp creates a fresh WebAuthn passkey at its OWN origin to act as
 * a session key, persists its (credentialId, publicKey) via
 * `saveSessionKeyMaterial`, and redirects the user to the Nido wallet. The
 * wallet receives only the *public* key (hex) in the URL, builds the install
 * transaction (`add_context_rule` scoping the key to one target contract), gets
 * the user's primary-passkey signature, submits, and redirects back. The
 * private key never leaves the authenticator — XSS at the dApp origin cannot
 * exfiltrate it. After this, the dApp signs the target contract's calls
 * IN-PAGE with the session key (see `nidoSign.ts`) — no per-transaction
 * redirect to the wallet.
 */

import { createSessionPasskey, saveSessionKeyMaterial, buf2hex } from "@nidohq/passkey-sdk"

// ---------------------------------------------------------------------------
// Pending-delegation persistence.
//
// `startDelegation` does a full-page redirect to the wallet; the wallet sends
// the user back with ONLY `?delegation=ok|cancelled`. Per its
// anti-redirect-abuse policy the wallet REPLACES the dApp's returnUrl query
// string, so we can't smuggle the account/target back through the URL. Persist
// the request locally before leaving and read it back on return, so the dApp
// knows which account+contract the round-trip was for (and can fill the form).
// ---------------------------------------------------------------------------

const PENDING_KEY = "nido:pendingDelegation"

/** Minimal Storage shape so the store is testable with a fake. */
export type DelegationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

function defaultStorage(): DelegationStorage | null {
	try {
		return typeof localStorage !== "undefined" ? localStorage : null
	} catch {
		return null
	}
}

/** The account/contract a just-started delegation is for. */
export interface PendingDelegation {
	/** Smart account the session key is being installed on. */
	account: string
	/** Target contract the session key authorises. */
	target: string
	/** Optional human-readable label. */
	label?: string
}

/** Record the in-flight delegation before redirecting to the wallet. */
export function writePendingDelegation(
	pending: PendingDelegation,
	store: DelegationStorage | null = defaultStorage(),
): void {
	store?.setItem(PENDING_KEY, JSON.stringify(pending))
}

/**
 * Read AND clear the pending-delegation record (single-use — consumed on the
 * return trip). Returns null if absent or corrupt.
 */
export function consumePendingDelegation(
	store: DelegationStorage | null = defaultStorage(),
): PendingDelegation | null {
	if (!store) return null
	const raw = store.getItem(PENDING_KEY)
	if (!raw) return null
	store.removeItem(PENDING_KEY)
	try {
		const o = JSON.parse(raw) as Partial<PendingDelegation>
		if (o && typeof o.account === "string" && typeof o.target === "string") {
			return { account: o.account, target: o.target, label: o.label }
		}
	} catch {
		/* corrupt entry — treat as absent */
	}
	return null
}

export interface StartDelegationOptions {
	/** Full origin of the wallet for this account, e.g. https://<account>.<base>. */
	walletOrigin: string
	/** Smart account address the session key will be installed on. */
	account: string
	/** Target contract the session key authorises. */
	targetContract: string
	/** Session-key lifetime. */
	duration: "24h" | "7d" | "30d" | "none"
	/** Where the wallet should send the user back. Same-origin as window.location. */
	returnUrl: string
	/** Optional human-readable label stored locally with the session-key material. */
	label?: string
	/**
	 * Optional spending limit (decimal XLM, e.g. "5") suggested to the wallet.
	 * The wallet shows it pre-filled on the delegate page; the USER still
	 * reviews/edits it there — this is a suggestion, not an enforcement.
	 */
	limit?: string
	/** Rolling window the limit applies over. Wallet defaults to "day". */
	limitPeriod?: "day" | "week" | "30d"
}

/**
 * Build the wallet delegate-page URL for a delegation request. Pure — exported
 * for tests; `startDelegation` supplies the live pubkey + dApp origin.
 */
export function buildDelegationUrl(
	opts: StartDelegationOptions,
	pubkeyHex: string,
	dappOrigin: string,
): string {
	const url = new URL(`${opts.walletOrigin}/security/delegate/`)
	url.searchParams.set("origin", dappOrigin)
	url.searchParams.set("target", opts.targetContract)
	url.searchParams.set("pubkey", pubkeyHex)
	url.searchParams.set("duration", opts.duration)
	// Spending limit is opt-in; a period without an amount is meaningless, so
	// `limit_period` only travels alongside `limit`.
	if (opts.limit) {
		url.searchParams.set("limit", opts.limit)
		url.searchParams.set("limit_period", opts.limitPeriod ?? "day")
	}
	url.searchParams.set("return", opts.returnUrl)
	return url.toString()
}

/**
 * Generate the session key, store it locally, then navigate the user to the
 * wallet's delegate page with the public key + scope in URL params. This is a
 * full-page redirect — no popup, no postMessage. The wallet redirects back to
 * `returnUrl` on success or cancel.
 */
export async function startDelegation(opts: StartDelegationOptions): Promise<void> {
	// Create a resident WebAuthn passkey at the current origin. The OS shows its
	// usual create-passkey UI; the user accepts. The private key stays in the
	// authenticator's secure element; we only get the public key + credentialId.
	const k = await createSessionPasskey({
		rpId: window.location.hostname,
		rpName: window.location.host,
		userName: `session-key:${opts.account}`,
	})

	// Persist only the credentialId and pubkey at THIS origin. If the user
	// cancels at the wallet, the orphaned material is harmless — next delegation
	// overwrites it. No private bytes to worry about.
	const pubkeyHex = buf2hex(k.publicKey)
	saveSessionKeyMaterial(opts.account, opts.targetContract, {
		credentialId: k.credentialId,
		publicKey: pubkeyHex,
		label: opts.label,
	})

	// Remember which account+contract this delegation is for; the wallet's return
	// redirect carries only `?delegation=...`.
	writePendingDelegation({
		account: opts.account,
		target: opts.targetContract,
		label: opts.label,
	})

	// Full-page redirect: the user reviews the request at the wallet, signs with
	// their primary passkey, and the wallet sends them back to `returnUrl` with
	// ?delegation=ok or ?delegation=cancelled.
	window.location.href = buildDelegationUrl(opts, pubkeyHex, window.location.origin)
}

// ---------------------------------------------------------------------------
// Auto-start delegation on connect.
//
// When the user picks Nido in the wallet selector we want to go straight into
// delegation. The hazard is a redirect loop: if we keyed "start delegation" off
// "connected Nido account with no session key", a CANCELLED return (still no
// session key) would re-fire it forever. So instead we set a ONE-SHOT flag at
// interactive-connect time and consume it before redirecting. A reload (no
// flag) or a cancelled return (flag already spent) can't re-trigger it.
// ---------------------------------------------------------------------------

const AUTOSTART_KEY = "nido:autostartDelegation"

/** sessionStorage by default — scoped to the tab, auto-cleared on close. */
function defaultSessionStorage(): DelegationStorage | null {
	try {
		return typeof sessionStorage !== "undefined" ? sessionStorage : null
	} catch {
		return null
	}
}

/** Flag that an interactive Nido connect should auto-start delegation. */
export function markAutoStartDelegation(
	account: string,
	store: DelegationStorage | null = defaultSessionStorage(),
): void {
	store?.setItem(AUTOSTART_KEY, account)
}

/**
 * Read AND clear the auto-start flag (single-use). Returns the flagged account,
 * or null if absent. Consuming before the redirect is what stops the loop.
 */
export function consumeAutoStartDelegation(
	store: DelegationStorage | null = defaultSessionStorage(),
): string | null {
	if (!store) return null
	const v = store.getItem(AUTOSTART_KEY)
	if (v) store.removeItem(AUTOSTART_KEY)
	return v
}

/**
 * Decide whether to auto-start delegation right after a connect: only when the
 * connected account is the one flagged at connect time AND it has no session
 * key yet. Gating on the flag (not just "no session key") prevents the loop.
 */
export function shouldAutoStartDelegation(opts: {
	account: string | null
	flaggedAccount: string | null
	hasSessionKey: boolean
}): boolean {
	return (
		!!opts.account &&
		opts.flaggedAccount === opts.account &&
		!opts.hasSessionKey
	)
}

/**
 * Inspect URL params on a page that may have just been redirected to from the
 * wallet. Returns the status if present, null otherwise. `search` is injectable
 * for testing; it defaults to the live `window.location.search`.
 */
export function readDelegationReturn(
	search: string = typeof window !== "undefined" ? window.location.search : "",
): "ok" | "cancelled" | null {
	const v = new URLSearchParams(search).get("delegation")
	if (v === "ok" || v === "cancelled") return v
	return null
}
