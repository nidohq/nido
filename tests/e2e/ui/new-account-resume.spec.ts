import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../support/fixtures';

// Resuming a setup (the My Nido menu's pending row, or a reload) whose address
// already holds a contract that this browser registered no passkey for: the
// setup secret was used by someone else first. The page must stop before
// offering a passkey, never activate the account, and drop its copy of the
// secret.
//
// The RPC answers with a real contract-instance entry: the account a thief
// holding the setup secret created first in `new_account_reads.rs`.

// Specs are transpiled to CommonJS, so resolve from the project root
// (Playwright's cwd) rather than import.meta.
const claimed = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/passkey-sdk/src/perch/testdata/new-account-reads.json'), 'utf8'),
).claimed as { account: string; instance: string };

const CONTRACT_ID = claimed.account;
const SALT = '5a'.repeat(32);
const PORT = process.env.E2E_PORT || 4399;
const URL_ = `http://${CONTRACT_ID.toLowerCase()}.localhost:${PORT}/new-account/#salt=${SALT}`;

test.describe('resuming a setup whose address is taken @fast', () => {
  test('stops before a passkey, activates nothing, and drops the salt @fast', async ({ page, context }) => {
    await context.addInitScript(
      ({ id, salt }) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('nido:testnet:pending', JSON.stringify([{ contractId: id, setupKey: salt }]));
        localStorage.setItem('nido:testnet:pending:ts', JSON.stringify({ [id]: Date.now() }));
      },
      { id: CONTRACT_ID, salt: SALT },
    );
    await page.route('https://soroban-testnet.stellar.org/**', async (route) => {
      const body = route.request().postDataJSON();
      if (body?.method !== 'getLedgerEntries') return route.abort();
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            entries: [{ key: body.params.keys[0], xdr: claimed.instance, lastModifiedLedgerSeq: 1 }],
            latestLedger: 2,
          },
        }),
      });
    });

    await page.goto(URL_);

    await expect(page.locator('#error-box')).toContainText('passkey this setup did not create');
    await expect(page.locator('#passkey-section')).toBeHidden();
    await expect(page.locator('#register-btn')).toBeDisabled();
    await expect(page.locator('#deploy-section')).toBeHidden();

    const stored = await page.evaluate((id) => ({
      pending: localStorage.getItem('nido:testnet:pending'),
      accounts: localStorage.getItem('nido:testnet:accounts'),
      credential: localStorage.getItem(`passkey:${id}:credentialId`),
    }), CONTRACT_ID);
    expect(stored.pending ?? '').not.toContain(CONTRACT_ID);
    expect(stored.accounts ?? '').not.toContain(CONTRACT_ID);
    expect(stored.credential).toBeNull();
  });
});
