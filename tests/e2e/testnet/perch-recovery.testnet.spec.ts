import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect, SEED_HEX, useIdentity } from '../../support/fixtures';
import { getInitScript } from '../../support/auth/bundle';
import { createAndDeployAs } from '../../support/recovery';
import { deployAccountDirect } from '../../support/directDeploy';

/**
 * @testnet — recovery through the wallet on the Perch stack, for all six
 * profile/mode combinations, against live testnet with real proofs (bb.js in
 * the page) and the accounts' real passkey authorization.
 *
 * It runs against `perch.TESTNET`, Perch's testnet release
 * (stellar-registry/perch#99 WS4) and Nido's factory around its account:
 *
 *   PUBLIC_RELAYER_URL=… PUBLIC_RELAYER_SIM_SOURCE=… npx astro build --root ./packages/frontend
 *   npx playwright test --project=testnet-chromium perch-recovery
 *
 * Accounts are created through the onboarding UI, which the hosted relayer
 * sponsors. With `NIDO_E2E_DIRECT_DEPLOY=1` (and a build without the relayer)
 * they are created from Node instead (`deployAccountDirect`); every recovery
 * step still runs through the wallet against the deployed contracts.
 *
 * Each run: deploy guardian Nidos (guardian modes), deploy the owner's Nido
 * and set up recovery on /security/recovery/ (the "quick" timing preset, ~2
 * minutes), then from a fresh browser context with a NEW passkey: start a
 * recovery on /security/recover/, collect evidence (friends approve from
 * their own Nidos on /security/guardian/; the recovery kit proves in the
 * page), wait out the delay, and finish.
 */

const PORT = Number(process.env.E2E_PORT || 4399);
const createAccount = process.env.NIDO_E2E_DIRECT_DEPLOY ? deployAccountDirect : createAndDeployAs;

type Profile = 'loss' | 'protected';
type Mode = 'guardian-only' | 'zk-only' | 'combined';

/** Another browser (its own storage, so its own passkeys) with the same
 *  TestAuthenticator shim the fixture context gets. */
async function freshContext(browser: Browser, label: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await context.addInitScript({ content: `window.__TEST_AUTH_CONFIG__=${JSON.stringify({ seedHex: SEED_HEX })};` });
  await context.addInitScript({ content: await getInitScript() });
  const page = await context.newPage();
  await useIdentity(page, label).catch(() => {});
  return { context, page };
}

test.describe('@testnet Perch recovery through the wallet', () => {
  test.describe.configure({ timeout: 20 * 60_000 });

  for (const profile of ['loss', 'protected'] as const satisfies readonly Profile[]) {
    for (const mode of ['guardian-only', 'zk-only', 'combined'] as const satisfies readonly Mode[]) {
      test(`${profile} / ${mode}: set up, lose the passkey, recover`, async ({ page, browser }) => {
        const run = `${profile}-${mode}-${Date.now()}`;

        // Guardians: two Nidos, quorum 2.
        const guardians: { address: string; host: string; page: Page }[] = [];
        if (mode !== 'zk-only') {
          for (const n of [1, 2]) {
            const g = await freshContext(browser, `${run}-guardian-${n}`);
            const { cAddress, host } = await createAccount(g.page, PORT, `${run}-guardian-${n}`);
            guardians.push({ address: cAddress, host, page: g.page });
          }
        }

        // The owner's Nido and its recovery settings.
        const owner = await createAccount(page, PORT, `${run}-owner`);
        await page.goto(`http://${owner.host}/security/recovery/`, { waitUntil: 'networkidle' });
        await page.locator(`input[name="profile"][value="${profile}"]`).check();
        await page.locator(`input[name="mode"][value="${mode}"]`).check();
        if (mode !== 'zk-only') {
          await page.locator('textarea[name="guardians"]').fill(guardians.map((g) => g.address).join('\n'));
          await page.locator('input[name="quorum"]').fill('2');
        }
        await page.locator('select[name="timing"]').selectOption('quick');
        let kit = '';
        if (mode !== 'guardian-only') {
          await page.getByRole('button', { name: /Create my recovery kit/ }).click();
          const download = page.waitForEvent('download');
          await page.getByRole('link', { name: 'Download recovery kit' }).click();
          kit = await (await download).createReadStream().then(async (stream) => {
            const chunks: Buffer[] = [];
            for await (const chunk of stream) chunks.push(chunk as Buffer);
            return Buffer.concat(chunks).toString('utf8');
          });
          await page.locator('[data-kit-saved]').check();
        }
        await page.getByRole('button', { name: /Turn on recovery/ }).click();
        await expect(page.getByText('Recovery saved')).toBeVisible({ timeout: 120_000 });

        // A new device with a new passkey.
        const device = await freshContext(browser, `${run}-owner-new-device`);
        device.page.on('dialog', (d) => void d.accept());
        device.page.on('pageerror', (e) => console.log(`[${run} device] pageerror: ${e.message}`));
        device.page.on('console', (m) => m.type() === 'error' && console.log(`[${run} device] ${m.text()}`));
        await device.page.goto(`http://${owner.host}/security/recover/`, { waitUntil: 'networkidle' });
        await device.page.getByRole('button', { name: 'Create my new passkey' }).click();
        await expect(device.page.getByText('Your recovery', { exact: true })).toBeVisible({ timeout: 180_000 });

        // Evidence: friends approve from their own Nidos; the old kit proves.
        if (guardians.length) {
          const links = await device.page.locator('[data-link]').evaluateAll((els) =>
            els.map((e) => (e as HTMLElement).dataset.link!),
          );
          for (const g of guardians) {
            const link = links.find((l) => l.includes(g.address.toLowerCase()))!;
            await g.page.goto(link, { waitUntil: 'networkidle' });
            const allow = g.page.getByRole('button', { name: 'Allow my Nido to approve recoveries' });
            if (await allow.isVisible().catch(() => false)) await allow.click();
            await g.page.getByRole('button', { name: 'Approve' }).click();
            await expect(g.page.getByText('Approved. You can close this page.')).toBeVisible({ timeout: 180_000 });
          }
        }
        if (kit) {
          await device.page.reload({ waitUntil: 'networkidle' });
          const box = device.page.locator('textarea.input.mono').first();
          await box.fill(kit);
          await box.dispatchEvent('change');
          await expect(device.page.getByText(/Approved\. You can finish/)).toBeVisible({ timeout: 300_000 });
        }

        // Wait out the delay, then finish.
        await expect(device.page.getByRole('button', { name: 'Finish recovery' })).toBeVisible({ timeout: 10 * 60_000 });
        await device.page.getByRole('button', { name: 'Finish recovery' }).click();
        await expect(device.page.getByText('Recovery finished')).toBeVisible({ timeout: 180_000 });
      });
    }
  }
});
