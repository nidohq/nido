import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Account,Address,Keypair,Operation,SorobanDataBuilder,StrKey,TransactionBuilder,xdr} from '@stellar/stellar-sdk';
import {makeIntent,cChallenge,externalPayload} from '../src/stellar.mjs';
import {LOCAL_NETWORK,sc} from '../src/local-chain.mjs';
import {derToCompact} from '../src/webauthn.mjs';
import {fakeAuthenticator} from './fixtures.mjs';
import {runWasi} from '../src/wasi-runner.mjs';
const binary=readFileSync(new URL('../public/runtime/wallet-checker.wasm',import.meta.url));
const check=input=>runWasi(binary,JSON.stringify(input));
async function fixture(options={}){
 const auth=await fakeAuthenticator();auth.registration.origin='http://wallet.localhost:5199';auth.registration.rpId='wallet.localhost';
 const c=StrKey.encodeContract(new Uint8Array(32).fill(4)),budget=StrKey.encodeContract(new Uint8Array(32).fill(5)),verifier=StrKey.encodeContract(new Uint8Array(32).fill(6));
 const u=Keypair.random(),f=Keypair.random().publicKey(),action=options.action||'refill';
 const ruleIds=options.rules||[0];
 const args=[sc.address(budget),sc.symbol(action),sc.vec(options.args||[])];
 const target=c,fn='execute';
 const entry=makeIntent(c).entry;
 entry.credentials.address.nonce=98765n;entry.credentials.address.signatureExpirationLedger=options.expiry||200;
 const call=new xdr.InvokeContractArgs({contractAddress:new Address(target).toScAddress(),functionName:fn,args});
 entry.rootInvocation.function=xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(call);
 const assertion=await auth.assertion(cChallenge(entry,c,LOCAL_NETWORK,ruleIds),options.assertion);
 const signature=sc.map({authenticator_data:sc.bytes(assertion.authenticatorData),client_data:sc.bytes(assertion.clientDataJSON),signature:sc.bytes(derToCompact(assertion.signature,true))}).toXdr();
 entry.credentials.address.signature=externalPayload(ruleIds,verifier,auth.publicKey,signature);
 const tx=new TransactionBuilder(new Account(u.publicKey(),'10'),{fee:options.fee||'100',networkPassphrase:LOCAL_NETWORK}).addOperation(Operation.invokeContractFunction({contract:target,function:fn,args,auth:[entry]})).setSorobanData(new SorobanDataBuilder().setResources(100000,1000,1000).setResourceFee('0').build()).setTimeout(100).build();
 const envelope=TransactionBuilder.buildFeeBumpTransaction(f,options.fee||'100',tx,LOCAL_NETWORK);
 return {requestId:crypto.randomUUID(),network:LOCAL_NETWORK,envelope:envelope.toXdr(),intent:{kind:'local-budget-action',account:c,recipient:f},registration:{credentialId:auth.registration.credentialId,spki:Buffer.from(auth.registration.spki).toString('base64')},assertedCredentialId:assertion.credentialId,feeAccount:f,localBudget:{contract:budget,verifier,source:u.publicKey(),action,latestLedger:100,expires:1000}};
}
test('WASI accepts exact local Perch refill and touch with fixed budget and empty arguments',async()=>{
 for(const action of ['refill','touch']){const result=await check(await fixture({action}));assert.equal(result.allowed,true,result.reason);}
});
test('WASI refuses validly signed destination/amount injection, unsupported actions and expired auth',async()=>{
 for(const opts of [{args:[sc.address(Keypair.random().publicKey())]},{args:[sc.u64(999)]},{action:'pause'},{rules:[1]},{expiry:99},{expiry:300},{assertion:{flags:1}},{fee:'250001'}]){const result=await check(await fixture(opts));assert.equal(result.allowed,false,JSON.stringify(opts));}
});
test('local wallet pinning rejects different U, F, budget, verifier and network',async()=>{
 const input=await fixture();
 for(const edit of [{feeAccount:Keypair.random().publicKey()},{network:'Public Global Stellar Network ; September 2015'},{localBudget:{...input.localBudget,source:Keypair.random().publicKey()}},{localBudget:{...input.localBudget,contract:StrKey.encodeContract(new Uint8Array(32).fill(7))}},{localBudget:{...input.localBudget,verifier:StrKey.encodeContract(new Uint8Array(32).fill(8))}}])assert.equal((await check({...input,...edit})).allowed,false);
});
