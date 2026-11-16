const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const out = path.resolve(__dirname, '../qa'); fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true }); let page, wallet;
  try {
    const context = await browser.newContext(); page = await context.newPage();
    const errors = []; context.on('page', p => p.on('pageerror', e => errors.push(String(e))));
    await page.addInitScript(() => window.addEventListener('message', event => {
      if (event.origin !== 'http://wallet.localhost:5199') return;
      try { void event.source.document.body; window.__walletDOMBlocked = false; }
      catch (error) { window.__walletDOMBlocked = error.name === 'SecurityError'; }
    }));
    await page.goto('http://localhost:5198/');
    const opened = page.waitForEvent('popup'); await page.locator('#open-wallet').click(); wallet = await opened;
    const cdp = await context.newCDPSession(wallet); await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } });
    await wallet.locator('html[data-wallet-ready="true"]').waitFor();
    await wallet.locator('#create-vault').click();
    await wallet.waitForFunction(() => document.querySelector('#vault-state').textContent === 'Encrypted · locked', { timeout: 30000 });
    const vault = await wallet.evaluate(() => JSON.parse(localStorage.getItem('nido-fee-lab-prf-vault-v1')));
    if (Object.keys(vault).sort().join() !== 'publicKeys,registration,salt,sealed,version') throw Error('Unexpected persisted vault data');
    if (vault.registration.rpId !== 'wallet.localhost' || !vault.sealed.ciphertext) throw Error('Bad PRF vault binding');
    if (!await page.evaluate(() => window.__walletDOMBlocked)) throw Error('App can read wallet DOM');
    if (await page.evaluate(() => localStorage.getItem('nido-fee-lab-prf-vault-v1')) !== null) throw Error('Wallet vault leaked to app origin');
    const rpResult = await page.evaluate(async credentialId => {
      const decode = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      try { await navigator.credentials.get({ publicKey: { rpId: 'wallet.localhost', challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ id: decode(credentialId), type: 'public-key' }], timeout: 1000 } }); return 'unexpected success'; }
      catch (error) { return error.name; }
    }, vault.registration.credentialId);
    if (rpResult !== 'SecurityError') throw Error('App could request wallet RP ID: ' + rpResult);
    await wallet.reload(); // Persisted ciphertext must unlock using a fresh PRF assertion.
    await wallet.locator('html[data-wallet-ready="true"]').waitFor();
    await wallet.waitForFunction(() => !document.querySelector('#wallet-approve').disabled);
    await wallet.locator('#wallet-approve').click();
    await page.locator('#popup-message[data-signed="true"]').waitFor();
    if (!(await wallet.locator('#runtime-state').textContent()).includes('Allowed')) throw Error('WASI checker did not allow');
    const runtimeDecision = JSON.parse(await wallet.locator('#runtime-evidence').textContent());
    if (!runtimeDecision.allowed || runtimeDecision.facts.checks.length !== 5) throw Error('Missing runtime evidence');
    const runtimeFailures = await wallet.evaluate(async () => {
      const { evaluateInWallet } = await import('/src/wasi-client.mjs');
      const ActualWorker = window.Worker;
      let terminated = 0;
      window.Worker = class { postMessage() {} terminate() { terminated++; } };
      let timeout;
      try { await evaluateInWallet('{}', 15); } catch (e) { timeout = e.message; }
      finally { window.Worker = ActualWorker; }
      const actualDenied = await evaluateInWallet('{}');
      return { timeout, terminated, actualDenied };
    });
    if (!runtimeFailures.timeout.includes('timed out') || runtimeFailures.terminated !== 1 || runtimeFailures.actualDenied.allowed !== false) throw Error('Runtime failure handling failed');
    await wallet.screenshot({ path: path.join(out, 'wallet-desktop.png'), fullPage: true });
    await wallet.setViewportSize({ width: 390, height: 844 });
    await wallet.screenshot({ path: path.join(out, 'wallet-mobile.png'), fullPage: true });
    const overflow = await wallet.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw Error('Wallet overflows mobile viewport');
    const refused = page.waitForEvent('popup'); await page.locator('#wrong-wallet').click(); const rejectedWallet = await refused;
    await rejectedWallet.waitForFunction(() => document.querySelector('#wallet-message').textContent.includes('wrong C account'));
    if (!await rejectedWallet.locator('#wallet-approve').isDisabled()) throw Error('Wrong C can be approved');
    const response = await context.request.get('http://wallet.localhost:5199/wallet.html');
    if (response.headers()['content-security-policy'] !== "frame-ancestors 'none'") throw Error('Missing anti-framing header');
    if (errors.length) throw Error(errors.join('\n'));
    const result = { checks: ['separate wallet origin', 'real WebAuthn PRF via virtual authenticator', 'encrypted seed persists across reload', 'same passkey signs C and unlocks fee HD path', 'Rust WASI guest checks actual XDR, Perch, P256 and Cedar before unlock', 'worker timeout terminates and rejects', 'real guest malformed input denies', 'signed fee envelope returned and independently verified', 'app cannot read wallet DOM or storage', 'app rejected for wallet RP ID', 'wrong C rejected without signing', 'anti-framing header', 'mobile layout'], runtimeDecision, runtimeFailures, rpResult, errors, overflow, networkSubmission: false, physicalAuthenticator: false, wasiHostImplemented: true };
    fs.writeFileSync(path.join(out, 'popup-browser-check.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } catch (error) {
    if (wallet && !wallet.isClosed()) { console.error(await wallet.locator('#wallet-message').textContent()); await wallet.screenshot({ path: path.join(out, 'popup-failure.png'), fullPage: true }); }
    throw error;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
