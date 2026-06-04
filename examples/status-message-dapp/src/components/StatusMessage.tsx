import { isContractId } from "@g2c/passkey-sdk"
import { accountOrigin } from "@g2c/stellar-wallets-kit-module"
import { Button, Card, Icon, Input, Text } from "@stellar/design-system"
import { useEffect, useState } from "react"
import statusMessage from "../contracts/status_message"
import { useWallet } from "../hooks/useWallet"
import {
	startDelegation,
	readDelegationReturn,
	consumePendingDelegation,
	consumeAutoStartDelegation,
	shouldAutoStartDelegation,
} from "../lib/delegationHandover"
import { signUpdateMessageInPage, hasSessionKey } from "../lib/nidoSign"
import { G2C_ID, g2cBase } from "../util/wallet"
import styles from "./StatusMessage.module.css"

type SaveState = "idle" | "loading" | "success" | "failure"

/** The deployed status-message contract id (baked into the generated client). */
const CONTRACT_ID = statusMessage.options.contractId

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
 */
export const StatusMessage = () => {
	const { address, walletId, signTransaction } = useWallet()
	const isNido = walletId === G2C_ID
	const nidoAccount = isNido && address && isContractId(address) ? address : null

	const [draft, setDraft] = useState("")
	const [saveState, setSaveState] = useState<SaveState>("idle")
	const [saveError, setSaveError] = useState<string>()
	const [saveProgress, setSaveProgress] = useState<string>()

	const [lookupAddr, setLookupAddr] = useState("")
	const [lookupResult, setLookupResult] = useState<string | null>()
	const [lookupBusy, setLookupBusy] = useState(false)

	// Pre-fill the lookup field with the connected account so you can read your
	// own status immediately. Only fills when empty, so it never clobbers typing.
	useEffect(() => {
		if (address && !lookupAddr) setLookupAddr(address)
	}, [address]) // eslint-disable-line react-hooks/exhaustive-deps

	// On return from the wallet's delegate page, clear the stored request and
	// drop the ?delegation param so a reload doesn't re-trigger anything.
	useEffect(() => {
		if (!readDelegationReturn()) return
		consumePendingDelegation()
		const clean = new URL(window.location.href)
		clean.searchParams.delete("delegation")
		window.history.replaceState({}, "", clean.toString())
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
				walletOrigin: accountOrigin(g2cBase(), nidoAccount),
				account: nidoAccount,
				targetContract: CONTRACT_ID,
				duration: "24h",
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
		if (!nidoAccount) return
		const flagged = consumeAutoStartDelegation()
		if (
			shouldAutoStartDelegation({
				account: nidoAccount,
				flaggedAccount: flagged,
				hasSessionKey: hasSessionKey(nidoAccount, CONTRACT_ID),
			})
		) {
			void delegate()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [nidoAccount])

	// Read an account's on-chain status (read-only simulation) into the lookup card.
	const readStatus = async (author: string) => {
		setLookupBusy(true)
		try {
			const tx = await statusMessage.get_message({ author })
			// `result` is the simulated Option<string> (undefined when unset).
			setLookupResult(tx.result ?? null)
		} catch (e) {
			console.error(e)
			setLookupResult(null)
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
				// Classic wallet: a G-address is a valid source + author; sign normally.
				const tx = await statusMessage.update_message(
					{ message: draft, author: address },
					{ publicKey: address },
				)
				await tx.signAndSend({ signTransaction })
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

	const lookup = () => {
		const author = lookupAddr.trim() || address
		if (author) void readStatus(author)
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
						<a
							href={accountOrigin(g2cBase(), nidoAccount)}
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
					Read any account&apos;s on-chain status. Pre-filled with your connected
					account; leave it to read your own.
				</Text>
				<div className={styles.row}>
					<Input
						id="status-lookup"
						fieldSize="md"
						placeholder="C… or G… address"
						value={lookupAddr}
						onChange={(e) => setLookupAddr(e.target.value)}
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
				{lookupResult !== undefined && (
					<Text as="div" size="sm" addlClassName={styles.result}>
						{lookupResult === null ? (
							<em>No status set for that account.</em>
						) : (
							<>“{lookupResult}”</>
						)}
					</Text>
				)}
			</Card>
		</div>
	)
}
