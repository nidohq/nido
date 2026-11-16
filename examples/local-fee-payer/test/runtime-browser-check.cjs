const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const out = path.resolve(__dirname, '../qa');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const wallet = await context.newPage();
    await wallet.goto('http://wallet.localhost:5199/wallet.html');
    await wallet.locator('html[data-wallet-ready="true"]').waitFor();
    await context.route('**/runtime/wallet-checker.wasm', route => route.fulfill({ contentType: 'application/wasm', body: Buffer.from('tampered binary') }));
    const integrity = await wallet.evaluate(async () => {
      try { const { evaluateInWallet } = await import('/src/wasi-client.mjs'); await evaluateInWallet('{}'); return 'unexpected acceptance'; }
      catch (e) { return e.message; }
    });
    if (!integrity.includes('hash mismatch')) throw Error(integrity);
    const app = await context.newPage(); await app.goto('http://localhost:5198/#signing-boundary');
    const screenshots = [];
    for (const [width, scheme, name] of [[1200, 'light', 'boundary-desktop'], [390, 'light', 'boundary-mobile'], [390, 'dark', 'boundary-mobile-dark']]) {
      await app.setViewportSize({ width, height: 1000 }); await app.emulateMedia({ colorScheme: scheme });
      await app.locator('#signing-boundary').screenshot({ path: path.join(out, name + '.png') });
      if (await app.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Boundary page overflow');
      screenshots.push(name);
    }
    fs.writeFileSync(path.join(out, 'runtime-browser-check.json'), JSON.stringify({ integrity, screenshots, physicalAuthenticator: false, ledgerSubmission: false }, null, 2));
    console.log(JSON.stringify({ integrity, screenshots }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
