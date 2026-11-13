// One-time public testnet artifacts. No wallet or production credentials.
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Address, Keypair, Operation, rpc, scValToNative } from '@stellar/stellar-sdk';
import { TESTNET_NETWORK } from '../src/demo-config.mjs';
import { server, build, simulate, submit, sc } from '../src/local-chain.mjs';
import { contractAddress, contractInstance, saltFor } from '../src/contract-address.mjs';

mkdirSync('.testnet-cache',{recursive:true});mkdirSync('public/testnet/contracts',{recursive:true});
const secretFile='.testnet-cache/deployer.secret';
if(!existsSync(secretFile))writeFileSync(secretFile,Keypair.random().secret(),{mode:0o600});
const deployer=Keypair.fromSecret(readFileSync(secretFile,'utf8'));
const registryConfig={rootDeployer:deployer.publicKey(),salt:'nido-fee-preview-v1'};
writeFileSync('testnet-source.json',JSON.stringify({network:TESTNET_NETWORK,verifierRegistry:registryConfig},null,2)+'\n');
execFileSync('node',['scripts/prepare-perch.mjs'],{stdio:'inherit',env:{...process.env,FEE_BUILD_NETWORK:'testnet'}});
cpSync('contracts','.testnet-contracts',{recursive:true,filter:src=>!src.split('/').includes('target')&&!src.split('/').includes('test_snapshots')});
for(const crate of ['perch-budget-account','fee-budget']){
 const p=`.testnet-contracts/${crate}/Cargo.toml`;writeFileSync(p,readFileSync(p,'utf8').replaceAll('.perch-src','.perch-testnet-src'));
}
for(const pkg of ['perch-fee-budget','perch-webauthn-verifier'])execFileSync('stellar',['contract','build','--manifest-path','.perch-testnet-src/Cargo.toml','--package',pkg,'--locked','--out-dir','public/testnet/contracts'],{stdio:'inherit',env:{...process.env,CARGO_TARGET_DIR:`${process.cwd()}/.perch-testnet-src/target`}});
execFileSync('stellar',['contract','build','--manifest-path','.testnet-contracts/Cargo.toml','--locked','--out-dir','public/testnet/contracts'],{stdio:'inherit',env:{...process.env,CARGO_TARGET_DIR:`${process.cwd()}/.testnet-contracts/target`}});
const files={budget:'perch_fee_budget',executor:'nido_demo_action',account:'demo_perch_budget_account',verifier:'perch_webauthn_verifier',registry:'local_verifier_registry'};
const wasmHashes=Object.fromEntries(Object.entries(files).map(([k,n])=>[k,createHash('sha256').update(readFileSync(`public/testnet/contracts/${n}.wasm`)).digest('hex')]));
const chain=server('https://soroban-testnet.stellar.org');
const network=await chain.getNetwork();if(network.passphrase!==TESTNET_NETWORK||network.protocolVersion<29)throw Error('Unexpected network/protocol');
try{await chain.getAccount(deployer.publicKey());}catch(e){if(!String(e).toLowerCase().includes('not found'))throw e;const r=await fetch(`https://friendbot.stellar.org/?addr=${deployer.publicKey()}`);if(!r.ok)throw Error(`Friendbot ${r.status}`);}
const receipts=[];
async function send(op){let tx=await build(chain,deployer.publicKey(),op,TESTNET_NETWORK);tx=rpc.assembleTransaction(tx,await simulate(chain,tx)).build();tx.sign(deployer);const receipt=await submit(chain,tx);receipts.push(receipt.hash);return receipt;}
for(const n of Object.values(files))await send(Operation.uploadContractWasm({wasm:readFileSync(`public/testnet/contracts/${n}.wasm`)}));
const registry=contractAddress(TESTNET_NETWORK,deployer.publicKey(),saltFor(registryConfig.salt));
if(!await contractInstance(chain,registry))await send(Operation.createCustomContract({address:new Address(deployer.publicKey()),wasmHash:Buffer.from(wasmHashes.registry,'hex'),salt:saltFor(registryConfig.salt),constructorArgs:[]}));
const verifier=contractAddress(TESTNET_NETWORK,registry,Buffer.from(wasmHashes.verifier,'hex'));
if(!await contractInstance(chain,verifier))await send(Operation.invokeContractFunction({contract:registry,function:'deploy',args:[sc.bytes(Buffer.from(wasmHashes.verifier,'hex'))]}));
const manifest={version:1,network:TESTNET_NETWORK,rpc:'https://soroban-testnet.stellar.org',perchRevision:JSON.parse(readFileSync('perch-source.json')).revision,registry,verifier,wasmHashes,uploadedAtLedger:(await chain.getLatestLedger()).sequence,receipts};
writeFileSync('public/testnet/deployment.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({registry,verifier,wasmHashes,receipts}));
