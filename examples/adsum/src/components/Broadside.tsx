import { type ElementType, type KeyboardEvent, type ReactNode } from "react"
import styles from "./Broadside.module.css"

export interface BroadsideProps {
	title: string
	/** Document text set in the display serif. */
	body?: string
	children?: ReactNode
	/** Makes the sheet interactive (keyboard included). */
	onClick?: () => void
	/** Rendered element; defaults to <article>. */
	as?: ElementType
}

/**
 * The document primitive: a printed sheet laid on the page. A fine double
 * frame, a Fraunces title under a hairline rule, optional document body,
 * then whatever the caller sets beneath. With `onClick` the whole sheet is
 * pressable — pointer and keyboard alike.
 */
export const Broadside = ({
	title,
	body,
	children,
	onClick,
	as: Tag = "article",
}: BroadsideProps) => {
	const interactive = onClick !== undefined
	const onKeyDown = interactive
		? (event: KeyboardEvent) => {
				if (event.target !== event.currentTarget) return
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault()
					onClick()
				}
			}
		: undefined

	return (
		<Tag
			className={
				interactive ? `${styles.sheet} ${styles.pressable}` : styles.sheet
			}
			onClick={onClick}
			onKeyDown={onKeyDown}
			role={interactive ? "button" : undefined}
			tabIndex={interactive ? 0 : undefined}
		>
			<header className={styles.heading}>
				<h2 className={styles.title}>{title}</h2>
			</header>
			{body === undefined ? null : <p className={styles.body}>{body}</p>}
			{children}
		</Tag>
	)
}
