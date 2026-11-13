const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true});let wallet;
 try{
  const context=await browser.newContext();const page=await context.newPage();const errors=[];
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await page.goto('http://localhost:5198/');const opened=page.waitForEvent('popup');await page.locator('#open-budget-wallet').click();wallet=await opened;
  const cdp=await context.newCDPSession(wallet);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true,hasPrf:true}});
  await wallet.locator('html[data-wallet-ready="true"]').waitFor();await wallet.locator('#budget-enroll').click();
  await wallet.waitForFunction(()=>!document.getElementById('budget-run').disabled||document.getElementById('budget-message').classList.contains('bad'),null,{timeout:180000});
  if(await wallet.locator('#budget-run').isDisabled())throw Error(await wallet.locator('#budget-message').textContent());
  // Use real virtual-passkey signatures and enforce-mode simulation. Mock auth
  // would skip C.__check_auth and cannot establish rule/policy selection.
  const denials=await wallet.evaluate(async()=>{
    const sdkUrl=performance.getEntriesByType('resource').map(x=>x.name).find(x=>x.includes('/@stellar_stellar-sdk.js?v='));
    if(!sdkUrl)throw Error('Loaded SDK module was not found');
    const {Address,Operation,xdr}=await import(sdkUrl);
    const {server,build,simulate,sc}=await import('/src/local-chain.mjs');
    const {cChallenge,externalPayload}=await import('/src/stellar.mjs');
    const {unb64,requestAssertion,verifyAssertion,derToCompact}=await import('/src/webauthn.mjs');
    const p=JSON.parse(localStorage.getItem('nido-local-budget-profile-v3'));
    const vault=JSON.parse(localStorage.getItem('nido-fee-lab-prf-vault-v1'));
    const reg={...vault.registration,spki:unb64(vault.registration.spki)};
    const chain=server(location.origin+'/local-rpc');
    const result={};
    for(const [name,direct,rules] of [['wrongRule',false,[1]],['ungrantedExecutor',true,[0]]]){
      const call=direct?{contract:p.executor,function:'refill',args:[]}:{contract:p.account,function:'execute',args:[sc.address(p.executor),sc.symbol('refill'),sc.vec([])]};
      const initial=await simulate(chain,await build(chain,p.u,Operation.invokeContractFunction(call)),'record');
      const entry=xdr.SorobanAuthorizationEntry.fromXdr(initial.result.auth[0].toXdr());
      entry.credentials.address.signatureExpirationLedger=(await chain.getLatestLedger()).sequence+100;
      const challenge=cChallenge(entry,p.account,p.network,rules);
      const assertion=await requestAssertion(reg,challenge);
      const key=await verifyAssertion(assertion,reg,challenge);
      const signature=sc.map({authenticator_data:sc.bytes(assertion.authenticatorData),client_data:sc.bytes(assertion.clientDataJSON),signature:sc.bytes(derToCompact(assertion.signature,true))}).toXdr();
      entry.credentials.address.signature=externalPayload(rules,p.verifier,key,signature);
      try{await simulate(chain,await build(chain,p.u,Operation.invokeContractFunction({...call,auth:[entry]})),'enforce');result[name]={denied:false};}
      catch(error){result[name]={denied:true,reason:error.message};}
    }
    return result;
  });
  for(const [name,result] of Object.entries(denials))if(!result.denied)throw Error('Actual Perch accepted '+name);
  for(const [name,result] of Object.entries(denials))if(!result.reason.includes('__check_auth')||!result.reason.includes('Error(Contract,'))throw Error('Denial did not reach native Perch: '+name);
  await wallet.locator('#budget-run').click();
  await wallet.waitForFunction(()=>document.getElementById('budget-message').dataset.confirmed==='true'||document.getElementById('budget-message').classList.contains('bad'),null,{timeout:120000});
  if((await wallet.locator('#budget-message').getAttribute('data-confirmed'))!=='true')throw Error(await wallet.locator('#budget-message').textContent());
  const first=await wallet.locator('#budget-spent').textContent();
  await wallet.evaluate(()=>delete document.getElementById('budget-message').dataset.confirmed);
  await wallet.locator('#budget-run').click();
  await wallet.waitForFunction(()=>document.getElementById('budget-message').dataset.confirmed==='true'||document.getElementById('budget-message').classList.contains('bad'),null,{timeout:120000});
  if((await wallet.locator('#budget-message').getAttribute('data-confirmed'))!=='true')throw Error(await wallet.locator('#budget-message').textContent());
  if(await wallet.locator('#budget-uses').textContent()!=='2')throw Error('Expected two ledger actions');
  // A later action must notice the now-low balance and perform another refill.
  await wallet.evaluate(()=>delete document.getElementById('budget-message').dataset.confirmed);
  await wallet.locator('#budget-run').click();
  await wallet.waitForFunction(()=>document.getElementById('budget-message').dataset.confirmed==='true'||document.getElementById('budget-message').classList.contains('bad'),null,{timeout:120000});
  if((await wallet.locator('#budget-message').getAttribute('data-confirmed'))!=='true')throw Error(await wallet.locator('#budget-message').textContent());
  if(await wallet.locator('#budget-uses').textContent()!=='3')throw Error('Expected three ledger actions');
  if((await wallet.locator('#budget-history').innerText()).split('\n').filter(s=>s.startsWith('refill:')).length<2)throw Error('A later low balance did not cause an automatic refill');
  if(Number(await wallet.locator('#budget-checks').textContent())<2)throw Error('Successful funding settlements were not recorded');
  const profile=await wallet.evaluate(()=>JSON.parse(localStorage.getItem('nido-local-budget-profile-v3')));
  const result={profile,denials,refillCount:await wallet.locator('#budget-checks').textContent(),firstSpent:first,spent:await wallet.locator('#budget-spent').textContent(),balance:await wallet.locator('#budget-balance').textContent(),receipts:await wallet.locator('#budget-history').innerText(),runtime:JSON.parse(await wallet.locator('#budget-evidence').textContent()),errors,physicalAuthenticator:false,network:'isolated local chain'};
  await wallet.screenshot({path:path.resolve('qa/budget-wallet-desktop.png'),fullPage:true});
  await wallet.setViewportSize({width:390,height:844});await wallet.screenshot({path:path.resolve('qa/budget-wallet-mobile.png'),fullPage:true});
  if(await wallet.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');
  if(errors.length)throw Error(errors.join('\n'));
  fs.writeFileSync('qa/budget-browser-check.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }catch(error){if(wallet){console.error(await wallet.locator('#budget-message').textContent());console.error(await wallet.locator('#budget-history').innerText());await wallet.screenshot({path:path.resolve('qa/budget-failure.png'),fullPage:true});}throw error;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
