import { Address, Operation, TransactionBuilder, rpc, xdr } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { APP_ORIGIN, WALLET_ORIGIN, expectedMessage } from './wallet-protocol.mjs';
import { C_ACCOUNT, cChallenge, externalPayload } from './stellar.mjs';
import { b64, unb64, registerPasskey, requestAssertion, sha256, verifyAssertion, derToCompact } from './webauthn.mjs';
import { newMnemonic, derivePublicAccounts, sealMnemonic, openMnemonic } from './hd-vault.mjs';
import { signPreparedLocalEnvelope } from './local-fee-signing.mjs';
import { LOCAL_NETWORK, server, build, simulate, submit, read, sc, jsonSafe } from './local-chain.mjs';
import { createSigningBoundary } from './signing-boundary.mjs';
import { evaluateInWallet } from './wasi-client.mjs';
import manifest from '../public/runtime/manifest.json';

const $=id=>document.getElementById(id);
const chain=server(`${WALLET_ORIGIN}/local-rpc`);
const vaultKey='nido-fee-lab-prf-vault-v1', profileKey='nido-local-budget-profile-v3';
const requestId=location.hash.slice(1);
const binding=id=>JSON.stringify(['nido/demo-seed-v1',WALLET_ORIGIN,C_ACCOUNT,id]);
let vault=JSON.parse(localStorage.getItem(vaultKey)||'null'), profile=JSON.parse(localStorage.getItem(profileKey)||'null'), busy=false, accepted=false;
const reg=()=>({...vault.registration,spki:unb64(vault.registration.spki)});
function message(text,bad=false){$('budget-message').textContent=text;$('budget-message').className=`notice ${bad?'bad':'good'}`;}
function controls(){ $('budget-enroll').disabled=busy||!accepted||!!profile; $('budget-run').disabled=busy||!profile||!accepted; }
function record(type,data){const li=document.createElement('li');li.textContent=`${type}: ${JSON.stringify(jsonSafe(data))}`;$('budget-history').prepend(li);}
async function refresh(){
  if(!profile){controls();return;}
  const s=await read(chain,profile.u,profile.budget,'status');
  if(s.config.fee!==vault.publicKeys.fee||s.config.controller!==profile.account||s.config.executor!==profile.executor||s.config.treasury!==profile.treasury||s.config.token!==profile.token||String(s.config.cap)!==profile.cap||String(s.config.low)!==profile.low||String(s.config.target)!==profile.target||s.config.expires!==profile.expires) throw Error('On-chain budget differs from wallet enrollment');
  const balance=await read(chain,profile.u,profile.token,'balance',[sc.address(profile.fee)]);
  const allowance=await read(chain,profile.u,profile.token,'allowance',[sc.address(profile.treasury),sc.address(profile.budget)]);
  $('budget-c').textContent=profile.account;$('budget-f').textContent=profile.fee;$('budget-contract').textContent=profile.budget;
  $('budget-balance').textContent=`${(Number(balance)/1e7).toFixed(7)} XLM`;
  $('budget-spent').textContent=`${(Number(s.spent)/1e7).toFixed(7)} / ${(Number(s.config.cap)/1e7).toFixed(2)} XLM`;
  $('budget-remaining').textContent=`${(Number(s.config.cap-s.spent)/1e7).toFixed(7)} XLM`;
  $('budget-meter').value=Number(s.spent);$('budget-meter').max=Number(s.config.cap);
  $('budget-allowance').textContent=`${(Number(allowance)/1e7).toFixed(7)} XLM`;
  $('budget-uses').textContent=String(await read(chain,profile.u,profile.executor,'uses'));
  $('budget-checks').textContent=String(s.checks);
  $('budget-state').textContent=s.paused?'Paused':s.spent===s.config.cap?'Exhausted':'Registered · ledger state';
  controls();return {s,balance};
}
async function enroll(){
  if(busy||profile||!accepted)return;busy=true;controls();let prf;
  try{
    if(!vault){
      message('Create a demo passkey, then verify it to encrypt a fresh wallet seed.');
      const registration=await registerPasskey({prf:{}}), salt=crypto.getRandomValues(new Uint8Array(32)), challenge=await sha256(crypto.getRandomValues(new Uint8Array(32)));
      const assertion=await requestAssertion(registration,challenge,{prf:{eval:{first:salt}}});await verifyAssertion(assertion,registration,challenge);prf=assertion.prf;
      if(!prf)throw Error('PRF required; no fallback');
      const phrase=newMnemonic();vault={version:1,registration:{...registration,spki:b64(registration.spki)},salt:b64(salt),sealed:await sealMnemonic(phrase,prf,binding(registration.credentialId)),publicKeys:await derivePublicAccounts(phrase)};
      localStorage.setItem(vaultKey,JSON.stringify(vault));prf.fill(0);
    }
    const key=await crypto.subtle.importKey('spki',reg().spki,{name:'ECDSA',namedCurve:'P-256'},true,['verify']);
    const publicKey=await crypto.subtle.exportKey('raw',key);
    message('Local bootstrap: creating C and the reusable Perch fee policy, funding U/F, and granting the treasury allowance. Only public keys leave the wallet.');
    const response=await fetch('/local-budget/enroll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({u:vault.publicKeys.u,fee:vault.publicKeys.fee,passkey:Buffer.from(publicKey).toString('base64')})});
    const result=await response.json();if(!response.ok)throw Error(result.error);
    if(result.version!==3||result.policyType!=='perch-fee-budget-v2'||result.feeRule!==0||result.network!==LOCAL_NETWORK||result.u!==vault.publicKeys.u||result.fee!==vault.publicKeys.fee)throw Error('Invalid enrollment response');
    profile=result;localStorage.setItem(profileKey,JSON.stringify(profile));await refresh();
    message('Registered. The next approved action will automatically refill F if its balance is low.');
  }catch(error){message(error.message,true);}finally{prf?.fill(0);busy=false;controls();}
}
async function execute(action){
  let prf,phrase;
  try{
    const ruleIds=[0];
    const call={contract:profile.account,function:'execute',args:[sc.address(profile.executor),sc.symbol(action),sc.vec([])]};
    let tx=await build(chain,profile.u,Operation.invokeContractFunction(call));
    const initial=await simulate(chain,tx,'record');
    if(initial.result.auth.length!==1)throw Error('Expected one C authorization');
    const entry=xdr.SorobanAuthorizationEntry.fromXdr(initial.result.auth[0].toXdr());
    if(entry.credentials.type!=='sorobanCredentialsAddress'||Address.fromScAddress(entry.credentials.address.address).toString()!==profile.account)throw Error('Unexpected authorization');
    const latest=(await chain.getLatestLedger()).sequence;
    entry.credentials.address.signatureExpirationLedger=Math.min(latest+100,profile.expires);
    const challenge=cChallenge(entry,profile.account,LOCAL_NETWORK,ruleIds);
    message(action==='refill'?'F is low. Approve C’s exact refill request; Perch checks C’s passkey; the funding contract fixes the destination and amount.':'Approve C’s demo action. F will pay its native network fee.');
    const assertion=await requestAssertion(reg(),challenge,{prf:{eval:{first:unb64(vault.salt)}}});
    const publicKey=await verifyAssertion(assertion,reg(),challenge);prf=assertion.prf;if(!prf)throw Error('PRF unavailable');
    const sig=sc.map({authenticator_data:sc.bytes(assertion.authenticatorData),client_data:sc.bytes(assertion.clientDataJSON),signature:sc.bytes(derToCompact(assertion.signature,true))}).toXdr();
    entry.credentials.address.signature=externalPayload(ruleIds,profile.verifier,publicKey,sig);
    tx=await build(chain,profile.u,Operation.invokeContractFunction({...call,auth:[entry]}));
    const enforced=await simulate(chain,tx,'enforce');
    tx=rpc.assembleTransaction(tx,enforced).build();
    const envelope=TransactionBuilder.buildFeeBumpTransaction(profile.fee,'100',tx,LOCAL_NETWORK);
    record('Prepared',{action,maximumFeeStroops:envelope.fee});
    const signing=createSigningBoundary(evaluateInWallet,async(encoded,fee,decision)=>{
      $('budget-runtime').textContent='Allowed · exact XDR + passkey + Cedar';
      $('budget-evidence').textContent=JSON.stringify({module:manifest.sha256,...decision},null,2);
      phrase=await openMnemonic(vault.sealed,prf,binding(vault.registration.credentialId));
      if(fee!==profile.fee)throw Error('F mismatch');
      return signPreparedLocalEnvelope(encoded,phrase,profile);
    });
    const signed=await signing.sign({requestId:crypto.randomUUID(),network:LOCAL_NETWORK,envelope:envelope.toXdr(),
      intent:{kind:'local-budget-action',account:profile.account,recipient:profile.fee},
      registration:{credentialId:vault.registration.credentialId,spki:Buffer.from(reg().spki).toString('base64')},assertedCredentialId:assertion.credentialId,feeAccount:profile.fee,
      localBudget:{contract:profile.executor,verifier:profile.verifier,source:profile.u,action,latestLedger:latest,expires:profile.expires}});
    message(`Submitting ${action} to the isolated local chain…`);
    const receipt=await submit(chain,signed);record(action,{hash:receipt.txHash||receipt.hash,ledger:receipt.ledger,result:jsonSafe(receipt.returnValue? (await import('@stellar/stellar-sdk')).scValToNative(receipt.returnValue):null)});
    return receipt;
  }finally{prf?.fill(0);phrase=undefined;}
}
async function run(){
  if(busy||!profile||!accepted)return;busy=true;controls();
  try{
    const {s,balance}=await refresh();
    if(balance<s.config.low){
      const amount=s.config.target-balance;
      if(s.paused||s.spent+amount>s.config.cap)throw Error('Automatic refill stopped: budget paused or insufficient remaining cap. No replacement budget is created.');
      await execute('refill');await refresh();
    }
    await execute('touch');await refresh();
    message('Confirmed on the local ledger. F paid the fees; treasury spending stays in the registered budget.');
    $('budget-message').dataset.confirmed='true';
    window.opener?.postMessage({kind:'budget-result',requestId,ok:true,account:profile.account,fee:profile.fee,budget:profile.budget},APP_ORIGIN);
  }catch(error){message(error.message,true);record('Refused / failed',{reason:error.message});try{await refresh();}catch{}}
  finally{busy=false;controls();}
}
if(location.origin!==WALLET_ORIGIN||window.top!==window.self)throw Error('Wallet origin and top-level window required');
if(vault&&(vault.version!==1||vault.registration.origin!==WALLET_ORIGIN||vault.registration.rpId!=='wallet.localhost'))throw Error('Unexpected vault binding');
if(profile&&(!vault||profile.fee!==vault.publicKeys.fee||profile.u!==vault.publicKeys.u))throw Error('Profile does not belong to this vault');
$('budget-enroll').onclick=enroll;$('budget-run').onclick=run;
window.addEventListener('message',event=>{
  if(accepted||!expectedMessage(event,APP_ORIGIN,window.opener,requestId)||event.data.kind!=='wallet-request')return;
  if(JSON.stringify(event.data.request)!==JSON.stringify({kind:'try-local-budget'})){message('Only the fixed demo intent is accepted',true);return;}
  accepted=true;controls();refresh().catch(e=>message(e.message,true));
});
window.opener?.postMessage({kind:'wallet-ready',requestId},APP_ORIGIN);controls();
document.documentElement.dataset.walletReady='true';
