import { BrowserRouter, Route, Routes } from "react-router-dom"
import { PageShell } from "./components/PageShell"
import { Home } from "./pages/Home"
import { Petition } from "./pages/Petition"
import { Trust } from "./pages/Trust"

function App() {
	return (
		<BrowserRouter basename={import.meta.env.BASE_URL}>
			<PageShell>
				<Routes>
					<Route path="/" element={<Home />} />
					<Route path="/petition/:id" element={<Petition />} />
					<Route path="/trust" element={<Trust />} />
				</Routes>
			</PageShell>
		</BrowserRouter>
	)
}

export default App
