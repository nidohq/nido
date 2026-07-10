import { StrKey } from "@stellar/stellar-sdk"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { ConstellationGraph } from "../components/ConstellationGraph"
import { LetterCard } from "../components/LetterCard"
import { QrPanel } from "../components/QrPanel"
import { useNotification } from "../hooks/useNotification"
import { useWallet } from "../hooks/useWallet"
import { newInviteSecret } from "../lib/claimPayload"
import { inviteStore } from "../lib/invites"
import { lookupNidoName, resolveNidoName } from "../lib/nidoResolver"
import { getLatestLedgerSeq } from "../lib/rpc"
import {
	createPreVouch,
	fetchVouchesGiven,
	fetchVouchesReceived,
	revokeVouch,
	vouchFor,
} from "../lib/trust"
import { buildVouchUrl } from "../lib/urls"
import { connectWallet, nidoBase } from "../util/wallet"
import styles from "./Trust.module.css"

/** Soroban ledgers close ~every 5s → 86400 / 5 per day. */
const LEDGERS_PER_DAY = 17280
/** The letter form's default validity: 30 days ≈ 518,400 ledgers. */
const DEFAULT_VALID_DAYS = "30"

const NIDO_NAME_PATTERN = /^[a-z0-9-]+$/i

const shortAddress = (address: string) =>
	`${address.slice(0, 4)}…${address.slice(-4)}`

/**
 * The origin the shareable QR links are built on: the page's origin plus a
 * non-root deploy base (GitHub Pages serves this app under a subpath).
 */
function shareOrigin(): string {
	const base = import.meta.env.BASE_URL
	const trimmed = base.endsWith("/") ? base.slice(0, -1) : base
	return window.location.origin + trimmed
}

/**
 * Turn the vouch form's input into a vouchable address: a G/C strkey passes
 * through, anything name-shaped goes to the nido resolver. Throws a
 * user-facing message for junk or an unregistered name.
 */
async function resolveTarget(input: string): Promise<string> {
	if (StrKey.isValidEd25519PublicKey(input) || StrKey.isValidContract(input)) {
		return input
	}
	if (!NIDO_NAME_PATTERN.test(input)) {
		throw new Error(
			"Enter a G or C address, or a nido name (letters, digits, hyphens).",
		)
	}
	const resolved = await resolveNidoName(input, nidoBase())
	if (!resolved) {
		throw new Error(`No nido account answers to “${input}”.`)
	}
	return resolved
}

/**
 * The trust page: the viewer's constellation (1-hop ego graph of vouches),
 * their own vouch QR, the vouch form and given-list, and the letters of
 * introduction drawer (pre-vouch invites rendered as sealed letters).
 */
export function Trust() {
	const { address } = useWallet()
	const viewer = address ?? null
	const { addNotification } = useNotification()

	const [given, setGiven] = useState<string[] | null>(null)
	const [received, setReceived] = useState<string[] | null>(null)
	const [graphError, setGraphError] = useState<string | null>(null)
	const [names, setNames] = useState<Record<string, string | null>>({})
	const requestedNames = useRef(new Set<string>())
	const [currentLedger, setCurrentLedger] = useState<number | null>(null)

	const [vouchInput, setVouchInput] = useState("")
	const [vouchBusy, setVouchBusy] = useState(false)
	const [vouchError, setVouchError] = useState<string | null>(null)
	const [revoking, setRevoking] = useState<string | null>(null)

	const [invites, setInvites] = useState(() => inviteStore.list())
	const [letterLabel, setLetterLabel] = useState("")
	const [usesInput, setUsesInput] = useState("1")
	const [daysInput, setDaysInput] = useState(DEFAULT_VALID_DAYS)
	const [sealing, setSealing] = useState(false)
	const [letterError, setLetterError] = useState<string | null>(null)

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
		if (!viewer) return
		let cancelled = false
		setGiven(null)
		setReceived(null)
		setGraphError(null)
		Promise.all([fetchVouchesGiven(viewer), fetchVouchesReceived(viewer)])
			.then(([g, r]) => {
				if (cancelled) return
				setGiven(g)
				setReceived(r)
			})
			.catch((err: unknown) => {
				console.error("Failed to read the web of trust", err)
				if (!cancelled) {
					setGraphError("Couldn't read the ledger. Try reloading the page.")
				}
			})
		return () => {
			cancelled = true
		}
	}, [viewer])

	// Resolve a nido name for every address on the chart, once per session.
	useEffect(() => {
		if (!viewer) return
		const addresses = [viewer, ...(given ?? []), ...(received ?? [])]
		for (const addr of addresses) {
			if (requestedNames.current.has(addr)) continue
			requestedNames.current.add(addr)
			void lookupNidoName(addr, nidoBase()).then((name) => {
				setNames((prev) => ({ ...prev, [addr]: name }))
			})
		}
	}, [viewer, given, received])

	const labelOf = (addr: string) => names[addr] ?? shortAddress(addr)

	async function handleVouch(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const input = vouchInput.trim()
		if (!viewer || vouchBusy || input === "") return
		setVouchBusy(true)
		setVouchError(null)
		try {
			const target = await resolveTarget(input)
			if (target === viewer) {
				throw new Error(
					"You can't vouch for yourself — trust must come from another hand.",
				)
			}
			if (given?.includes(target)) {
				throw new Error("Your vouch already stands beside this name.")
			}
			await vouchFor(viewer, target)
			setGiven((prev) => (prev ? [...prev, target] : [target]))
			setVouchInput("")
			addNotification(`Your vouch stands beside ${labelOf(target)}.`, "success")
		} catch (err) {
			setVouchError(
				err instanceof Error
					? err.message
					: "The vouch didn't take. Try again.",
			)
		} finally {
			setVouchBusy(false)
		}
	}

	async function handleRevoke(target: string) {
		if (!viewer || revoking !== null) return
		setRevoking(target)
		setVouchError(null)
		try {
			await revokeVouch(viewer, target)
			setGiven((prev) => prev?.filter((a) => a !== target) ?? prev)
			addNotification(`Vouch for ${labelOf(target)} revoked.`, "success")
		} catch (err) {
			setVouchError(
				err instanceof Error
					? err.message
					: "The revocation didn't take. Try again.",
			)
		} finally {
			setRevoking(null)
		}
	}

	const usesNum = Number(usesInput.trim())
	const usesValid = Number.isInteger(usesNum) && usesNum >= 1
	const daysTrim = daysInput.trim()
	const daysNum = Number(daysTrim)
	const daysValid =
		daysTrim === "" || (Number.isInteger(daysNum) && daysNum >= 1)
	const needsLedger = daysTrim !== "" && currentLedger === null
	const canSeal = usesValid && daysValid && !needsLedger

	async function handleSeal(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (!viewer || !canSeal || sealing) return
		setSealing(true)
		setLetterError(null)
		try {
			const expires =
				daysTrim === "" || currentLedger === null
					? null
					: currentLedger + daysNum * LEDGERS_PER_DAY
			const secret = newInviteSecret()
			await createPreVouch(viewer, secret.pubkeyHex, expires, usesNum)
			inviteStore.add({
				...secret,
				label: letterLabel.trim(),
				createdAt: Date.now(),
			})
			setInvites(inviteStore.list())
			setLetterLabel("")
			setUsesInput("1")
			setDaysInput(DEFAULT_VALID_DAYS)
			addNotification("Letter sealed — hand its code to the bearer.", "success")
		} catch (err) {
			setLetterError(
				err instanceof Error
					? err.message
					: "The letter couldn't be sealed. Try again.",
			)
		} finally {
			setSealing(false)
		}
	}

	const sortedInvites = [...invites].sort((a, b) => b.createdAt - a.createdAt)

	return (
		<div className={styles.page}>
			<section className={styles.intro}>
				<p className={styles.kicker}>Web of trust</p>
				<h1 className={styles.heading}>Your constellation</h1>
				<p className={styles.lede}>
					Every vouch is a fixed star: the names you stand behind, and those who
					stand behind yours, charted around your own.
				</p>
			</section>

			{viewer === null ? (
				<section className={styles.connectSheet}>
					<p className={styles.connectKicker}>The sky is unobserved</p>
					<p className={styles.connectBody}>
						The chart needs its astronomer. Connect a wallet to draw your
						constellation, press vouches, and seal letters of introduction.
					</p>
					<button
						type="button"
						className={styles.connectCta}
						onClick={() => void connectWallet()}
					>
						Connect
					</button>
				</section>
			) : (
				<>
					<div className={styles.layout}>
						<section className={styles.plate} aria-labelledby="chart-heading">
							<div className={styles.plateHead}>
								<h2 id="chart-heading" className={styles.plateTitle}>
									The chart
								</h2>
								{given !== null && received !== null && (
									<span className={styles.plateMeta}>
										{given.length} given · {received.length} received
									</span>
								)}
							</div>

							{graphError ? (
								<p className={styles.stateNote} role="alert">
									{graphError}
								</p>
							) : given === null || received === null ? (
								<p className={styles.stateNote}>Charting the sky…</p>
							) : (
								<ConstellationGraph
									center={viewer}
									given={given}
									received={received}
									names={names}
								/>
							)}

							<ul className={styles.legend} aria-label="Chart legend">
								<li className={styles.legendItem}>
									<svg viewBox="0 0 40 10" aria-hidden="true">
										<line
											className={styles.legendGiven}
											x1="1"
											y1="5"
											x2="33"
											y2="5"
										/>
										<path
											className={styles.legendHeadInk}
											d="M33,1.5 L39,5 L33,8.5 Z"
										/>
									</svg>
									given
								</li>
								<li className={styles.legendItem}>
									<svg viewBox="0 0 40 10" aria-hidden="true">
										<line
											className={styles.legendReceived}
											x1="7"
											y1="5"
											x2="39"
											y2="5"
										/>
										<path
											className={styles.legendHeadInk}
											d="M7,1.5 L1,5 L7,8.5 Z"
											transform="rotate(180 4 5)"
										/>
									</svg>
									received
								</li>
								<li className={styles.legendItem}>
									<svg viewBox="0 0 40 10" aria-hidden="true">
										<line
											className={styles.legendMutual}
											x1="1"
											y1="3"
											x2="39"
											y2="3"
										/>
										<line
											className={styles.legendMutual}
											x1="1"
											y1="7"
											x2="39"
											y2="7"
										/>
									</svg>
									mutual
								</li>
							</ul>
						</section>

						<aside className={styles.rail}>
							<section className={styles.sheet} aria-labelledby="qr-heading">
								<h2 id="qr-heading" className={styles.sheetTitle}>
									My QR
								</h2>
								<QrPanel
									value={buildVouchUrl(shareOrigin(), viewer)}
									caption="Scanning this vouches for me"
								/>
							</section>

							<section className={styles.sheet} aria-labelledby="vouch-heading">
								<h2 id="vouch-heading" className={styles.sheetTitle}>
									Extend your hand
								</h2>
								<form
									className={styles.vouchForm}
									onSubmit={(e) => void handleVouch(e)}
								>
									<label htmlFor="vouch-target" className={styles.labelText}>
										Address or nido name
									</label>
									<div className={styles.vouchRow}>
										<input
											id="vouch-target"
											className={styles.vouchInput}
											value={vouchInput}
											onChange={(e) => setVouchInput(e.target.value)}
											placeholder="G…, C…, or a name"
											autoComplete="off"
											spellCheck={false}
										/>
										<button
											type="submit"
											className={styles.vouchSubmit}
											disabled={vouchBusy || vouchInput.trim() === ""}
										>
											{vouchBusy ? "Pressing…" : "Vouch"}
										</button>
									</div>
								</form>

								{vouchError && (
									<p className={styles.error} role="alert">
										{vouchError}
									</p>
								)}

								<h3 className={styles.givenTitle}>Given by your hand</h3>
								{given === null ? (
									<p className={styles.railNote}>Reading the record…</p>
								) : given.length === 0 ? (
									<p className={styles.railNote}>No vouches given yet.</p>
								) : (
									<ul className={styles.givenList}>
										{given.map((addr) => (
											<li key={addr} className={styles.givenEntry}>
												<span
													className={
														names[addr] != null
															? styles.givenName
															: styles.givenAddr
													}
													title={addr}
												>
													{labelOf(addr)}
												</span>
												<button
													type="button"
													className={styles.revoke}
													onClick={() => void handleRevoke(addr)}
													disabled={revoking !== null}
												>
													{revoking === addr ? "Revoking…" : "Revoke"}
												</button>
											</li>
										))}
									</ul>
								)}
							</section>
						</aside>
					</div>

					<section className={styles.letters} aria-labelledby="letters-heading">
						<div className={styles.lettersHead}>
							<h2 id="letters-heading" className={styles.lettersTitle}>
								Letters of introduction
							</h2>
							<p className={styles.lettersLede}>
								Vouch for someone who isn&rsquo;t on the ledger yet: seal a
								letter, hand over its code, and the vouch is theirs to claim
								when they arrive.
							</p>
						</div>

						<p className={styles.warning}>
							The QR is the vouch — anyone who scans it can claim one of its
							uses. A letter can be revoked until its uses are spent.
						</p>

						<div className={styles.lettersLayout}>
							<form
								className={styles.letterForm}
								onSubmit={(e) => void handleSeal(e)}
								aria-labelledby="seal-heading"
							>
								<div className={styles.letterFormHead}>
									<p className={styles.formKicker}>Write a letter</p>
									<h3 id="seal-heading" className={styles.formTitle}>
										Seal an introduction
									</h3>
								</div>

								<div className={styles.field}>
									<label htmlFor="letter-label" className={styles.labelText}>
										Label
									</label>
									<input
										id="letter-label"
										className={styles.textInput}
										value={letterLabel}
										onChange={(e) => setLetterLabel(e.target.value)}
										placeholder="For Alice…"
										autoComplete="off"
									/>
									<p className={styles.hint}>
										kept only in this browser, never on the ledger
									</p>
								</div>

								<div className={styles.fieldRow}>
									<div className={styles.field}>
										<label htmlFor="letter-uses" className={styles.labelText}>
											Uses
										</label>
										<input
											id="letter-uses"
											type="number"
											className={styles.numberInput}
											min={1}
											step={1}
											inputMode="numeric"
											value={usesInput}
											onChange={(e) => setUsesInput(e.target.value)}
											data-invalid={!usesValid || undefined}
										/>
									</div>
									<div className={styles.field}>
										<label htmlFor="letter-days" className={styles.labelText}>
											Valid for (days)
										</label>
										<input
											id="letter-days"
											type="number"
											className={styles.numberInput}
											min={1}
											step={1}
											inputMode="numeric"
											value={daysInput}
											onChange={(e) => setDaysInput(e.target.value)}
											placeholder="never expires"
											data-invalid={!daysValid || undefined}
										/>
										<p className={styles.hint}>
											{daysTrim === ""
												? "no expiry — stands until revoked"
												: currentLedger === null
													? "reading the network's ledger…"
													: daysValid
														? `≈ ledger ${currentLedger + daysNum * LEDGERS_PER_DAY}`
														: "whole days, at least 1"}
										</p>
									</div>
								</div>

								{letterError && (
									<p className={styles.error} role="alert">
										{letterError}
									</p>
								)}

								<button
									type="submit"
									className={styles.sealSubmit}
									disabled={!canSeal || sealing}
								>
									{sealing ? "Sealing…" : "Seal the letter"}
								</button>
							</form>

							{sortedInvites.length === 0 ? (
								<div className={styles.noLetters}>
									<p className={styles.noLettersKicker}>No letters yet</p>
									<p className={styles.noLettersBody}>
										Your writing desk is clear. Seal an introduction and it will
										wait here, ready to re-show its code or be revoked.
									</p>
								</div>
							) : (
								<ul className={styles.letterGrid}>
									{sortedInvites.map((invite) => (
										<li key={invite.pubkeyHex}>
											<LetterCard
												invite={invite}
												viewer={viewer}
												origin={shareOrigin()}
												currentLedger={currentLedger}
												onRemoved={() => setInvites(inviteStore.list())}
											/>
										</li>
									))}
								</ul>
							)}
						</div>
					</section>
				</>
			)}
		</div>
	)
}
