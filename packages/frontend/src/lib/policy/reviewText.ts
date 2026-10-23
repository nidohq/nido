// How app-grant review screens say a rule's cap, expiry and recipient in
// plain words: XLM per day rather than stroops per ledgers, a clock time
// rather than a ledger number (the ledger stays, second), and who a
// transfer may pay. Shared by /security/delegate-doc/, the document card
// and /sign/ so each says it the same way.

import type { Rule } from '@nidohq/passkey-sdk';
import { stroopsToXlm } from '../money.js';
import { PERIOD_LABEL, PERIOD_LEDGERS, type LimitPeriod } from '../spendingLimitParams.js';

/** About five seconds per ledger: for display only (the bound itself is
 *  the ledger number). */
const SECONDS_PER_LEDGER = 5;

/** A cap as the user reads it: "Up to 2 XLM per day". A window that is not
 *  a day, week or 30 days is named in ledgers. */
export function capText(limitStroops: string, periodLedgers: number): string {
  const period = (Object.keys(PERIOD_LEDGERS) as LimitPeriod[]).find((p) => PERIOD_LEDGERS[p] === periodLedgers);
  let amount: string;
  try {
    amount = stroopsToXlm(BigInt(limitStroops));
  } catch {
    amount = limitStroops;
  }
  return `Up to ${amount} XLM ${period ? PERIOD_LABEL[period] : `per ${periodLedgers.toLocaleString('en-US')} ledgers`}`;
}

/** When a rule stops, as a time: "tomorrow around 2:54 PM (ledger
 *  18,280)", estimated from the current ledger at ~5 s per ledger; without
 *  the current ledger, "at ledger 18,280". Lowercase, to follow "Stops" or
 *  "Expires". `timeZone` is for tests. */
export function expiryText(
  notAfterLedger: number,
  latestLedger: number | null,
  now: Date = new Date(),
  timeZone?: string,
): string {
  const ledger = `ledger ${notAfterLedger.toLocaleString('en-US')}`;
  if (latestLedger === null) return `at ${ledger}`;
  const at = new Date(now.getTime() + (notAfterLedger - latestLedger) * SECONDS_PER_LEDGER * 1000);
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
  const day = (d: Date) => d.toLocaleDateString('en-US', { timeZone });
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const when =
    day(at) === day(now)
      ? 'today'
      : day(at) === day(tomorrow)
        ? 'tomorrow'
        : `on ${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone })}`;
  return `${when} around ${time} (${ledger})`;
}

/** The one address a rule's `transfer` may pay: an `address-eq` on
 *  argument 1 (SEP-41 `transfer(from, to, amount)`), or null. */
export function ruleRecipient(rule: Pick<Rule, 'args'>): string | null {
  const pred = rule.args?.find((a) => a.index === 1)?.pred;
  return pred?.type === 'address-eq' ? pred.address : null;
}

/** Whether a rule allowing `functions` (absent = any function) may call
 *  `transfer`, so whom it pays is worth saying. */
export function canTransfer(functions: readonly string[] | null | undefined): boolean {
  return functions === null || functions === undefined || functions.length === 0 || functions.includes('transfer');
}
