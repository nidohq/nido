import { Address, Operation, rpc, hash } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import deployment from '../public/testnet/deployment.json' with {type:'json'};
import { DEMO, TESTNET_NETWORK } from './demo-config.mjs';
import { withAccessKey } from './hd-vault.mjs';
import { build, simulate, submit, read, nativeToken, sc } from './local-chain.mjs';
import { contractAddress, contractInstance, requireContractHash, saltFor } from './contract-address.mjs';

const CAP='1500000', LOW='11000000', TARGET='11000000';
export function checkTestnetProfile(profile, keys) {
  if(deployment.network!==TESTNET_NETWORK||profile.network!==TESTNET_NETWORK||profile.u!==keys.u||profile.fee!==keys.fee||
    profile.verifier!==deployment.verifier||profile.treasury!==keys.u||profile.token!==nativeToken(TESTNET_NETWORK)||
    profile.cap!==CAP||profile.low!==LOW||profile.target!==TARGET||profile.version!==3||profile.feeRule!==0||
    Object.entries(deployment.wasmHashes).some(([k,v])=>profile.wasmHashes?.[k]!==v))throw Error('Testnet enrollment differs from wallet pins');
}
export async function verifyTestnetContracts(chain,profile) {
  await Promise.all([
    requireContractHash(chain,profile.account,deployment.wasmHashes.account),
    requireContractHash(chain,profile.executor,deployment.wasmHashes.executor),
    requireContractHash(chain,profile.budget,deployment.wasmHashes.budget),
    requireContractHash(chain,deployment.verifier,deployment.wasmHashes.verifier),
  ]);
}

// A wallet-internal setup flow. F is never unlocked or used here. The source U
// authorizes only this fixed enrollment, with fresh testnet funds from Friendbot.
export async function enrollTestnet(chain,keys,passkey,phrase,onProgress,storage=localStorage) {
  if(!DEMO.testnet||location.origin!==DEMO.walletOrigin)throw Error('Testnet wallet origin required');
  const net=await chain.getNetwork();
  if(net.passphrase!==TESTNET_NETWORK||net.protocolVersion<29)throw Error('Wrong testnet or unsupported protocol');
  const raw=Buffer.from(passkey,'base64');if(raw.length!==65||raw[0]!==4)throw Error('P256 public key required');
  const identity=hash(Buffer.from(JSON.stringify(['nido-fee-testnet-v1',keys.u,keys.fee,passkey,deployment.wasmHashes]))).toString('hex');
  const salts=Object.fromEntries(['account','executor','budget'].map(role=>[role,saltFor(`${identity}/${role}`)]));
  const addresses=Object.fromEntries(Object.entries(salts).map(([role,salt])=>[role,contractAddress(TESTNET_NETWORK,keys.u,salt)]));
  const planKey=`nido-fee-testnet-enrollment/${identity}`;
  let plan=JSON.parse(storage.getItem(planKey)||'null');
  if(!plan){plan={expires:(await chain.getLatestLedger()).sequence+100000};storage.setItem(planKey,JSON.stringify(plan));}
  if(!Number.isInteger(plan.expires)||plan.expires<=(await chain.getLatestLedger()).sequence)throw Error('This enrollment expired. No replacement budget or allowance was created.');
  try{await chain.getAccount(keys.u);}catch(error){
    if(!String(error).toLowerCase().includes('not found'))throw error;
    onProgress('Friendbot is funding your test-only U account. No private key leaves this wallet.');
    const response=await fetch(`https://friendbot.stellar.org/?addr=${keys.u}`);
    if(!response.ok)throw Error(`Testnet faucet unavailable (${response.status}). Retry enrollment later; the same keys and plan are retained.`);
  }
  const base={version:3,policyType:'perch-fee-budget-v2',feeRule:0,...keys,passkey,...addresses,verifier:deployment.verifier,token:nativeToken(TESTNET_NETWORK),treasury:keys.u,network:TESTNET_NETWORK,cap:CAP,low:LOW,target:TARGET,expires:plan.expires,wasmHashes:deployment.wasmHashes};
  // Reuse an existing deployment, including its original expiry. Never reset spent.
  if(await contractInstance(chain,base.budget)){
    await requireContractHash(chain,base.budget,deployment.wasmHashes.budget);
    const old=await read(chain,keys.u,base.budget,'status');base.expires=old.config.expires;
    assertBudgetConfig(old.config,base);
  }
  await requireContractHash(chain,deployment.verifier,deployment.wasmHashes.verifier);
  return withAccessKey(phrase,async key=>{
    if(key.publicKey!==keys.u)throw Error('Setup U mismatch');
    async function send(op,smart=true){
      let tx=await build(chain,keys.u,op,TESTNET_NETWORK);
      if(smart)tx=rpc.assembleTransaction(tx,await simulate(chain,tx)).build();
      tx.addSignature(keys.u,Buffer.from(await crypto.subtle.sign('Ed25519',key.privateKey,tx.hash())).toString('base64'));
      const receipt=await submit(chain,tx);onProgress(`Enrollment transaction confirmed: ${receipt.hash}`);return receipt;
    }
    async function deploy(role,args){
      if(await contractInstance(chain,addresses[role]))return requireContractHash(chain,addresses[role],deployment.wasmHashes[role]);
      onProgress(`Deploying your testnet ${role}…`);
      await send(Operation.createCustomContract({address:new Address(keys.u),wasmHash:Buffer.from(deployment.wasmHashes[role],'hex'),salt:salts[role],constructorArgs:args}));
      await requireContractHash(chain,addresses[role],deployment.wasmHashes[role]);
    }
    try{await chain.getAccount(keys.fee);}catch(error){
      if(!String(error).toLowerCase().includes('not found'))throw error;
      onProgress('Funding F with 1.05 test XLM, including its reserve. This initial amount is separate from the refill cap.');
      await send(Operation.createAccount({destination:keys.fee,startingBalance:'1.05'}),false);
    }
    const config={controller:sc.address(base.account),executor:sc.address(base.executor),treasury:sc.address(keys.u),token:sc.address(base.token),fee:sc.address(keys.fee),cap:sc.u64(CAP),low:sc.u64(LOW),target:sc.u64(TARGET),expires:sc.u32(base.expires)};
    await deploy('budget',[sc.map(config)]);
    await deploy('executor',[sc.address(base.account),sc.address(base.budget)]);
    await deploy('account',[sc.vec([sc.vec([sc.symbol('External'),sc.address(base.verifier),sc.bytes(raw)])])]);
    const state=await read(chain,keys.u,base.budget,'status');assertBudgetConfig(state.config,base);
    const allowance=await read(chain,keys.u,base.token,'allowance',[sc.address(keys.u),sc.address(base.budget)]);
    if(allowance===0n&&state.spent===0n){
      onProgress('Approving the funding component for at most 0.15 test XLM. F stays local.');
      await send(Operation.invokeContractFunction({contract:base.token,function:'approve',args:[sc.address(keys.u),sc.address(base.budget),sc.i128(CAP),sc.u32(base.expires)]}));
    }
    const caps=await read(chain,keys.u,base.account,'capabilities');
    if(caps.auth_digest!=='addr_oz_v1'||caps.fee_rule!==0)throw Error('Wrong native Perch route');
    checkTestnetProfile(base,keys);await verifyTestnetContracts(chain,base);return base;
  });
}
export function assertBudgetConfig(config,profile) {
  for(const [key,value] of Object.entries({controller:profile.account,executor:profile.executor,treasury:profile.treasury,token:profile.token,fee:profile.fee,cap:profile.cap,low:profile.low,target:profile.target,expires:profile.expires})){
    if(String(config[key])!==String(value))throw Error(`Registered budget mismatch: ${key}`);
  }
}
