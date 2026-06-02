import { Card, Icon } from "@stellar/design-system"
import React from "react"
import { Link } from "react-router-dom"
import { StatusMessage } from "../components/StatusMessage"
import styles from "./Home.module.css"

const Home: React.FC = () => (
	<div className={styles.Home}>
		<div>
			<h1>Status Message</h1>
			<p>
				A minimal Stellar dApp template: connect with the{" "}
				<strong>wallet selector</strong> — a g2c passkey smart account or any
				standard wallet (Freighter, xBull, Albedo, LOBSTR, Rabet, Hana) — and
				read or write an on-chain status message through an automatically
				generated contract client.
			</p>
		</div>

		<Card>
			<h2>
				<Icon.MessageTextSquare01 size="lg" />
				Status message contract
			</h2>
			<p>
				The <code>status-message</code> contract stores one string per account.
				Writing requires the author&apos;s authorization, so saving routes
				through whichever wallet you connected. A g2c smart account signs with a
				passkey; classic wallets sign normally.
			</p>

			<StatusMessage />
		</Card>

		<Card>
			<h2>
				<Icon.Code02 size="lg" />
				How this template is wired
			</h2>
			<ol>
				<li>
					The contract lives under <code>contracts/status-message</code> and is
					built, deployed, and turned into a TS client by Scaffold on{" "}
					<code>npm start</code> (see <code>environments.toml</code>).
				</li>
				<li>
					The wallet selector is configured in <code>src/util/wallet.ts</code>,
					which registers the <code>@g2c/stellar-wallets-kit-module</code>{" "}
					alongside the standard wallets.
				</li>
				<li>
					Set <code>PUBLIC_G2C_BASE</code> in <code>.env</code> to the g2c
					deployment you want the passkey ceremony to use.
				</li>
				<li>
					Invoke the contract directly any time from the{" "}
					<Link to="/debug" className="Link Link--primary">
						Contract Explorer
					</Link>
					.
				</li>
			</ol>
		</Card>
	</div>
)

export default Home
