import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { useIdentity } from './fixtures';

/**
 * Create + deploy a fresh v0.7 smart account via the real create path.
 *
 * The home page is an info-only landing: "Get started" (`#get-started-hero`)
 * opens the My Nido menu, whose `.mn-create-btn` runs `createNido` (friendbot
 * fund + factory.get_c_address) and navigates straight to the new account's
 * C-address subdomain at `/new-account/?key=<secret>`. `#register-btn` then
 * registers the passkey (shim) and auto-deploys to `#done-section`.
 *
 * This replaced the removed home-page `#create-btn`/`#c-address-result`/
 * `#setup-link` flow — the single source of truth for "make an account" across
 * the testnet specs.
 *
 * Pass `identityLabel` to mint THIS account's primary passkey from a distinct
 * shim identity (set before register) — required when a test needs multiple
 * accounts with different keypairs (e.g. recovery: originator vs friend).
 *
 * Returns the C-address and its subdomain host (`<caddr>.localhost:<port>`).
 */
export async function createNidoAccount(
  page: Page,
  port: number,
  opts: { identityLabel?: string } = {},
): Promise<{ cAddress: string; host: string }> {
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#get-started-hero').click();
  await expect(page.locator('[data-mynido]')).toHaveClass(/mynido-open/);
  await page.locator('.mn-create-btn').click();
  await page.waitForURL(/\/new-account\/\?key=/, { timeout: 60_000 });
  const host = new URL(page.url()).host;
  const cAddress = host.split('.')[0].toUpperCase();
  expect(cAddress).toMatch(/^C[A-Z2-7]{55}$/);
  // Distinct identity for THIS account's primary passkey, set BEFORE register.
  // The shim mints the create()-time key from `nextLabel`; the stored
  // credentialId then deterministically reproduces the key on every get().
  if (opts.identityLabel) await useIdentity(page, opts.identityLabel);
  await page.locator('#register-btn').click();
  await expect(page.locator('#done-section')).toBeVisible({ timeout: 120_000 });
  return { cAddress, host };
}
