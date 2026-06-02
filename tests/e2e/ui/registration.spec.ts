import { test, expect } from '../../support/fixtures';

// Deterministic fake C-address (valid strkey). The new-account page derives the
// contractId from the subdomain via contractIdFromHostname() and uppercases it,
// so visiting `<lower>.localhost` yields exactly FAKE_CONTRACT_ID and the
// localStorage keys are `passkey:${FAKE_CONTRACT_ID}:*`.
const FAKE_CONTRACT_ID = 'CDLZFC2SYJYDZT7K7VJRL2CU7LQV6AFZ2K2QJLY7QV53KIGWXJOANPYY';
const PORT = process.env.E2E_PORT || 4399;

// A dummy testnet secret key for the `?key=` param. The registration step
// (navigator.credentials.create + parseRegistration + saveCredential) persists
// the credential to localStorage BEFORE any chain call; the subsequent deploy()
// is fire-and-forget and needs the network, so it harmlessly fails afterward.
// We assert on the persisted credential, which lands no-chain.
const NEW_ACCOUNT_URL =
  `http://${FAKE_CONTRACT_ID.toLowerCase()}.localhost:${PORT}/new-account/` +
  `?key=SDTEST7777777777777777777777777777777777777777777777`;

test.describe('passkey registration (shim) @fast', () => {
  test('shim is installed before page scripts @fast', async ({ page }) => {
    await page.goto(NEW_ACCOUNT_URL);

    // Install marker set by installTestAuthenticator(), and the feature-detect
    // global the app gates on.
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.dataset.testAuthenticator,
        ),
      )
      .toBe('1');

    const hasPkc = await page.evaluate(
      () => typeof (window as any).PublicKeyCredential === 'function',
    );
    expect(hasPkc).toBe(true);
  });

  test('registering a passkey persists credentialId + publicKey @fast', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto(NEW_ACCOUNT_URL);

    // The contract id surfaced from the subdomain matches our fake address.
    await expect(page.locator('#contract-id')).toContainText(FAKE_CONTRACT_ID);

    // Register: clicking drives the (shimmed) navigator.credentials.create(),
    // parseRegistration(), then saveCredential() to localStorage. On success the
    // page hides the passkey step and reveals the "Setting up your Nido" step.
    await page.locator('#register-btn').click();

    // Success indicator: the credential is persisted to localStorage. We poll
    // this directly rather than the UI, because the page kicks off a network
    // deploy() right after persisting — that step needs testnet and is expected
    // to fail here (reverting the UI), but the credential write already happened.
    const credentialKey = `passkey:${FAKE_CONTRACT_ID}:credentialId`;
    const publicKeyKey = `passkey:${FAKE_CONTRACT_ID}:publicKey`;

    await expect
      .poll(
        () =>
          page.evaluate((k) => localStorage.getItem(k), credentialKey),
        { timeout: 10_000 },
      )
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
    // Uncompressed SEC1 P-256 point: 0x04 || x(32) || y(32) → 04 + 128 hex chars.
    expect(publicKey).toMatch(/^04[0-9a-f]{128}$/);

    // The credential ceremony itself must not have thrown a fatal page error.
    const fatal = pageErrors.filter(
      (e) =>
        e.includes('is not defined') ||
        e.includes('Unexpected token') ||
        e.includes('navigator.credentials'),
    );
    expect(fatal).toEqual([]);
  });
});
