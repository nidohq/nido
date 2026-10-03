import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// UI-only checks for the recovery pages on the Perch stack. No chain, no
// passkey: the fast-tier build has no `PUBLIC_PERCH_DEPLOYMENT` (WS4's
// manifest does not exist yet), so every recovery page must say so instead
// of guessing addresses, and must boot without script errors. The flows
// themselves run against live testnet in
// tests/e2e/testnet/perch-recovery.testnet.spec.ts once the manifest lands.

const PORT = Number(process.env.E2E_PORT || 4399);
const DIST_DIR = join(process.cwd(), 'packages/frontend/dist');
const FAKE_CONTRACT_ID = 'CDLZFC2SYJYDZT7K7VJRL2CU7LQV6AFZ2K2QJLY7QV53KIGWXJOANPYY';
const host = `http://${FAKE_CONTRACT_ID.toLowerCase()}.localhost:${PORT}`;

function collectFatal(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test.describe('recovery pages — UI only (no chain) @fast', () => {
  test('the built pages carry the recovery mount points @fast', () => {
    for (const page of ['security/recovery', 'security/recover', 'security/guardian']) {
      const html = readFileSync(join(DIST_DIR, page, 'index.html'), 'utf-8');
      expect(html).toContain('id="recovery-root"');
    }
  });

  for (const path of ['/security/recovery/', '/security/recover/']) {
    test(`${path} says recovery is not deployed yet @fast`, async ({ page }) => {
      const errors = collectFatal(page);
      await page.goto(`${host}${path}`, { waitUntil: 'networkidle' });
      await expect(page.locator('#recovery-root')).toContainText('not deployed on this network yet');
      expect(errors).toEqual([]);
    });
  }

  test('the guardian page says recovery is not deployed yet @fast', async ({ page }) => {
    const errors = collectFatal(page);
    await page.goto(`${host}/security/guardian/#bm90LWEtcmVxdWVzdA`, { waitUntil: 'networkidle' });
    await expect(page.locator('#recovery-root')).toContainText('not deployed on this network yet');
    expect(errors).toEqual([]);
  });

  test('the security hub links to the recovery pages @fast', async ({ page }) => {
    await page.goto(`${host}/security/`, { waitUntil: 'networkidle' });
    await expect(page.locator('#recovery-section a[href="/security/recovery/"]')).toBeVisible();
    await expect(page.locator('a[href="/security/recover/"]')).toBeVisible();
    await expect(page.locator('#recovery-summary')).toContainText('Not available on this network yet');
  });

  test('the explainer describes friends, a kit, or both @fast', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/how-recovery-works/`, { waitUntil: 'networkidle' });
    await expect(page.getByText('Friends never hold a key')).toBeVisible();
  });
});
