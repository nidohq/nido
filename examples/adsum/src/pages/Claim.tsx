import { useEffect, useMemo, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { useWallet } from "../hooks/useWallet"
import { dateForLedger } from "../lib/ledgerTime"
import { lookupNidoName } from "../lib/nidoResolver"
import { getLatestLedgerSeq } from "../lib/rpc"
import { claimVouch, fetchPreVouch, type PreVouchView } from "../lib/trust"
import { parseClaimParam } from "../lib/urls"
import { connectWallet, nidoBase } from "../util/wallet"
import styles from "./Claim.module.css"

const PENDING_KEY = "adsum:pendingClaim"

const shortAddress = (address: string) =>
	`${address.slice(0, 4)}…${address.slice(-4)}`

const dateFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
})

/** The letter's terms line: "x of y claimed · expires ~date". */
function termsLine(pv: PreVouchView, currentLedger: number | null): string {
	const claimed = `${pv.claims} of ${pv.maxClaims} claimed`
	if (pv.expires === null) return `${claimed} · never expires`
	if (currentLedger === null) return `${claimed} · expires ~…`
	if (pv.expires <= currentLedger) return `${claimed} · expired`
	return `${claimed} · expires ~${dateFormatter.format(
		dateForLedger(pv.expires, currentLedger),
	)}`
}

/**
 * The invite secret for this landing, and its derived pubkey. A `k` param
 * present in the URL is authoritative and wins outright. A bare landing (no
 * `k` key at all — returning to this tab after `connectWallet()`'s modal
 * closes) falls back to whatever a previous visit left pending. A `k` key
 * that IS present but fails to parse is always an error.
 */
function resolveClaim(
	search: string,
): { seedHex: string; pubkeyHex: string } | null {
	if (!new URLSearchParams(search).has("k")) {
		const pending = localStorage.getItem(PENDING_KEY)
		return pending
			? parseClaimParam(`?${new URLSearchParams({ k: pending }).toString()}`)
			: null
	}
	return parseClaimParam(search)
}

/** The dead-end card: a `/claim` link with no usable code. */
const NoClaim = () => (
	<div className={styles.missing}>
		<p className={styles.missingKicker}>No letter here</p>
		<p className={styles.missingBody}>
			This claim link didn&rsquo;t carry a usable code. Ask whoever shared it
			for a fresh QR.
		</p>
		<Link to="/" className={styles.missingLink}>
			Back to the wall
		</Link>
	</div>
)

/**
 * The `/claim?k=<secret>` landing — a letter of introduction, opened. Renders
 * fully logged-out: the secret is parsed independently of wallet state, so
 * a disconnected scan still gets to read who vouched for it, with an
 * onboarding prompt (the wallet selector, Nido module included, handles
 * creating a brand-new account) in place of the claim press. The anti-spoof
 * rule is binding — the link carries only the secret; the voucher's name is
 * always resolved fresh from the registry, never read from the link.
 */
export function Claim() {
	const location = useLocation()
	const { address } = useWallet()
	const viewer = address ?? null

	const claim = useMemo(() => resolveClaim(location.search), [location.search])

	// A freshly-arrived `k` param is persisted immediately — before the
	// wallet has even finished initialising — so it survives the connect
	// (or brand-new-account) roundtrip regardless of connection state.
	useEffect(() => {
		if (claim && new URLSearchParams(location.search).has("k")) {
			localStorage.setItem(PENDING_KEY, claim.seedHex)
		}
	}, [claim, location.search])

	const [preVouch, setPreVouch] = useState<PreVouchView | null | undefined>(
		undefined,
	)
	const [readError, setReadError] = useState<string | null>(null)
	useEffect(() => {
		if (!claim) return
		let cancelled = false
		setPreVouch(undefined)
		setReadError(null)
		fetchPreVouch(claim.pubkeyHex)
			.then((pv) => {
				if (!cancelled) setPreVouch(pv)
			})
			.catch((err: unknown) => {
				console.error("Failed to read the letter's seal", err)
				if (!cancelled) {
					setReadError("Couldn't reach the ledger. Try reloading the page.")
				}
			})
		return () => {
			cancelled = true
		}
	}, [claim])

	const [currentLedger, setCurrentLedger] = useState<number | null>(null)
	useEffect(() => {
		let cancelled = false
		getLatestLedgerSeq()
			.then((sequence) => {
				if (!cancelled) setCurrentLedger(sequence)
			})
			.catch((err: unknown) => {
				console.error("Failed to read the latest ledger", err)
			})
		return () => {
			cancelled = true
		}
	}, [])

	const voucher = preVouch?.from
	const [voucherName, setVoucherName] = useState<string | null | undefined>(
		undefined,
	)
	useEffect(() => {
		if (!voucher) {
			setVoucherName(undefined)
			return
		}
		let cancelled = false
		setVoucherName(undefined)
		void lookupNidoName(voucher, nidoBase()).then((n) => {
			if (!cancelled) setVoucherName(n)
		})
		return () => {
			cancelled = true
		}
	}, [voucher])

	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [done, setDone] = useState(false)

	async function handleClaim() {
		if (!viewer || !claim || busy) return
		setBusy(true)
		setError(null)
		try {
			await claimVouch(claim.seedHex, viewer)
			localStorage.removeItem(PENDING_KEY)
			setDone(true)
		} catch (err) {
			// The generated client's error map keys `AlreadyVouched` (a repeat
			// claim, or the claimant already held this vouch some other way) to
			// exactly this message — see packages/web_of_trust/src/index.ts.
			if (err instanceof Error && err.message === "AlreadyVouched") {
				setError("You already hold this vouch — no need to claim it twice.")
			} else {
				setError(
					err instanceof Error
						? err.message
						: "The claim didn't take. Try again.",
				)
			}
		} finally {
			setBusy(false)
		}
	}

	if (!claim) return <NoClaim />

	return (
		<div className={styles.page}>
			<article
				className={styles.letter}
				data-open={preVouch != null || undefined}
			>
				<header className={styles.flap} aria-hidden="true">
					<span className={styles.wax}>⁂</span>
				</header>

				<div className={styles.inside}>
					{readError ? (
						<>
							<p className={styles.mutedKicker}>
								Couldn&rsquo;t break the seal
							</p>
							<p className={styles.body}>{readError}</p>
						</>
					) : preVouch === undefined ? (
						<p className={styles.body}>Breaking the seal…</p>
					) : preVouch === null ? (
						<>
							<p className={styles.mutedKicker}>No longer available</p>
							<p className={styles.body}>
								This letter has expired or is exhausted — every use was claimed,
								its term ran out, or it was revoked. Ask whoever sent it for a
								fresh one.
							</p>
							<Link
								to="/"
								className={styles.cta}
								onClick={() => localStorage.removeItem(PENDING_KEY)}
							>
								Back to the wall
							</Link>
						</>
					) : (
						<>
							<p className={styles.kicker}>A letter has arrived</p>
							<h1 className={styles.heading}>
								{voucherName === undefined
									? "…"
									: (voucherName ?? shortAddress(preVouch.from))}{" "}
								has vouched for you
							</h1>
							<p className={styles.from} title={preVouch.from}>
								from {preVouch.from}
							</p>
							<p className={styles.terms}>
								{termsLine(preVouch, currentLedger)}
							</p>

							<div className={styles.actionBlock}>
								{done ? (
									<>
										<p className={styles.affirm}>
											Sealed — Adsum, you are vouched for.
										</p>
										<Link to="/trust" className={styles.cta}>
											Go to your constellation
										</Link>
									</>
								) : viewer === null ? (
									<>
										<p className={styles.reason}>
											This letter is addressed to whichever account accepts it —
											connect, or create a Nido account on the spot, to claim
											it.
										</p>
										<button
											type="button"
											className={styles.cta}
											onClick={() => void connectWallet()}
										>
											Connect
										</button>
									</>
								) : (
									<>
										<button
											type="button"
											className={styles.cta}
											onClick={() => void handleClaim()}
											disabled={busy}
										>
											{busy ? "Opening the seal…" : "Claim this vouch"}
										</button>
										{error && (
											<p className={styles.error} role="alert">
												{error}
											</p>
										)}
									</>
								)}
							</div>
						</>
					)}
				</div>
			</article>
		</div>
	)
}
