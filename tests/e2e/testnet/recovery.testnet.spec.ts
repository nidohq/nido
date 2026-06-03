import { test, expect, useIdentity } from '../../support/fixtures';
import { seedBank } from '../../support/testnet';
import { createAndDeployAs, installRecoveryRule } from '../../support/recovery';

const PORT = Number(process.env.E2E_PORT || 4399);

/**
 * @testnet — real-chain end-to-end of the social-recovery (1-of-1) ceremony.
 *
 * An account with a friend-gated recovery rule rotates its passkey after the
 * owner "loses" their device:
 *  1) Deploy a friend account + the originator account with DISTINCT passkeys
 *     (useIdentity before each register — otherwise both register the same
 *     'default' key and the test is meaningless).
 *  2) Install a 1-of-1 recovery rule on the originator (CallContract(self),
 *     multisig-policy threshold 1, the friend as the sole signer). This is a
 *     primary-passkey self-mod (proven by the session-key install spec).
 *  3) Originator: create a fresh rotation passkey (#om-new-key), stage the
 *     rotation (#om-prepare — freezes the canonical parentSignatureExpiration-
 *     Ledger and emits the ?handoff= link).
 *  4) Friend: open the handoff link ON THE FRIEND'S subdomain (so loadCredential
 *     finds the friend's key), sign the nested auth entry with their OWN passkey
 *     (#fm-sign → #fm-blob).
 *  5) Originator: paste the blob, add it (#om-add-sig → 1/1), submit
 *     (#om-submit → #om-submit-status).
 *
 * ASSERT-OR-PIN: recovery is the most auth-fragile flow (nested friend auth
 * targeting the RECOVERING account's __check_auth + byte-identical parent
 * expiration + multisig threshold policy). If a step is rejected on-chain we
 * capture the EXACT #om-submit-status / #fm-status text and which step produced
 * it, then throw (documenting the failure) rather than mask it.
 */
test.describe('@testnet social recovery (1-of-1)', () => {
  test.describe.configure({ timeout: 360_000 });

  test('friend-gated rotation: stage → friend signs → collect → submit', async ({
    page,
    context,
  }) => {
    await seedBank(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // --- SETUP: deploy friend, then originator (distinct identities) ---
    const friend = await createAndDeployAs(page, PORT, 'friend-a');
    const orig = await createAndDeployAs(page, PORT, 'originator');

    // Install a 1-of-1 recovery rule on the originator; friend = friend account.
    await installRecoveryRule(page, orig.host, [friend.cAddress], 1);

    // --- ORIGINATOR: new key + stage rotation ---
    await page.goto(`http://${orig.host}/security/recover/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#originator-mode')).toBeVisible({ timeout: 30_000 });
    // The recovery rule must have been discovered (#om-no-rule stays hidden, the
    // stage UI shows). If #om-no-rule is shown, the install didn't land.
    await expect(page.locator('#om-no-rule')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('#om-new-key')).toBeVisible({ timeout: 30_000 });

    // The NEW rotation passkey is a fresh identity (shim create() keys off it).
    await useIdentity(page, 'orig-rotated');
    await page.locator('#om-new-key').click();
    await expect(page.locator('#om-key-status')).toContainText(/created|0x|04|…/i, {
      timeout: 30_000,
    });
    await expect(page.locator('#om-prepare')).toBeEnabled({ timeout: 15_000 });
    await page.locator('#om-prepare').click();
    await expect(page.locator('#om-collect')).toBeVisible({ timeout: 90_000 });

    const handoff = (await page.locator('#om-link').inputValue()).trim();
    expect(handoff, '#om-prepare did not emit a handoff link').toContain('handoff=');

    // --- FRIEND: open handoff on the friend subdomain, sign ---
    // The handoff link points at the ORIGINATOR host; rewrite host→friend host
    // so the friend signs on THEIR subdomain where loadCredential finds the
    // friend's primary passkey.
    const handoffParam = new URL(handoff, `http://${orig.host}`).searchParams.get('handoff')!;
    await page.goto(
      `http://${friend.host}/security/recover/?handoff=${encodeURIComponent(handoffParam)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await expect(page.locator('#friend-mode')).toBeVisible({ timeout: 30_000 });
    // NOTE: the page fills #fm-account with `contractIdFromHostname(hostname)` —
    // i.e. the CURRENT (friend) subdomain's account, NOT the recovering
    // originator (a UI labeling quirk: the copy says "your friend …" but the
    // value is this account). So assert it equals the FRIEND address. The
    // originator↔friend link is enforced inside signRotationAsFriend, which
    // requires `handoff.friends.includes(friendAccount)`.
    await expect(page.locator('#fm-account')).toContainText(friend.cAddress.slice(0, 8));
    await page.locator('#fm-sign').click();

    // #fm-blob is a textarea revealed (and filled) only after a successful sign.
    // Race the success status against a "Failed: …" so a friend-side rejection
    // surfaces verbatim instead of timing out blind.
    const friendOutcome = await Promise.race([
      page
        .locator('#fm-status')
        .filter({ hasText: /Signed/i })
        .first()
        .waitFor({ timeout: 60_000 })
        .then(() => 'signed' as const),
      page
        .locator('#fm-status')
        .filter({ hasText: /Failed/i })
        .first()
        .waitFor({ timeout: 60_000 })
        .then(() => 'failed' as const),
    ]).catch(() => 'timeout' as const);

    if (friendOutcome !== 'signed') {
      const fmStatus = (await page.locator('#fm-status').textContent().catch(() => ''))?.trim();
      throw new Error(
        `friend sign step did not succeed (outcome=${friendOutcome}). ` +
          `fm-status="${fmStatus}" orig=${orig.cAddress} friend=${friend.cAddress}.`,
      );
    }
    const blob = (await page.locator('#fm-blob').inputValue()).trim();
    expect(blob.length, 'friend blob is empty').toBeGreaterThan(0);

    // --- ORIGINATOR: collect + submit ---
    await page.goto(`http://${orig.host}/security/recover/`, { waitUntil: 'domcontentloaded' });
    // Staging persists in the originator's localStorage, so #om-collect resumes.
    await expect(page.locator('#om-collect')).toBeVisible({ timeout: 30_000 });
    await page.locator('#om-paste').fill(blob);
    await page.locator('#om-add-sig').click();
    await expect(page.locator('#om-progress')).toContainText(/1\s*(of|\/)\s*1/i, {
      timeout: 15_000,
    });
    await expect(page.locator('#om-submit')).toBeEnabled({ timeout: 15_000 });
    await page.locator('#om-submit').click();

    // --- ASSERT or PIN ---
    // On success #om-submit-status reads "Rotation submitted: <hash>. …".
    // On failure it reads "Failed: <msg>". (This page has no #error-box.)
    const outcome = await Promise.race([
      page
        .locator('#om-submit-status')
        .filter({ hasText: /Rotation submitted|submitted|success|rotated|now active/i })
        .first()
        .waitFor({ timeout: 240_000 })
        .then(() => 'ok' as const),
      page
        .locator('#om-submit-status')
        .filter({ hasText: /Failed/i })
        .first()
        .waitFor({ state: 'visible', timeout: 240_000 })
        .then(() => 'failed' as const),
    ]).catch(() => 'timeout' as const);

    if (outcome !== 'ok') {
      const status = (await page.locator('#om-submit-status').textContent().catch(() => ''))?.trim();
      // PIN: recovery is the most auth-fragile flow (nested friend auth +
      // byte-identical parent expiration + multisig policy). A rejection here is
      // a real finding worth capturing precisely — do NOT loosen the assert.
      // >>> FLIP to assert 'ok' once recovery succeeds on-chain.
      throw new Error(
        `recovery submit did not succeed (outcome=${outcome}). ` +
          `om-submit-status="${status}" ` +
          `orig=${orig.cAddress} friend=${friend.cAddress}.`,
      );
    }
    expect(outcome).toBe('ok');

    expect(errors.filter((e) => /Buffer|is not defined|Unexpected token/.test(e))).toEqual([]);
    test.info().annotations.push({ type: 'orig', description: orig.cAddress });
    test.info().annotations.push({ type: 'friend', description: friend.cAddress });
  });
});
