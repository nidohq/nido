// Optional local browser QA. Use a separately installed Playwright; it is not shipped to users.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const out = path.resolve(__dirname, '../qa'); fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    const session = await page.context().newCDPSession(page);
    await session.send('WebAuthn.enable');
    await session.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await page.goto(process.env.LAB_URL || 'http://localhost:5198/');
    await page.locator('html[data-ready="true"]').waitFor({ timeout: 30000 });
    if (await page.locator('#bypass').isVisible()) throw Error('Vulnerable comparison should start collapsed');
    await page.locator('#vulnerable-comparison > summary').click();
    await page.locator('#bypass').click();
    await page.waitForFunction(() => document.querySelector('#bypass-signature').textContent === 'Valid · without passkey');
    await page.locator('#register').click();
    await page.waitForFunction(() => !document.querySelector('#approve-c').disabled);
    await page.locator('#approve-c').click();
    await page.waitForFunction(() => !document.querySelector('#approve-fee').disabled);
    await page.locator('#approve-fee').click();
    await page.waitForFunction(() => document.querySelector('#signature-status').textContent === 'Yes · Ed25519');
    const download = page.waitForEvent('download'); await page.locator('#download').click();
    await (await download).saveAs(path.join(out, 'signed-fixture.xdr'));
    await page.screenshot({ path: path.join(out, 'desktop.png'), fullPage: true });
    await page.locator('#fee').selectOption('1000'); await page.locator('#approve-c').click();
    await page.waitForFunction(() => document.querySelector('#policy-status').textContent === 'Denied');
    if (!await page.locator('#approve-fee').isDisabled()) throw Error('Denied request can continue');
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true });
    const sizes = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    if (sizes.document > sizes.viewport) throw Error('Document overflows on mobile');
    await page.locator('.evidence summary').first().focus(); await page.keyboard.press('Enter');
    if (!await page.locator('.evidence').first().evaluate(e => e.open)) throw Error('Keyboard disclosure failed');
    if (errors.length) throw Error(errors.join('\n'));
    const result = { checks: ['browser WebAuthn via Chromium virtual authenticator', 'Cedar WASM', 'same-passkey C and fee approvals', 'Ed25519 verification', 'unrelated transaction bypass without enrollment', 'XDR download', 'over-budget denial', 'desktop/mobile', 'keyboard disclosure'], errors, sizes, networkSubmission: false, authenticator: 'virtual, not a physical device' };
    fs.writeFileSync(path.join(out, 'browser-check.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    if (page) { console.error(await page.locator('#message').textContent()); await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }); }
    throw error;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
