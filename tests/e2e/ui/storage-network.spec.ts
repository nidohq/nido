import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test, expect } from '../../support/fixtures';
import { ACCOUNT, APEX, DIST_MAINNET, accountOrigin, mockSetupChain } from '../../support/setupFlowMock';

// Every page of the mainnet build, on an account origin and on the apex: no
// script may read wallet storage before the page has set the storage network
// (passkey-sdk `nidoKey` throws until then).

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pages(path);
    return entry.name === 'index.html' ? [`/${relative(DIST_MAINNET, dir).split(sep).join('/')}/`.replace('//', '/')] : [];
  });
}

const NEVER_SET = 'storage network was never set';

test.describe('@fast storage network (mainnet build)', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const origin of [accountOrigin(ACCOUNT), `https://${APEX}`]) {
    test(`no page reads storage before the network is set on ${origin}`, async ({ context, page }) => {
      await mockSetupChain(context);
      // A stored name makes the sidebar read storage as soon as it runs.
      await page.goto(`${origin}/__blank`);
      await page.evaluate((id) => localStorage.setItem(`nido:mainnet:names:${id}`, 'alice'), ACCOUNT);

      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`${page.url()}: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`${page.url()}: ${message.text()}`);
      });

      for (const path of pages(DIST_MAINNET)) {
        await page.goto(`${origin}${path}`, { waitUntil: 'load' });
        await page.waitForTimeout(250);
      }
      expect(errors.filter((e) => e.includes(NEVER_SET))).toEqual([]);
    });
  }
});
