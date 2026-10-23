import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { StrKey } from '@stellar/stellar-sdk';
import { buildPolicyDoc, canonicalJson, docHash, parsePolicyDocJson } from '@nidohq/passkey-sdk';
import { accountViews, deployment, deploymentViews, mockPerchChain } from '../../support/perchRpcMock.mts';

// The app-approval page (/security/delegate-doc/) in a browser, against a
// build with a Perch deployment and a mocked chain
// (tests/support/perchRpcMock.mts): several grants reviewed and approved
// as one document update, a passkey as the app's key, the caps a request
// declares (or doesn't), the decision in view without scrolling, and the
// way back to the app as a popup or a page.
//
// Needs `packages/frontend/dist-perch`:
//   PUBLIC_PERCH_DEPLOYMENT="$(cat tests/support/perch-fixture-deployment.json)" \
//     npx astro build --root ./packages/frontend --outDir ./dist-perch

const contract = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));
const ACCOUNT = contract(30);
const GAME = contract(40);
const XLM = contract(41);
const ADMIN_KEY = '04' + 'ab'.repeat(64);
const APP_KEY = '04' + 'cd'.repeat(64);
const WALLET = `http://${ACCOUNT.toLowerCase()}.localhost:4397`;
const DAPP = 'http://dapp.localhost:4397';

/** The account's applied document: its admin passkey only. */
const applied = buildPolicyDoc({
  network: deployment.network,
  signers: [{ id: 'admin', kind: 'passkey', verifier: deployment.webauthnVerifier, publicKey: ADMIN_KEY }],
  permissions: [{ name: 'admin', on: 'self-admin', by: ['admin'] }],
});

/** Guess the Number's session: `guess` on the game (no cap: a cap allows
 *  transfers only) and the XLM transfer that moves the stake (2 XLM/day). */
function grantUrl(extra: Record<string, string | null> = {}): string {
  const fields: Record<string, string | null> = {
    origin: DAPP,
    return: `${DAPP}/play`,
    pubkey: APP_KEY,
    duration: '24h',
    'grant.0.label': 'guess',
    'grant.0.target': GAME,
    'grant.0.functions': 'guess',
    'grant.0.limit': 'none',
    'grant.1.label': 'guess-xlm',
    'grant.1.target': XLM,
    'grant.1.functions': 'transfer',
    'grant.1.limit': '2',
    'grant.1.limit_period': 'day',
    ...extra,
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v !== null) p.set(k, v);
  return `${WALLET}/security/delegate-doc/?${p}`;
}

async function mockChain(target: Page | BrowserContext): Promise<void> {
  await mockPerchChain(target, {
    ...deploymentViews(),
    ...accountViews(ACCOUNT, { canonical: canonicalJson(applied) }),
    [`${ACCOUNT}:applied_doc_hash`]: Buffer.from(docHash(applied), 'hex'),
  });
}

/** The app: opens the grant page as a popup and records what comes back. */
async function routeDapp(context: BrowserContext): Promise<void> {
  await context.route(`${DAPP}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>Guess the Number</title>
        <button id="open">Start a session</button>
        <script>
          window.msgs = [];
          addEventListener('message', (e) => window.msgs.push({ origin: e.origin, data: e.data }));
          document.getElementById('open').onclick = () =>
            window.open(${JSON.stringify(grantUrl())}, 'nido-wallet', 'popup,width=460,height=720');
        </script>`,
    }),
  );
}

async function openPopup(page: Page): Promise<Page> {
  await page.goto(`${DAPP}/play`);
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#open')]);
  await expect(popup.locator('[data-grant="1"]')).toBeVisible();
  return popup;
}

const messages = (page: Page) =>
  page.evaluate(() => (window as unknown as { msgs: { origin: string; data: unknown }[] }).msgs);

/** The document the page stashed for /sign/. */
async function stashedDoc(page: Page) {
  await page.waitForURL(/\/sign\/\?req=/);
  const id = new URL(page.url()).searchParams.get('req')!;
  const raw = await page.evaluate((key) => sessionStorage.getItem(key), `nido:signreq:${id}`);
  const req = JSON.parse(raw!) as {
    kind: string;
    operation: { type: string; docJson: string; prevDocJson?: string; expectedRevision: string };
    returnTarget: { type: string; origin: string; returnUrl: string; successQuery: string };
  };
  return { req, doc: parsePolicyDocJson(req.operation.docJson) };
}

test.describe('app approval page: several grants, one approval @fast', () => {
  test('reviews both grants for a passkey key, each cap as the app asked', async ({ page }) => {
    await mockChain(page);
    await page.goto(grantUrl());

    await expect(page.locator('#request-title')).toHaveText('App requests a scoped session key for 2 rules');
    await expect(page.locator('#signer-kind')).toContainText('passkey');
    await expect(page.locator('#signer-text')).toHaveText(APP_KEY);

    const guess = page.locator('[data-grant="0"]');
    await expect(guess.locator('.dd-rule')).toHaveText('guess');
    await expect(guess.locator('[data-field="target"]')).toHaveText(GAME);
    await expect(guess.locator('[data-field="functions"]')).toHaveText('Only guess');
    // Declared uncapped: no cap inputs at all, and nothing to confirm.
    await expect(guess.locator('[data-field="cap"]')).toContainText('the app asked for no cap');
    await expect(guess.locator('input, select')).toHaveCount(0);

    const stake = page.locator('[data-grant="1"]');
    await expect(stake.locator('[data-field="target"]')).toHaveText(XLM);
    await expect(stake.locator('[data-cap-on]')).toBeChecked();
    await expect(stake.locator('[data-cap-xlm]')).toHaveValue('2');
    await expect(stake.locator('select')).toHaveValue('day');
    await expect(stake.locator('[data-uncapped-ack]')).toBeHidden();

    await expect(page.locator('[data-scope="guess"]')).toContainText('No spending cap');
    await expect(page.locator('[data-scope="guess-xlm"]')).toContainText('Up to 2 XLM per day');
    // Both rules land in the one previewed update, over the applied admin rule.
    await expect(page.locator('#doc-diff')).toContainText('guess-xlm');
    await expect(page.locator('#doc-hash')).toHaveText(/^[0-9a-f]{64}$/);
  });

  test('approving hands /sign/ ONE document holding both rules', async ({ page }) => {
    await mockChain(page);
    await page.goto(grantUrl({ credential_id: 'q83vEjRW' }));
    await expect(page.locator('#doc-hash')).toHaveText(/^[0-9a-f]{64}$/);
    await page.locator('#approve').click();

    const { req, doc } = await stashedDoc(page);
    expect(req.kind).toBe('session-grant');
    expect(req.operation.type).toBe('apply-policy-doc');
    expect(req.operation.expectedRevision).toBe('1');
    expect(req.returnTarget).toEqual({
      type: 'dapp',
      origin: DAPP,
      returnUrl: `${DAPP}/play`,
      successQuery: '?delegation=ok',
    });
    expect(doc.rules.map((r) => r.name)).toEqual(['admin', 'guess', 'guess-xlm']);
    // One declaration for the app's passkey — against the account's
    // verifier, the credential id after the key — shared by both rules.
    const session = doc.signers.filter((s) => s.id !== 'admin');
    expect(session).toEqual([{ id: 'session', verifier: deployment.webauthnVerifier, key: `${APP_KEY}abcdef123456` }]);
    const [, guess, stake] = doc.rules;
    expect(guess!.scope).toEqual({ type: 'contract', address: GAME });
    expect(guess!.functions).toEqual(['guess']);
    expect(guess!.cap).toBeUndefined();
    expect(stake!.scope).toEqual({ type: 'contract', address: XLM });
    expect(stake!.functions).toEqual(['transfer']);
    expect(stake!.cap).toBeDefined();
    for (const r of [guess!, stake!]) expect(r['not-after-ledger']).toBe(1_000 + 17_280);
  });

  test('a grant with no limit hides the cap inputs and asks the user to choose', async ({ page }) => {
    await mockChain(page);
    await page.goto(grantUrl({ 'grant.1.limit': null, 'grant.1.limit_period': null }));
    const stake = page.locator('[data-grant="1"]');
    await expect(stake.locator('[data-cap-on]')).not.toBeChecked();
    // Hidden means hidden: no empty Amount box reading as a forgotten cap.
    await expect(stake.locator('[data-cap-xlm]')).toBeHidden();
    await expect(stake.locator('select')).toBeHidden();
    await expect(stake.locator('[data-uncapped-ack]')).toBeVisible();

    await expect(page.locator('#doc-hash')).toHaveText(/^[0-9a-f]{64}$/);
    await page.locator('#approve').click();
    await expect(page.locator('#status')).toContainText('Set a spending cap on "guess-xlm"');
    await expect(page).toHaveURL(/delegate-doc/);

    await stake.locator('[data-uncapped-ack]').check();
    await page.locator('#approve').click();
    const { doc } = await stashedDoc(page);
    expect(doc.rules.find((r) => r.name === 'guess-xlm')!.cap).toBeUndefined();
  });

  for (const [name, viewport] of [
    ['a 1280×720 desktop', { width: 1280, height: 720 }],
    ['a phone', { width: 390, height: 844 }],
    ['the popup the app opens', { width: 460, height: 720 }],
  ] as const) {
    test(`on ${name}, the cap and the decision show without scrolling`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockChain(page);
      await page.goto(grantUrl());
      const stake = page.locator('[data-grant="1"]');
      await expect(stake.locator('[data-cap-xlm]')).toHaveValue('2');
      for (const el of [
        page.locator('[data-grant="0"] [data-field="cap"]'),
        stake.locator('[data-cap-xlm]'),
        stake.locator('select'),
        page.locator('#approve'),
        page.locator('#deny'),
      ]) {
        await expect(el).toBeInViewport({ ratio: 1 });
      }
    });
  }
});

test.describe('app approval page: back to the app @fast', () => {
  test('as a popup, Cancel posts the result to the app and closes', async ({ context, page }) => {
    await mockChain(context);
    await routeDapp(context);
    const popup = await openPopup(page);

    await Promise.all([popup.waitForEvent('close'), popup.locator('#deny').click()]);
    await expect.poll(() => messages(page)).toEqual([
      { origin: WALLET, data: { source: 'nido-wallet', search: '?delegation=cancelled' } },
    ]);
    await expect(page).toHaveURL(`${DAPP}/play`);
  });

  test('as a popup, Approve keeps the popup through /sign/, which posts back and closes', async ({ context, page }) => {
    await mockChain(context);
    await routeDapp(context);
    const popup = await openPopup(page);

    await expect(popup.locator('#doc-hash')).toHaveText(/^[0-9a-f]{64}$/);
    await popup.locator('#approve').click();
    const { doc } = await stashedDoc(popup);
    expect(doc.rules.map((r) => r.name)).toEqual(['admin', 'guess', 'guess-xlm']);
    expect(await popup.evaluate(() => window.opener !== null)).toBe(true);

    // /sign/ returns to the opener the same way (its cancel here: the
    // success return needs a passkey ceremony and a relayer).
    await Promise.all([popup.waitForEvent('close'), popup.locator('#cancel').click()]);
    await expect.poll(() => messages(page)).toEqual([
      { origin: WALLET, data: { source: 'nido-wallet', search: '?delegation=cancelled' } },
    ]);
  });

  test('as a page, Cancel redirects to the return URL', async ({ context, page }) => {
    await mockChain(context);
    await routeDapp(context);
    await page.goto(grantUrl());
    await expect(page.locator('[data-grant="1"]')).toBeVisible();
    await page.locator('#deny').click();
    await expect(page).toHaveURL(`${DAPP}/play?delegation=cancelled`);
  });
});
