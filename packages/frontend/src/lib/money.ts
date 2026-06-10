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
 * Convert a token amount in its smallest integer unit to a plain decimal
 * string for an arbitrary number of decimals (generalizes {@link stroopsToXlm}
 * beyond XLM's 7 — SACs are always 7, but SEP-41 tokens choose their own).
 *
 * @param raw       smallest-unit amount
 * @param decimals  the token's decimal places (>= 0)
 * @returns decimal string (no grouping, no unit)
 */
export function rawToDecimal(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const sign = negative ? "-" : "";
  if (decimals <= 0) return `${sign}${abs.toString()}`;
  const unit = 10n ** BigInt(decimals);
  const whole = abs / unit;
  const frac = abs % unit;
  if (frac === 0n) return `${sign}${whole.toString()}`;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${sign}${whole.toString()}.${fracStr}`;
}

/**
 * Group a plain decimal string for display WITHOUT round-tripping through
 * Number — exact for arbitrary-precision token amounts (formatXlm loses
 * digits past 2^53 and collapses sub-1e-7 fractions of high-decimal tokens
 * to "0"). The fraction is truncated to `maxFractionDigits`; a nonzero
 * amount whose displayable digits all truncate away renders as the smallest
 * displayable unit with a "<" prefix (e.g. "<0.0000001") rather than "0".
 *
 * @param decimal  plain decimal string, e.g. from {@link rawToDecimal}
 * @param opts.maxFractionDigits  cap on displayed decimal places (default 7)
 * @returns grouped string without a unit, e.g. "1,234.5"
 */
export function formatDecimal(
  decimal: string,
  opts: { maxFractionDigits?: number } = {},
): string {
  const { maxFractionDigits = XLM_FRACTION_DIGITS } = opts;
  const negative = decimal.startsWith("-");
  const [whole, fracRaw = ""] = (negative ? decimal.slice(1) : decimal).split(".");
  if (!/^\d+$/.test(whole) || (fracRaw && !/^\d+$/.test(fracRaw))) return "0";
  const frac = fracRaw.slice(0, maxFractionDigits).replace(/0+$/, "");
  if (whole === "0" && !frac && /[1-9]/.test(fracRaw)) {
    return maxFractionDigits > 0 ? `<0.${"0".repeat(maxFractionDigits - 1)}1` : "<1";
  }
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
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
  return rawToDecimal(s, XLM_FRACTION_DIGITS);
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

/**
 * Convert a user-entered decimal string to an integer smallest-unit amount for
 * a token with `decimals` decimal places. Generalizes {@link xlmToStroops}
 * beyond XLM's fixed 7 (SACs are always 7; SEP-41 tokens choose their own,
 * 0..=38). Accepts up to `decimals` fractional digits and throws on anything
 * malformed so callers can surface a validation error. Inverse of
 * {@link rawToDecimal}.
 *
 * @param amount    decimal string, e.g. "12.5" or "0.0000001"
 * @param decimals  the token's decimal places (>= 0)
 * @returns smallest-unit amount as a bigint
 * @throws if `amount` is not a non-negative decimal with <= `decimals` fraction digits
 */
export function decimalToRaw(amount: string, decimals: number): bigint {
  const d = Math.trunc(decimals);
  if (d < 0) throw new Error(`Invalid decimals: ${decimals}`);
  const trimmed = amount.trim();
  const re = d === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${d}})?$`);
  if (!re.test(trimmed)) {
    throw new Error(`Invalid amount: "${amount}"`);
  }
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = frac.padEnd(d, "0");
  return BigInt(whole) * 10n ** BigInt(d) + BigInt(fracPadded || "0");
}
