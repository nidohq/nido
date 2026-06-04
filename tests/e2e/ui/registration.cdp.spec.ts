import { test, expect } from '@playwright/test';
import { setupVirtualAuthenticator } from '../../support/cdp';

// Chromium-only fidelity lane. Unlike the shim specs, this uses the REAL
// Chromium virtual authenticator via CDP (no cross-browser shim), exercising
// the genuine navigator.credentials.create() ceremony. Runs ONLY in the
// chromium-cdp project (testMatch /\.cdp\.spec\.ts$/).
//
// Migrated from the old account-name.spec.ts "passkey registration with
// virtual authenticator" test, retargeted at the new-account page (where the
// page actually persists the credential before the deploy step reverts the UI),
// matching the shim test's localStorage success indicator.

const FAKE_CONTRACT_ID = 'CDLZFC2SYJYDZT7K7VJRL2CU7LQV6AFZ2K2QJLY7QV53KIGWXJOANPYY';
const PORT = Number(process.env.E2E_PORT || 4399);

// Dummy testnet secret for the `?key=` param. Registration persists the
// credential to localStorage BEFORE the chain deploy(); we assert on that.
const NEW_ACCOUNT_URL =
  `http://${FAKE_CONTRACT_ID.toLowerCase()}.localhost:${PORT}/new-account/` +
  `?key=SDTEST7777777777777777777777777777777777777777777777`;

test.describe('passkey registration (real CDP virtual authenticator)', () => {
  test('registering a passkey persists a credential', async ({ page }) => {
    await page.goto(NEW_ACCOUNT_URL, { waitUntil: 'networkidle' });

    // Install a real virtual authenticator (Chromium-only) AFTER the page is
    // up, so the subsequent create() ceremony resolves against it.
    await setupVirtualAuthenticator(page);

    // The contract id surfaced from the subdomain matches our fake address.
    // The chip shows a shortened head…tail; the full id lives on its title.
    await expect(page.locator('#account-chip')).toHaveAttribute(
      'title',
      FAKE_CONTRACT_ID,
    );

    await expect(page.locator('#register-btn')).toBeVisible();
    await page.locator('#register-btn').click();

    // Success indicator: the credential is persisted to localStorage. We poll
    // this directly rather than the UI, because the page kicks off a network
    // deploy() right after persisting — that step needs testnet and reverts the
    // UI here, but the credential write already happened.
    const credentialKey = `passkey:${FAKE_CONTRACT_ID}:credentialId`;
    const publicKeyKey = `passkey:${FAKE_CONTRACT_ID}:publicKey`;

    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), credentialKey), {
        timeout: 15_000,
      })
      .toBeTruthy();

    const credentialId = await page.evaluate(
      (k) => localStorage.getItem(k),
      credentialKey,
    );
    const publicKey = await page.evaluate(
      (k) => localStorage.getItem(k),
      publicKeyKey,
    );

    expect(credentialId).toBeTruthy();
    // Uncompressed SEC1 P-256 point: 0x04 || x(32) || y(32) → 04 + 128 hex.
    expect(publicKey).toMatch(/^04[0-9a-f]{128}$/);
  });
});
