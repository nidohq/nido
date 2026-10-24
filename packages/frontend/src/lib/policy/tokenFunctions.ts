// Which app-grant rules allow a token function. A spending cap allows token
// transfers only, so it means something only on a rule that allows one:
// such a rule left uncapped reads "No spending cap" (a warning, as the user
// chose it), and one allowing none of TOKEN_MOVING_FUNCTIONS says no cap
// applies because it allows no token functions. That is a name check, not
// a claim that the rule cannot move value.

/** SEP-41 / Stellar Asset Contract functions that move or authorise a
 *  balance. A rule allowing any of them can move tokens. Kept identical, in
 *  order, to Perch's `TOKEN_MOVING_FUNCTIONS` (crates/perch-ir/src/validate.rs,
 *  stellar-registry/perch#160), which refuses the same functions on a rule
 *  left uncapped by cross-token lowering; change both together
 *  (tokenFunctions.test.ts pins this copy). */
export const TOKEN_MOVING_FUNCTIONS: readonly string[] = [
  'transfer',
  'transfer_from',
  'approve',
  'burn',
  'burn_from',
  'mint',
  'clawback',
  'set_authorized',
  'set_admin',
];

/** Whether a rule allowing `functions` (absent = any function) can move
 *  tokens: it allows any function, or one of TOKEN_MOVING_FUNCTIONS. */
export function canMoveTokens(functions: readonly string[] | null | undefined): boolean {
  return (
    functions === null ||
    functions === undefined ||
    functions.length === 0 ||
    functions.some((f) => TOKEN_MOVING_FUNCTIONS.includes(f))
  );
}

/** An uncapped rule that can move tokens. */
export const NO_SPENDING_CAP = 'No spending cap';
/** An uncapped rule allowing none of TOKEN_MOVING_FUNCTIONS, the same
 *  words on every review screen: what was checked, not a claim that it
 *  cannot move value. */
export const NO_CAP_NO_TOKEN_FUNCTIONS = 'No cap — allows no token functions';
