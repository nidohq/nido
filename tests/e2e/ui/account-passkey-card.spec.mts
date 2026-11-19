import { test, expect, type Page } from '@playwright/test';
import { StrKey } from '@stellar/stellar-sdk';
import { mockPerchChain } from '../../support/perchRpcMock.mts';

// The account page on a device with no passkey for the account: the passkey
// card when a contract is deployed at the address, a "no Nido here" state when
// none is. The mocked chain decides which.
//
// Needs `packages/frontend/dist-perch` (see guardian-consent.spec.mts).

const ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 41));
const PAGE = `http://${ACCOUNT.toLowerCase()}.nido.localhost:4397/account/`;
const RPC = 'https://soroban-testnet.stellar.org/';

const card = (page: Page) => page.locator('#register-section');
const noNido = (page: Page) => page.locator('#no-nido-section');

test.describe('account page passkey card @fast', () => {
  test('a deployed account offers the synced passkey and recovery, not a new passkey', async ({ page }) => {
    await mockPerchChain(page, {}, { deployedContracts: [ACCOUNT] });
    await page.goto(PAGE);

    await expect(card(page)).toBeVisible();
    await expect(card(page).getByRole('button', { name: /Use your synced passkey/ })).toBeVisible();
    await expect(card(page).getByRole('link', { name: 'Recover your Nido' })).toBeVisible();
    await expect(card(page)).not.toContainText('Set up your passkey');
    await expect(noNido(page)).toBeHidden();
  });

  test('an address with no contract says so and offers to create a Nido', async ({ page }) => {
    await mockPerchChain(page, {});
    await page.goto(PAGE);

    await expect(noNido(page)).toBeVisible();
    await expect(noNido(page)).toContainText("There's no Nido at this address");
    await expect(card(page)).toBeHidden();

    await noNido(page).getByRole('button', { name: 'Create a Nido' }).click();
    await expect(page).toHaveURL(/\/new-account\/\?setup=1#salt=[0-9a-f]{64}$/);
  });

  test('a failed lookup shows the passkey card', async ({ page }) => {
    await mockPerchChain(page, {});
    await page.route(RPC, async (route) => {
      const body = route.request().postDataJSON() as { id: number; method: string };
      if (body.method !== 'getLedgerEntries') return route.fallback();
      return route.fulfill({ json: { jsonrpc: '2.0', id: body.id, error: { code: -32603, message: 'unavailable' } } });
    });
    await page.goto(PAGE);

    await expect(card(page)).toBeVisible();
    await expect(noNido(page)).toBeHidden();
  });
});
