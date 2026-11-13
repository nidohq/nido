import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Keypair} from '@stellar/stellar-sdk';
import {demoConfig,LOCAL_NETWORK,TESTNET_NETWORK} from '../src/demo-config.mjs';
import {contractAddress,requireContractHash,saltFor} from '../src/contract-address.mjs';
import {checkTestnetProfile,assertBudgetConfig} from '../src/testnet-enrollment.mjs';
import {nativeToken,simulate} from '../src/local-chain.mjs';
import deployment from '../public/testnet/deployment.json' with {type:'json'};

test('preview origins, RP and budget network are fixed by the numeric PR build',()=>{
 const p=demoConfig('365');assert.equal(p.walletOrigin,'https://pr-365.nido-1am.pages.dev');assert.equal(p.walletRpId,new URL(p.walletOrigin).hostname);assert.notEqual(p.appOrigin,p.walletOrigin);assert.equal(p.network,TESTNET_NETWORK);assert.equal(demoConfig().network,LOCAL_NETWORK);
 for(const n of ['https://evil.example','365/../evil','0','-1','365?rpc=evil'])assert.throws(()=>demoConfig(n));
});
test('testnet artifacts match the published code hashes; budget core matches local proof-bearing artifact',()=>{
 const names={budget:'perch_fee_budget',executor:'nido_demo_action',account:'demo_perch_budget_account',verifier:'perch_webauthn_verifier',registry:'local_verifier_registry'};
 for(const [role,name] of Object.entries(names))assert.equal(createHash('sha256').update(readFileSync(new URL(`../public/testnet/contracts/${name}.wasm`,import.meta.url))).digest('hex'),deployment.wasmHashes[role]);
 // Source linkage is checked by contract-artifacts.test; these bytes are the
 // same funding component, not a testnet rewrite of the planner or settlement.
 assert.equal(createHash('sha256').update(readFileSync(new URL('../public/contracts/perch_fee_budget.wasm',import.meta.url))).digest('hex'),deployment.wasmHashes.budget);
});
test('deployment identity is stable for retry and separated by network, deployer and role',()=>{
 const u=Keypair.random().publicKey(),salt=saltFor('enrollment/budget'), a=contractAddress(TESTNET_NETWORK,u,salt);
 assert.equal(contractAddress(TESTNET_NETWORK,u,salt),a);
 for(const args of [[LOCAL_NETWORK,u,salt],[TESTNET_NETWORK,Keypair.random().publicKey(),salt],[TESTNET_NETWORK,u,saltFor('enrollment/account')]])assert.notEqual(contractAddress(...args),a);
});
test('profile rejects foreign F/treasury/network/code and increased spending limits',()=>{
 const keys={u:Keypair.random().publicKey(),fee:Keypair.random().publicKey()};
 const p={...keys,network:TESTNET_NETWORK,verifier:deployment.verifier,treasury:keys.u,token:nativeToken(TESTNET_NETWORK),cap:'1500000',low:'11000000',target:'11000000',version:3,feeRule:0,wasmHashes:deployment.wasmHashes};
 checkTestnetProfile(p,keys);
 for(const change of [{fee:Keypair.random().publicKey()},{treasury:Keypair.random().publicKey()},{network:LOCAL_NETWORK},{cap:'1500001'},{low:'12000000'},{target:'12000000'},{feeRule:1},{wasmHashes:{...p.wasmHashes,budget:'00'.repeat(32)}}])assert.throws(()=>checkTestnetProfile({...p,...change},keys));
 const config={controller:'C',executor:'E',treasury:p.treasury,token:p.token,fee:p.fee,cap:1500000n,low:11000000n,target:11000000n,expires:100};
 const profile={...p,account:'C',executor:'E',expires:100};assertBudgetConfig(config,profile);
 for(const change of [{fee:keys.u},{cap:1500001n},{controller:'other'},{expires:101}])assert.throws(()=>assertBudgetConfig({...config,...change},profile));
});
test('missing or changed deployed code is rejected; simulation auth errors are never retried',async()=>{
 await assert.rejects(requireContractHash({getLedgerEntries:async()=>({entries:[]})},deployment.verifier,deployment.wasmHashes.verifier));
 await assert.rejects(requireContractHash({getLedgerEntries:async()=>({entries:[{val:{toJSON:()=>({contract_data:{val:{contract_instance:{executable:{wasm:'bad'}}}}})}}]})},deployment.verifier,deployment.wasmHashes.verifier));
 let calls=0;await assert.rejects(simulate({simulateTransaction:async()=>{calls++;return {error:'Error(Contract, #1) auth denied'};}},{}),/auth denied/);assert.equal(calls,1);
});
