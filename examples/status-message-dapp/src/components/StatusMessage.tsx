import { isContractId, RelayerError } from "@nidohq/passkey-sdk"
import { resolveNidoName, lookupNidoName } from "../lib/nidoResolver"
import { accountOrigin } from "@nidohq/stellar-wallets-kit-module"
import { Button, Card, Icon, Input, Text } from "@stellar/design-system"
import { useEffect, useState } from "react"
import statusMessage from "../contracts/status_message"
import { stellarNetwork } from "../contracts/util"
import { useWallet } from "../hooks/useWallet"
import {
	startDelegation,
	readDelegationReturn,
	consumePendingDelegation,
	consumeAutoStartDelegation,
	shouldAutoStartDelegation,
} from "../lib/delegationHandover"
import {
	signUpdateMessageInPage,
	tipAuthorInPage,
	hasSessionKey,
	XLM_SAC_ID,
} from "../lib/nidoSign"
import { checkSessionKeyStatus } from "../lib/sessionKeyStatus"
import { NIDO_ID, nidoBase } from "../util/wallet"
import styles from "./StatusMessage.module.css"

type SaveState = "idle" | "loading" | "success" | "failure"
/** Tips add a terminal "pending": the relayer stopped answering but the tx
 *  may still land — neither success nor a retry-inviting failure. */
type TipState = SaveState | "pending"
type SessionKeyUiState = "missing" | "checking" | "live"
type SetSessionKeyUiState = (state: SessionKeyUiState) => void

/** Survives the enable-tipping redirect to the wallet and back, so the tip
 *  row can re-attach to the author the user was about to tip. */
const TIP_CONTEXT_KEY = "nido:tipContext"

/** The deployed status-message contract id (baked into the generated client). */
const CONTRACT_ID = statusMessage.options.contractId

/** Explorer link for a submitted transaction (demo runs on testnet). */
const explorerTxUrl = (hash: string) =>
	`https://stellar.expert/explorer/${stellarNetwork === "PUBLIC" ? "public" : "testnet"}/tx/${hash}`

/** Compact single-line rendering of a relayer error's `details` payload. */
const compactDetails = (details: unknown): string | null => {
	let s: string | null = null
	if (typeof details === "string") s = details
	else if (details != null) {
		try {
			s = JSON.stringify(details)
		} catch {
			s = null
		}
	}
	if (!s || s === "{}" || s === "[]") return null
	return s.length > 200 ? `${s.slice(0, 200)}…` : s
}

/**
 * "Tip rejected" copy: the error message, plus the relayer's error code and a
 * compact details string when present — so even a generic relayer message
 * (e.g. an unparsed simulation failure) leaves the user something actionable.
 */
const describeTipError = (e: unknown): string => {
	let msg = e instanceof Error ? e.message : String(e)
	if (e instanceof RelayerError) {
		if (e.code) msg += ` [${e.code}]`
		const details = compactDetails(e.details)
		if (details) msg += ` — ${details}`
	}
	return msg
}

const isRevokedSessionKeyError = (message: string): boolean =>
	/session passkey is not installed|delegation never committed|was revoked/i.test(
		message,
	)

function useSessionKeyUiState(
	account: string | null,
	targetContract: string,
): [SessionKeyUiState, SetSessionKeyUiState] {
	const [state, setState] = useState<SessionKeyUiState>("missing")

	useEffect(() => {
		let cancelled = false
		if (!account) {
			setState("missing")
			return
		}
		if (!hasSessionKey(account, targetContract)) {
			setState("missing")
			return
		}

		setState("checking")
		void checkSessionKeyStatus(account, targetContract)
			.then((status) => {
				if (cancelled) return
				setState(status === "live" ? "live" : "missing")
			})
			.catch((err) => {
				console.error(err)
				if (cancelled) return
				// Do not strand users behind an RPC blip; signing still re-checks before use.
				setState("live")
			})

		return () => {
			cancelled = true
		}
	}, [account, targetContract])

	return [state, setState]
}

/**
 * Read and write an account's on-chain status message via the scaffold-generated
 * `status_message` contract client.
 *
 * - "Your status" writes the *connected* account's message; `update_message`
 *   requires the author's auth. For a classic wallet, saving signs normally
 *   through the kit. For a **Nido** smart account, delegation happens on connect
 *   (auto), then saving signs `update_message` IN-PAGE with the dApp's session
 *   passkey — no wallet round-trip per save. A successful save reads the account
 *   back so the new status shows immediately.
 * - "Look up" reads any account's message with a read-only simulation. It's
 *   pre-filled with the connected account on connect / on return from the wallet.
 * - "Tip 1 XLM" sends the displayed author native XLM from the connected Nido
 *   account, signed in-page with a session key scoped to the XLM SAC and capped
 *   by a wallet-installed spending limit (5 XLM/day), submitted gaslessly via
 *   the Nido relayer. "Enable tipping" runs the same delegation round-trip as
 *   the status flow, just with the SAC target + limit params.
 */
export const StatusMessage = () => {
	const { address, walletId, signTransaction } = useWallet()
	const isNido = walletId === NIDO_ID
	const nidoAccount =
		isNido && address && isContractId(address) ? address : null

	const [draft, setDraft] = useState("")
	const [saveState, setSaveState] = useState<SaveState>("idle")
	const [saveError, setSaveError] = useState<string>()
	const [saveProgress, setSaveProgress] = useState<string>()

	const [lookupAddr, setLookupAddr] = useState("")
	const [lookupResult, setLookupResult] = useState<string | null>()
	const [lookupBusy, setLookupBusy] = useState(false)
	// The author whose status is currently displayed (set on read SUCCESS) —
	// the tip affordance attaches to THIS address, not the still-editable input.
	const [lookupAuthor, setLookupAuthor] = useState<string | null>(null)
	const [lookupError, setLookupError] = useState<string | null>(null)
	// Reverse-resolved Nido names (resolver `.well-known/nido.json`) for the
	// connected account and the displayed author — shown alongside / instead of
	// the raw C-address when the account has a registered name.
	const [accountName, setAccountName] = useState<string | null>(null)
	const [authorName, setAuthorName] = useState<string | null>(null)

	const [tipState, setTipState] = useState<TipState>("idle")
	const [tipError, setTipError] = useState<string>()
	const [tipProgress, setTipProgress] = useState<string>()
	const [tipHash, setTipHash] = useState<string>()

	const [statusSession] = useSessionKeyUiState(nidoAccount, CONTRACT_ID)
	const [tipSession, setTipSession] = useSessionKeyUiState(
		nidoAccount,
		XLM_SAC_ID,
	)
	const hasLocalStatusSession = nidoAccount
		? hasSessionKey(nidoAccount, CONTRACT_ID)
		: false
	const hasLocalTipSession = nidoAccount
		? hasSessionKey(nidoAccount, XLM_SAC_ID)
		: false
	const statusSessionUi =
		hasLocalStatusSession && statusSession === "missing"
			? "checking"
			: statusSession
	const tipSessionUi =
		hasLocalTipSession && tipSession === "missing" ? "checking" : tipSession
	const canTip = tipSessionUi === "live"

	// Pre-fill the lookup field with the connected account so you can read your
	// own status immediately. Only fills when empty, so it never clobbers typing.
	useEffect(() => {
		if (address && !lookupAddr) setLookupAddr(address)
	}, [address]) // eslint-disable-line react-hooks/exhaustive-deps

	// Reverse-resolve the connected account's Nido name via the resolver.
	useEffect(() => {
		setAccountName(null)
		if (!nidoAccount) return
		let cancelled = false
		void lookupNidoName(nidoAccount, nidoBase()).then((n) => {
			if (!cancelled) setAccountName(n)
		})
		return () => {
			cancelled = true
		}
	}, [nidoAccount])

	// Reverse-resolve the displayed author's Nido name via the resolver.
	useEffect(() => {
		setAuthorName(null)
		if (!lookupAuthor) return
		let cancelled = false
		void lookupNidoName(lookupAuthor, nidoBase()).then((n) => {
			if (!cancelled) setAuthorName(n)
		})
		return () => {
			cancelled = true
		}
	}, [lookupAuthor])

	// On return from the wallet's delegate page, clear the stored request and
	// drop the ?delegation param so a reload doesn't re-trigger anything. If
	// the round trip was enable-tipping, restore the tip context: re-read the
	// author the user was about to tip so the (now enabled) Tip button
	// reappears instead of silently vanishing until a manual re-read.
	useEffect(() => {
		const status = readDelegationReturn()
		if (!status) return
		consumePendingDelegation()
		const clean = new URL(window.location.href)
		clean.searchParams.delete("delegation")
		window.history.replaceState({}, "", clean.toString())
		try {
			const raw = sessionStorage.getItem(TIP_CONTEXT_KEY)
			sessionStorage.removeItem(TIP_CONTEXT_KEY)
			// Only restore on an INSTALLED delegation — a cancelled return must
			// not auto-surface a Tip row for a session key that never landed.
			const author =
				status === "ok" && raw
					? (JSON.parse(raw) as { author?: string }).author
					: undefined
			if (author) {
				setLookupAddr(author)
				void readStatus(author)
			}
		} catch {
			// best-effort restore only
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	const delegate = async () => {
		if (!nidoAccount) {
			setSaveError("Connect a Nido smart account (C-address) first.")
			return
		}
		setSaveError(undefined)
		try {
			// Creates a passkey at THIS origin, then full-page redirects to
			// <account>.nido.fyi/security/delegate/ to authorize it. Returns here
			// with ?delegation=ok (handled by the effect above).
			await startDelegation({
				walletOrigin: accountOrigin(nidoBase(), nidoAccount),
				account: nidoAccount,
				targetContract: CONTRACT_ID,
				duration: "30d",
				returnUrl: window.location.href,
				label: "status-message",
			})
			// Redirect happens; code below won't run.
		} catch (e) {
			setSaveError(e instanceof Error ? e.message : String(e))
		}
	}

	// Auto-start delegation when the user just picked Nido in the selector. The
	// one-shot flag is set at connect time (util/wallet); consuming it here —
	// before any redirect — is what prevents a loop on a cancelled return.
	useEffect(() => {
		if (!nidoAccount || statusSessionUi === "checking") return
		const flagged = consumeAutoStartDelegation()
		if (
			shouldAutoStartDelegation({
				account: nidoAccount,
				flaggedAccount: flagged,
				hasSessionKey: statusSessionUi === "live",
			})
		) {
			void delegate()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [nidoAccount, statusSessionUi])

	// Read an account's on-chain status (read-only simulation) into the lookup card.
	const readStatus = async (author: string) => {
		setLookupBusy(true)
		setTipState("idle")
		setTipError(undefined)
		setTipHash(undefined)
		try {
			const tx = await statusMessage.get_message({ author })
			// `result` is the simulated Option<string> (undefined when unset).
			setLookupResult(tx.result ?? null)
			// Pair the tip affordance only with a COMPLETED read: set on success
			// (batched with the result above) so the row never shows the new
			// author against a stale result, and never survives a failed read.
			setLookupAuthor(author)
		} catch (e) {
			console.error(e)
			setLookupResult(null)
			setLookupAuthor(null)
		} finally {
			setLookupBusy(false)
		}
	}

	const save = async () => {
		if (!address) {
			setSaveState("failure")
			setSaveError("Connect a wallet first.")
			return
		}
		setSaveState("loading")
		setSaveError(undefined)
		setSaveProgress(undefined)
		try {
			if (isNido) {
				// In-page session-passkey signing (no wallet round-trip).
				await signUpdateMessageInPage({
					account: address,
					message: draft,
					contractId: CONTRACT_ID,
					onProgress: setSaveProgress,
				})
			} else {
				// Classic wallet: sign and broadcast normally.
				//
				// Guard: if the wallet signals it already submitted the tx on-chain
				// (Nido relayer / model A — `submitted: true` on the kit result),
				// we must NOT re-broadcast.  We detect this by wrapping
				// `signTransaction` so that a submitted-marker throws a sentinel
				// that short-circuits `signAndSend`'s internal broadcast step.
				class AlreadySubmittedError extends Error {
					constructor() {
						super("nido:already_submitted")
						this.name = "AlreadySubmittedError"
					}
				}
				const tx = await statusMessage.update_message(
					{ message: draft, author: address },
					{ publicKey: address },
				)
				try {
					await tx.signAndSend({
						signTransaction: async (xdr, opts) => {
							const result = await signTransaction(xdr, opts)
							// When the Nido relayer submitted on our behalf, `result`
							// carries `submitted: true` and `signedTxXdr` is the tx hash.
							// Throw sentinel so `signAndSend` never tries to broadcast.
							if (result && "submitted" in result && result.submitted) {
								throw new AlreadySubmittedError()
							}
							return result
						},
					})
				} catch (e) {
					// Re-throw anything that isn't our own sentinel.
					//
					// IMPLEMENTATION ASSUMPTION: stellar-sdk's `signAndSend` does NOT
					// catch or wrap errors thrown from the `signTransaction` callback —
					// it lets them propagate as-is to the outer try/catch. This sentinel
					// pattern relies on that behaviour. If a future stellar-sdk version
					// wraps callback errors, AlreadySubmittedError would be re-thrown
					// here and the `submitted: true` path would incorrectly surface as
					// a failure.
					if (!(e instanceof AlreadySubmittedError)) throw e
					// Otherwise: tx was already submitted by the relayer — treat as success.
				}
			}
			setSaveState("success")
			// Confirmation of the write → surface it by reading the account back.
			setLookupAddr(address)
			void readStatus(address)
		} catch (e) {
			console.error(e)
			setSaveState("failure")
			setSaveError(e instanceof Error ? e.message : String(e))
		} finally {
			setSaveProgress(undefined)
		}
	}

	const lookup = async () => {
		const raw = (lookupAddr.trim() || address || "").trim()
		if (!raw) return
		setLookupError(null)
		// A C-/G- strkey reads directly; anything else is treated as a Nido name
		// and resolved to its address via the resolver before reading.
		if (/^[GC][A-Z2-7]{55}$/.test(raw)) {
			void readStatus(raw)
			return
		}
		setLookupBusy(true)
		const resolved = await resolveNidoName(raw, nidoBase())
		setLookupBusy(false)
		if (!resolved) {
			setLookupResult(undefined)
			setLookupAuthor(null)
			setLookupError(`No Nido account named “${raw}”.`)
			return
		}
		setLookupAddr(resolved)
		void readStatus(resolved)
	}

	// Delegate a tipping session key scoped to the XLM SAC, capped at 5 XLM per
	// rolling day. Same wallet round-trip as `delegate` above: the pending
	// record persists locally because the wallet replaces the return URL's
	// query string (see delegationHandover.ts).
	const enableTipping = async () => {
		if (!nidoAccount) return
		setTipError(undefined)
		// Busy until the redirect unloads the page — a double-click would create
		// a second passkey whose material orphans the first's.
		setTipState("loading")
		try {
			// Persist the tip target across the redirect (the wallet replaces our
			// query string, and the remount resets lookupAuthor).
			if (lookupAuthor) {
				sessionStorage.setItem(
					TIP_CONTEXT_KEY,
					JSON.stringify({ author: lookupAuthor }),
				)
			}
			await startDelegation({
				walletOrigin: accountOrigin(nidoBase(), nidoAccount),
				account: nidoAccount,
				targetContract: XLM_SAC_ID,
				duration: "30d",
				limit: "5",
				limitPeriod: "day",
				returnUrl: window.location.href,
				label: "Tipping",
			})
			// Redirect happens; code below won't run.
		} catch (e) {
			// No redirect happened (e.g. passkey creation cancelled) — drop the
			// stored context so a LATER unrelated return can't consume it.
			sessionStorage.removeItem(TIP_CONTEXT_KEY)
			setTipState("failure")
			setTipError(e instanceof Error ? e.message : String(e))
		}
	}

	// Gasless 1 XLM tip through the relayer, signed with the tipping passkey.
	const tip = async () => {
		if (!nidoAccount || !lookupAuthor) return
		setTipState("loading")
		setTipError(undefined)
		setTipHash(undefined)
		try {
			const { hash } = await tipAuthorInPage({
				account: nidoAccount,
				author: lookupAuthor,
				xlm: 1,
				onProgress: setTipProgress,
			})
			setTipHash(hash)
			setTipState("success")
		} catch (e) {
			console.error(e)
			if (e instanceof RelayerError && e.code === "WAIT_TIMEOUT") {
				// The relayer stopped answering but the tx may STILL land —
				// "rejected" plus a re-enabled button here is a double-tip
				// invitation. Park the row in a terminal pending state with the
				// explorer link when the relayer returned a hash.
				const last = e.details as { hash?: string | null } | undefined
				if (last?.hash) setTipHash(last.hash)
				setTipError(undefined)
				setTipState("pending")
				return
			}
			const message = describeTipError(e)
			if (isRevokedSessionKeyError(message)) setTipSession("missing")
			setTipState("failure")
			// Relayer / policy rejections (e.g. over the 5 XLM/day limit) arrive as
			// error messages — surface them readably, with the relayer's code and
			// details appended when present. The session material is KEPT: the rule
			// may still allow smaller amounts, or the window may roll over.
			setTipError(`Tip rejected: ${message}`)
		} finally {
			setTipProgress(undefined)
		}
	}

	return (
		<div className={styles.StatusMessage}>
			<Card>
				<Text as="h3" size="md" weight="medium">
					Your status
				</Text>
				<Text as="p" size="sm">
					{address
						? "Set the status message stored on-chain under your connected account."
						: "Connect a wallet to set your status message."}
				</Text>

				{nidoAccount && (
					<Text as="p" size="sm" addlClassName={styles.accountLink}>
						{accountName && (
							<>
								Your Nido name: <strong>{accountName}</strong> ·{" "}
							</>
						)}
						<a
							href={accountOrigin(nidoBase(), nidoAccount)}
							target="_blank"
							rel="noreferrer"
						>
							Manage this account on Nido
						</a>
					</Text>
				)}

				<div className={styles.row}>
					<Input
						id="status-draft"
						fieldSize="md"
						placeholder="gm — feeling soroban today"
						value={draft}
						disabled={!address || saveState === "loading"}
						error={saveState === "failure" ? saveError : undefined}
						onChange={(e) => {
							setDraft(e.target.value)
							setSaveState("idle")
						}}
					/>
					<Button
						variant="primary"
						size="md"
						disabled={!address || saveState === "loading"}
						isLoading={saveState === "loading"}
						onClick={() => void save()}
					>
						Save
					</Button>
				</div>
				{saveState === "loading" && saveProgress && (
					<Text as="div" size="sm" addlClassName={styles.progress}>
						{saveProgress}
					</Text>
				)}
				{saveState === "success" && (
					<Text as="div" size="sm" addlClassName={styles.success}>
						<Icon.CheckCircle size="sm" /> Saved on-chain.
					</Text>
				)}
			</Card>

			<Card>
				<Text as="h3" size="md" weight="medium">
					Look up a status
				</Text>
				<Text as="p" size="sm">
					Read any account&apos;s on-chain status. Pre-filled with your
					connected account; leave it to read your own.
				</Text>
				<div className={styles.row}>
					<Input
						id="status-lookup"
						fieldSize="md"
						placeholder="C…/G… address or a Nido name"
						value={lookupAddr}
						onChange={(e) => {
							setLookupAddr(e.target.value)
							setLookupError(null)
						}}
					/>
					<Button
						variant="secondary"
						size="md"
						disabled={lookupBusy || (!lookupAddr.trim() && !address)}
						isLoading={lookupBusy}
						onClick={() => void lookup()}
					>
						Read
					</Button>
				</div>
				{lookupError && (
					<Text as="div" size="sm" addlClassName={styles.result}>
						<em>{lookupError}</em>
					</Text>
				)}
				{lookupResult !== undefined && (
					<Text as="div" size="sm" addlClassName={styles.result}>
						{authorName && (
							<div>
								Status for <strong>{authorName}</strong>:
							</div>
						)}
						{lookupResult === null ? (
							<em>No status set for that account.</em>
						) : (
							<>“{lookupResult}”</>
						)}
					</Text>
				)}

				{/* Tip the displayed author from the connected Nido account — signed
				    in-page with a SPENDING-LIMITED session key, submitted gaslessly
				    through the relayer. Hidden for your own account (no self-tips). */}
				{nidoAccount &&
					lookupAuthor &&
					lookupResult !== undefined &&
					lookupAuthor !== nidoAccount && (
						<>
							<div className={styles.tipRow}>
								{tipSessionUi === "checking" ? (
									<Button variant="tertiary" size="md" disabled>
										Checking tipping
									</Button>
								) : canTip ? (
									<Button
										variant="tertiary"
										size="md"
										disabled={tipState === "loading" || tipState === "pending"}
										isLoading={tipState === "loading"}
										onClick={() => void tip()}
									>
										Tip 1 XLM
									</Button>
								) : (
									<Button
										variant="tertiary"
										size="md"
										disabled={tipState === "loading"}
										isLoading={tipState === "loading"}
										onClick={() => void enableTipping()}
									>
										Enable tipping
									</Button>
								)}
								<Text as="span" size="sm" addlClassName={styles.tipHint}>
									{tipSessionUi === "checking"
										? "Verifying the tipping passkey on-chain."
										: canTip
											? "Gasless — sent through the Nido relayer."
											: "Adds a tipping passkey capped at 5 XLM per day."}
								</Text>
							</div>
							{tipState === "loading" && tipProgress && (
								<Text as="div" size="sm" addlClassName={styles.progress}>
									{tipProgress}
								</Text>
							)}
							{tipState === "success" && tipHash && (
								<Text as="div" size="sm" addlClassName={styles.success}>
									<Icon.CheckCircle size="sm" /> Tipped 1 XLM.{" "}
									<a
										href={explorerTxUrl(tipHash)}
										target="_blank"
										rel="noreferrer"
									>
										View transaction
									</a>
								</Text>
							)}
							{tipState === "pending" && (
								<Text as="div" size="sm" addlClassName={styles.progress}>
									Tip submitted — still confirming.{" "}
									{tipHash && (
										<a
											href={explorerTxUrl(tipHash)}
											target="_blank"
											rel="noreferrer"
										>
											Check the transaction
										</a>
									)}{" "}
									Verify it before tipping again.
								</Text>
							)}
							{tipState === "failure" && tipError && (
								<Text as="div" size="sm" addlClassName={styles.error}>
									{tipError}
								</Text>
							)}
						</>
					)}
			</Card>
		</div>
	)
}
