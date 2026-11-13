import { test, expect, type Page } from '@playwright/test';
import { StrKey } from '@stellar/stellar-sdk';
import { accountViews, deployment, deploymentViews, mockPerchChain } from '../../support/perchRpcMock.mts';

// "New device? Use your synced passkey" on /security/, with a real (virtual)
// authenticator. The passkey is created on the account's subdomain outside
// the app, so the authenticator holds it as a resident credential while the
// page's storage knows nothing of it: the state a passkey synced from
// another device leaves a new one in. The mocked chain's `configuration()`
// lists (or doesn't list) its key.
//
// Needs `packages/frontend/dist-perch` (see guardian-consent.spec.mts).

const ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 40));
const SECURITY = `http://${ACCOUNT.toLowerCase()}.localhost:4397/security/`;

/** A real virtual authenticator, as tests/support/cdp.ts installs (that
 *  module is CommonJS, which an .mts spec can't import by name). */
async function setupVirtualAuthenticator(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

/** Create a resident passkey for this page's rpId, bypassing the app; its
 *  65-byte public key, hex. */
async function passkeyFromAnotherDevice(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Nido', id: window.location.hostname },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'nido', displayName: 'Nido' },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      },
    })) as PublicKeyCredential;
    const spki = new Uint8Array((cred.response as AuthenticatorAttestationResponse).getPublicKey()!);
    return Array.from(spki.slice(-65), (b) => b.toString(16).padStart(2, '0')).join('');
  });
}

async function randomKeyHex(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('hex');
}

/** Mock the chain with an account whose admin rule holds the keys `keys()`
 *  returns when `configuration()` is read. */
async function mockAccount(page: Page, keys: () => string[]): Promise<void> {
  const views = accountViews(ACCOUNT, {});
  const configuration = views[`${ACCOUNT}:configuration`] as Record<string, unknown>;
  await mockPerchChain(page, {
    ...deploymentViews(),
    ...views,
    [`${ACCOUNT}:configuration`]: () => ({
      ...configuration,
      rules: [
        {
          context_type: { tag: 'CallContract', values: [ACCOUNT] },
          id: 0,
          name: 'admin',
          policies: [],
          recovery: false,
          signers: keys().map((k) => ({ tag: 'External', values: [deployment.webauthnVerifier, Buffer.from(k, 'hex')] })),
          valid_until: undefined,
        },
      ],
    }),
  });
}

const storedKey = (page: Page) =>
  page.evaluate((acc) => localStorage.getItem(`passkey:${acc}:publicKey`), ACCOUNT);

test.describe('security page: use a synced passkey', () => {
  test('adopts a passkey whose key signs for the account', async ({ page }) => {
    await setupVirtualAuthenticator(page);
    const other = await randomKeyHex();
    let synced = '';
    await mockAccount(page, () => (synced ? [other, synced] : [other]));
    await page.goto(SECURITY);
    synced = await passkeyFromAnotherDevice(page);

    await expect(page.locator('#passkey-status-chip')).toHaveText('Not set up');
    await page.getByRole('button', { name: /Use your synced passkey/ }).click();

    await expect(page.locator('#passkey-status-chip')).toHaveText('On');
    await expect(page.locator('#device-pubkey')).toHaveText(synced);
    await expect(page.getByRole('button', { name: /Use your synced passkey/ })).toBeHidden();
    expect(await storedKey(page)).toBe(synced);
  });

  test('refuses a passkey the account does not list, and points to recovery', async ({ page }) => {
    await setupVirtualAuthenticator(page);
    const other = await randomKeyHex();
    await mockAccount(page, () => [other]);
    await page.goto(SECURITY);
    await passkeyFromAnotherDevice(page);

    await page.getByRole('button', { name: /Use your synced passkey/ }).click();

    await expect(page.locator('#adopt-passkey-msg')).toContainText("can't sign for this Nido");
    await expect(page.locator('#adopt-passkey-msg')).toContainText('recover');
    await expect(page.locator('#passkey-status-chip')).toHaveText('Not set up');
    expect(await storedKey(page)).toBeNull();
  });
});
