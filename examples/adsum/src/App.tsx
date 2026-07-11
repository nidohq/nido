import { BrowserRouter, Route, Routes } from "react-router-dom"
import { PageShell } from "./components/PageShell"
import { Claim } from "./pages/Claim"
import { Debug } from "./pages/Debug"
import { Home } from "./pages/Home"
import { Petition } from "./pages/Petition"
import { Trust } from "./pages/Trust"
import { Vouch } from "./pages/Vouch"

function App() {
	return (
		<BrowserRouter basename={import.meta.env.BASE_URL}>
			<PageShell>
				<Routes>
					<Route path="/" element={<Home />} />
					<Route path="/petition/:id" element={<Petition />} />
					<Route path="/trust" element={<Trust />} />
					<Route path="/vouch" element={<Vouch />} />
					<Route path="/claim" element={<Claim />} />
					<Route path="/debug" element={<Debug />} />
				</Routes>
			</PageShell>
		</BrowserRouter>
	)
}

export default App
