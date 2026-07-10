import { useState } from "react"
import { BrowserRouter, Route, Routes } from "react-router-dom"
import { Broadside } from "./components/Broadside"
import { InkProgress } from "./components/InkProgress"
import { PageShell } from "./components/PageShell"
import { SealBadge } from "./components/SealBadge"
import { StampButton, type StampState } from "./components/StampButton"

// Placeholder specimen sheet until the petition wall lands (next task):
// exercises every core component in both editions.
function Home() {
	const [stamp, setStamp] = useState<StampState>("ready")
	const press = () => {
		setStamp("busy")
		setTimeout(() => setStamp("stamped"), 900)
	}

	return (
		<div style={{ display: "grid", gap: "var(--space-6)" }}>
			<Broadside
				title="A specimen of the Adsum press"
				body={
					"Petitions are printed proclamations: set in Fraunces on warm paper, signed by pressing the ADSUM stamp — I am present. This sheet exercises the type, the ink line, the vouch marks, and the stamp until the petition wall is posted."
				}
			>
				<InkProgress value={128} max={200} />
				<InkProgress value={41} />
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "var(--space-4)",
						flexWrap: "wrap",
					}}
				>
					<StampButton state={stamp} onStamp={press} />
					<SealBadge count={3} />
					<SealBadge count={1} tone="you" />
					<SealBadge count={7} tone="kin" />
				</div>
			</Broadside>
		</div>
	)
}

function Trust() {
	return (
		<Broadside
			title="The web of trust"
			body="The constellation of vouches — given and received — is drawn here in a later task."
		/>
	)
}

function App() {
	return (
		<BrowserRouter basename={import.meta.env.BASE_URL}>
			<PageShell>
				<Routes>
					<Route path="/" element={<Home />} />
					<Route path="/trust" element={<Trust />} />
				</Routes>
			</PageShell>
		</BrowserRouter>
	)
}

export default App
