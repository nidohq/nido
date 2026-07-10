import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair } from '@stellar/stellar-sdk';
import { adsumChainMock, type AdsumScenario } from '../../support/adsumChainMock';

// FAST lane: the Adsum example dApp (examples/adsum), served standalone
// (tests/support/adsum-server.mjs, port 4401 by default) against a
// chain-mocked Soroban RPC (tests/support/adsumChainMock.ts) — no wallet
// ceremony, no real testnet, no real chain. Covers Home, Petition, Vouch,
// and Claim as disconnected, read-only views, per the Adsum dapp plan's
// Task 9.
const PORT = Number(process.env.E2E_ADSUM_PORT || 4401);
const ADSUM = `http://localhost:${PORT}`;

// Same existence check playwright.config.ts uses to decide whether to start
// the adsum-server.mjs webServer entry at all: skip gracefully (rather than
// fail against a 404'ing server, or a webServer startup timeout) when
// examples/adsum/dist hasn't been built. Resolved from process.cwd()
// (Playwright's cwd, the repo root) rather than import.meta.url -- Playwright
// transpiles specs to CommonJS, so import.meta isn't available (see
// account-ui.spec.ts's DIST_DIR comment for the same constraint).
const adsumDistPath = join(process.cwd(), 'examples/adsum/dist');
test.skip(!existsSync(adsumDistPath), 'examples/adsum/dist not built');

/** A deterministic G-address, distinct per `fill` byte — no real key material,
 *  just a valid, checksummed ed25519 public key for seed data. */
const addr = (fill: number) => Keypair.fromRawEd25519Seed(Buffer.alloc(32, fill)).publicKey();

const CREATOR_0 = addr(1);
const CREATOR_1 = addr(2);
const CREATOR_2 = addr(3);
const VOUCH_TARGET = addr(4);
const CLAIM_FROM = addr(5);

const shortAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

const PETITION_0_BODY =
  'The Commons Bridge has stood unrepaired since the spring floods. We, the undersigned, call on the council to fund the repair before winter closes the crossing entirely.';

const CLAIM_SEED = Buffer.alloc(32, 7);
const CLAIM_SEED_HEX = CLAIM_SEED.toString('hex');
// Valid 64-hex-char format (so it parses), but derives a pubkey no seeded
// pre-vouch matches — the "unknown key" / exhausted-letter case.
const UNKNOWN_CLAIM_SEED_HEX = 'ab'.repeat(32);

function scenario(): AdsumScenario {
  return {
    petitions: [
      {
        id: 0,
        creator: CREATOR_0,
        title: 'Repair the Commons Bridge',
        body: PETITION_0_BODY,
        sigCount: 5,
        goal: 10,
        deadline: null,
        createdLedger: 100,
        signers: [],
      },
      {
        id: 1,
        creator: CREATOR_1,
        title: 'Protect the Harbor Lights',
        body: 'The harbor lighthouse keeps the channel safe on moonless nights. Its upkeep fund has run dry — restore it before the fog season.',
        sigCount: 12,
        goal: null,
        deadline: null,
        createdLedger: 200,
        signers: [],
      },
      {
        id: 2,
        creator: CREATOR_2,
        title: 'Fund the Public Archive',
        body: 'Every deed, ledger, and letter this town has kept for two hundred years sits in one damp basement. Fund a proper archive before the record is lost.',
        sigCount: 7,
        goal: null,
        deadline: null,
        createdLedger: 300,
        signers: [],
      },
    ],
    preVouches: [
      {
        // The pubkey derived from the seed the "known key" claim test uses
        // below (Keypair.fromRawEd25519Seed(CLAIM_SEED).rawPublicKey()).
        pubkeyHex: Keypair.fromRawEd25519Seed(CLAIM_SEED).rawPublicKey().toString('hex'),
        from: CLAIM_FROM,
        expires: null,
        maxClaims: 5,
        claims: 1,
      },
    ],
    // Reverse name resolution: VOUCH_TARGET resolves to a name (proves the
    // resolver-facing read); CLAIM_FROM is deliberately left unregistered so
    // the claim test exercises the truncated-address fallback path instead.
    names: { [VOUCH_TARGET]: 'Harbor Alliance' },
  };
}

test.describe('adsum petition + trust dApp (chain-mocked) @fast', () => {
  test('home renders the 3 seeded petitions newest-first with counts @fast', async ({ page }) => {
    await adsumChainMock(page, scenario());
    await page.goto(`${ADSUM}/`, { waitUntil: 'load' });

    const cards = page.locator('section[aria-label="Posted petitions"] ul > li');
    await expect(cards).toHaveCount(3);
    await expect(page.locator('section[aria-label="Posted petitions"]')).toContainText(
      '3 standing',
    );

    const texts = await cards.allTextContents();
    expect(texts[0]).toContain('Fund the Public Archive');
    expect(texts[0]).toContain('7');
    expect(texts[0]).toContain('present');

    expect(texts[1]).toContain('Protect the Harbor Lights');
    expect(texts[1]).toContain('12');
    expect(texts[1]).toContain('present');

    expect(texts[2]).toContain('Repair the Commons Bridge');
    expect(texts[2]).toContain('5');
    expect(texts[2]).toContain('present');
  });

  test('petition page renders body, sigCount, and a disabled stamp when disconnected @fast', async ({
    page,
  }) => {
    await adsumChainMock(page, scenario());
    await page.goto(`${ADSUM}/petition/0`, { waitUntil: 'load' });

    await expect(page.getByText(PETITION_0_BODY)).toBeVisible();
    await expect(page.getByRole('progressbar', { name: '5 of 10 present' })).toBeVisible();

    const stamp = page.getByRole('button', { name: 'Adsum — I am present' });
    await expect(stamp).toBeVisible();
    await expect(stamp).toBeDisabled();
    await expect(stamp).toHaveAttribute('data-state', 'disabled');
    await expect(stamp).toHaveAttribute('aria-pressed', 'false');
    await expect(
      page.getByText('The record is open — connect a wallet to add your name.'),
    ).toBeVisible();
  });

  test('vouch page resolves a seeded name; a junk address renders the error state @fast', async ({
    page,
  }) => {
    await adsumChainMock(page, scenario());

    await page.goto(`${ADSUM}/vouch?for=${VOUCH_TARGET}`, { waitUntil: 'load' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Harbor Alliance');
    await expect(page.getByText(VOUCH_TARGET, { exact: true })).toBeVisible();
    await expect(page.getByText('Connect a wallet to vouch for this address.')).toBeVisible();

    await page.goto(`${ADSUM}/vouch?for=not-a-real-address`, { waitUntil: 'load' });
    await expect(page.getByText('No address here')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the wall' })).toBeVisible();
  });

  test('claim page renders the vouching letter; an unknown key renders exhausted @fast', async ({
    page,
  }) => {
    await adsumChainMock(page, scenario());

    await page.goto(`${ADSUM}/claim?k=${CLAIM_SEED_HEX}`, { waitUntil: 'load' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      `${shortAddress(CLAIM_FROM)} has vouched for you`,
    );
    await expect(page.getByText(`from ${CLAIM_FROM}`)).toBeVisible();
    await expect(page.getByText('1 of 5 claimed · never expires')).toBeVisible();
    await expect(
      page.getByText(
        'This letter is addressed to whichever account accepts it — connect, or create a Nido account on the spot, to claim it.',
      ),
    ).toBeVisible();

    await page.goto(`${ADSUM}/claim?k=${UNKNOWN_CLAIM_SEED_HEX}`, { waitUntil: 'load' });
    await expect(page.getByText('No longer available')).toBeVisible();
    await expect(
      page.getByText(/every use was claimed, its term ran out, or it was revoked/),
    ).toBeVisible();
  });
});
