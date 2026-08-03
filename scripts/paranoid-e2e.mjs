// Paranoid-mode end-to-end drill against LIVE TESTNET (untracked runner).
//
// Headless stand-ins for the browser pieces: a synthetic P-256 "passkey"
// (buildSyntheticAssertion — the on-chain verifier skips rpIdHash, same trick
// as the Rust integration tests) and the real ML-DSA-65 key via
// @noble/post-quantum. Everything on-chain is the production path: deployed
// factory, webauthn-verifier, ml-dsa-verifier, real transactions.
//
// Sequence: create account → enroll backstop → ARM hybrid rule → ENFORCE
// (remove rule 0) → negative checks (passkey-only / ML-DSA-only rejected) →
// fund → dual-signed SPEND → stand down (solo rule back, hybrid removed).

import {
  Keypair, Networks, TransactionBuilder, rpc, xdr, Contract, Address,
  nativeToScVal, scValToNative, Asset,
} from '@stellar/stellar-sdk';
import { Client as FactoryClient } from '@nidohq/factory';
import { Client as SmartAccountClient } from '@nidohq/smart-account';
import {
  buildSyntheticAssertion, buildAuthHash, computeAuthDigest, getAuthEntry,
  injectPasskeySignature, injectSignedAuthPayload, encodeMlDsaSigData,
  extractXdrOperations, fetchRegistryAddress,
} from '@nidohq/passkey-sdk';
import { basicNodeSigner } from '@stellar/stellar-sdk/contract';
import { p256 } from '@noble/curves/nist.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from 'node:crypto';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const PASS = Networks.TESTNET;
const server = new rpc.Server(RPC_URL);
const ML_DSA_CONTEXT = new TextEncoder().encode('nido-mldsa-v1');

const log = (s) => console.log(`\n=== ${s}`);

// --- keys -------------------------------------------------------------
const funder = Keypair.random();
log(`funder ${funder.publicKey()} — friendbot funding`);
await fetch(`https://friendbot.stellar.org?addr=${funder.publicKey()}`).then(r => {
  if (!r.ok) throw new Error(`friendbot: ${r.status}`);
});

const passkeyPriv = randomBytes(32);
const passkeyPub = p256.getPublicKey(passkeyPriv, false); // 65B SEC1
const mlSeed = randomBytes(32);
const ml = ml_dsa65.keygen(mlSeed);
const commitment = sha256(ml.publicKey);

// --- helpers ----------------------------------------------------------
async function submitClassic(tx) {
  // enforce-mode re-sim + resource refit on the auth-injected tx.
  const prepped = await server.prepareTransaction(tx);
  prepped.sign(funder);
  const send = await server.sendTransaction(prepped);
  if (send.status === 'ERROR') {
    throw new Error(`send failed: ${JSON.stringify(send.errorResult)}`);
  }
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const got = await server.getTransaction(send.hash);
    if (got.status === 'SUCCESS') return send.hash;
    if (got.status === 'FAILED') throw new Error(`tx FAILED: ${send.hash}`);
  }
  throw new Error(`tx timed out: ${send.hash}`);
}

// Build, simulate, sign the account auth entry with the requested signers,
// and submit. `sign` is 'passkey' | 'mldsa' | 'both'.
async function accountTx(account, operation, ruleId, sign) {
  const source = await server.getAccount(funder.publicKey());
  const opClone = xdr.Operation.fromXDR(operation.toXDR());
  opClone.body().invokeHostFunctionOp().auth([]);
  const simTx = new TransactionBuilder(source, { fee: '10000000', networkPassphrase: PASS })
    .addOperation(opClone).setTimeout(0).build();
  const sim = await server.simulateTransaction(simTx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`sim failed: ${sim.error}`);
  const authEntry = getAuthEntry(sim);
  const lastLedger = sim.latestLedger;
  const payload = buildAuthHash(authEntry, PASS, lastLedger);
  const contextRuleIds = [ruleId];
  const digest = computeAuthDigest(payload, contextRuleIds);
  const assembled = rpc.assembleTransaction(simTx, sim).build();

  const signers = [];
  if (sign === 'passkey' || sign === 'both') {
    const a = await buildSyntheticAssertion(passkeyPriv, digest);
    signers.push({
      kind: 'external', verifierAddress: WEBAUTHN_VERIFIER, publicKey: passkeyPub,
      passkeySignature: {
        authenticatorData: a.authenticatorData,
        clientDataJson: a.clientDataJSON,
        signature: a.signature,
      },
    });
  }
  if (sign === 'mldsa' || sign === 'both') {
    signers.push({
      kind: 'external-bytes', verifierAddress: MLDSA_VERIFIER, keyData: commitment,
      sigData: encodeMlDsaSigData(ml.publicKey, ml_dsa65.sign(digest, ml.secretKey, { context: ML_DSA_CONTEXT })),
    });
  }
  injectSignedAuthPayload(assembled, signers, lastLedger, undefined, contextRuleIds);
  return submitClassic(assembled);
}

function saClient(account) {
  return new SmartAccountClient({ contractId: account, networkPassphrase: PASS, rpcUrl: RPC_URL });
}
async function op(txPromise, label) {
  return extractXdrOperations(await txPromise, label)[0];
}
const external = (verifier, keyData) => ({
  tag: 'External', values: [verifier, Buffer.from(keyData)],
});

// --- resolve deployed contracts --------------------------------------
const FACTORY = await fetchRegistryAddress('factory');
const WEBAUTHN_VERIFIER = await fetchRegistryAddress('verifier');
const MLDSA_VERIFIER = await fetchRegistryAddress('mldsa-verifier');
log(`factory ${FACTORY}\n    webauthn ${WEBAUTHN_VERIFIER}\n    mldsa ${MLDSA_VERIFIER}`);

// --- 1. create the account -------------------------------------------
log('1. create_account via factory');
const factory = new FactoryClient({
  contractId: FACTORY, networkPassphrase: PASS, rpcUrl: RPC_URL,
  publicKey: funder.publicKey(),
  ...basicNodeSigner(funder, PASS),
});
const salt = Buffer.from(randomBytes(32));
const createTx = await factory.create_account({ salt, key: Buffer.from(passkeyPub) });
const created = await createTx.signAndSend();
const ACCOUNT = created.result;
log(`account ${ACCOUNT}`);

// --- 2. enroll the backstop (passkey signs, rule 0) -------------------
log('2. enroll pq-backstop (CallContract(self), ML-DSA signer)');
const enrollHash = await accountTx(
  ACCOUNT,
  await op(saClient(ACCOUNT).add_context_rule({
    context_type: { tag: 'CallContract', values: [ACCOUNT] },
    name: 'pq-backstop', valid_until: undefined,
    signers: [external(MLDSA_VERIFIER, commitment)], policies: new Map(),
  }), 'enroll'),
  0, 'passkey',
);
log(`enrolled: ${enrollHash}`);

// --- 3. ARM: hybrid Default rule --------------------------------------
log('3. ARM paranoid (hybrid Default rule, passkey signs)');
const armHash = await accountTx(
  ACCOUNT,
  await op(saClient(ACCOUNT).add_context_rule({
    context_type: { tag: 'Default', values: undefined },
    name: 'paranoid', valid_until: undefined,
    signers: [external(WEBAUTHN_VERIFIER, passkeyPub), external(MLDSA_VERIFIER, commitment)],
    policies: new Map(),
  }), 'arm'),
  0, 'passkey',
);
log(`armed: ${armHash}`);

// Discover rule ids by scanning get_context_rule via simulation.
async function findRuleId(account, name) {
  for (let id = 0; id < 12; id++) {
    const source = await server.getAccount(funder.publicKey());
    const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: PASS })
      .addOperation(new Contract(account).call('get_context_rule', nativeToScVal(id, { type: 'u32' })))
      .setTimeout(0).build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) continue;
    const native = scValToNative(sim.result.retval);
    if (native?.name === name) return native.id ?? id;
  }
  throw new Error(`rule "${name}" not found`);
}
const PARANOID_ID = await findRuleId(ACCOUNT, 'paranoid');
log(`paranoid rule id = ${PARANOID_ID}`);

// --- 4. ENFORCE: remove rule 0 ---------------------------------------
log('4. ENFORCE (remove passkey-only rule 0, passkey signs its own removal)');
const enforceHash = await accountTx(
  ACCOUNT,
  await op(saClient(ACCOUNT).remove_context_rule({ context_rule_id: 0 }), 'enforce'),
  0, 'passkey',
);
log(`enforced: ${enforceHash}`);

// --- 5. fund the account, then negative + positive spend checks -------
log('5. fund account with 10 XLM (SAC transfer from funder G)');
const SAC = Asset.native().contractId(PASS);
{
  const source = await server.getAccount(funder.publicKey());
  const fundTx = new TransactionBuilder(source, { fee: '10000000', networkPassphrase: PASS })
    .addOperation(new Contract(SAC).call(
      'transfer',
      nativeToScVal(Address.fromString(funder.publicKey()), { type: 'address' }),
      nativeToScVal(Address.fromString(ACCOUNT), { type: 'address' }),
      nativeToScVal(100_000_000n, { type: 'i128' }),
    )).setTimeout(60).build();
  log(`funded: ${await submitClassic(fundTx)}`);
}

const spendOp = () => {
  const c = new Contract(SAC);
  return c.call(
    'transfer',
    nativeToScVal(Address.fromString(ACCOUNT), { type: 'address' }),
    nativeToScVal(Address.fromString(funder.publicKey()), { type: 'address' }),
    nativeToScVal(10_000_000n, { type: 'i128' }),
  );
};

log('6. NEGATIVE: passkey-only spend under paranoid rule (must fail)');
try {
  await accountTx(ACCOUNT, spendOp(), PARANOID_ID, 'passkey');
  throw new Error('UNEXPECTED: passkey-only spend was accepted');
} catch (e) {
  if (String(e).includes('UNEXPECTED')) throw e;
  log(`rejected as expected: ${String(e).slice(0, 140)}`);
}

log('7. NEGATIVE: ML-DSA-only spend under paranoid rule (must fail)');
try {
  await accountTx(ACCOUNT, spendOp(), PARANOID_ID, 'mldsa');
  throw new Error('UNEXPECTED: ML-DSA-only spend was accepted');
} catch (e) {
  if (String(e).includes('UNEXPECTED')) throw e;
  log(`rejected as expected: ${String(e).slice(0, 140)}`);
}

log('8. POSITIVE: dual-signed spend (passkey + ML-DSA)');
const spendHash = await accountTx(ACCOUNT, spendOp(), PARANOID_ID, 'both');
log(`DUAL-SIGNED SPEND CONFIRMED: ${spendHash}`);

// --- 9. stand down ----------------------------------------------------
log('9. STAND DOWN: restore solo rule (dual-signed), remove hybrid rule');
const soloHash = await accountTx(
  ACCOUNT,
  await op(saClient(ACCOUNT).add_context_rule({
    context_type: { tag: 'Default', values: undefined },
    name: 'solo', valid_until: undefined,
    signers: [external(WEBAUTHN_VERIFIER, passkeyPub)], policies: new Map(),
  }), 'solo'),
  PARANOID_ID, 'both',
);
log(`solo rule restored: ${soloHash}`);
const SOLO_ID = await findRuleId(ACCOUNT, 'solo');
const removeHash = await accountTx(
  ACCOUNT,
  await op(saClient(ACCOUNT).remove_context_rule({ context_rule_id: PARANOID_ID }), 'rm-hybrid'),
  SOLO_ID, 'passkey',
);
log(`hybrid rule removed (passkey-only again works): ${removeHash}`);

log(`ALL STEPS PASSED — account ${ACCOUNT}`);
