/**
 * Soroban ledgers close roughly every 5 seconds. The `petitions` contract
 * stores `deadline`/`created_ledger` as ledger sequence numbers rather than
 * wall-clock timestamps, so the UI needs to convert between the two: a
 * ledger number the contract will accept from a date picker
 * (`ledgerForDate`), and a human-readable estimate of when a given ledger
 * will close, for display (`dateForLedger`, `formatLedgerCountdown`).
 *
 * These are estimates — ledger close time drifts — so round conservatively
 * (up, when converting a date to a ledger) and label the countdown with
 * "~" rather than claiming precision.
 */

const LEDGER_SECONDS = 5

/**
 * The ledger number closest to (but not before) `date`, given the network's
 * `currentLedger` and the current wall-clock time `now`. Rounds up so a
 * deadline picked for a given date is guaranteed to close at or after it.
 */
export function ledgerForDate(
	date: Date,
	currentLedger: number,
	now: Date = new Date(),
): number {
	const deltaMs = date.getTime() - now.getTime()
	const deltaLedgers = Math.ceil(deltaMs / (LEDGER_SECONDS * 1000))
	return currentLedger + deltaLedgers
}

/** The estimated wall-clock `Date` at which `ledger` will close. */
export function dateForLedger(
	ledger: number,
	currentLedger: number,
	now: Date = new Date(),
): Date {
	const deltaLedgers = ledger - currentLedger
	return new Date(now.getTime() + deltaLedgers * LEDGER_SECONDS * 1000)
}

function pluralize(n: number, unit: string): string {
	return `${n} ${unit}${n === 1 ? "" : "s"}`
}

/**
 * A humanized countdown to `deadline` (a ledger number), e.g.
 * "closes in ~3 days". Returns `"closed"` once `deadline` is at or before
 * `currentLedger`.
 */
export function formatLedgerCountdown(
	deadline: number,
	currentLedger: number,
): string {
	const remainingLedgers = deadline - currentLedger
	if (remainingLedgers <= 0) return "closed"

	const seconds = remainingLedgers * LEDGER_SECONDS
	const days = Math.floor(seconds / 86400)
	const hours = Math.floor((seconds % 86400) / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)

	if (days >= 1) return `closes in ~${pluralize(days, "day")}`
	if (hours >= 1) return `closes in ~${pluralize(hours, "hour")}`
	if (minutes >= 1) return `closes in ~${pluralize(minutes, "minute")}`
	return "closes in <1 minute"
}
