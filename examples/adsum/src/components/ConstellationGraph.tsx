import { useId } from "react"
import styles from "./ConstellationGraph.module.css"

export interface ConstellationGraphProps {
	/** The viewer's address — the pole star at the chart's center. */
	center: string
	/** Addresses the viewer vouches for (outbound rays). */
	given: string[]
	/** Addresses vouching for the viewer (inbound rays). */
	received: string[]
	/**
	 * Resolved nido names keyed by address. Missing or `null` entries fall
	 * back to a truncated address.
	 */
	names: Record<string, string | null>
}

type EdgeKind = "given" | "received" | "mutual"

/* Chart geometry — one fixed engraving, scaled by the viewBox. */
const SIZE = 640
const CX = SIZE / 2
const CY = SIZE / 2
/** The ring the neighbour stars sit on. */
const RING_R = 210
/** Radial distance of a star's label from the center. */
const LABEL_R = RING_R + 34
/** Edges start clear of the pole star's points… */
const EDGE_START = 36
/** …and stop clear of a neighbour star (leaving room for the arrowhead). */
const EDGE_END_GAP = 15
/** Half the gap between the two strokes of a doubled (mutual) rule. */
const DOUBLE_OFFSET = 3
const LABEL_MAX = 16

const shortAddress = (address: string) =>
	`${address.slice(0, 4)}…${address.slice(-4)}`

const truncateName = (name: string) =>
	name.length > LABEL_MAX ? `${name.slice(0, LABEL_MAX - 1)}…` : name

/**
 * An eight-point star path (four long points, four short), the engraver's
 * mark for the pole star at the chart's center.
 */
function starPath(cx: number, cy: number, outer: number, inner: number) {
	const points: string[] = []
	for (let i = 0; i < 16; i++) {
		const angle = (i / 16) * 2 * Math.PI - Math.PI / 2
		const r = i % 2 === 0 ? (i % 4 === 0 ? outer : outer * 0.55) : inner
		points.push(
			`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`,
		)
	}
	return `M${points.join("L")}Z`
}

interface Star {
	address: string
	kind: EdgeKind
	/** Unit direction from the center. */
	ux: number
	uy: number
	x: number
	y: number
}

/**
 * The trust page's chart: the viewer's 1-hop ego graph drawn as an engraved
 * star-atlas plate. Pure SVG, deterministic radial layout — neighbour `i` of
 * `n` sits at angle `i/n · 2π` around the ring (measured from the zenith), no
 * physics, no graph library. Vouches given are solid outbound rays, vouches
 * received are finely-dashed inbound rays, and a mutual bond is the classic
 * doubled rule in sealing-wax vermilion.
 */
export const ConstellationGraph = ({
	center,
	given,
	received,
	names,
}: ConstellationGraphProps) => {
	const markerId = useId()

	const givenSet = new Set(given)
	const receivedSet = new Set(received)
	const neighbours = [...new Set([...given, ...received])]

	/** Resolved name (marked `named`) or the truncated address. */
	const labelFor = (address: string) => {
		const resolved = names[address] ?? null
		return resolved === null
			? { text: shortAddress(address), named: false }
			: { text: truncateName(resolved), named: true }
	}

	const centerLabel = labelFor(center).text
	const mutualCount = neighbours.filter(
		(a) => givenSet.has(a) && receivedSet.has(a),
	).length

	if (neighbours.length === 0) {
		return (
			<div className={styles.empty}>
				<svg
					className={styles.emptyChart}
					viewBox="0 0 200 130"
					aria-hidden="true"
				>
					<circle
						className={styles.orbit}
						cx="100"
						cy="65"
						r="52"
						fill="none"
					/>
					<circle
						className={styles.orbit}
						cx="100"
						cy="65"
						r="30"
						fill="none"
					/>
					<path className={styles.pole} d={starPath(100, 65, 13, 4.5)} />
				</svg>
				<p className={styles.emptyKicker}>A clear sky</p>
				<p className={styles.emptyBody}>
					No vouches yet — extend your hand below, or share your QR, and names
					will gather around yours.
				</p>
			</div>
		)
	}

	const stars: Star[] = neighbours.map((address, i) => {
		// Deterministic radial layout: angle = index/total · 2π, from the zenith.
		const angle = (i / neighbours.length) * 2 * Math.PI - Math.PI / 2
		const ux = Math.cos(angle)
		const uy = Math.sin(angle)
		return {
			address,
			kind:
				givenSet.has(address) && receivedSet.has(address)
					? "mutual"
					: givenSet.has(address)
						? "given"
						: "received",
			ux,
			uy,
			x: CX + RING_R * ux,
			y: CY + RING_R * uy,
		}
	})

	const edgeEnds = (star: Star) => ({
		x1: CX + EDGE_START * star.ux,
		y1: CY + EDGE_START * star.uy,
		x2: CX + (RING_R - EDGE_END_GAP) * star.ux,
		y2: CY + (RING_R - EDGE_END_GAP) * star.uy,
	})

	return (
		<svg
			className={styles.chart}
			viewBox={`0 0 ${SIZE} ${SIZE}`}
			role="img"
			aria-label={`Trust constellation for ${centerLabel}: ${given.length} given, ${received.length} received, ${mutualCount} mutual.`}
		>
			<defs>
				{/* Arrowheads: `ink` for one-way rays, `seal` for the mutual rule. */}
				<marker
					id={`${markerId}-ink`}
					viewBox="0 0 8 8"
					refX="7"
					refY="4"
					markerWidth="7"
					markerHeight="7"
					orient="auto-start-reverse"
				>
					<path className={styles.headInk} d="M0,0.5 L8,4 L0,7.5 Z" />
				</marker>
				<marker
					id={`${markerId}-seal`}
					viewBox="0 0 8 8"
					refX="7"
					refY="4"
					markerWidth="7"
					markerHeight="7"
					orient="auto-start-reverse"
				>
					<path className={styles.headSeal} d="M0,0.5 L8,4 L0,7.5 Z" />
				</marker>
			</defs>

			{/* The engraved orbit the stars rest on, plus an inner hairline. */}
			<circle className={styles.orbit} cx={CX} cy={CY} r={RING_R} fill="none" />
			<circle
				className={styles.orbitFaint}
				cx={CX}
				cy={CY}
				r={RING_R - 70}
				fill="none"
			/>

			{/* Rays. */}
			{stars.map((star) => {
				const { x1, y1, x2, y2 } = edgeEnds(star)
				if (star.kind === "mutual") {
					// The doubled rule: an outbound stroke and an inbound stroke,
					// offset either side of the true ray.
					const px = -star.uy * DOUBLE_OFFSET
					const py = star.ux * DOUBLE_OFFSET
					return (
						<g
							key={star.address}
							className={`${styles.edge} mutual`}
							data-kind="mutual"
							data-testid="constellation-edge"
						>
							<line
								className={styles.rayMutual}
								x1={x1 + px}
								y1={y1 + py}
								x2={x2 + px}
								y2={y2 + py}
								markerEnd={`url(#${markerId}-seal)`}
							/>
							<line
								className={styles.rayMutual}
								x1={x2 - px}
								y1={y2 - py}
								x2={x1 - px}
								y2={y1 - py}
								markerEnd={`url(#${markerId}-seal)`}
							/>
						</g>
					)
				}
				const outbound = star.kind === "given"
				return (
					<line
						key={star.address}
						className={`${styles.edge} ${outbound ? "given" : "received"} ${
							outbound ? styles.rayGiven : styles.rayReceived
						}`}
						data-kind={star.kind}
						data-testid="constellation-edge"
						x1={outbound ? x1 : x2}
						y1={outbound ? y1 : y2}
						x2={outbound ? x2 : x1}
						y2={outbound ? y2 : y1}
						markerEnd={`url(#${markerId}-ink)`}
					/>
				)
			})}

			{/* Neighbour stars and their labels. */}
			{stars.map((star) => {
				const { text: label, named } = labelFor(star.address)
				return (
					<g key={star.address} className={styles.starGroup}>
						<title>{star.address}</title>
						<circle
							className={styles.star}
							data-kind={star.kind}
							data-testid="constellation-node"
							cx={star.x}
							cy={star.y}
							r={8}
						/>
						<text
							className={named ? styles.labelName : styles.labelAddr}
							x={CX + LABEL_R * star.ux}
							y={CY + LABEL_R * star.uy}
							textAnchor="middle"
							dominantBaseline="middle"
						>
							{label}
						</text>
					</g>
				)
			})}

			{/* The pole star: the viewer. */}
			<g className={styles.starGroup}>
				<title>{center}</title>
				<path
					className={styles.pole}
					data-testid="constellation-center"
					d={starPath(CX, CY, 24, 8)}
				/>
				<text
					className={
						labelFor(center).named ? styles.labelName : styles.labelAddr
					}
					x={CX}
					y={CY + 44}
					textAnchor="middle"
				>
					{centerLabel}
				</text>
			</g>
		</svg>
	)
}
