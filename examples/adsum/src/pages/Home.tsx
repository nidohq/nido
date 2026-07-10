import { Server } from "@stellar/stellar-sdk/rpc"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Broadside } from "../components/Broadside"
import { CreatePetition } from "../components/CreatePetition"
import { InkProgress } from "../components/InkProgress"
import { rpcUrl, stellarNetwork } from "../contracts/util"
import { useNotification } from "../hooks/useNotification"
import { formatLedgerCountdown } from "../lib/ledgerTime"
import {
	fetchPetitionCount,
	fetchPetitions,
	type PetitionView,
} from "../lib/petitions"
import styles from "./Home.module.css"

const EXCERPT_MAX = 220

/** The body, trimmed to a card-friendly excerpt at a word boundary. */
function excerpt(body: string): string {
	const clean = body.trim().replace(/\s+/g, " ")
	if (clean.length <= EXCERPT_MAX) return clean
	const cut = clean.slice(0, EXCERPT_MAX)
	const lastSpace = cut.lastIndexOf(" ")
	return `${cut.slice(0, lastSpace > 0 ? lastSpace : EXCERPT_MAX)}…`
}

const shortAddress = (address: string) =>
	`${address.slice(0, 4)}…${address.slice(-4)}`

/**
 * Home: the petition wall. A poster wall of `Broadside` cards (newest first)
 * beside the submission slot (`CreatePetition`), sticky on wide screens so
 * posting never demands a scroll. The current ledger is read once here (via
 * the RPC server directly — no generated-client call for this) and threaded
 * down for both the deadline countdown on each card and the date -> ledger
 * estimate in the form.
 */
export function Home() {
	const navigate = useNavigate()
	const { addNotification } = useNotification()

	const [petitions, setPetitions] = useState<PetitionView[] | null>(null)
	const [wallError, setWallError] = useState<string | null>(null)
	const [currentLedger, setCurrentLedger] = useState<number | null>(null)
	const [reloadToken, setReloadToken] = useState(0)

	// The latest ledger sequence, read once and cached for the page's lifetime
	// (ledger-time helpers only need an approximate "now").
	useEffect(() => {
		let cancelled = false
		const server = new Server(rpcUrl, { allowHttp: stellarNetwork === "LOCAL" })
		server
			.getLatestLedger()
			.then((latest) => {
				if (!cancelled) setCurrentLedger(latest.sequence)
			})
			.catch((err: unknown) => {
				console.error("Failed to read the latest ledger", err)
			})
		return () => {
			cancelled = true
		}
	}, [])

	useEffect(() => {
		let cancelled = false
		async function load() {
			try {
				const count = await fetchPetitionCount()
				const views = await fetchPetitions(count)
				if (!cancelled) {
					setPetitions(views)
					setWallError(null)
				}
			} catch (err) {
				console.error("Failed to load petitions", err)
				if (!cancelled) {
					setWallError("Couldn't reach the ledger. Try reloading the page.")
				}
			}
		}
		void load()
		return () => {
			cancelled = true
		}
	}, [reloadToken])

	const handleCreated = (id: number) => {
		addNotification(`Petition #${id} posted to the wall.`, "success")
		setReloadToken((t) => t + 1)
	}

	return (
		<div className={styles.page}>
			<section className={styles.intro}>
				<p className={styles.kicker}>Open call</p>
				<h1 className={styles.heading}>The petition wall</h1>
				<p className={styles.lede}>
					Every bill posted here stands on the ledger — present, countable,
					unerasable. Read what&rsquo;s posted, add your name on its page, or
					set your own.
				</p>
			</section>

			<div className={styles.layout}>
				<section className={styles.wall} aria-label="Posted petitions">
					<div className={styles.wallHead}>
						<h2 className={styles.wallTitle}>Posted</h2>
						{petitions && petitions.length > 0 && (
							<span className={styles.wallCount}>
								{petitions.length} standing
							</span>
						)}
					</div>

					{wallError ? (
						<p className={styles.stateNote} role="alert">
							{wallError}
						</p>
					) : petitions === null ? (
						<p className={styles.stateNote}>Reading the wall…</p>
					) : petitions.length === 0 ? (
						<div className={styles.empty}>
							<p className={styles.emptyKicker}>Nothing posted, yet</p>
							<p className={styles.emptyBody}>
								The wall is bare. Be the first to stand up and be counted —
								draft a bill and press it into the record.
							</p>
							<a className={styles.emptyCta} href="#compose-petition">
								Draft the first broadside
							</a>
						</div>
					) : (
						<ul className={styles.grid}>
							{petitions.map((p) => (
								<Broadside
									as="li"
									key={p.id}
									title={p.title}
									body={excerpt(p.body)}
									onClick={() => navigate(`/petition/${p.id}`)}
								>
									<InkProgress value={p.sigCount} max={p.goal ?? undefined} />
									<div className={styles.cardFooter}>
										<p className={styles.deadline}>
											{p.deadline == null
												? "open-ended"
												: currentLedger == null
													? "…"
													: formatLedgerCountdown(p.deadline, currentLedger)}
										</p>
										<p className={styles.byline}>
											filed by {shortAddress(p.creator)}
										</p>
									</div>
								</Broadside>
							))}
						</ul>
					)}
				</section>

				<aside className={styles.composeRail} id="compose-petition">
					<CreatePetition
						currentLedger={currentLedger}
						onCreated={handleCreated}
					/>
				</aside>
			</div>
		</div>
	)
}
