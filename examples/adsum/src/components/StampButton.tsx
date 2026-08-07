import styles from "./StampButton.module.css"

export type StampState = "ready" | "busy" | "stamped" | "disabled"

export interface StampButtonProps {
	state: StampState
	/** Fired once per press while `state` is "ready". */
	onStamp: () => void
	/** The word on the stamp face. Defaults to the ADSUM mark. */
	label?: string
}

/**
 * The ADSUM stamp — signing rendered as a press. A real <button>:
 * disabled/busy are natively `disabled`, the impressed state is announced
 * with `aria-pressed`, and every animation sits behind
 * prefers-reduced-motion (state changes are instant without it).
 */
export const StampButton = ({ state, onStamp, label }: StampButtonProps) => {
	return (
		<button
			type="button"
			className={styles.stamp}
			data-state={state}
			disabled={state !== "ready"}
			aria-pressed={state === "stamped"}
			aria-label={
				state === "busy"
					? `${label ?? "Adsum"} — stamping`
					: (label ?? "Adsum — I am present")
			}
			onClick={state === "ready" ? onStamp : undefined}
		>
			<span className={styles.face} aria-hidden="true">
				<span className={styles.word}>{label ?? "ADSUM"}</span>
				<span className={styles.motto}>
					{state === "busy" ? "pressing…" : "I am present"}
				</span>
			</span>
		</button>
	)
}
