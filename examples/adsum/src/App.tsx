import { BrowserRouter, Route, Routes } from "react-router-dom"
import { Broadside } from "./components/Broadside"
import { PageShell } from "./components/PageShell"
import { Home } from "./pages/Home"

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
