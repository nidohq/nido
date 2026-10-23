// Which app-grant rules can move tokens. A spending cap allows token
// transfers only, so it means something only on a rule that can move
// tokens: such a rule left uncapped reads "No spending cap" (a warning, as
// the user chose it), and one that cannot says so instead of "no cap",
// which would read as if it could spend.

/** SEP-41 / Stellar Asset Contract functions that move or authorise a
 *  balance. A rule allowing any of them can move tokens. */
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
/** An uncapped rule that cannot move tokens. */
export const CANT_MOVE_TOKENS = "Can't move tokens — no cap needed";
