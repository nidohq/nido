// How app-grant review screens say a rule's cap and recipient in plain
// words: XLM per day rather than stroops per ledgers, and who a transfer
// may pay. Shared by /security/delegate-doc/, the document card
// and /sign/ so each says it the same way.

import type { Rule } from '@nidohq/passkey-sdk';
import { stroopsToXlm } from '../money.js';
import { NATIVE_SAC_ID } from '../network.js';
import { PERIOD_LABEL, PERIOD_LEDGERS, type LimitPeriod } from '../spendingLimitParams.js';
import { truncate } from './policyView.js';

/** A cap as the user reads it, in the units of `token`, the contract it
 *  meters (the cap's `token`, else the rule's contract): "Up to 2 XLM per
 *  day" for the network's XLM contract. Any other token's decimals are not
 *  known here, so its limit is given in its smallest units, with the token's
 *  address (and with no token, which only an invalid rule has, unnamed). A window that is not a day, week or 30 days is named in ledgers. */
export function capText(limit: string, periodLedgers: number, token: string | null): string {
  const period = (Object.keys(PERIOD_LEDGERS) as LimitPeriod[]).find((p) => PERIOD_LEDGERS[p] === periodLedgers);
  const span = period ? PERIOD_LABEL[period] : `per ${periodLedgers.toLocaleString('en-US')} ledgers`;
  if (token === null) return `Up to ${limit} (smallest units) ${span}`;
  if (token !== NATIVE_SAC_ID) return `Up to ${limit} (smallest units) of token ${truncate(token)} ${span}`;
  let amount: string;
  try {
    amount = stroopsToXlm(BigInt(limit));
  } catch {
    amount = limit;
  }
  return `Up to ${amount} XLM ${span}`;
}

/** The token a rule's cap meters: its `token`, else the rule's contract
 *  (Perch requires the two to match when both are given). */
export function capToken(rule: Pick<Rule, 'cap' | 'scope'>): string | null {
  return rule.cap?.token ?? (rule.scope.type === 'contract' ? rule.scope.address : null);
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
