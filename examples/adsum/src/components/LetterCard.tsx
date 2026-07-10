import { useEffect, useState } from "react"
import { inviteStore, type StoredInvite } from "../lib/invites"
import { dateForLedger } from "../lib/ledgerTime"
import { fetchPreVouch, revokePreVouch, type PreVouchView } from "../lib/trust"
import { buildClaimUrl } from "../lib/urls"
import styles from "./LetterCard.module.css"
import { QrPanel } from "./QrPanel"

export interface LetterCardProps {
	invite: StoredInvite
	/** The connected account — the letter's author, needed to revoke it. */
	viewer: string
	/** Share-link origin, e.g. `https://adsum.example`. */
	origin: string
	/** Latest known ledger sequence, for the expiry estimate. */
	currentLedger: number | null
	/** Fired after this invite leaves the store (revoked or discarded). */
	onRemoved: () => void
}

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
 * One letter of introduction: a pre-vouch invite rendered as a sealed
 * letter — folded flap, wax seal, the claim QR inside, and the letter's
 * terms (live claim count from the ledger, estimated expiry). Revocable by
 * its author until the uses are spent; once the ledger no longer holds the
 * pre-vouch (exhausted or revoked elsewhere) the letter reads as spent and
 * can be discarded from the list.
 */
export const LetterCard = ({
	invite,
	viewer,
	origin,
	currentLedger,
	onRemoved,
}: LetterCardProps) => {
	/** `undefined` while reading; `null` when the ledger no longer holds it. */
	const [preVouch, setPreVouch] = useState<PreVouchView | null | undefined>(
		undefined,
	)
	const [readFailed, setReadFailed] = useState(false)
	const [revoking, setRevoking] = useState(false)
	const [error, setError] = useState<string | null>(null)
	/** Bumped by the Retry action to re-run the terms fetch below. */
	const [retryCount, setRetryCount] = useState(0)

	useEffect(() => {
		let cancelled = false
		fetchPreVouch(invite.pubkeyHex)
			.then((pv) => {
				if (!cancelled) {
					setPreVouch(pv)
					setReadFailed(false)
				}
			})
			.catch((err: unknown) => {
				console.error("Failed to read the letter's pre-vouch", err)
				if (!cancelled) setReadFailed(true)
			})
		return () => {
			cancelled = true
		}
	}, [invite.pubkeyHex, retryCount])

	/** Re-runs the terms fetch after a transient read failure. */
	function retry() {
		setReadFailed(false)
		setRetryCount((n) => n + 1)
	}

	const spent = preVouch === null && !readFailed

	async function revoke() {
		if (revoking) return
		setRevoking(true)
		setError(null)
		try {
			await revokePreVouch(viewer, invite.pubkeyHex)
			inviteStore.remove(invite.pubkeyHex)
			onRemoved()
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "The revocation didn't take. Try again.",
			)
			setRevoking(false)
		}
	}

	function discard() {
		inviteStore.remove(invite.pubkeyHex)
		onRemoved()
	}

	return (
		<article className={styles.letter} data-spent={spent || undefined}>
			<header className={styles.flap} aria-hidden="true">
				<span className={styles.wax}>⁂</span>
			</header>

			<div className={styles.inside}>
				<p className={styles.kicker}>Letter of introduction</p>
				<h3 className={styles.title}>
					{invite.label.trim() === "" ? "For the bearer" : invite.label}
				</h3>

				{spent ? (
					<p className={styles.spentNote}>
						Spent — every use was claimed, or the letter was revoked.
					</p>
				) : (
					<QrPanel
						value={buildClaimUrl(origin, invite.seedHex)}
						caption="Scan to claim this vouch"
					/>
				)}

				<p className={styles.terms}>
					{readFailed
						? "Couldn't read the letter's terms — the code above still works."
						: preVouch === undefined
							? "Consulting the record…"
							: preVouch === null
								? "No longer on the ledger."
								: termsLine(preVouch, currentLedger)}
				</p>

				{error && (
					<p className={styles.error} role="alert">
						{error}
					</p>
				)}

				<div className={styles.actions}>
					{spent ? (
						<button type="button" className={styles.discard} onClick={discard}>
							Discard
						</button>
					) : (
						<>
							{readFailed && (
								<button
									type="button"
									className={styles.retry}
									onClick={retry}
								>
									Retry
								</button>
							)}
							<button
								type="button"
								className={styles.revoke}
								onClick={() => void revoke()}
								disabled={revoking || (preVouch === undefined && !readFailed)}
							>
								{revoking ? "Revoking…" : "Revoke letter"}
							</button>
						</>
					)}
				</div>
			</div>
		</article>
	)
}
