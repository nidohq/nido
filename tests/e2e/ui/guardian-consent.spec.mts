import { test, expect, type Page } from '@playwright/test';
import { StrKey } from '@stellar/stellar-sdk';
import { buildPolicyDoc, perch, type PolicyDoc } from '@nidohq/passkey-sdk';
import {
  accountViews,
  deployment,
  deploymentViews,
  guardianRule,
  mockPerchChain,
  type Invocation,
} from '../../support/perchRpcMock.mts';

// The guardian page in a browser, against a build with a Perch deployment
// and a mocked chain (tests/support/perchRpcMock.mts): what a friend reads
// before approving a reconfiguration is what the approval signs.
//
// Needs `packages/frontend/dist-perch`:
//   PUBLIC_PERCH_DEPLOYMENT="$(cat tests/support/perch-fixture-deployment.json)" \
//     npx astro build --root ./packages/frontend --outDir ./dist-perch

const contract = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));
const ACCOUNT = contract(30);
const guardians = [contract(20), contract(21), contract(22)];
const KEY = '04' + 'ab'.repeat(64);
const VALID_UNTIL = 5_000;

function ownerDoc(more: Partial<perch.RecoveryChoice> = {}): PolicyDoc {
  const doc = buildPolicyDoc({
    network: deployment.network,
    signers: [{ id: 'admin', kind: 'passkey', verifier: deployment.webauthnVerifier, publicKey: KEY }],
    permissions: [{ name: 'admin', on: 'self-admin', by: ['admin'] }],
  });
  return perch.withRecovery(
    doc,
    perch.recoverySpec(deployment as perch.PerchDeployment, {
      profile: 'protected',
      mode: 'guardian-only',
      guardians,
      quorum: 2,
      replaceable: ['admin'],
      ...more,
    }),
  );
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** The config hash an `approve_change` subject names, as the controller
 *  receives it: `Reconfigure(Set(hash))`. */
function signedConfigHash(subject: unknown): string {
  const [tag, [inner, hash]] = subject as [string, [string, Uint8Array]];
  expect([tag, inner]).toEqual(['Reconfigure', 'Set']);
  return hex(hash);
}

/** Open, as guardian `guardians[0]` on its own Nido, the link asking it to
 *  approve `recovery` for ACCOUNT. Returns the simulated invocations and the
 *  config hash the link names. */
async function openRequest(page: Page, recovery: unknown): Promise<{ calls: Invocation[]; configHash: string }> {
  const current = ownerDoc();
  const configHash = hex(perch.configHash({ ...current, recovery } as PolicyDoc)!);
  const request = {
    kind: 'change',
    account: ACCOUNT,
    change: { kind: 'reconfigure-set', configHash },
    validUntil: VALID_UNTIL,
    recovery,
  };
  const calls = await mockPerchChain(page, {
    ...deploymentViews(),
    ...accountViews(ACCOUNT, { canonical: JSON.stringify(current) }),
    ...accountViews(guardians[0]!, { rules: [guardianRule()] }),
  });
  const fragment = Buffer.from(JSON.stringify(request)).toString('base64url');
  await page.goto(`http://${guardians[0]!.toLowerCase()}.localhost:4397/security/guardian/#${fragment}`);
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
  return { calls, configHash };
}

/** The `approve_change` the Approve button asks the guardian to sign. */
async function approveAndCapture(page: Page, calls: Invocation[]): Promise<Invocation> {
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => calls.find((c) => c.fn === 'approve_change')).toBeDefined();
  return calls.find((c) => c.fn === 'approve_change')!;
}

test.describe('guardian page: what is shown is what is signed @fast', () => {
  test('a replaced controller and replaced guardians are shown in full and signed as shown', async ({ page }) => {
    const replacement = [contract(60), contract(61), contract(62)];
    const controller = contract(70);
    const recovery = structuredClone(ownerDoc().recovery) as Record<string, unknown> & { mode: Record<string, unknown> };
    recovery.controller = controller;
    recovery.mode.guardians = replacement;
    const { calls, configHash } = await openRequest(page, recovery);

    // The move of trust, called out above the table, every address in full.
    const alert = page.locator('[data-trust-changes]');
    await expect(alert).toBeVisible();
    await expect(alert.locator('[data-trust="controller"]')).toContainText(deployment.recoveryController);
    await expect(alert.locator('[data-trust="controller"]')).toContainText(controller);
    await expect(alert.locator('[data-trust="controller"]')).toContainText('Not the one Nido sets up today');
    for (const g of [...guardians, ...replacement]) {
      await expect(alert.locator('[data-trust="mode.guardians"]')).toContainText(g);
    }

    // Every setting of the request, as the table shows it.
    await expect(page.locator('tr[data-changed]')).toHaveCount(2);
    await expect(page.locator('tr[data-setting="controller"]')).toContainText(controller);
    for (const g of replacement) await expect(page.locator('tr[data-setting="mode.guardians"]')).toContainText(g);

    // The approval states the hash of these settings, and signs exactly it.
    await expect(page.locator('[data-approves]')).toHaveAttribute('data-approves', configHash);
    await expect(page.locator('[data-approves]')).toContainText(configHash);
    await expect(page.locator('[data-approves]')).toContainText(ACCOUNT);
    await expect(page.locator('[data-approves]')).toContainText(`ledger ${VALID_UNTIL}`);
    const signed = await approveAndCapture(page, calls);
    expect(signed.contract).toBe(deployment.recoveryController);
    await expect(page.locator('[data-approves]')).toContainText(signed.contract);
    const [account, subject, validUntil, guardian] = signed.args;
    expect(account).toBe(ACCOUNT);
    expect(signedConfigHash(subject)).toBe(configHash);
    expect(validUntil).toBe(VALID_UNTIL);
    expect(guardian).toBe(guardians[0]);
  });

  test('each setting a request carries is the value displayed', async ({ page }) => {
    const recovery = structuredClone(ownerDoc({ delayLedgers: 77, expiryLedgers: 88, maxCancels: 9 }).recovery) as Record<string, unknown>;
    const { calls, configHash } = await openRequest(page, recovery);

    const leaves = (m: unknown, path = ''): [string, string[]][] =>
      Array.isArray(m)
        ? [[path, m.map(String)]]
        : typeof m === 'object' && m !== null
          ? Object.entries(m).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k))
          : [[path, [String(m)]]];
    for (const [path, values] of leaves(recovery)) {
      const row = page.locator(`tr[data-setting="${path}"]`);
      for (const v of values) await expect(row).toContainText(v);
    }
    await expect(page.locator('[data-trust-changes]')).toHaveCount(0);

    const signed = await approveAndCapture(page, calls);
    expect(signedConfigHash(signed.args[1])).toBe(configHash);
  });
});
