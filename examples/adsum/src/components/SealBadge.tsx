import styles from "./SealBadge.module.css"

export type SealTone = "neutral" | "you" | "kin"

export interface SealBadgeProps {
	count: number
	/**
	 * neutral — plain ink mark; you — the viewer vouched for them (solid
	 * seal); kin — vouched by someone the viewer vouches for (bronze ring).
	 */
	tone?: SealTone
}

const TONE_NOTE: Record<SealTone, string> = {
	neutral: "",
	you: ", vouched by you",
	kin: ", vouched by someone you vouch for",
}

const formatter = new Intl.NumberFormat()

/**
 * A small ink-mark: the vouch count pressed beside a name like a chop.
 * Tones mark the viewer's relationship to the signer.
 */
export const SealBadge = ({ count, tone = "neutral" }: SealBadgeProps) => {
	const label = `${formatter.format(count)} ${count === 1 ? "vouch" : "vouches"}${TONE_NOTE[tone]}`
	return (
		<span
			className={`${styles.seal} ${styles[tone]}`}
			role="img"
			aria-label={label}
			title={label}
		>
			{formatter.format(count)}
		</span>
	)
}
