import { useEffect, useState, type ReactNode } from "react"
import { Link, NavLink } from "react-router-dom"
import { useWallet } from "../hooks/useWallet"
import { connectWallet, disconnectWallet } from "../util/wallet"
import styles from "./PageShell.module.css"

const THEME_KEY = "adsum:theme"
type Edition = "light" | "dark"

const storedEdition = (): Edition | null => {
	const stored = localStorage.getItem(THEME_KEY)
	return stored === "light" || stored === "dark" ? stored : null
}

const systemEdition = (): Edition =>
	window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"

/**
 * Theme toggle: paper (light) vs ink (dark) edition. Respects
 * prefers-color-scheme until the reader chooses; the choice is pinned via
 * `data-theme` on <html> and persisted under `adsum:theme` (applied before
 * first paint in main.tsx).
 */
const EditionToggle = () => {
	const [edition, setEdition] = useState<Edition>(
		() => storedEdition() ?? systemEdition(),
	)

	// Follow the system while the reader has not chosen an edition.
	useEffect(() => {
		if (storedEdition()) return
		const query = window.matchMedia("(prefers-color-scheme: dark)")
		const follow = () => {
			if (!storedEdition()) setEdition(query.matches ? "dark" : "light")
		}
		query.addEventListener("change", follow)
		return () => query.removeEventListener("change", follow)
	}, [])

	const next: Edition = edition === "dark" ? "light" : "dark"
	const choose = () => {
		document.documentElement.dataset.theme = next
		localStorage.setItem(THEME_KEY, next)
		setEdition(next)
	}

	return (
		<button
			type="button"
			className={styles.edition}
			onClick={choose}
			aria-label={`Switch to the ${next === "dark" ? "ink (dark)" : "paper (light)"} edition`}
		>
			{next === "dark" ? "Ink edition" : "Paper edition"}
		</button>
	)
}

const shortAddress = (address: string) =>
	`${address.slice(0, 4)}…${address.slice(-4)}`

const WalletControl = () => {
	const { address, isPending } = useWallet()

	if (!address) {
		return (
			<button
				type="button"
				className={styles.connect}
				onClick={() => void connectWallet()}
			>
				{isPending ? "Waking…" : "Connect"}
			</button>
		)
	}

	return (
		<div className={styles.walletChip} data-pending={isPending || undefined}>
			<span className={styles.address} title={address}>
				{shortAddress(address)}
			</span>
			<button
				type="button"
				className={styles.disconnect}
				onClick={() => void disconnectWallet()}
			>
				Disconnect
			</button>
		</div>
	)
}

/**
 * The page every broadside is posted on: masthead (wordmark, nav, wallet),
 * content column, and a colophon footer carrying the edition toggle.
 */
export const PageShell = ({ children }: { children: ReactNode }) => {
	return (
		<div className={styles.shell}>
			<a className={styles.skip} href="#main">
				Skip to content
			</a>
			<header className={styles.masthead}>
				<div className={styles.mastRow}>
					<Link to="/" className={styles.wordmark}>
						ADSUM
						<span className={styles.motto}>I am present</span>
					</Link>
					<nav className={styles.nav} aria-label="Primary">
						<NavLink
							to="/"
							end
							className={({ isActive }) =>
								isActive
									? `${styles.navLink} ${styles.navHere}`
									: styles.navLink
							}
						>
							Petitions
						</NavLink>
						<NavLink
							to="/trust"
							className={({ isActive }) =>
								isActive
									? `${styles.navLink} ${styles.navHere}`
									: styles.navLink
							}
						>
							Trust
						</NavLink>
					</nav>
					<WalletControl />
				</div>
			</header>
			<main id="main" className={styles.main}>
				{children}
			</main>
			<footer className={styles.colophon}>
				<span className={styles.asterism} aria-hidden="true">
					⁂
				</span>
				<p className={styles.imprint}>
					Adsum — petitions pressed on Soroban. Set in Fraunces &amp; Hanken
					Grotesk.
				</p>
				<Link to="/debug" className={styles.debugLink}>
					Debug
				</Link>
				<EditionToggle />
			</footer>
		</div>
	)
}
