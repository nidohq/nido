import { test, expect } from '@playwright/test';

// Drives the full flow and captures browser snapshots — the visual proof the
// example works end to end on real testkit output.
test('connect → visualize → simulate → attenuate', async ({ page }) => {
  await page.goto('/');

  // 1. Connect screen
  await expect(page.getByRole('heading', { name: 'Connect a Nido account' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/01-connect.png', fullPage: true });

  // 2. Connect the local-key Nido account
  await page.getByRole('button', { name: /Connect with Nido/ }).click();

  // A real derived C-address and a real 64-hex doc_hash appear.
  const hash = page.locator('#hash');
  await expect(hash).toBeVisible();
  await expect(hash).toHaveText(/^[0-9a-f]{64}$/);
  await expect(page.locator('.addr').first()).toHaveText(/^C[A-Z2-7]{55}$/);

  // All three verifiers, including the post-quantum ML-DSA signer.
  await expect(page.getByText('WebAuthn / secp256r1')).toBeVisible();
  await expect(page.getByText('ed25519 · sim')).toBeVisible();
  await expect(page.getByText('ML-DSA-65 (post-quantum) · sim')).toBeVisible();
  await page.screenshot({ path: 'artifacts/02-console.png', fullPage: true });

  // 3. Simulate: the ci key may publish as self → allow.
  await page.locator('#sim-run').click();
  await expect(page.locator('#sim-verdict')).toHaveClass(/verdict ok/);

  // ...but not set_admin → deny.
  await page.locator('#sim-fn').selectOption('set_admin');
  await page.locator('#sim-run').click();
  await expect(page.locator('#sim-verdict')).toHaveClass(/verdict bad/);
  await page.screenshot({ path: 'artifacts/03-simulate.png', fullPage: true });

  // ...but set_admin on the *self-admin* scope, signed by admin, is authorized
  // by the account's own admin rule → allow. (And pq alone authorizes it via
  // the ML-DSA pq-admin rule — the simulator tries every matching rule.)
  await page.locator('#sim-target').selectOption('self');
  await page.locator('.sim-signer[value="admin"]').check();
  await page.locator('#sim-run').click();
  await expect(page.locator('#sim-verdict')).toHaveClass(/verdict ok/);
  await page.screenshot({ path: 'artifacts/03b-self-admin.png', fullPage: true });

  // 4. Build a more complex policy: add a rule; doc_hash changes.
  const before = await hash.textContent();
  await page.locator('#b-add').click();
  await expect(hash).not.toHaveText(before ?? '');

  // 5. Attenuate: narrow ci-publish → verified ⊆ parent.
  await page.locator('#a-apply').click();
  await expect(page.locator('#a-verdict')).toHaveClass(/verdict ok/);

  // Attempt to widen → refused, fail-closed.
  await page.locator('#a-fns').fill('publish, publish_hash, set_admin');
  await page.locator('#a-apply').click();
  await expect(page.locator('#a-verdict')).toHaveClass(/verdict bad/);
  await page.screenshot({ path: 'artifacts/04-attenuate.png', fullPage: true });
});
