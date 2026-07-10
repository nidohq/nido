import { BrowserRouter, Route, Routes } from "react-router-dom"

function Home() {
	return <h1>Adsum</h1>
}

function App() {
	return (
		<BrowserRouter basename={import.meta.env.BASE_URL}>
			<Routes>
				<Route path="/" element={<Home />} />
			</Routes>
		</BrowserRouter>
	)
}

export default App
