import { useEffect, useState } from "react"
import { lookupNidoName } from "../lib/nidoResolver"
import { fetchSigners } from "../lib/petitions"
import { fetchVouchesGiven, fetchVouchesReceived } from "../lib/trust"
import { nidoBase } from "../util/wallet"
import { SealBadge, type SealTone } from "./SealBadge"
import styles from "./SignatureWall.module.css"

const PAGE_SIZE = 30

/**
 * Session caches, shared by every wall on every page. Badge data (an
 * address's received vouches, the viewer's given vouches) and reverse name
 * lookups change rarely and are re-requested constantly while paging, so
 * each is fetched once per session and remembered by address. Promises are
 * cached (not values) so concurrent entries share one in-flight read; a
 * failed read evicts itself so a later mount can retry.
 */
const nameCache = new Map<string, Promise<string | null>>()
const receivedCache = new Map<string, Promise<string[]>>()
const givenCache = new Map<string, Promise<string[]>>()

function throughCache<T>(
	cache: Map<string, Promise<T>>,
	key: string,
	fetcher: () => Promise<T>,
	fallback: T,
): Promise<T> {
	let promise = cache.get(key)
	if (!promise) {
		promise = fetcher().catch(() => {
			cache.delete(key)
			return fallback
		})
		cache.set(key, promise)
	}
	return promise
}

const cachedName = (address: string) =>
	throughCache(
		nameCache,
		address,
		() => lookupNidoName(address, nidoBase()),
		null,
	)
const cachedReceived = (address: string) =>
	throughCache(receivedCache, address, () => fetchVouchesReceived(address), [])
const cachedGiven = (address: string) =>
	throughCache(givenCache, address, () => fetchVouchesGiven(address), [])

/** Test hook: forget every session-cached name and vouch read. */
export function resetSignatureWallCaches(): void {
	nameCache.clear()
	receivedCache.clear()
	givenCache.clear()
}

const shortAddress = (address: string) =>
	`${address.slice(0, 4)}…${address.slice(-4)}`

function toneFor(
	received: string[],
	viewer: string | null,
	viewerGiven: string[],
): SealTone {
	if (viewer && received.includes(viewer)) return "you"
	if (received.some((a) => viewerGiven.includes(a))) return "kin"
	return "neutral"
}

interface SignerEntryProps {
	address: string
	viewer: string | null
	viewerGiven: string[]
	/** The viewer's own signature, freshly pressed this session. */
	fresh?: boolean
}

/**
 * One name on the wall. Renders the truncated address immediately, swaps in
 * the resolved nido name when the reverse lookup lands (names sign in the
 * document serif; bare addresses stay in the UI face), and presses a
 * `SealBadge` chop beside it once the vouch read resolves.
 */
const SignerEntry = ({
	address,
	viewer,
	viewerGiven,
	fresh,
}: SignerEntryProps) => {
	const [name, setName] = useState<string | null>(null)
	const [received, setReceived] = useState<string[] | null>(null)

	useEffect(() => {
		let cancelled = false
		void cachedName(address).then((n) => {
			if (!cancelled) setName(n)
		})
		void cachedReceived(address).then((r) => {
			if (!cancelled) setReceived(r)
		})
		return () => {
			cancelled = true
		}
	}, [address])

	return (
		<li className={styles.entry} data-fresh={fresh || undefined}>
			{name ? (
				<span className={styles.name} title={address}>
					{name}
				</span>
			) : (
				<span className={styles.addr} title={address}>
					{shortAddress(address)}
				</span>
			)}
			{received === null ? (
				<span className={styles.badgeGhost} aria-hidden="true" />
			) : (
				<SealBadge
					count={received.length}
					tone={toneFor(received, viewer, viewerGiven)}
				/>
			)}
		</li>
	)
}

export interface SignatureWallProps {
	petitionId: number
	/** Connected account, for badge tones — `null` when disconnected. */
	viewer: string | null
	/**
	 * An address stamped onto the document this session: pinned to the top
	 * of the wall immediately, without waiting for the ledger read to
	 * include it (and deduped if a fetched page already does).
	 */
	freshSigner?: string | null
}

/**
 * The signature wall: every name pressed onto the petition, in order of
 * signing, 30 to a page behind "Load more". Each entry resolves its nido
 * name (or keeps the truncated address) and carries a vouch-count chop
 * toned against the viewer's own web of trust.
 */
export const SignatureWall = ({
	petitionId,
	viewer,
	freshSigner = null,
}: SignatureWallProps) => {
	const [signers, setSigners] = useState<string[] | null>(null)
	const [hasMore, setHasMore] = useState(false)
	const [loadingMore, setLoadingMore] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [viewerGiven, setViewerGiven] = useState<string[]>([])

	useEffect(() => {
		let cancelled = false
		setSigners(null)
		setHasMore(false)
		setError(null)
		fetchSigners(petitionId, 0, PAGE_SIZE)
			.then((page) => {
				if (cancelled) return
				setSigners(page)
				setHasMore(page.length === PAGE_SIZE)
			})
			.catch((err: unknown) => {
				console.error("Failed to read the signatures", err)
				if (!cancelled) setError("Couldn't read the signatures. Try reloading.")
			})
		return () => {
			cancelled = true
		}
	}, [petitionId])

	useEffect(() => {
		if (!viewer) {
			setViewerGiven([])
			return
		}
		let cancelled = false
		void cachedGiven(viewer).then((given) => {
			if (!cancelled) setViewerGiven(given)
		})
		return () => {
			cancelled = true
		}
	}, [viewer])

	async function loadMore() {
		if (signers === null || loadingMore) return
		setLoadingMore(true)
		try {
			const page = await fetchSigners(petitionId, signers.length, PAGE_SIZE)
			setSigners([...signers, ...page])
			setHasMore(page.length === PAGE_SIZE)
		} catch (err) {
			console.error("Failed to read more signatures", err)
			setError("Couldn't read more signatures. Try again.")
		} finally {
			setLoadingMore(false)
		}
	}

	// The fresh signature is pinned on top; a fetched page that already
	// carries it (the ledger caught up) must not repeat it below.
	const fetched =
		freshSigner === null
			? signers
			: (signers?.filter((a) => a !== freshSigner) ?? null)
	const empty = fetched !== null && fetched.length === 0 && freshSigner === null

	return (
		<section className={styles.wall} aria-label="Signatures">
			<div className={styles.head}>
				<h2 className={styles.heading}>Signatures</h2>
				<span className={styles.order}>in order of signing</span>
			</div>

			{error ? (
				<p className={styles.note} role="alert">
					{error}
				</p>
			) : fetched === null ? (
				<p className={styles.note}>Reading the signatures…</p>
			) : empty ? (
				<p className={styles.note}>
					No names yet — the first stamp starts the record.
				</p>
			) : (
				<>
					<ul className={styles.list}>
						{freshSigner !== null && (
							<SignerEntry
								key={freshSigner}
								address={freshSigner}
								viewer={viewer}
								viewerGiven={viewerGiven}
								fresh
							/>
						)}
						{fetched.map((address) => (
							<SignerEntry
								key={address}
								address={address}
								viewer={viewer}
								viewerGiven={viewerGiven}
							/>
						))}
					</ul>
					{hasMore && (
						<button
							type="button"
							className={styles.more}
							onClick={() => void loadMore()}
							disabled={loadingMore}
						>
							{loadingMore ? "Reading…" : "Load more"}
						</button>
					)}
				</>
			)}
		</section>
	)
}
