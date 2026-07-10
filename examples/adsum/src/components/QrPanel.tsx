import QRCode from "qrcode"
import { useEffect, useRef, useState } from "react"
import styles from "./QrPanel.module.css"

export interface QrPanelProps {
	/** The full text encoded in the QR — also what the Copy button copies. */
	value: string
	/** One line under the plate saying what scanning it does. */
	caption: string
}

/**
 * QR modules are printed in fixed iron-gall-on-paper colours (a data URL
 * can't follow the theme), and the plate always sits on a light paper chip
 * so it scans in either edition.
 */
const QR_OPTIONS = {
	margin: 1,
	width: 512,
	errorCorrectionLevel: "M",
	color: { dark: "#211c13", light: "#faf5e9" },
} as const

const TRUNCATE_AT = 44

/** Middle-truncate long values for display; Copy always takes the full text. */
const displayValue = (value: string) =>
	value.length <= TRUNCATE_AT
		? value
		: `${value.slice(0, 26)}…${value.slice(-10)}`

/**
 * A QR code printed like a tipped-in plate: the code on a pasted paper chip,
 * a caption beneath, and the encoded value with a copy button. The QR is
 * rendered client-side (`qrcode`'s `toDataURL`) into a plain <img>.
 */
export const QrPanel = ({ value, caption }: QrPanelProps) => {
	const [src, setSrc] = useState<string | null>(null)
	const [failed, setFailed] = useState(false)
	const [copied, setCopied] = useState(false)
	const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		let cancelled = false
		setSrc(null)
		setFailed(false)
		QRCode.toDataURL(value, QR_OPTIONS)
			.then((url) => {
				if (!cancelled) setSrc(url)
			})
			.catch(() => {
				// Deliberately not logging: `value` can carry an invite secret.
				if (!cancelled) setFailed(true)
			})
		return () => {
			cancelled = true
		}
	}, [value])

	useEffect(
		() => () => {
			if (copyTimer.current) clearTimeout(copyTimer.current)
		},
		[],
	)

	async function copy() {
		try {
			await navigator.clipboard.writeText(value)
			setCopied(true)
			if (copyTimer.current) clearTimeout(copyTimer.current)
			copyTimer.current = setTimeout(() => setCopied(false), 1800)
		} catch {
			// Clipboard refused (permissions) — the value is still visible to
			// select by hand; stay quiet rather than log it.
		}
	}

	return (
		<figure className={styles.panel}>
			{failed ? (
				<p className={styles.failed}>
					The code couldn&rsquo;t be drawn — copy the link below instead.
				</p>
			) : (
				<span className={styles.chip}>
					{src ? (
						<img className={styles.code} src={src} alt={caption} />
					) : (
						<span className={styles.pending} aria-hidden="true" />
					)}
				</span>
			)}
			<figcaption className={styles.caption}>{caption}</figcaption>
			<span className={styles.valueRow}>
				<code className={styles.value}>{displayValue(value)}</code>
				<button
					type="button"
					className={styles.copy}
					onClick={() => void copy()}
					data-copied={copied || undefined}
				>
					{copied ? "Copied" : "Copy"}
				</button>
			</span>
		</figure>
	)
}
