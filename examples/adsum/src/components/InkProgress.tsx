import styles from "./InkProgress.module.css"

export interface InkProgressProps {
	value: number
	/** When omitted the petition has no goal: render an open-ended tally. */
	max?: number
}

const formatter = new Intl.NumberFormat()

/**
 * Progress as a filling ink line. With a `max` it is a proper progressbar
 * (aria-valuenow/-valuemax); the line turns vermilion when the goal is met
 * — the document is sealed. Without a `max` it renders an open-ended
 * tally: the count in display type over a rule that trails off the page.
 */
export const InkProgress = ({ value, max }: InkProgressProps) => {
	if (max === undefined) {
		return (
			<div className={styles.tally}>
				<span className={styles.count}>{formatter.format(value)}</span>
				<span className={styles.word}>present</span>
				<span className={styles.trail} aria-hidden="true" />
			</div>
		)
	}

	const clamped = Math.max(0, Math.min(value, max))
	const percent = max > 0 ? (clamped / max) * 100 : 0
	const sealed = max > 0 && value >= max

	return (
		<div className={styles.wrap} data-sealed={sealed || undefined}>
			<div
				className={styles.line}
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={max}
				aria-valuenow={clamped}
				aria-label={`${formatter.format(value)} of ${formatter.format(max)} present`}
			>
				<div className={styles.fill} style={{ width: `${percent}%` }} />
			</div>
			<p className={styles.legend}>
				<span className={styles.count}>{formatter.format(value)}</span>
				<span className={styles.word}>
					of {formatter.format(max)} {sealed ? "— sealed" : "present"}
				</span>
			</p>
		</div>
	)
}
