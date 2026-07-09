/**
 * Advisory, client-only state for the "set up account recovery" home-page
 * banner.
 *
 * Recovery enrollment is deliberately UNREADABLE from chain (every account
 * gets an identical leaf + recovery rule at creation, so who holds a real
 * backup is hidden — the whole privacy point of the design). So the banner
 * can't ask the chain "is this account backed up?"; it keys off a local flag
 * we set when the user completes a real enrollment (at creation or later).
 *
 * Consequences of it being advisory-only (all acceptable):
 *  - Clearing site data / a new device loses the flag → the banner reappears
 *    even for a backed-up account. Re-enrolling is a harmless no-op insert.
 *  - It reflects THIS browser's knowledge, never a security decision.
 *
 * Every access is guarded so this is a safe no-op where localStorage is
 * unavailable (SSR, privacy modes).
 */

const BACKUP_KEY = (account: string) => `nido:zkrecovery:backup:${account}`;
const SNOOZE_KEY = (account: string) => `nido:zkrecovery:backup-snooze:${account}`;

/** How long a dismissal hides the banner before it reappears (still suppressed
 *  permanently once a backup is recorded). Dismiss = "not now", not "never". */
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

function store(): Storage | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage;
  } catch {
    return undefined;
  }
}

/** Record that this account has a real recovery backup — permanently hides the
 *  banner on this browser. Call on any successful seed/wallet enrollment. */
export function markBackupSetUp(account: string): void {
  store()?.setItem(BACKUP_KEY(account), '1');
}

/** True once a backup has been recorded locally for this account. */
export function hasBackupLocally(account: string): boolean {
  return store()?.getItem(BACKUP_KEY(account)) === '1';
}

/** Snooze the banner for SNOOZE_MS (a "not now" dismissal). */
export function snoozeBackupPrompt(account: string, nowMs: number = Date.now()): void {
  store()?.setItem(SNOOZE_KEY(account), String(nowMs + SNOOZE_MS));
}

/** Whether the banner should show: no recorded backup, and not currently
 *  snoozed. */
export function shouldShowBackupBanner(account: string, nowMs: number = Date.now()): boolean {
  if (hasBackupLocally(account)) return false;
  const until = Number(store()?.getItem(SNOOZE_KEY(account)) ?? 0);
  return !(until > nowMs);
}
