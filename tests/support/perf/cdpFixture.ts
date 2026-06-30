/**
 * "Real ceremony + real chain" harness: a Chromium virtual authenticator (via
 * CDP) with NO `navigator.credentials` shim, against real testnet. This is the
 * combination the shim specs and the testnet lifecycle spec each only half-had
 * — the shim fakes WebAuthn, the lifecycle spec uses the shim. Here the create
 * ceremony is genuine and the chain is real.
 *
 * Chromium-only (CDP) — use under the `testnet-chromium` project.
 *
 * `cdpTest` is the single-run fixture (one authenticated page); `newCdpRunCtx`
 * mints an isolated context per run for the N-run perf loop.
 */
import { test as base, expect } from '@playwright/test';
import type { Browser, BrowserContext, CDPSession, Page } from '@playwright/test';
import { setupVirtualAuthenticator } from '../cdp';
import { seedBank } from '../testnet';

/** Fresh isolated run context: bank-seeded, real virtual authenticator, no shim. */
export async function newCdpRunCtx(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page; cdp: CDPSession }> {
  const context = await browser.newContext();
  await seedBank(context);
  const page = await context.newPage();
  const cdp = await setupVirtualAuthenticator(page);
  return { context, page, cdp };
}

/** Single-run fixture exposing the CDP session; installs the authenticator, no shim. */
export const cdpTest = base.extend<{ cdp: CDPSession }>({
  cdp: async ({ page, context }, use) => {
    await seedBank(context);
    const cdp = await setupVirtualAuthenticator(page);
    await use(cdp);
  },
});

export { expect };
