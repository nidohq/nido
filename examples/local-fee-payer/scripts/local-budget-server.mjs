// Local-chain bootstrap only. Never receives a wallet secret, PRF or private key.
// The known standalone genesis key is NOT a production funding service.
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { Address, Keypair, Operation, StrKey, rpc, scValToNative, hash, xdr } from '@stellar/stellar-sdk';
import { LOCAL_NETWORK, server, build, simulate, submit, read, sc, nativeToken, jsonSafe } from '../src/local-chain.mjs';

const rpcUrl = 'http://127.0.0.1:8022/soroban/rpc';
const chain = server(rpcUrl);
const root = Keypair.fromRawEd25519Seed(createHash('sha256').update(LOCAL_NETWORK).digest());
const files = { budget:'public/contracts/perch_fee_budget.wasm', executor:'public/contracts/nido_demo_action.wasm', account:'public/contracts/demo_perch_budget_account.wasm', verifier:'public/contracts/perch_webauthn_verifier.wasm', registry:'public/contracts/local_verifier_registry.wasm' };
const wasmHashes = Object.fromEntries(Object.entries(files).map(([k,p]) => [k,createHash('sha256').update(readFileSync(p)).digest('hex')]));
let deployed;
const profiles = new Map();
async function sendOp(op, smart = true) {
  let tx = await build(chain, root.publicKey(), op);
  if (smart) tx = rpc.assembleTransaction(tx, await simulate(chain, tx)).build();
  tx.sign(root); return submit(chain, tx);
}
function addressFor(salt) {
  return StrKey.encodeContract(hash(xdr.HashIdPreimage.envelopeTypeContractId(new xdr.HashIdPreimageContractId({
    networkId:hash(Buffer.from(LOCAL_NETWORK)), contractIdPreimage:xdr.ContractIdPreimage.contractIdPreimageFromAddress(new xdr.ContractIdPreimageFromAddress({address:new Address(root.publicKey()).toScAddress(),salt}))
  })).toXdr()));
}
async function deploy(hash, args = [], salt = randomBytes(32)) {
  const result = await sendOp(Operation.createCustomContract({ address: new Address(root.publicKey()), wasmHash:Buffer.from(hash,'hex'), salt, constructorArgs:args }));
  return scValToNative(result.returnValue);
}
async function infrastructure() {
  if (deployed) return deployed;
  const network = await chain.getNetwork();
  if (network.passphrase !== LOCAL_NETWORK) throw Error('Refusing bootstrap outside the dedicated local chain');
  if(network.protocolVersion < 29)throw Error('Local chain needs protocol 29; see README upgrade command');
  for (const file of Object.values(files)) await sendOp(Operation.uploadContractWasm({ wasm:readFileSync(file) }));
  const registrySalt=createHash('sha256').update('nido-local-fee-verifiers-v1').digest();
  const registry=addressFor(registrySalt);
  try { await chain.getLedgerEntries(xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({contract:new Address(registry).toScAddress(),key:xdr.ScVal.scvLedgerKeyContractInstance(),durability:xdr.ContractDataDurability.persistent}))).then(r=>{if(!r.entries?.length)throw Error('missing')}); }
  catch { await deploy(wasmHashes.registry,[],registrySalt); }
  const verifierAddress=StrKey.encodeContract(hash(xdr.HashIdPreimage.envelopeTypeContractId(new xdr.HashIdPreimageContractId({networkId:hash(Buffer.from(LOCAL_NETWORK)),contractIdPreimage:xdr.ContractIdPreimage.contractIdPreimageFromAddress(new xdr.ContractIdPreimageFromAddress({address:new Address(registry).toScAddress(),salt:Buffer.from(wasmHashes.verifier,'hex')}))})).toXdr()));
  try { await sendOp(Operation.invokeContractFunction({contract:registry,function:'deploy',args:[sc.bytes(Buffer.from(wasmHashes.verifier,'hex'))]})); }
  catch (error) { const r=await chain.getLedgerEntries(xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({contract:new Address(verifierAddress).toScAddress(),key:xdr.ScVal.scvLedgerKeyContractInstance(),durability:xdr.ContractDataDurability.persistent}))); if(!r.entries?.length)throw error; }
  const verifier=verifierAddress;
  // Native SAC creation is idempotent only after checking whether it exists.
  try { await read(chain, root.publicKey(), nativeToken(), 'balance', [sc.address(root.publicKey())]); }
  catch { await sendOp(Operation.createStellarAssetContract({ asset: (await import('@stellar/stellar-sdk')).Asset.native() })); }
  deployed = {verifier}; return deployed;
}
async function enroll(input) {
  if (!input || Object.keys(input).sort().join() !== 'fee,passkey,u') throw Error('Only public enrollment data accepted');
  if (!StrKey.isValidEd25519PublicKey(input.u) || !StrKey.isValidEd25519PublicKey(input.fee) || input.u === input.fee) throw Error('Distinct U and F G addresses required');
  const raw = Buffer.from(input.passkey, 'base64'); if (raw.length !== 65 || raw[0] !== 4) throw Error('Uncompressed P256 public key required');
  const identity = createHash('sha256').update(JSON.stringify({u:input.u,fee:input.fee,passkey:input.passkey})).digest('hex');
  if (profiles.has(identity)) return profiles.get(identity);
  const saved = `.local-chain/perch-v2-${identity}.json`;
  if (existsSync(saved)) {
    const prior = JSON.parse(readFileSync(saved));
    if(prior.version!==3||Object.entries(wasmHashes).some(([k,v])=>prior.wasmHashes?.[k]!==v))throw Error('Existing budget uses different contract artifacts. An explicit migration is required; no replacement allowance was created.');
    await read(chain, input.u, prior.budget, 'status');
    profiles.set(identity,prior); return prior;
  }
  const {verifier} = await infrastructure();
  for (const [account,amount] of [[input.u,'2'], [input.fee,'1.05']]) {
    try { await chain.getAccount(account); }
    catch { await sendOp(Operation.createAccount({destination:account,startingBalance:amount}),false); }
  }
  const signer = sc.vec([sc.symbol('External'), sc.address(verifier), sc.bytes(raw)]);
  const accountSalt=randomBytes(32), executorSalt=randomBytes(32);
  const account=addressFor(accountSalt), executor=addressFor(executorSalt);
  const ledger = await chain.getLatestLedger();
  const config = { controller:sc.address(account), executor:sc.address(executor), treasury:sc.address(root.publicKey()), token:sc.address(nativeToken()),
    fee:sc.address(input.fee), cap:sc.u64(1_500_000), low:sc.u64(11_000_000), target:sc.u64(11_000_000), expires:sc.u32(ledger.sequence + 100000) };
  const budget = await deploy(wasmHashes.budget, [sc.map(config)]);
  if (await deploy(wasmHashes.executor,[sc.address(account),sc.address(budget)],executorSalt)!==executor) throw Error('Executor derivation mismatch');
  if (await deploy(wasmHashes.account,[sc.vec([signer])],accountSalt)!==account) throw Error('Account derivation mismatch');
  const caps=await read(chain,input.u,account,'capabilities');
  if(caps.auth_digest!=='addr_oz_v1'||caps.fee_rule!==0)throw Error('Wrong Perch authorization path');
  await sendOp(Operation.invokeContractFunction({contract:nativeToken(),function:'approve',args:[sc.address(root.publicKey()),sc.address(budget),sc.i128(1_500_000),sc.u32(ledger.sequence + 100000)]}));
  const profile = { version:3, policyType:'perch-fee-budget-v2', feeRule:0, ...input, account, executor, budget, verifier, token:nativeToken(), treasury:root.publicKey(), network:LOCAL_NETWORK,
    cap:'1500000', low:'11000000', target:'11000000', expires:ledger.sequence + 100000, wasmHashes };
  profiles.set(identity,profile);
  mkdirSync('.local-chain',{recursive:true});
  writeFileSync(saved,JSON.stringify(profile,null,2)+'\n');
  return profile;
}
// Serialize genesis-account operations. This server has no wallet-signing API.
let queue = Promise.resolve();
createServer(async (req,res) => {
  res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store');
  try {
    if (req.method === 'GET' && req.url === '/health') { res.end(JSON.stringify({localOnly:true,network:LOCAL_NETWORK,...await chain.getHealth()})); return; }
    if (req.method !== 'POST' || req.url !== '/enroll' || !['http://wallet.localhost:5199', undefined].includes(req.headers.origin)) throw Error('Unsupported local bootstrap request');
    let raw=''; for await(const chunk of req) {raw+=chunk; if(raw.length>4096) throw Error('Request too large');}
    const result = queue.then(() => enroll(JSON.parse(raw))); queue=result.catch(()=>{});
    res.end(JSON.stringify(jsonSafe(await result)));
  } catch(error) {res.statusCode=400;res.end(JSON.stringify({error:error.message}));console.error(error.message);}
}).listen(5200,'127.0.0.1',()=>console.log('Local-only fee-budget bootstrap on 127.0.0.1:5200; chain on 8022. No wallet secrets accepted.'));
