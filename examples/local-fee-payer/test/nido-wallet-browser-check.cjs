// Testnet only: normal Nido onboarding, one virtual passkey, same-tab Fees.
// Never reads/exports seed material. Network settlement is real even when static files are routed.
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const number=process.env.FEE_PREVIEW_NUMBER||'365',apex=`${number}.test.nido.fyi`,app=`https://${apex}`;
 const browser=await chromium.launch({headless:true});let page;
 try{
  const context=await browser.newContext(),errors=[],requests=[];
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  if(process.env.NIDO_PREVIEW_DIR)await context.route(url=>url.hostname===apex||url.hostname.endsWith(`--${apex}`),async route=>{
   const url=new URL(route.request().url());let file=path.join(process.env.NIDO_PREVIEW_DIR,decodeURIComponent(url.pathname));
   if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
   if(!fs.existsSync(file))return route.continue();
   const type={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
   await route.fulfill({path:file,contentType:type});
  });
  page=await context.newPage();const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');
  const {authenticatorId}=await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true,hasPrf:!process.env.FEE_DISABLE_PRF}});
  page.on('request',r=>{if(r.url().includes('soroban-testnet'))requests.push(r.url());});
  await page.goto(`${app}/fee-demo/testnet.html`);await page.locator('#open-budget-wallet').click();await page.locator('#fee-create').click();
  await page.locator('#preparing-continue:not([disabled])').waitFor({timeout:90000});await page.locator('#preparing-continue').click();
  await page.locator('#enroll-continue').waitFor({state:'visible',timeout:60000});await page.locator('#enroll-continue').click();
  await page.waitForURL(/\/fees\//,{timeout:180000});
  const account=new URL(page.url()).hostname.split('--')[0].toUpperCase();
  await page.locator('html[data-wallet-ready="true"]').waitFor();await page.locator('#budget-enroll').click();
  if(process.env.FEE_DISABLE_PRF){
   await page.locator('#budget-message.bad').waitFor({timeout:60000});
   const message=await page.locator('#budget-message').textContent();
   if(!message.includes('does not support PRF'))throw Error(message);
   const persisted=await page.evaluate(c=>({credential:!!localStorage.getItem(`passkey:${c}:credentialId`),vault:localStorage.getItem(`nido.${c}.fee-vault-v1`),budget:localStorage.getItem(`nido.${c}.fee-budget-v1`)}),account);
   const {credentials}=await cdp.send('WebAuthn.getCredentials',{authenticatorId});
   if(!persisted.credential||persisted.vault||persisted.budget||credentials.length!==1)throw Error('Unsupported PRF changed the wallet or saved a fee key');
   if(errors.length)throw Error(errors.join('\n'));
   const result={account,normalNidoCreated:true,feeActivationRefused:true,unencryptedFallback:false,passkeys:credentials.length,pages:context.pages().length,physicalAuthenticator:false,message};
   fs.mkdirSync('qa',{recursive:true});fs.writeFileSync('qa/nido-wallet-no-prf.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));return;
  }
  async function settled(timeout){await page.waitForFunction(()=>!document.getElementById('budget-run').disabled||document.getElementById('budget-message').classList.contains('bad'),null,{timeout});if(await page.locator('#budget-run').isDisabled())throw Error(await page.locator('#budget-message').textContent());}
  await settled(300000);console.log('Native Nido enrollment confirmed');
  for(let i=0;i<2;i++){
   await page.evaluate(()=>delete document.getElementById('budget-message').dataset.confirmed);
   await page.locator('#budget-run').click();
   await page.waitForFunction(()=>document.getElementById('budget-message').dataset.confirmed==='true'||document.getElementById('budget-message').classList.contains('bad'),null,{timeout:180000});
   if(await page.locator('#budget-message').getAttribute('data-confirmed')!=='true')throw Error(await page.locator('#budget-message').textContent());
   console.log('Native Nido action '+(i+1)+' confirmed');
  }
  const {credentials}=await cdp.send('WebAuthn.getCredentials',{authenticatorId});
  if(credentials.length!==1)throw Error('Created a second passkey');
  if(context.pages().length!==1)throw Error('Opened a popup');
  if(await page.locator('#budget-c').textContent()!==account)throw Error('Replaced the Nido account');
  const result={account,fee:await page.locator('#budget-f').textContent(),budget:await page.locator('#budget-contract').textContent(),spent:await page.locator('#budget-spent').textContent(),refills:await page.locator('#budget-checks').textContent(),actions:await page.locator('#budget-uses').textContent(),runtime:JSON.parse(await page.locator('#budget-evidence').textContent()),receipts:await page.locator('#budget-history').innerText(),passkeys:credentials.length,pages:context.pages().length,physicalAuthenticator:false,staticFiles:process.env.NIDO_PREVIEW_DIR?'locally routed':'live preview',errors};
  if(Number(result.refills)<2)throw Error('Repeated refill not demonstrated');
  await page.reload();await page.waitForFunction(()=>document.getElementById('budget-state').textContent==='Registered · ledger state',null,{timeout:60000});
  if(await page.locator('#budget-contract').textContent()!==result.budget||await page.locator('#budget-spent').textContent()!==result.spent)throw Error('Reload changed budget');
  result.reloadPreservedBudget=true;fs.mkdirSync('qa',{recursive:true});
  await page.screenshot({path:'qa/nido-fees-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'qa/nido-fees-mobile.png',fullPage:true});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');
  fs.writeFileSync('qa/nido-wallet-testnet.json',JSON.stringify(result,null,2)+'\n');if(errors.length)throw Error(errors.join('\n'));console.log(JSON.stringify(result));
 }catch(error){if(page){console.error('Failed at '+new URL(page.url()).origin+new URL(page.url()).pathname);console.error((await page.locator('body').innerText()).slice(-6000));fs.mkdirSync('qa',{recursive:true});await page.screenshot({path:'qa/nido-wallet-failure.png',fullPage:true});}throw error;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
