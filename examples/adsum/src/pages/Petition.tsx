import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { InkProgress } from "../components/InkProgress"
import { SignatureWall } from "../components/SignatureWall"
import { StampButton, type StampState } from "../components/StampButton"
import { useWallet } from "../hooks/useWallet"
import { dateForLedger, formatLedgerCountdown } from "../lib/ledgerTime"
import { lookupNidoName } from "../lib/nidoResolver"
import {
	fetchPetition,
	hasSigned,
	signPetition,
	type PetitionView,
} from "../lib/petitions"
import { getLatestLedgerSeq } from "../lib/rpc"
import { connectWallet, nidoBase } from "../util/wallet"
import styles from "./Petition.module.css"

const shortAddress = (address: string) =>
	`${address.slice(0, 4)}…${address.slice(-4)}`

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "long" })

/** The dead-end sheet: a petition id that isn't in the record. */
const MissingPetition = () => (
	<div className={styles.missing}>
		<p className={styles.missingKicker}>Nothing posted here</p>
		<p className={styles.missingBody}>This petition isn&rsquo;t on the wall.</p>
		<Link to="/" className={styles.missingLink}>
			Back to the wall
		</Link>
	</div>
)

/**
 * The proclamation page — the flagship. The petition is printed in full as
 * a broadside: title, imprint line, body in the document serif at a
 * generous measure. At its foot sits the signing block, where the ADSUM
 * stamp does its work: disabled (with the reason spelled out) when the
 * reader is disconnected or the window has closed, ready when their name
 * can still join, busy mid-press, and stamped — persisted via `hasSigned`
 * — once it has. A successful press bumps the count, pins the reader's
 * name to the top of the signature wall, and leaves the impression behind.
 */
export function Petition() {
	const { id: idParam } = useParams()
	const id =
		idParam !== undefined && /^\d+$/.test(idParam) ? Number(idParam) : null
	const { address } = useWallet()
	const viewer = address ?? null

	const [petition, setPetition] = useState<PetitionView | null | undefined>(
		undefined,
	)
	const [loadError, setLoadError] = useState<string | null>(null)
	const [currentLedger, setCurrentLedger] = useState<number | null>(null)
	/** `null` while unknown (no viewer yet, or the record check is in flight). */
	const [signed, setSigned] = useState<boolean | null>(null)
	const [busy, setBusy] = useState(false)
	const [stampError, setStampError] = useState<string | null>(null)
	const [freshSigner, setFreshSigner] = useState<string | null>(null)
	const [extraSigs, setExtraSigs] = useState(0)
	const [creatorName, setCreatorName] = useState<string | null>(null)

	useEffect(() => {
		if (id === null) return
		let cancelled = false
		fetchPetition(id)
			.then((view) => {
				if (!cancelled) setPetition(view)
			})
			.catch((err: unknown) => {
				console.error("Failed to load the petition", err)
				if (!cancelled) {
					setLoadError("Couldn't reach the ledger. Try reloading the page.")
				}
			})
		return () => {
			cancelled = true
		}
	}, [id])

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

	useEffect(() => {
		if (id === null || viewer === null) {
			setSigned(null)
			return
		}
		let cancelled = false
		setSigned(null)
		hasSigned(id, viewer)
			.then((s) => {
				if (!cancelled) setSigned(s)
			})
			.catch((err: unknown) => {
				// Fall back to ready — the contract itself refuses a double-sign.
				console.error("Failed to check the record", err)
				if (!cancelled) setSigned(false)
			})
		return () => {
			cancelled = true
		}
	}, [id, viewer])

	const creator = petition?.creator
	useEffect(() => {
		if (creator === undefined) return
		let cancelled = false
		void lookupNidoName(creator, nidoBase()).then((name) => {
			if (!cancelled) setCreatorName(name)
		})
		return () => {
			cancelled = true
		}
	}, [creator])

	if (id === null) return <MissingPetition />
	if (loadError) {
		return (
			<p className={styles.stateNote} role="alert">
				{loadError}
			</p>
		)
	}
	if (petition === undefined) {
		return <p className={styles.stateNote}>Unrolling the document…</p>
	}
	if (petition === null) return <MissingPetition />

	const expired =
		petition.deadline != null &&
		currentLedger != null &&
		petition.deadline <= currentLedger

	const stampState: StampState =
		signed === true
			? "stamped"
			: busy
				? "busy"
				: viewer === null || expired || signed === null
					? "disabled"
					: "ready"

	const reason =
		stampState !== "disabled"
			? null
			: viewer === null
				? "The record is open — connect a wallet to add your name."
				: expired
					? "This petition is closed. The window to sign has passed."
					: "Consulting the record…"

	async function handleStamp() {
		if (viewer === null || petition == null || busy || signed) return
		setBusy(true)
		setStampError(null)
		try {
			await signPetition(petition.id, viewer)
			setSigned(true)
			setExtraSigs((n) => n + 1)
			setFreshSigner(viewer)
		} catch (err) {
			setStampError(
				err instanceof Error
					? err.message
					: "The stamp didn't take. Try again.",
			)
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className={styles.page}>
			<Link to="/" className={styles.crumb}>
				&larr; The petition wall
			</Link>

			<article className={styles.sheet}>
				<header className={styles.docket}>
					<p className={styles.kicker}>Petition No. {petition.id}</p>
					<h1 className={styles.title}>{petition.title}</h1>
					<p className={styles.meta}>
						<span className={styles.metaItem}>
							filed by{" "}
							<span className={styles.metaName} title={petition.creator}>
								{creatorName ?? shortAddress(petition.creator)}
							</span>
						</span>
						<span className={styles.metaDot} aria-hidden="true">
							·
						</span>
						<span className={styles.metaItem}>
							posted{" "}
							{currentLedger == null
								? "…"
								: `≈ ${dateFormatter.format(
										dateForLedger(petition.createdLedger, currentLedger),
									)}`}
						</span>
						<span className={styles.metaDot} aria-hidden="true">
							·
						</span>
						<span className={styles.metaItem}>
							{petition.deadline == null
								? "open-ended"
								: currentLedger == null
									? "…"
									: formatLedgerCountdown(petition.deadline, currentLedger)}
						</span>
					</p>
				</header>

				<p className={styles.body}>{petition.body}</p>

				<div
					className={styles.signing}
					data-fresh={freshSigner !== null || undefined}
				>
					<div className={styles.signingText}>
						{stampState === "stamped" ? (
							<p className={styles.affirm}>
								{freshSigner
									? "Adsum — your name is on the record."
									: "Your name stands on this document."}
							</p>
						) : (
							<p className={styles.reason}>
								{reason ?? "Press the stamp to declare yourself present."}
							</p>
						)}
						{stampState === "disabled" && viewer === null && (
							<button
								type="button"
								className={styles.connect}
								onClick={() => void connectWallet()}
							>
								Connect
							</button>
						)}
						{stampError && (
							<p className={styles.stampError} role="alert">
								{stampError}
							</p>
						)}
					</div>
					<div className={styles.stampSlot}>
						<StampButton
							state={stampState}
							onStamp={() => void handleStamp()}
						/>
					</div>
				</div>

				<InkProgress
					value={petition.sigCount + extraSigs}
					max={petition.goal ?? undefined}
				/>

				<div className={styles.asterism} aria-hidden="true">
					⁂
				</div>

				<SignatureWall
					petitionId={petition.id}
					viewer={viewer}
					freshSigner={freshSigner}
				/>
			</article>
		</div>
	)
}
