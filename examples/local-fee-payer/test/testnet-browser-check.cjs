// Real testnet exercise. Only static preview files may be routed locally;
// Friendbot, RPC, WebAuthn, the WASI guest and ledger settlement remain real.
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const number=process.env.FEE_PREVIEW_NUMBER||'365', app=`https://${number}.test.nido.fyi`, origin=`https://pr-${number}.nido-1am.pages.dev`;
 const browser=await chromium.launch({headless:true});let wallet;
 try {
  fs.mkdirSync('qa',{recursive:true});
  const context=await browser.newContext(), errors=[];
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  if(process.env.FEE_PREVIEW_DIR)await context.route(url=>[app,origin].includes(url.origin)&&url.pathname.startsWith('/fee-demo/'),async route=>{
   const url=new URL(route.request().url()), file=path.join(process.env.FEE_PREVIEW_DIR,url.pathname.slice('/fee-demo/'.length));
   const type={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.wasm':'application/wasm'}[path.extname(file)]||'application/octet-stream';
   await route.fulfill({path:file,contentType:type});
  });
  const page=await context.newPage();await page.goto(`${app}/fee-demo/testnet.html`);
  const opened=page.waitForEvent('popup');await page.locator('#open-budget-wallet').click();wallet=await opened;
  const cdp=await context.newCDPSession(wallet);await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true,hasPrf:true}});
  await wallet.locator('html[data-wallet-ready="true"]').waitFor();await wallet.locator('#budget-enroll').click();
  await wallet.waitForFunction(()=>!document.getElementById('budget-run').disabled||document.getElementById('budget-message').classList.contains('bad'),null,{timeout:300000});
  if(await wallet.locator('#budget-run').isDisabled())throw Error(await wallet.locator('#budget-message').textContent());
  console.log('Testnet enrollment confirmed');
  for(let i=0;i<3;i++){
   await wallet.evaluate(()=>delete document.getElementById('budget-message').dataset.confirmed);
   await wallet.locator('#budget-run').click();
   await wallet.waitForFunction(()=>document.getElementById('budget-message').dataset.confirmed==='true'||document.getElementById('budget-message').classList.contains('bad'),null,{timeout:180000});
   if((await wallet.locator('#budget-message').getAttribute('data-confirmed'))!=='true')throw Error(await wallet.locator('#budget-message').textContent());
   if(await wallet.locator('#budget-uses').textContent()!==String(i+1))throw Error('Wrong settled action count');
   console.log(`Testnet action ${i+1} confirmed`);
  }
  const profile=await wallet.evaluate(()=>JSON.parse(localStorage.getItem('nido-testnet-budget-profile-v1')));
  const result={profile,refillCount:await wallet.locator('#budget-checks').textContent(),spent:await wallet.locator('#budget-spent').textContent(),balance:await wallet.locator('#budget-balance').textContent(),receipts:await wallet.locator('#budget-history').innerText(),runtime:JSON.parse(await wallet.locator('#budget-evidence').textContent()),errors,physicalAuthenticator:false,staticFiles:process.env.FEE_PREVIEW_DIR?'locally routed at real preview origins':'live PR preview',network:'Stellar testnet'};
  if(Number(result.refillCount)<2)throw Error('Repeated low balance did not trigger another refill');
  await wallet.screenshot({path:'qa/testnet-wallet-desktop.png',fullPage:true});
  await wallet.setViewportSize({width:390,height:844});await wallet.screenshot({path:'qa/testnet-wallet-mobile.png',fullPage:true});
  if(await wallet.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');
  fs.writeFileSync('qa/testnet-browser-check.json',JSON.stringify(result,null,2)+'\n');
  await wallet.reload();await wallet.waitForFunction(()=>document.getElementById('budget-spent').textContent.includes(' XLM'),null,{timeout:60000});
  if(await wallet.locator('#budget-contract').textContent()!==profile.budget||await wallet.locator('#budget-spent').textContent()!==result.spent)throw Error('Reload replaced budget or reset spending');
  result.reloadPreservedBudget=true;
  if(errors.length)throw Error(errors.join('\n'));
  fs.writeFileSync('qa/testnet-browser-check.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 } catch(error){if(wallet){console.error(await wallet.locator('#budget-message').textContent());console.error(await wallet.locator('#budget-history').innerText());await wallet.screenshot({path:'qa/testnet-failure.png',fullPage:true});}throw error;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
