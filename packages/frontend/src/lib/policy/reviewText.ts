// How app-grant review screens say a rule's cap and recipient in plain
// words: XLM per day rather than stroops per ledgers, and who a transfer
// may pay. Shared by /security/delegate-doc/, the document card
// and /sign/ so each says it the same way.

import type { Rule } from '@nidohq/passkey-sdk';
import { stroopsToXlm } from '../money.js';
import { PERIOD_LABEL, PERIOD_LEDGERS, type LimitPeriod } from '../spendingLimitParams.js';

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
