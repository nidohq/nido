import { test, expect, SEED_HEX } from '../../support/fixtures';
import { seedCredential } from '../../support/auth/seed';
import { Address, StrKey, hash, xdr } from '@stellar/stellar-sdk';

const PORT = Number(process.env.E2E_PORT || 4399);
const FAKE_CONTRACT_ID = 'CDLZFC2SYJYDZT7K7VJRL2CU7LQV6AFZ2K2QJLY7QV53KIGWXJOANPYY';
const host = `${FAKE_CONTRACT_ID.toLowerCase()}.localhost:${PORT}`;
const DAPP = `http://dapp.localhost:${PORT}`;

async function gotoSign(page: import('@playwright/test').Page, query: string, account = FAKE_CONTRACT_ID) {
  // Land on the account origin first to seed the credential, then load /sign/.
  const accountHost = `${account.toLowerCase()}.localhost:${PORT}`;
  await page.goto(`http://${accountHost}/account/`, { waitUntil: 'load' });
  await seedCredential(page, account, SEED_HEX, 'default');
  const ret = `${DAPP}/cb`;
  await page.goto(
    `http://${accountHost}/sign/?${query}&dapp=${encodeURIComponent(DAPP)}&return=${encodeURIComponent(ret)}`,
    { waitUntil: 'load' },
  );
}

test.describe('@fast dapp sign (message)', () => {
  test('signs a message and returns nido_signed', async ({ page }) => {
    await gotoSign(page, 'kind=message&message=' + encodeURIComponent('hello world'));
    await expect(page.locator('#needs-register')).toBeHidden();
    await expect(page.locator('#approve')).toBeEnabled();
    await page.locator('#approve').click();
    await page.waitForURL('**/cb?nido_signed=**', { timeout: 15_000 });
    const u = new URL(page.url());
    expect(u.searchParams.get('kind')).toBe('message');
    expect(u.searchParams.get('nido_signed')).toBeTruthy();
  });

  test('cancel returns nido_sign=cancelled', async ({ page }) => {
    await gotoSign(page, 'kind=message&message=hi');
    await page.locator('#cancel').click();
    await page.waitForURL('**/cb?nido_sign=cancelled**', { timeout: 10_000 });
  });

  // #89: the ceremony is bound to one account; the page must say WHICH and
  // offer a way out for users who meant to use a different one.
  test('shows the bound account identity prominently', async ({ page }) => {
    await gotoSign(page, 'kind=message&message=hi');
    // No friendly name stored on this origin → the short address is the title.
    await expect(page.locator('#id-name')).toContainText('CDLZFC');
  });

  test('"Use a different account" returns nido_sign=switch-account', async ({ page }) => {
    await gotoSign(page, 'kind=message&message=hi');
    await page.locator('#switch-account').click();
    await page.waitForURL('**/cb?nido_sign=switch-account**', { timeout: 10_000 });
  });
});

// A dApp's request is refused before any passkey prompt when it asks for what
// no dApp may have: another network, or a call on the account itself.
function authEntryXdr(network: string, contract: string, fn: string): string {
  return xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(network)),
      nonce: xdr.Int64.fromString('1'),
      signatureExpirationLedger: 100,
      invocation: new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(contract).toScAddress(),
            functionName: fn,
            args: [],
          }),
        ),
        subInvocations: [],
      }),
    }),
  ).toXDR('base64');
}

const TESTNET = 'Test SDF Network ; September 2015';
const PUBNET = 'Public Global Stellar Network ; September 2015';
const OTHER_CONTRACT = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';
const ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 9));

test.describe('@fast dapp sign refusals', () => {
  test('refuses an auth entry for another network', async ({ page }) => {
    await gotoSign(page, 'kind=authEntry&authEntry=' + encodeURIComponent(authEntryXdr(PUBNET, OTHER_CONTRACT, 'swap')));
    await expect(page.locator('#error-box')).toContainText('different Stellar network');
    await expect(page.locator('#approve')).toBeDisabled();
  });

  test("refuses an auth entry that calls the account's own functions", async ({ page }) => {
    await gotoSign(
      page,
      'kind=authEntry&authEntry=' + encodeURIComponent(authEntryXdr(TESTNET, ACCOUNT, 'apply_doc')),
      ACCOUNT,
    );
    await expect(page.locator('#error-box')).toContainText('"apply_doc"');
    await expect(page.locator('#approve')).toBeDisabled();
  });

  test('refuses a transaction request for another network', async ({ page }) => {
    await gotoSign(page, 'kind=tx&xdr=AAAA&network=' + encodeURIComponent(PUBNET));
    await expect(page.locator('#error-box')).toContainText('different Stellar network');
    await expect(page.locator('#approve')).toBeDisabled();
  });

  test('an ?sm-sign= link on the account page opens no signing request', async ({ page }) => {
    await page.goto(
      `http://${host}/account/?sm-sign=AAAA&sm-return=${encodeURIComponent(`http://status-message.localhost:${PORT}/`)}`,
      { waitUntil: 'load' },
    );
    await page.waitForTimeout(1000);
    expect(new URL(page.url()).pathname).toBe('/account/');
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('nido:signreq:')))).toEqual([]);
  });
});
