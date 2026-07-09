#!/usr/bin/env node
// Deploy zk-recovery (and, when --verifier absent, zk-verifier) to testnet by
// building the create-contract-with-constructor operation directly via
// @stellar/stellar-sdk. stellar-cli 26.0.0 fails ("Missing Entry Context") on
// constructors that take contract-Address arguments; the SDK path does not.
//
// Usage:
//   DEPLOY_SECRET=$(stellar keys show ci-publisher-testnet) \
//   node scripts/deploy-zk-recovery.mjs \
//     --wasm target/wasm32v1-none/contract/nido_zk_recovery.wasm \
//     --factory C... --verifier C... --webauthn C... \
//     --delay 60 --window 604800 --max-cancels 2 --floor 0 \
//     --passphrase "Test SDF Network ; September 2015"
import { readFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import {
  Keypair, TransactionBuilder, Operation, Networks, Address, xdr, nativeToScVal, rpc,
} from '@stellar/stellar-sdk';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const RPC = 'https://soroban-testnet.stellar.org';
const secret = process.env.DEPLOY_SECRET?.trim();
if (!secret || !secret.startsWith('S')) { console.error('DEPLOY_SECRET (S...) required'); process.exit(1); }

const wasmPath = arg('wasm');
const factory = arg('factory');
const verifier = arg('verifier');
const webauthn = arg('webauthn');
const passphrase = arg('passphrase', 'Test SDF Network ; September 2015');
const delay = BigInt(arg('delay', '60'));
const window = BigInt(arg('window', '604800'));
const maxCancels = Number(arg('max-cancels', '2'));
const floor = BigInt(arg('floor', '0'));

const server = new rpc.Server(RPC);
const kp = Keypair.fromSecret(secret);
const wasmBytes = readFileSync(wasmPath);
const wasmHash = createHash('sha256').update(wasmBytes).digest();
console.error(`wasm ${wasmPath} sha256=${wasmHash.toString('hex')}`);

const ctorArgs = [
  new Address(factory).toScVal(),
  new Address(verifier).toScVal(),
  nativeToScVal(delay, { type: 'u64' }),
  nativeToScVal(window, { type: 'u64' }),
  nativeToScVal(maxCancels, { type: 'u32' }),
  nativeToScVal(floor, { type: 'u64' }),
  xdr.ScVal.scvBytes(Buffer.from(passphrase, 'utf8')),
  new Address(webauthn).toScVal(),
];

const source = await server.getAccount(kp.publicKey());
const op = Operation.createCustomContract({
  address: Address.fromString(kp.publicKey()),
  wasmHash,
  salt: randomBytes(32),
  constructorArgs: ctorArgs,
});
const tx = new TransactionBuilder(source, { fee: '10000000', networkPassphrase: Networks.TESTNET })
  .addOperation(op).setTimeout(120).build();

const sim = await server.simulateTransaction(tx);
if (rpc.Api.isSimulationError(sim)) { console.error('SIM ERROR:', sim.error); process.exit(1); }
const prepared = rpc.assembleTransaction(tx, sim).build();
prepared.sign(kp);
const sent = await server.sendTransaction(prepared);
console.error('sent', sent.hash, sent.status);
let get = await server.getTransaction(sent.hash);
for (let i = 0; i < 30 && get.status === 'NOT_FOUND'; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  get = await server.getTransaction(sent.hash);
}
if (get.status !== 'SUCCESS') { console.error('TX FAILED', get.status, JSON.stringify(get.resultXdr)); process.exit(1); }
// The created contract address is the return value of createContract.
const addr = Address.fromScVal(get.returnValue).toString();
console.log(addr);
