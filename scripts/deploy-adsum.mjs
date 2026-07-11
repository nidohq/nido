#!/usr/bin/env node
// Deploy the adsum contracts (petitions + web-of-trust) to testnet and
// register both by name in the unverified registry. Clone of
// scripts/deploy-zk-recovery.mjs's transaction lifecycle (upload/deploy go
// through @stellar/stellar-sdk directly rather than stellar-cli, which fails
// with "Missing Entry Context" on scaffold-built contracts -- see that
// script's header) plus registry registration, which deploy-zk-recovery.mjs
// itself doesn't do. The registration calls (`fetch_contract_id`,
// `register_contract`, `update_contract_address`) mirror
// scripts/deploy-policy-builder-v1.sh's fetch_contract_id/register-contract/
// update-contract-address CLI calls against the same unverified registry
// (CDBL7MNO...) and DEPLOYED.md's "Re-deploying" section (which invokes
// `update_contract_address` on that contract directly) -- reimplemented here
// via the SDK's simulate -> assemble -> sign -> send -> poll pattern instead
// of shelling out to `stellar registry`/`stellar contract invoke`, since the
// whole point of this script is to avoid depending on the CLI.
//
// Both adsum contracts are constructor-less: no constructorArgs, unlike
// zk-recovery's multi-Address constructor.
//
// No idempotency skip-guard: deploy-zk-recovery.mjs has no --force / skip
// pattern either -- every run deploys fresh contract instances (random
// salt) and then either registers (first time) or repoints (name already
// resolves) the registry name to the new address, printing the prior
// address first when one exists.
//
// Usage:
//   DEPLOY_SECRET=$(stellar keys show ci-publisher-testnet) \
//   node scripts/deploy-adsum.mjs
//
//   DEPLOY_SECRET=S... node scripts/deploy-adsum.mjs --network testnet
//
// Env:
//   DEPLOY_SECRET   Required. Source/deploying account secret (S...). Also
//                   becomes the registry `owner` for fresh registrations.
//   NETWORK         Optional, default "testnet". Same effect as --network.
//
// Flags (all optional, mirror deploy-zk-recovery.mjs's --passphrase
// convention):
//   --network <name>       "testnet" (default) or "futurenet".
//   --rpc <url>             Override the RPC endpoint for --network.
//   --passphrase <string>   Override the network passphrase for --network.
//   --petitions-wasm <path> Default: target/wasm32v1-none/contract/nido_petitions.wasm
//   --wot-wasm <path>       Default: target/wasm32v1-none/contract/nido_web_of_trust.wasm
//   --help                  Print this usage and exit 0 (no secret/network needed).
import { readFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import {
  Keypair, TransactionBuilder, Operation, Networks, Address, Contract,
  Account, nativeToScVal, scValToNative, rpc,
} from '@stellar/stellar-sdk';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const HELP = `Usage: DEPLOY_SECRET=S... node scripts/deploy-adsum.mjs [options]

Uploads + deploys (both constructor-less, fresh contract each run):
  target/wasm32v1-none/contract/nido_petitions.wasm     -> registry name "adsum-petitions"
  target/wasm32v1-none/contract/nido_web_of_trust.wasm  -> registry name "adsum-web-of-trust"

Registers (or repoints, if already registered) both names in the unverified
registry CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S.

Env:
  DEPLOY_SECRET   required. Funded account secret (S...); also becomes the
                  registry "owner" for fresh registrations.
  NETWORK         optional, default "testnet". Same as --network.

Options:
  --network <name>        testnet (default) | futurenet
  --rpc <url>              override RPC endpoint for --network
  --passphrase <string>    override network passphrase for --network
  --petitions-wasm <path>  default target/wasm32v1-none/contract/nido_petitions.wasm
  --wot-wasm <path>        default target/wasm32v1-none/contract/nido_web_of_trust.wasm
  --help                   print this and exit 0
`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

// Same RPC/passphrase constants as deploy-zk-recovery.mjs for testnet;
// futurenet added for completeness since the task asks for an overridable
// network, defaulting to testnet either way.
const NETWORKS = {
  testnet: { rpc: 'https://soroban-testnet.stellar.org', passphrase: Networks.TESTNET },
  futurenet: { rpc: 'https://rpc-futurenet.stellar.org', passphrase: Networks.FUTURENET },
};
const rawNetwork = arg('network', process.env.NETWORK);
if (rawNetwork && !(rawNetwork in NETWORKS)) {
  console.error(`Unknown --network "${rawNetwork}". Valid options: ${Object.keys(NETWORKS).join(', ')}`);
  process.exit(1);
}
const networkName = rawNetwork || 'testnet';
const net = NETWORKS[networkName];
const RPC = arg('rpc', net.rpc);
const passphrase = arg('passphrase', net.passphrase);

const REGISTRY_ID = 'CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S';

const secret = process.env.DEPLOY_SECRET?.trim();
if (!secret || !secret.startsWith('S')) { console.error('DEPLOY_SECRET (S...) required'); process.exit(1); }

const CONTRACTS = [
  { wasm: arg('petitions-wasm', 'target/wasm32v1-none/contract/nido_petitions.wasm'), name: 'adsum-petitions' },
  { wasm: arg('wot-wasm', 'target/wasm32v1-none/contract/nido_web_of_trust.wasm'), name: 'adsum-web-of-trust' },
];

const server = new rpc.Server(RPC);
const kp = Keypair.fromSecret(secret);

// Submit `op` from the deploying account: simulate -> assemble -> sign ->
// send -> poll to a terminal status. Identical lifecycle to
// deploy-zk-recovery.mjs's inline version, generalized into a helper since
// this script calls it for every upload/deploy/register/repoint step.
async function submit(op) {
  const account = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: '10000000', networkPassphrase: passphrase })
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
  return get;
}

// Read-only: does `name` already resolve in the registry? Simulate-only,
// unfunded dummy source, no signing/sending -- same pattern as
// packages/passkey-sdk/src/registry.ts's registryLookup. Empirically (see
// task-10-report.md), fetch_contract_id traps -- a simulation error, not a
// clean None -- when the name isn't registered, so both "not found" and "RPC
// unreachable" collapse to `null` here; either way the caller registers
// fresh rather than repoints.
const DUMMY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
async function fetchRegistered(name) {
  const registry = new Contract(REGISTRY_ID);
  const source = new Account(DUMMY_SOURCE, '0');
  const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: passphrase })
    .addOperation(registry.call('fetch_contract_id', nativeToScVal(name, { type: 'string' })))
    .setTimeout(0).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return null;
  return scValToNative(sim.result.retval);
}

async function uploadWasm(path) {
  const wasmBytes = readFileSync(path);
  const wasmHash = createHash('sha256').update(wasmBytes).digest();
  console.error(`wasm ${path} sha256=${wasmHash.toString('hex')}`);
  await submit(Operation.uploadContractWasm({ wasm: wasmBytes, source: kp.publicKey() }));
  return wasmHash;
}

async function deployContract(wasmHash) {
  const op = Operation.createCustomContract({
    address: Address.fromString(kp.publicKey()),
    wasmHash,
    salt: randomBytes(32),
    // both adsum contracts are constructor-less -- no constructorArgs.
  });
  const get = await submit(op);
  return Address.fromScVal(get.returnValue).toString();
}

async function registerOrRepoint(name, address) {
  const registry = new Contract(REGISTRY_ID);
  const existing = await fetchRegistered(name);
  if (existing) {
    console.error(`registry: "${name}" already resolves to ${existing} -- repointing to ${address}`);
    await submit(registry.call(
      'update_contract_address',
      nativeToScVal(name, { type: 'string' }),
      new Address(address).toScVal(),
    ));
  } else {
    console.error(`registry: "${name}" not yet registered -- registering ${address}`);
    await submit(registry.call(
      'register_contract',
      nativeToScVal(name, { type: 'string' }),
      new Address(address).toScVal(),
      new Address(kp.publicKey()).toScVal(),
    ));
  }
}

const results = [];
for (const { wasm, name } of CONTRACTS) {
  const wasmHash = await uploadWasm(wasm);
  const address = await deployContract(wasmHash);
  await registerOrRepoint(name, address);
  results.push({ name, address, sha256: wasmHash.toString('hex') });
}

console.log('');
console.log('Deployed + registered:');
for (const r of results) {
  console.log(`  ${r.name.padEnd(20)} ${r.address}  sha256=${r.sha256}`);
}
