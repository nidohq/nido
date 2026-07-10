/**
 * localStorage-backed record of pre-vouch invites the current browser has
 * created. The contract itself has no notion of "my invites" — a `key`
 * (pubkey) plus its `pre_vouch` row is all it stores — so this is purely a
 * client-side convenience letting the creator find and re-share (or later
 * revoke) links they've handed out. Losing this storage loses the list, not
 * the underlying pre-vouch: anyone who still has the `/claim?k=` link (which
 * encodes the seed itself) can still redeem it.
 */

const STORAGE_KEY = "adsum:invites"

export interface StoredInvite {
	/** The 32-byte ed25519 seed, hex-encoded (encoded into the `/claim?k=` link). */
	seedHex: string
	/** The seed's derived pubkey, hex-encoded — matches `pre_vouch`'s `key`. */
	pubkeyHex: string
	/** A free-form label the creator chose for this invite (e.g. "for Alice"). */
	label: string
	/** `Date.now()` at creation, for sorting/display. */
	createdAt: number
}

function readAll(): StoredInvite[] {
	const raw = localStorage.getItem(STORAGE_KEY)
	if (!raw) return []
	try {
		const parsed: unknown = JSON.parse(raw)
		return Array.isArray(parsed) ? (parsed as StoredInvite[]) : []
	} catch {
		return []
	}
}

function writeAll(invites: StoredInvite[]): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(invites))
}

export const inviteStore = {
	/** All stored invites, in insertion order. */
	list(): StoredInvite[] {
		return readAll()
	},

	/** Add (or replace, if `pubkeyHex` already exists) an invite. */
	add(inv: StoredInvite): void {
		const all = readAll().filter((i) => i.pubkeyHex !== inv.pubkeyHex)
		all.push(inv)
		writeAll(all)
	},

	/** Remove the invite for `pubkeyHex`, if any. */
	remove(pubkeyHex: string): void {
		writeAll(readAll().filter((i) => i.pubkeyHex !== pubkeyHex))
	},
}
