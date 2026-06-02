import { test as base, expect } from '@playwright/test';
import { getInitScript } from './auth/bundle';

// Fixed 32-byte seed → deterministic credentialIds → deterministic accounts.
export const SEED_HEX = '07'.repeat(32);

export const test = base.extend({
  context: async ({ context }, use) => {
    const script = await getInitScript();
    await context.addInitScript({
      content: `window.__TEST_AUTH_CONFIG__=${JSON.stringify({ seedHex: SEED_HEX })};`,
    });
    await context.addInitScript({ content: script });
    await use(context);
  },
});

/** Set which logical identity the next create() mints. */
export async function useIdentity(page: import('@playwright/test').Page, label: string) {
  await page.evaluate((l) => (window as any).__testAuthenticator.setNextLabel(l), label);
}

export { expect };
