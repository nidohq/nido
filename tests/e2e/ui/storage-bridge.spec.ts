import { test, expect, type Page } from '@playwright/test';
import { StrKey } from '@stellar/stellar-sdk';
import { serveProduction } from '../../support/productionHeaders';

// The storage bridge under the headers production sends (public/_headers,
// mirrored by the proxy worker): account origins can frame it and sync, while
// signing pages stay unframeable and other origins get nothing back.

const APEX = 'nido.fyi';
const A = StrKey.encodeContract(Buffer.alloc(32, 1));
const B = StrKey.encodeContract(Buffer.alloc(32, 2));
const C = StrKey.encodeContract(Buffer.alloc(32, 3));
const origin = (id: string) => `https://${id.toLowerCase()}.${APEX}`;
const BRIDGE = `https://${APEX}/nido-storage-bridge/`;

async function seedApex(page: Page) {
  await page.goto(BRIDGE);
  await page.evaluate(
    ({ a, b, c }) => {
      localStorage.setItem('nido:testnet:accounts', JSON.stringify([a]));
      localStorage.setItem(
        'nido:testnet:pending',
        JSON.stringify([
          { contractId: b, setupKey: 'salt-b' },
          { contractId: c, setupKey: 'salt-c' },
        ]),
      );
    },
    { a: A, b: B, c: C },
  );
}

/** From the current page, frame the bridge and ask it for a snapshot, posting
 *  either from this window or from a nested window of the same origin. Resolves
 *  with the response, or null when none arrives. */
function askBridge(page: Page, from: 'self' | 'nested') {
  return page.evaluate(
    async ({ bridge, from }) => {
      const iframe = document.createElement('iframe');
      iframe.src = bridge;
      document.body.appendChild(iframe);
      await new Promise((r) => iframe.addEventListener('load', r, { once: true }));
      const id = 'probe';
      const request = { type: 'nido:storage:request:v1', id, snapshot: { accounts: [], pending: [], names: {} } };
      const answer = new Promise<unknown>((resolve) => {
        window.addEventListener('message', (e) => {
          if ((e.data as { id?: string })?.id === id) resolve(e.data);
        });
        setTimeout(() => resolve(null), 1500);
      });
      const target = new URL(bridge).origin;
      if (from === 'self') {
        iframe.contentWindow!.postMessage(request, target);
      } else {
        const nested = document.createElement('iframe');
        document.body.appendChild(nested);
        // A function from the nested window's realm, so the message's source
        // is the nested window rather than the embedder.
        const post = new (nested.contentWindow as unknown as typeof globalThis).Function(
          'w',
          'm',
          't',
          'w.postMessage(m, t)',
        );
        post(iframe.contentWindow, request, target);
      }
      return answer;
    },
    { bridge: BRIDGE, from },
  );
}

test.describe('@fast storage bridge with production headers', () => {
  test.beforeEach(async ({ context }) => {
    await serveProduction(context, APEX, ['https://evil.example']);
  });

  test('an account page syncs the account list from the apex and no other setup key', async ({ page }) => {
    await seedApex(page);
    await page.goto(`${origin(B)}/account/`);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('nido:testnet:accounts')), { timeout: 10_000 })
      .toContain(A);
    expect(await page.evaluate(() => localStorage.getItem('nido:testnet:pending'))).not.toContain('salt-c');
  });

  test("the bridge answers an account origin with that account's setup entry only", async ({ page }) => {
    await seedApex(page);
    await page.goto(`${origin(B)}/__blank`);
    const own = (await askBridge(page, 'self')) as { snapshot: { accounts: string[]; pending: unknown[] } };
    expect(own.snapshot.accounts).toEqual([A]);
    expect(own.snapshot.pending).toEqual([{ contractId: B, setupKey: 'salt-b' }]);

    await page.goto(`${origin(A)}/__blank`);
    const other = (await askBridge(page, 'self')) as { snapshot: { pending: unknown[] } };
    expect(other.snapshot.pending).toEqual([]);
  });

  test('a message from a window other than the embedder gets no answer', async ({ page }) => {
    await seedApex(page);
    await page.goto(`${origin(A)}/__blank`);
    expect(await askBridge(page, 'nested')).toBeNull();
  });

  test('a built-in dApp origin gets no answer and changes nothing', async ({ page }) => {
    await seedApex(page);
    await page.goto(`https://status-message.${APEX}/__blank`);
    expect(await askBridge(page, 'self')).toBeNull();
    await page.goto(BRIDGE);
    expect(await page.evaluate(() => localStorage.getItem('nido:testnet:pending'))).toContain('salt-c');
  });

  test('another site cannot frame the bridge', async ({ page }) => {
    await seedApex(page);
    await page.goto('https://evil.example/__blank');
    expect(await askBridge(page, 'self')).toBeNull();
  });

  test('signing pages stay unframeable', async ({ page }) => {
    await page.goto(`${origin(A)}/__blank`);
    const frame = await page.evaluate(async (src) => {
      const iframe = document.createElement('iframe');
      iframe.src = src;
      document.body.appendChild(iframe);
      await new Promise((r) => setTimeout(r, 1500));
      try {
        return iframe.contentDocument?.getElementById('approve') ? 'rendered' : 'blocked';
      } catch {
        return 'blocked';
      }
    }, `${origin(A)}/sign/?kind=message&message=hi`);
    expect(frame).toBe('blocked');
  });
});
