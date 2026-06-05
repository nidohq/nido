/**
 * Amount / balance formatting helpers.
 *
 * Formats REAL XLM amounts only. The Nido prototype (`app/ui.jsx`) invented a
 * "$250" USD balance for the mock — we deliberately do NOT fabricate a fiat
 * balance here. Callers pass actual XLM figures.
 */

/** Stroops per XLM (1 XLM = 10^7 stroops). */
export const STROOPS_PER_XLM = 10_000_000n;

const XLM_FRACTION_DIGITS = 7;

/**
 * Format a numeric XLM amount for display.
 *
 * @param amount   XLM value as a number or numeric string
 * @param opts.maxFractionDigits  cap on decimal places (default 7, XLM's max)
 * @param opts.minFractionDigits  floor on decimal places (default 0)
 * @returns grouped string without a unit, e.g. "1,234.5"
 */
export function formatXlm(
  amount: number | string,
  opts: { maxFractionDigits?: number; minFractionDigits?: number } = {},
): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "0";
  const {
    maxFractionDigits = XLM_FRACTION_DIGITS,
    minFractionDigits = 0,
  } = opts;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: minFractionDigits,
    maximumFractionDigits: Math.max(minFractionDigits, maxFractionDigits),
  });
}

/**
 * Format an XLM amount with the unit suffix, e.g. "1,234.5 XLM".
 */
export function formatXlmAmount(
  amount: number | string,
  opts?: { maxFractionDigits?: number; minFractionDigits?: number },
): string {
  return `${formatXlm(amount, opts)} XLM`;
}

/**
 * Convert an integer stroop count to a display XLM string.
 *
 * @param stroops  raw stroop count (bigint, number, or numeric string)
 * @returns XLM value as a plain decimal string (no grouping, no unit)
 */
export function stroopsToXlm(stroops: bigint | number | string): string {
  const s =
    typeof stroops === "bigint" ? stroops : BigInt(Math.trunc(Number(stroops)));
  const negative = s < 0n;
  const abs = negative ? -s : s;
  const whole = abs / STROOPS_PER_XLM;
  const frac = abs % STROOPS_PER_XLM;
  const sign = negative ? "-" : "";
  if (frac === 0n) return `${sign}${whole.toString()}`;
  const fracStr = frac.toString().padStart(XLM_FRACTION_DIGITS, "0").replace(/0+$/, "");
  return `${sign}${whole.toString()}.${fracStr}`;
}

/**
 * Convert a user-entered decimal XLM string to an integer stroop count.
 * Inverse of {@link stroopsToXlm}. Accepts up to 7 fractional digits (XLM's
 * max precision) and throws on anything malformed so callers can show a
 * validation error.
 *
 * @param amount  decimal XLM string, e.g. "12.5" or "0.0000001"
 * @returns stroops as a bigint
 * @throws if `amount` is not a non-negative decimal with ≤ 7 fraction digits
 */
export function xlmToStroops(amount: string): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d{1,7})?$/.test(trimmed)) {
    throw new Error(`Invalid XLM amount: "${amount}"`);
  }
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = frac.padEnd(XLM_FRACTION_DIGITS, "0");
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(fracPadded);
}
