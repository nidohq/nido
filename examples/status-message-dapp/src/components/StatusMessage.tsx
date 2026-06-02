import { Button, Card, Icon, Input, Text } from "@stellar/design-system"
import { useState } from "react"
import statusMessage from "../contracts/status_message"
import { useWallet } from "../hooks/useWallet"
import styles from "./StatusMessage.module.css"

type SaveState = "idle" | "loading" | "success" | "failure"

/**
 * Read and write an account's on-chain status message via the scaffold-generated
 * `status_message` contract client.
 *
 * - "Your status" writes the *connected* account's message; `update_message`
 *   requires the author's auth, so signing routes through the selected wallet —
 *   for g2c that is the passkey ceremony, for classic wallets a normal signature.
 * - "Look up" reads any account's message with a read-only simulation (no
 *   signature, no connection required).
 */
export const StatusMessage = () => {
	const { address, signTransaction } = useWallet()

	const [draft, setDraft] = useState("")
	const [saveState, setSaveState] = useState<SaveState>("idle")
	const [saveError, setSaveError] = useState<string>()

	const [lookupAddr, setLookupAddr] = useState("")
	const [lookupResult, setLookupResult] = useState<string | null>()
	const [lookupBusy, setLookupBusy] = useState(false)

	const save = async () => {
		if (!address) {
			setSaveState("failure")
			setSaveError("Connect a wallet first.")
			return
		}
		setSaveState("loading")
		setSaveError(undefined)
		try {
			const tx = await statusMessage.update_message(
				{ message: draft, author: address },
				{ publicKey: address },
			)
			await tx.signAndSend({ signTransaction })
			setSaveState("success")
		} catch (e) {
			console.error(e)
			setSaveState("failure")
			setSaveError(e instanceof Error ? e.message : String(e))
		}
	}

	const lookup = async () => {
		const author = lookupAddr.trim() || address
		if (!author) return
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
					Read any account&apos;s on-chain status. Leave blank to read your own.
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
