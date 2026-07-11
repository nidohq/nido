import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useWallet } from "../hooks/useWallet"
import { ledgerForDate } from "../lib/ledgerTime"
import { createPetition } from "../lib/petitions"
import {
	BODY_MAX_BYTES,
	TITLE_MAX_BYTES,
	utf8ByteLength,
} from "../lib/textBytes"
import { connectWallet } from "../util/wallet"
import styles from "./CreatePetition.module.css"

export interface CreatePetitionProps {
	/**
	 * Latest known ledger sequence, for the deadline date -> ledger estimate.
	 * `null` while it is still loading — the deadline field is disabled until
	 * then, so nothing is submitted against a guessed base ledger.
	 */
	currentLedger: number | null
	/** Fired with the new petition's id, just before navigating to it. */
	onCreated?: (id: number) => void
}

/**
 * The submission slot on the wall: compose a bill, watch the byte counters,
 * press it into the record. Styled as its own printed form — the same double
 * frame and Fraunces heading as a `Broadside`, but with fields instead of
 * read-only text. Disconnected readers get a connect prompt in place of the
 * submit button rather than a merely-disabled one.
 */
export const CreatePetition = ({
	currentLedger,
	onCreated,
}: CreatePetitionProps) => {
	const { address } = useWallet()
	const navigate = useNavigate()

	const [title, setTitle] = useState("")
	const [body, setBody] = useState("")
	const [goalInput, setGoalInput] = useState("")
	const [deadlineInput, setDeadlineInput] = useState("")
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const titleBytes = utf8ByteLength(title)
	const bodyBytes = utf8ByteLength(body)
	const titleValid = titleBytes > 0 && titleBytes <= TITLE_MAX_BYTES
	const bodyValid = bodyBytes > 0 && bodyBytes <= BODY_MAX_BYTES

	const goalTrim = goalInput.trim()
	const goalNum = goalTrim === "" ? null : Number(goalTrim)
	const goalValid =
		goalTrim === "" || (Number.isInteger(goalNum) && (goalNum as number) > 0)

	const deadlineLedger =
		deadlineInput && currentLedger != null
			? ledgerForDate(new Date(`${deadlineInput}T00:00:00`), currentLedger)
			: null

	const canSubmit = titleValid && bodyValid && goalValid

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (!address || !canSubmit || submitting) return

		setSubmitting(true)
		setError(null)
		try {
			const result = await createPetition(
				{
					title,
					body,
					goal: goalTrim === "" ? null : Number(goalTrim),
					deadline: deadlineInput ? deadlineLedger : null,
				},
				address,
			)
			if (typeof result.id === "number") {
				onCreated?.(result.id)
				void navigate(`/petition/${result.id}`)
				return
			}
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Something went wrong posting this petition.",
			)
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<form
			className={styles.form}
			onSubmit={(e) => void handleSubmit(e)}
			aria-labelledby="compose-heading"
		>
			<div className={styles.heading}>
				<p className={styles.kicker}>Post a bill</p>
				<h2 id="compose-heading" className={styles.legend}>
					Compose a petition
				</h2>
			</div>

			<div className={styles.field}>
				<div className={styles.labelRow}>
					<label htmlFor="petition-title" className={styles.labelText}>
						Title
					</label>
					<span
						className={styles.counter}
						data-over={titleBytes > TITLE_MAX_BYTES || undefined}
					>
						{titleBytes}/{TITLE_MAX_BYTES}
					</span>
				</div>
				<input
					id="petition-title"
					className={styles.titleInput}
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="A bill to…"
					autoComplete="off"
				/>
			</div>

			<div className={styles.field}>
				<div className={styles.labelRow}>
					<label htmlFor="petition-body" className={styles.labelText}>
						Body
					</label>
					<span
						className={styles.counter}
						data-over={bodyBytes > BODY_MAX_BYTES || undefined}
					>
						{bodyBytes}/{BODY_MAX_BYTES}
					</span>
				</div>
				<textarea
					id="petition-body"
					className={styles.bodyInput}
					value={body}
					onChange={(e) => setBody(e.target.value)}
					rows={6}
					placeholder="State the case, in full."
				/>
			</div>

			<div className={styles.metaRow}>
				<div className={styles.field}>
					<div className={styles.labelRow}>
						<label htmlFor="petition-goal" className={styles.labelText}>
							Signature goal
						</label>
						<span className={styles.optional}>optional</span>
					</div>
					<input
						id="petition-goal"
						type="number"
						className={styles.metaInput}
						min={1}
						step={1}
						inputMode="numeric"
						value={goalInput}
						onChange={(e) => setGoalInput(e.target.value)}
						placeholder="No goal"
						data-invalid={(goalTrim !== "" && !goalValid) || undefined}
					/>
				</div>

				<div className={styles.field}>
					<div className={styles.labelRow}>
						<label htmlFor="petition-deadline" className={styles.labelText}>
							Deadline
						</label>
						<span className={styles.optional}>optional</span>
					</div>
					<input
						id="petition-deadline"
						type="date"
						className={styles.metaInput}
						value={deadlineInput}
						onChange={(e) => setDeadlineInput(e.target.value)}
						disabled={currentLedger == null}
					/>
					<p className={styles.hint}>
						{currentLedger == null
							? "reading the network's ledger…"
							: deadlineInput && deadlineLedger != null
								? `≈ ledger ${deadlineLedger}`
								: "no deadline — stays open"}
					</p>
				</div>
			</div>

			{error && (
				<p className={styles.error} role="alert">
					{error}
				</p>
			)}

			<div className={styles.actions}>
				{address ? (
					<button
						type="submit"
						className={styles.submit}
						disabled={!canSubmit || submitting}
					>
						{submitting ? "Posting…" : "Post to the wall"}
					</button>
				) : (
					<button
						type="button"
						className={styles.submit}
						onClick={() => void connectWallet()}
					>
						Connect to post
					</button>
				)}
			</div>
		</form>
	)
}
