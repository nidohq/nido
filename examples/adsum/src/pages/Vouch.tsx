import { useEffect, useMemo, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useWallet } from "../hooks/useWallet"
import { lookupNidoName } from "../lib/nidoResolver"
import { hasVouched, vouchFor } from "../lib/trust"
import { parseVouchParam } from "../lib/urls"
import { connectWallet, nidoBase } from "../util/wallet"
import styles from "./Vouch.module.css"

const PENDING_KEY = "adsum:pendingVouch"

/**
 * The vouch target for this landing. A `for` param present in the URL is
 * authoritative and wins outright — persisted immediately by the effect
 * below so it survives the connect roundtrip. A bare landing (no `for` key
 * at all — e.g. returning to this same tab after `connectWallet()`'s modal
 * closes) falls back to whatever a previous visit left pending. A `for` key
 * that IS present but fails to parse (junk, truncated) is always an error:
 * it never silently falls back to a stale pending value.
 */
function resolveTarget(search: string): string | null {
	if (!new URLSearchParams(search).has("for")) {
		return localStorage.getItem(PENDING_KEY)
	}
	return parseVouchParam(search)
}

/** The dead-end card: a `/vouch` link with no usable address. */
const NoTarget = () => (
	<div className={styles.missing}>
		<p className={styles.missingKicker}>No address here</p>
		<p className={styles.missingBody}>
			This vouch link didn&rsquo;t carry a usable address. Ask whoever shared it
			for a fresh QR or link.
		</p>
		<Link to="/" className={styles.missingLink}>
			Back to the wall
		</Link>
	</div>
)

/**
 * The `/vouch?for=<address>` landing — the far end of someone's "My QR" or a
 * shared link. Renders fully logged-out: params are parsed independently of
 * wallet state, so a disconnected scan still gets the resolved card, just
 * with a connect prompt in place of the press. The anti-spoof rule is
 * binding — the URL carries only the address; the name shown is always
 * resolved fresh from the registry, never read from the link, so a crafted
 * URL can never claim an identity it doesn't hold.
 */
export function Vouch() {
	const location = useLocation()
	const navigate = useNavigate()
	const { address } = useWallet()
	const viewer = address ?? null

	const target = useMemo(
		() => resolveTarget(location.search),
		[location.search],
	)

	// A freshly-arrived `for` param is persisted immediately — before the
	// wallet has even finished initialising — so it survives the connect
	// roundtrip regardless of whether the reader is connected yet.
	useEffect(() => {
		if (target && new URLSearchParams(location.search).has("for")) {
			localStorage.setItem(PENDING_KEY, target)
		}
	}, [target, location.search])

	const [name, setName] = useState<string | null | undefined>(undefined)
	useEffect(() => {
		if (!target) return
		let cancelled = false
		setName(undefined)
		void lookupNidoName(target, nidoBase()).then((resolved) => {
			if (!cancelled) setName(resolved)
		})
		return () => {
			cancelled = true
		}
	}, [target])

	const isSelf = target !== null && viewer !== null && target === viewer

	const [already, setAlready] = useState<boolean | null>(null)
	useEffect(() => {
		if (!target || !viewer || isSelf) {
			setAlready(null)
			return
		}
		let cancelled = false
		setAlready(null)
		hasVouched(viewer, target)
			.then((v) => {
				if (!cancelled) setAlready(v)
			})
			.catch((err: unknown) => {
				// Fall back to ready — the contract itself refuses a duplicate.
				console.error("Failed to check the record", err)
				if (!cancelled) setAlready(false)
			})
		return () => {
			cancelled = true
		}
	}, [target, viewer, isSelf])

	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [done, setDone] = useState(false)

	async function handleVouch() {
		if (!viewer || !target || busy || isSelf || already) return
		setBusy(true)
		setError(null)
		try {
			await vouchFor(viewer, target)
			localStorage.removeItem(PENDING_KEY)
			setDone(true)
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "The vouch didn't take. Try again.",
			)
		} finally {
			setBusy(false)
		}
	}

	function dismiss() {
		localStorage.removeItem(PENDING_KEY)
		void navigate("/")
	}

	if (!target) return <NoTarget />

	return (
		<div className={styles.page}>
			<section className={styles.card} data-settled={done || undefined}>
				<p className={styles.kicker}>A calling card</p>
				<h1 className={styles.heading}>
					{name === undefined
						? "Consulting the record…"
						: (name ?? "An unrecognized address")}
				</h1>
				<p className={styles.address}>{target}</p>
				<p className={styles.note}>
					Resolved fresh from the ledger — never from the link itself.
				</p>

				<div className={styles.actionBlock}>
					{done ? (
						<>
							<p className={styles.affirm}>
								Adsum — your vouch stands beside {name ?? "this address"}.
							</p>
							<Link to="/trust" className={styles.cta}>
								See your constellation
							</Link>
						</>
					) : viewer === null ? (
						<>
							<p className={styles.reason}>
								Connect a wallet to vouch for this address.
							</p>
							<button
								type="button"
								className={styles.cta}
								onClick={() => void connectWallet()}
							>
								Connect
							</button>
						</>
					) : isSelf ? (
						<>
							<p className={styles.reason}>
								This is your own card — you can&rsquo;t vouch for yourself.
							</p>
							<button type="button" className={styles.cta} disabled>
								Vouch
							</button>
						</>
					) : already === null ? (
						<p className={styles.reason}>Consulting the record…</p>
					) : already ? (
						<>
							<p className={styles.reason}>
								Your vouch already stands beside this name.
							</p>
							<Link to="/trust" className={styles.cta}>
								See your constellation
							</Link>
						</>
					) : (
						<>
							<button
								type="button"
								className={styles.cta}
								onClick={() => void handleVouch()}
								disabled={busy}
							>
								{busy ? "Vouching…" : "Vouch"}
							</button>
							{error && (
								<p className={styles.error} role="alert">
									{error}
								</p>
							)}
						</>
					)}
				</div>
			</section>

			{!done && (
				<button type="button" className={styles.dismiss} onClick={dismiss}>
					This isn&rsquo;t for me
				</button>
			)}
		</div>
	)
}
