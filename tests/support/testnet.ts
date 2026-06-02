import type { BrowserContext } from '@playwright/test';

export const RPC_URL = 'https://soroban-testnet.stellar.org';
export const FRIENDBOT_URL = 'https://friendbot.stellar.org';

/** localStorage key the app uses for the name-tx submitter/fee-payer. */
export const SUBMITTER_KEY = 'g2c:name-keypair';

/**
 * Registry-safe unique name: `<prefix>` + base36 of the timestamp, lowercased,
 * clamped to 15 chars, guaranteed to start with a letter.
 */
export function uniqueName(prefix: string, nowMs: number): string {
  const suffix = nowMs.toString(36).replace(/[^a-z0-9]/g, '');
  const base = (prefix.replace(/[^a-z]/g, '') || 't') + suffix;
  return base.slice(0, 15);
}

/**
 * Pre-seed a funded "bank" submitter so name txs skip friendbot. If
 * G2C_TEST_BANK_SECRET is unset, the app falls back to its own friendbot
 * funding (slower, flakier). Sets the key on every origin in the context.
 */
export async function seedBank(context: BrowserContext): Promise<void> {
  const secret = process.env.G2C_TEST_BANK_SECRET;
  if (!secret) return; // no bank → app friendbots its own submitter
  await context.addInitScript(
    ([k, v]) => {
      try { localStorage.setItem(k, v); } catch { /* pre-DOM on some engines */ }
    },
    [SUBMITTER_KEY, secret] as const,
  );
}

/** Bounded retry with exponential backoff for transient testnet/RPC errors. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { tries?: number; baseMs?: number } = {},
): Promise<T> {
  const tries = opts.tries ?? 3;
  const baseMs = opts.baseMs ?? 500;
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastErr;
}
