import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { buildPolicyDoc, canonicalJson, docHash, parsePolicyDocJson, type PolicyDoc } from '@nidohq/passkey-sdk';
import {
  accountViews,
  deployment,
  deploymentViews,
  mockPerchChain,
  type Invocation,
} from '../../support/perchRpcMock.mts';
import { createShimPasskey, installPasskeyShim } from '../../support/passkeyShim.mts';

// The app-approval page (/security/delegate-doc/) in a browser, against a
// build with a Perch deployment and a mocked chain
// (tests/support/perchRpcMock.mts): several grants reviewed and approved
// as one document update, a passkey as the app's key, the caps a request
// declares (or doesn't), the decision in view without scrolling, the way
// back to the app as a popup or a page, and the whole approval through
// /sign/ to the one apply_doc it submits.
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

/** An account's applied document: its admin passkey only. */
const adminDoc = (key: string): PolicyDoc =>
  buildPolicyDoc({
    network: deployment.network,
    signers: [{ id: 'admin', kind: 'passkey', verifier: deployment.webauthnVerifier, publicKey: key }],
    permissions: [{ name: 'admin', on: 'self-admin', by: ['admin'] }],
  });
const applied = adminDoc(ADMIN_KEY);

/** Guess the Number's session: `guess` on the game (no cap: a cap allows
 *  transfers only) and the XLM transfer that moves the stake (2 XLM/day),
 *  payable only to the game. */
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
    'grant.1.to': GAME,
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

/** Clicks a control that closes its own page, and waits for the close.
 *  The page can close before the click action reports back (Firefox), so a
 *  rejection is tolerated once the page is closed. */
async function clickAndClose(page: Page, selector: string): Promise<void> {
  await Promise.all([
    page.waitForEvent('close'),
    page
      .locator(selector)
      .click()
      .catch((e: unknown) => {
        if (!page.isClosed()) throw e;
      }),
  ]);
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
    await expect(guess.locator('[data-field="functions"]')).toHaveText('Only guess()');
    // Declared uncapped, and it allows no token function: no cap inputs,
    // nothing to confirm, and no "no spending cap" warning.
    await expect(guess.locator('[data-field="cap"]')).toHaveText('No cap — allows no token functions');
    await expect(guess.locator('input, select')).toHaveCount(0);

    const stake = page.locator('[data-grant="1"]');
    await expect(stake.locator('[data-field="target"]')).toHaveText(XLM);
    await expect(stake.locator('[data-cap-on]')).toBeChecked();
    await expect(stake.locator('[data-cap-xlm]')).toHaveValue('2');
    await expect(stake.locator('select')).toHaveValue('day');
    await expect(stake.locator('[data-uncapped-ack]')).toBeHidden();

    await expect(page.locator('[data-scope="guess"]')).toContainText('No cap — allows no token functions');
    await expect(page.locator('[data-scope="guess"]')).not.toContainText('No spending cap');
    await expect(page.locator('[data-scope="guess"] .tone-warn')).toHaveCount(0);
    await expect(page.locator('[data-scope="guess-xlm"]')).toContainText(`Up to 2 XLM per day, only to ${GAME}.`);
    // Whom the stake can pay: only the game, named as the guess rule's contract.
    await expect(stake.locator('[data-field="pays-to"]')).toHaveText(`Only ${GAME} — the contract “guess” calls`);
    await expect(guess.locator('[data-field="pays-to"]')).toHaveCount(0);
    // The mock chain is at ledger 1,000.
    await expect(page.locator('#expiry-text')).toHaveText('At ledger 18,280 (≈ 17,280 ledgers from now).');
    await expect(page.locator('#scope-expiry')).toHaveText('At ledger 18,280 (≈ 24 hours)');
    // Both rules land in the one previewed update, over the applied admin rule.
    await expect(page.locator('#doc-diff')).toContainText('guess-xlm');
    await expect(page.locator('#doc-hash')).toHaveText(/^[0-9a-f]{64}$/);
    // The document card says the same of each rule, the cap in XLM.
    await expect(page.locator('#doc-preview .pol-preview-rule', { hasText: 'guess()' }).first()).toContainText(
      'No cap — allows no token functions',
    );
    const stakeCard = page.locator('#doc-preview .pol-preview-rule', { hasText: 'transfer()' }).first();
    await expect(stakeCard).toContainText('Up to 2 XLM per day');
    await expect(stakeCard).toContainText('Pays only to');
    await expect(stakeCard).toContainText('Stops at ledger 18,280');
    await expect(page.locator('#doc-preview')).not.toContainText('stroops');
  });

  test('shows every function as a method: bold monospace with call parens', async ({ page }) => {
    await mockChain(page);
    await page.goto(grantUrl());
    await expect(page.locator('#doc-hash')).toHaveText(/^[0-9a-f]{64}$/);
    // The grant's Functions row, the summary, and the document preview.
    for (const where of [
      page.locator('[data-grant="0"] [data-field="functions"]'),
      page.locator('[data-scope="guess"]'),
      page.locator('#doc-preview'),
      page.locator('#doc-diff'),
    ]) {
      await expect(where.locator('code.fn-call', { hasText: 'guess()' }).first()).toBeVisible();
    }
    await expect(page.locator('[data-grant="1"] [data-field="functions"] code.fn-call')).toHaveText(['transfer()']);
    const style = await page
      .locator('[data-grant="0"] code.fn-call')
      .evaluate((el) => ({ weight: Number(getComputedStyle(el).fontWeight), family: getComputedStyle(el).fontFamily }));
    expect(style.weight).toBeGreaterThanOrEqual(700);
    expect(style.family.toLowerCase()).toMatch(/mono/);
  });

  test('approving hands /sign/ ONE document holding both rules', async ({ page }) => {
    await mockChain(page);
    await page.goto(grantUrl());
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
    // One declaration for the app's passkey — its bare key, against the
    // account's verifier — shared by both rules.
    const session = doc.signers.filter((s) => s.id !== 'admin');
    expect(session).toEqual([{ id: 'session', verifier: deployment.webauthnVerifier, key: APP_KEY }]);
    const [, guess, stake] = doc.rules;
    expect(guess!.scope).toEqual({ type: 'contract', address: GAME });
    expect(guess!.functions).toEqual(['guess']);
    expect(guess!.cap).toBeUndefined();
    expect(stake!.scope).toEqual({ type: 'contract', address: XLM });
    expect(stake!.functions).toEqual(['transfer']);
    expect(stake!.cap).toBeDefined();
    // to= lowers to an address-eq on transfer's `to` (argument 1).
    expect(stake!.args).toEqual([{ index: 1, pred: { type: 'address-eq', address: GAME } }]);
    expect(guess!.args).toBeUndefined();
    for (const r of [guess!, stake!]) expect(r['not-after-ledger']).toBe(1_000 + 17_280);
  });

  test('a grant already applied as asked reads "Already in place", counted as /sign/ counts', async ({ page }) => {
    // The account already holds `guess` exactly as this request builds it.
    const withGuess = buildPolicyDoc({
      network: deployment.network,
      signers: [
        { id: 'admin', kind: 'passkey', verifier: deployment.webauthnVerifier, publicKey: ADMIN_KEY },
        { id: 'session', kind: 'passkey', verifier: deployment.webauthnVerifier, publicKey: APP_KEY },
      ],
      permissions: [
        { name: 'admin', on: 'self-admin', by: ['admin'] },
        { name: 'guess', on: { contract: GAME }, by: ['session'], functions: ['guess'], until: 1_000 + 17_280 },
      ],
    });
    await mockPerchChain(page, {
      ...deploymentViews(),
      ...accountViews(ACCOUNT, { canonical: canonicalJson(withGuess) }),
      [`${ACCOUNT}:applied_doc_hash`]: Buffer.from(docHash(withGuess), 'hex'),
    });
    await page.goto(grantUrl());
    await expect(page.locator('#doc-hash')).toHaveText(/^[0-9a-f]{64}$/);
    await expect(page.locator('[data-grant="0"] .dd-count')).toHaveText('Already in place');
    // The one rule this approval changes carries no "Rule k of K".
    await expect(page.locator('[data-grant="1"] .dd-count')).toHaveText('');
    await expect(page.locator('#request-title')).toHaveText(
      'App requests a scoped session key for 2 rules (1 already in place)',
    );

    // /sign/ reviews the same single change.
    await page.locator('#approve').click();
    await page.waitForURL(/\/sign\/\?req=/);
    const cards = page.locator('[data-grant-rule]');
    await expect(cards).toHaveCount(1);
    await expect(cards).toHaveAttribute('data-grant-rule', 'guess-xlm');
    await expect(cards).not.toContainText('rule 1 of');
  });

  test('changing grants are numbered in document order, as /sign/ numbers them', async ({ page }) => {
    // An earlier request left `guess-xlm` (another expiry), so the built
    // document updates it in place and appends `guess`: [admin, guess-xlm, guess].
    const withXlm = buildPolicyDoc({
      network: deployment.network,
      signers: [
        { id: 'admin', kind: 'passkey', verifier: deployment.webauthnVerifier, publicKey: ADMIN_KEY },
        { id: 'session', kind: 'passkey', verifier: deployment.webauthnVerifier, publicKey: APP_KEY },
      ],
      permissions: [
        { name: 'admin', on: 'self-admin', by: ['admin'] },
        { name: 'guess-xlm', on: { contract: XLM }, by: ['session'], functions: ['transfer'], until: 500 },
      ],
    });
    await mockPerchChain(page, {
      ...deploymentViews(),
      ...accountViews(ACCOUNT, { canonical: canonicalJson(withXlm) }),
      [`${ACCOUNT}:applied_doc_hash`]: Buffer.from(docHash(withXlm), 'hex'),
    });
    await page.goto(grantUrl());
    await expect(page.locator('#doc-hash')).toHaveText(/^[0-9a-f]{64}$/);
    await expect(page.locator('[data-grant="1"] .dd-count')).toHaveText('Rule 1 of 2');
    await expect(page.locator('[data-grant="0"] .dd-count')).toHaveText('Rule 2 of 2');

    await page.locator('#approve').click();
    await page.waitForURL(/\/sign\/\?req=/);
    const cards = page.locator('[data-grant-rule]');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toHaveAttribute('data-grant-rule', 'guess-xlm');
    await expect(cards.nth(0)).toContainText('rule 1 of 2');
    await expect(cards.nth(1)).toHaveAttribute('data-grant-rule', 'guess');
    await expect(cards.nth(1)).toContainText('rule 2 of 2');
  });

  test('on a first apply, only the grants are numbered, not the admin rule the document must carry', async ({ page }) => {
    // No applied document: the page anchors the admin rule on the live passkey.
    await mockPerchChain(page, {
      ...deploymentViews(),
      ...accountViews(ACCOUNT, {
        rules: [
          {
            context_type: { tag: 'CallContract', values: [ACCOUNT] },
            id: 0,
            name: 'admin',
            policies: [],
            recovery: false,
            signers: [{ tag: 'External', values: [deployment.webauthnVerifier, Buffer.from(ADMIN_KEY, 'hex')] }],
            valid_until: undefined,
          },
        ],
      }),
      // None: an `undefined` view answers with an RPC error.
      [`${ACCOUNT}:applied_doc_hash`]: null,
    });
    await page.goto(grantUrl());
    await expect(page.locator('#doc-hash')).toHaveText(/^[0-9a-f]{64}$/);
    await expect(page.locator('[data-grant="0"] .dd-count')).toHaveText('Rule 1 of 2');
    await expect(page.locator('[data-grant="1"] .dd-count')).toHaveText('Rule 2 of 2');
    await expect(page.locator('#request-title')).toHaveText('App requests a scoped session key for 2 rules');
  });

  test('limit=none on a token-function rule explains why the cap choice is still asked', async ({ page }) => {
    await mockChain(page);
    await page.goto(grantUrl({ 'grant.1.limit': 'none', 'grant.1.limit_period': null }));
    await expect(page.locator('[data-grant="1"] .dd-note')).toHaveText(
      'The app asked for no cap, but this rule allows a token function, so the choice is yours: set a cap, or confirm the key may spend without one.',
    );
  });

  test('a capped transfer grant without to= says plainly it can pay any address', async ({ page }) => {
    await mockChain(page);
    await page.goto(grantUrl({ 'grant.1.to': null }));
    await expect(page.locator('#doc-hash')).toHaveText(/^[0-9a-f]{64}$/);
    await expect(page.locator('[data-grant="1"] [data-field="pays-to"]')).toHaveText('Any address');
    await expect(page.locator('[data-scope="guess-xlm"]')).toContainText('Up to 2 XLM per day, to any address.');
    await expect(page.locator('#doc-preview .pol-preview-rule', { hasText: 'transfer()' }).first()).toContainText(
      'Pays any address',
    );
    await page.locator('#approve').click();
    const { doc } = await stashedDoc(page);
    expect(doc.rules.find((r) => r.name === 'guess-xlm')!.args).toBeUndefined();
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

  for (const [name, functions] of [
    ['transfer', 'transfer'],
    ['any function', null],
  ] as const) {
    test(`limit=none on ${name} still asks the user to choose a cap`, async ({ page }) => {
      await mockChain(page);
      await page.goto(
        grantUrl({ 'grant.1.functions': functions, 'grant.1.limit': 'none', 'grant.1.limit_period': null, 'grant.1.to': null }),
      );
      const stake = page.locator('[data-grant="1"]');
      await expect(stake.locator('[data-field="cap"]')).not.toContainText('token functions');
      await expect(stake.locator('[data-cap-on]')).not.toBeChecked();
      await expect(stake.locator('[data-cap-xlm]')).toBeHidden();
      await expect(stake.locator('[data-uncapped-ack]')).toBeVisible();

      await expect(page.locator('#doc-hash')).toHaveText(/^[0-9a-f]{64}$/);
      await page.locator('#approve').click();
      await expect(page.locator('#status')).toContainText('Set a spending cap on "guess-xlm"');
      await expect(page).toHaveURL(/delegate-doc/);

      await stake.locator('[data-uncapped-ack]').check();
      // A rule that can move tokens, left uncapped by the player's choice:
      // the summary warns.
      await expect(page.locator('[data-scope="guess-xlm"] .tone-warn')).toHaveText('No spending cap');
      await expect(page.locator('[data-scope="guess-xlm"]')).toContainText('No spending cap, to any address.');
      await page.locator('#approve').click();
      const { doc } = await stashedDoc(page);
      expect(doc.rules.find((r) => r.name === 'guess-xlm')!.cap).toBeUndefined();
    });
  }

  for (const [name, viewport] of [
    ['a 1280×720 desktop', { width: 1280, height: 720 }],
    ['a phone', { width: 390, height: 844 }],
    ['the popup the app opens', { width: 460, height: 720 }],
  ] as const) {
    test(`on ${name}, the cap and the decision show without scrolling`, async ({ context, page }) => {
      // A browser that can do passkeys: without WebAuthn (Linux WebKit) the
      // layout shows its "open in your real browser" banner above the page.
      await installPasskeyShim(context);
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

    await clickAndClose(popup, '#deny');
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
    await clickAndClose(popup, '#cancel');
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

// The whole approval, as a player would make it: the two grants reviewed on
// the approval page, then each rule on /sign/, one passkey confirmation (the
// test authenticator), and one apply_doc submitted with both rules.
test.describe('app approval page through /sign/ @fast', () => {
  test('two grants are confirmed once and applied as one document', async ({ context, page }) => {
    await installPasskeyShim(context);
    // This device's passkey, which the account's admin rule names.
    await page.route(`${WALLET}/blank`, (route) => route.fulfill({ contentType: 'text/html', body: '' }));
    await page.goto(`${WALLET}/blank`);
    const { publicKeyHex, credentialIdB64u } = await createShimPasskey(page);
    await page.unroute(`${WALLET}/blank`);
    const owner = adminDoc(publicKeyHex);
    const submitter = Keypair.random();
    const submitted: Invocation[] = [];
    await mockPerchChain(
      page,
      {
        ...deploymentViews(),
        ...accountViews(ACCOUNT, {
          canonical: canonicalJson(owner),
          // The live admin rule the device's passkey signs under.
          rules: [
            {
              context_type: { tag: 'CallContract', values: [ACCOUNT] },
              id: 0,
              name: 'admin',
              policies: [],
              recovery: false,
              signers: [{ tag: 'External', values: [deployment.webauthnVerifier, Buffer.from(publicKeyHex, 'hex')] }],
              valid_until: undefined,
            },
          ],
        }),
        [`${ACCOUNT}:applied_doc_hash`]: Buffer.from(docHash(owner), 'hex'),
        [`${ACCOUNT}:apply_doc`]: ([json]: unknown[]) =>
          Buffer.from(docHash(parsePolicyDocJson(Buffer.from(json as Uint8Array).toString('utf8'))), 'hex'),
      },
      { selfAuthorizing: [ACCOUNT], classicAccounts: [submitter.publicKey()], submitted },
    );
    await page.route(`${DAPP}/**`, (route) => route.fulfill({ contentType: 'text/html', body: '<title>Guess the Number</title>' }));

    // This device holds the account's passkey and a funded submitter.
    await page.goto(`${WALLET}/security/`);
    await page.evaluate(
      ([acc, cid, pk, secret]) => {
        localStorage.setItem(`passkey:${acc}:credentialId`, cid!);
        localStorage.setItem(`passkey:${acc}:publicKey`, pk!);
        localStorage.setItem('nido:testnet:name-keypair', secret!);
      },
      [ACCOUNT, credentialIdB64u, publicKeyHex, submitter.secret()],
    );

    await page.goto(grantUrl());
    await expect(page.locator('#doc-hash')).toHaveText(/^[0-9a-f]{64}$/);
    await page.locator('#approve').click();

    // /sign/ shows each rule the request grants, and lets the user confirm.
    await page.waitForURL(/\/sign\/\?req=/);
    const cards = page.locator('[data-grant-rule]');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toHaveAttribute('data-grant-rule', 'guess');
    await expect(cards.nth(0)).toContainText('rule 1 of 2');
    // A noun phrase in the lead, not a second sentence inside it.
    await expect(page.locator('#lead')).toHaveText(
      `${DAPP} wants this account to sign a session key grant for 2 rules.`,
    );
    await expect(cards.nth(1)).toContainText('Can pay');
    await expect(cards.nth(1)).toContainText('the contract “guess” calls');
    await expect(cards.nth(1)).toContainText('24 hours');
    await expect(cards.nth(0)).not.toContainText('Can pay');
    // The call-only rule allows no token function; /sign/ says so rather than "any amount".
    await expect(cards.nth(0)).toContainText('No cap — allows no token functions');
    await expect(cards.nth(0)).not.toContainText('Any amount');
    await expect(cards.nth(0).locator('code.fn-call')).toHaveText(['guess()']);
    await expect(cards.nth(1).locator('code.fn-call')).toHaveText(['transfer()']);
    await expect(cards.nth(1)).toHaveAttribute('data-grant-rule', 'guess-xlm');
    await expect(cards.nth(1)).toContainText('Up to 2 XLM');
    await expect(page.locator('#approve')).toBeEnabled();
    await page.locator('#approve').click();

    await page.waitForURL(`${DAPP}/play?delegation=ok`, { timeout: 20_000 });
    expect(submitted.map((c) => [c.contract, c.fn])).toEqual([[ACCOUNT, 'apply_doc']]);
    const doc = parsePolicyDocJson(Buffer.from(submitted[0]!.args[0] as Uint8Array).toString('utf8'));
    expect(doc.rules.map((r) => r.name)).toEqual(['admin', 'guess', 'guess-xlm']);
    expect(doc.rules.map((r) => r.scope)).toEqual([
      { type: 'self-admin' },
      { type: 'contract', address: GAME },
      { type: 'contract', address: XLM },
    ]);
    expect(doc.signers.filter((sg) => sg.id !== 'admin')).toEqual([
      { id: 'session', verifier: deployment.webauthnVerifier, key: APP_KEY },
    ]);
  });
});
