/**
 * Nido-styled in-page "confirming…" bottom sheet (host markup).
 *
 * Renders the static frame once near the app root; its open/close lifecycle is
 * driven imperatively by `lib/passkeySheet.ts` (`withPasskeySheet`), which the
 * non-React in-page signer (`lib/nidoSign.ts`) wraps around the real
 * `navigator.credentials.get()` ceremony. React never re-renders this node, so
 * the controller's class toggles persist.
 */

import "./PasskeySheet.css"

export const PasskeySheet = ({
	title = "Confirm it's you",
	sub = "Sign in-page with your dApp passkey.",
}: {
	title?: string
	sub?: string
}) => (
	<div className="nps-scrim" id="nido-passkey-scrim" style={{ pointerEvents: "none" }}>
		<div
			className="nps-sheet"
			role="dialog"
			aria-modal="true"
			aria-labelledby="nido-passkey-title"
		>
			<div className="nps-grab" />
			<div className="nps-faceid" id="nido-passkey-faceid">
				<div className="nps-frame" />
				<div className="nps-scan" />
				<div className="nps-glyph" aria-hidden="true">
					{/* Face-ID style glyph shown while confirming. */}
					<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
						<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
						<path d="M9 10v1M15 10v1M12 9v3.5a1 1 0 0 1-1 1M9.5 16a3.5 3.5 0 0 0 5 0" />
					</svg>
				</div>
				<div className="nps-tick" aria-hidden="true">
					{/* Success check shown on `done`. */}
					<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
						<path d="M20 6 9 17l-5-5" />
					</svg>
				</div>
			</div>
			<div className="nps-title" id="nido-passkey-title">
				{title}
			</div>
			<div className="nps-sub" id="nido-passkey-sub">
				{sub}
			</div>
		</div>
	</div>
)
