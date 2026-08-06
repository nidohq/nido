#!/usr/bin/env node
// Spike #161 part2 EXPERIMENT C: nested require_auth(G) under SourceAccount
// credentials, via a wrapper contract — first simple nesting (wrapper ->
// SAC.transfer), then the full composite (wrapper -> factory.create_account +
// SAC.transfer). Preauth-signer-only G, bare unsigned submission.
//
// Usage: node spike-c.mjs --phase nested|composite
// Progress -> stderr, JSON result -> stdout.

import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  Account,
  Address,
  Asset,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';
const NET = Networks.TESTNET;

const WRAPPER = 'CBO5O4JZCQPOREOH2Z6USCXR32M4SQVDFSRP2SGSYLYKM246OVSB757X';
const FACTORY = 'CBQKB6GYPO7P2CGDKN7KYLEFEBBN6FY5NXZJ7HNR43ZK2DDOU5N7NCV5';

const log = (...a) => console.error(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = new rpc.Server(RPC_URL);

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const phase = arg('phase', null);
if (phase !== 'nested' && phase !== 'composite') {
  log('usage: node spike-c.mjs --phase nested|composite');
  process.exit(2);
}

async function fundWithFriendbot(pubkey) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const resp = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(pubkey)}`);
    if (resp.ok) return;
    log(`friendbot HTTP ${resp.status} for ${pubkey}, attempt ${attempt}; backing off`);
    await sleep(3000 * attempt);
  }
  throw new Error(`friendbot funding failed for ${pubkey}`);
}

async function horizonAccount(pubkey) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    const resp = await fetch(`${HORIZON_URL}/accounts/${pubkey}`);
    if (resp.ok) return resp.json();
    await sleep(2000);
  }
  throw new Error(`horizon account fetch failed for ${pubkey}`);
}

async function pollSuccess(hash, label) {
  const res = await server.pollTransaction(hash, {
    attempts: 30,
    sleepStrategy: rpc.BasicSleepStrategy,
  });
  if (res.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    let detail = '';
    try {
      detail = JSON.stringify({
        resultXdr: res.resultXdr?.toXDR?.('base64'),
        diagnostics: (res.diagnosticEventsXdr ?? []).map((d) => d.toXDR('base64')),
      });
    } catch {}
    throw new Error(`${label} tx ${hash} finished ${res.status} ${detail}`);
  }
  return res;
}

function txErrorName(sent) {
  try {
    return sent.errorResult?.result().switch().name ?? null;
  } catch {
    return null;
  }
}

// --- auth-entry decoding -----------------------------------------------------

function scAddrToStr(scAddr) {
  try {
    return Address.fromScAddress(scAddr).toString();
  } catch {
    return `<scaddress type ${scAddr.switch().name}>`;
  }
}

function decodeInvocation(inv) {
  const fn = inv.function();
  let node;
  switch (fn.switch().name) {
    case 'sorobanAuthorizedFunctionTypeContractFn': {
      const c = fn.contractFn();
      node = {
        type: 'contractFn',
        contract: scAddrToStr(c.contractAddress()),
        function: c.functionName().toString(),
        args: c.args().map((a) => {
          try {
            const n = scValToNative(a);
            return typeof n === 'bigint' ? n.toString() : Buffer.isBuffer(n) ? n.toString('hex') : n;
          } catch {
            return `<scval ${a.switch().name}>`;
          }
        }),
      };
      break;
    }
    default:
      node = { type: fn.switch().name };
  }
  node.subInvocations = inv.subInvocations().map(decodeInvocation);
  return node;
}

function decodeAuthEntry(entry) {
  const creds = entry.credentials();
  const out = { credentials: creds.switch().name };
  if (creds.switch().name === 'sorobanCredentialsAddress') {
    out.address = scAddrToStr(creds.address().address());
    out.nonce = creds.address().nonce().toString();
  }
  out.rootInvocation = decodeInvocation(entry.rootInvocation());
  out.xdr_base64 = entry.toXDR('base64');
  return out;
}

// --- P-256 keygen (real curve point, SEC1 uncompressed) ----------------------

function genP256Sec1() {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  const sec1 = Buffer.concat([Buffer.from([0x04]), x, y]);
  if (sec1.length !== 65) throw new Error(`bad sec1 length ${sec1.length}`);
  return sec1;
}

// --- shared preauth choreography --------------------------------------------
// Given a raw (unassembled) invoke tx builder-output at seq n+2 for account G:
// simulate, decode auth, assert all sourceAccount, assemble, install preauth
// signer + masterWeight 0 at n+1, submit T bare, poll.
async function runPreauthFlow({ G, rawT, n, result, leeway }) {
  // FINDING (captured in results): default recording mode refuses nested
  // require_auth ("authorization not tied to the root contract invocation");
  // RPC's record_allow_nonroot mode is required for composite invocations.
  result.sim_auth_mode = 'record_allow_nonroot';
  const sim = await server.simulateTransaction(rawT, leeway, 'record_allow_nonroot');
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulation failed: ${sim.error}`);
  }
  const authEntries = sim.result?.auth ?? [];
  result.auth_entry_count = authEntries.length;
  result.auth_entries = authEntries.map(decodeAuthEntry);
  log(`sim auth entries (${authEntries.length}):`);
  log(JSON.stringify(result.auth_entries.map(({ xdr_base64, ...rest }) => rest), null, 2));

  const allSourceAccount = authEntries.every(
    (e) => e.credentials().switch() === xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount(),
  );
  result.all_source_account_credentials = allSourceAccount;
  if (!allSourceAccount) {
    throw new Error(
      'CRITICAL FINDING: at least one auth entry uses non-sourceAccount credentials — preauth cannot cover it',
    );
  }

  const T = rpc.assembleTransaction(rawT, sim).build();
  const tHash = T.hash();
  const tXdr = T.toEnvelope().toXDR('base64');
  result.t_hash = tHash.toString('hex');
  result.t_seq = T.sequence;
  result.t_fee = T.fee;
  result.t_resource_fee = T.toEnvelope().v1().tx().ext().sorobanData().resourceFee().toString();
  log(`T built: seq ${T.sequence}, fee ${T.fee}, hash ${result.t_hash}`);

  // S at n+1: preauth signer + master weight 0, atomically.
  const sSource = new Account(G.publicKey(), n.toString());
  const S = new TransactionBuilder(sSource, { fee: '200', networkPassphrase: NET })
    .addOperation(
      Operation.setOptions({
        signer: { preAuthTx: tHash, weight: 1 },
        masterWeight: 0,
      }),
    )
    .setTimeout(300)
    .build();
  S.sign(G);
  const sSent = await server.sendTransaction(S);
  log(`S sent: ${sSent.hash} status ${sSent.status}`);
  if (sSent.status === 'ERROR') throw new Error(`S rejected: ${txErrorName(sSent)}`);
  await pollSuccess(sSent.hash, 'setup');
  result.setup_tx_hash = sSent.hash;
  log('S confirmed: preauth signer installed, master weight 0');

  // Submit T completely bare (zero signatures).
  const unsignedT = TransactionBuilder.fromXDR(tXdr, NET);
  if (unsignedT.signatures.length !== 0) throw new Error('T unexpectedly has signatures');
  const sent = await server.sendTransaction(unsignedT);
  log(`bare T sent: ${sent.hash} status ${sent.status}`);
  if (sent.status === 'ERROR') {
    throw new Error(`bare T rejected: ${txErrorName(sent)}`);
  }
  const final = await pollSuccess(sent.hash, 'T');
  result.t_tx_hash = sent.hash;
  result.t_ledger = final.ledger;
  result.t_inner_signature_count = final.envelopeXdr.v1().signatures().length;
  log(`T SUCCESS in ledger ${final.ledger}; applied signature count ${result.t_inner_signature_count}`);

  await sleep(4000);
  const gFinal = await horizonAccount(G.publicKey());
  result.g_signers_after_t = gFinal.signers.map((s) => ({ type: s.type, key: s.key, weight: s.weight }));
  result.preauth_signer_removed = !gFinal.signers.some((s) => s.type === 'preauth_tx');
  result.g_master_weight_after_t = gFinal.signers.find((s) => s.key === G.publicKey())?.weight ?? null;
  return final;
}

async function simulateGetCAddress(saltBuf, someAccount) {
  const acct = await server.getAccount(someAccount);
  const tx = new TransactionBuilder(acct, { fee: '1000000', networkPassphrase: NET })
    .addOperation(
      Operation.invokeContractFunction({
        contract: FACTORY,
        function: 'get_c_address',
        args: [nativeToScVal(saltBuf, { type: 'bytes' })],
      }),
    )
    .setTimeout(300)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`get_c_address sim failed: ${sim.error}`);
  return scValToNative(sim.result.retval).toString();
}

async function sacBalanceOf(holder, someAccount) {
  const sacId = Asset.native().contractId(NET);
  const acct = await server.getAccount(someAccount);
  const tx = new TransactionBuilder(acct, { fee: '1000000', networkPassphrase: NET })
    .addOperation(
      Operation.invokeContractFunction({
        contract: sacId,
        function: 'balance',
        args: [nativeToScVal(holder, { type: 'address' })],
      }),
    )
    .setTimeout(300)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`balance sim failed: ${sim.error}`);
  return scValToNative(sim.result.retval).toString();
}

async function contractInstanceExists(cAddr) {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(cAddr).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const res = await server.getLedgerEntries(key);
  return (res.entries ?? []).length > 0;
}

async function main() {
  const result = { phase, network: 'testnet', wrapper: WRAPPER };
  const sacId = Asset.native().contractId(NET);
  result.native_sac = sacId;

  const G = Keypair.random();
  result.g_pubkey = G.publicKey();
  log(`G (burner): ${G.publicKey()}`);
  await fundWithFriendbot(G.publicKey());
  const gAcct = await server.getAccount(G.publicKey());
  const n = BigInt(gAcct.sequenceNumber());
  log(`G sequence n = ${n}`);
  const tSource = new Account(G.publicKey(), (n + 1n).toString()); // builds at n+2

  if (phase === 'nested') {
    // Destination: the deployer account R (any existing account works).
    const rKeys = JSON.parse((await import('node:fs')).readFileSync(new URL('./r-keys.json', import.meta.url)));
    result.dest = rKeys.pub;
    const destBefore = await horizonAccount(rKeys.pub);
    result.dest_balance_before = destBefore.balances.find((b) => b.asset_type === 'native').balance;

    const rawT = new TransactionBuilder(tSource, { fee: '1000000', networkPassphrase: NET })
      .addOperation(
        Operation.invokeContractFunction({
          contract: WRAPPER,
          function: 'nested_transfer',
          args: [
            nativeToScVal(sacId, { type: 'address' }),
            nativeToScVal(G.publicKey(), { type: 'address' }),
            nativeToScVal(rKeys.pub, { type: 'address' }),
            nativeToScVal(50_000_000n, { type: 'i128' }), // 5 XLM
          ],
        }),
      )
      .setTimeout(3600)
      .build();

    await runPreauthFlow({ G, rawT, n, result });

    const destAfter = await horizonAccount(rKeys.pub);
    result.dest_balance_after = destAfter.balances.find((b) => b.asset_type === 'native').balance;
    const delta =
      BigInt(Math.round(parseFloat(result.dest_balance_after) * 1e7)) -
      BigInt(Math.round(parseFloat(result.dest_balance_before) * 1e7));
    result.dest_delta_stroops = delta.toString();
    result.outcome =
      result.t_inner_signature_count === 0 && result.preauth_signer_removed && delta >= 50_000_000n - 1_000_000n
        ? 'SUCCESS'
        : 'PARTIAL';
  } else {
    // composite: factory.create_account + transfer, one preauth, one tx.
    const salt = createHash('sha256').update(`spike161-c-${Date.now()}-${Math.random()}`).digest();
    const key = genP256Sec1();
    result.salt_hex = salt.toString('hex');
    result.p256_key_hex = key.toString('hex');

    const cAddr = await simulateGetCAddress(salt, G.publicKey());
    result.c_address = cAddr;
    log(`predicted C address: ${cAddr}`);
    result.c_existed_before = await contractInstanceExists(cAddr);

    const rawT = new TransactionBuilder(tSource, { fee: '1000000', networkPassphrase: NET })
      .addOperation(
        Operation.invokeContractFunction({
          contract: WRAPPER,
          function: 'onboard',
          args: [
            nativeToScVal(FACTORY, { type: 'address' }),
            nativeToScVal(salt, { type: 'bytes' }),
            nativeToScVal(key, { type: 'bytes' }),
            nativeToScVal(sacId, { type: 'address' }),
            nativeToScVal(G.publicKey(), { type: 'address' }),
            nativeToScVal(50_000_000n, { type: 'i128' }), // 5 XLM
          ],
        }),
      )
      .setTimeout(3600)
      .build();

    // extra cpu leeway: deploy+genesis is heavier than the sim's exact count,
    // and the frozen tx must never die on resources (one-shot signer).
    await runPreauthFlow({ G, rawT, n, result, leeway: { cpuInstructions: 2_000_000 } });

    result.c_exists_after = await contractInstanceExists(cAddr);
    result.c_sac_balance = await sacBalanceOf(cAddr, G.publicKey());
    log(`C deployed: ${result.c_exists_after}, C balance: ${result.c_sac_balance} stroops`);
    result.outcome =
      result.t_inner_signature_count === 0 &&
      result.preauth_signer_removed &&
      result.c_exists_after &&
      result.c_sac_balance === '50000000'
        ? 'SUCCESS'
        : 'PARTIAL';
  }

  result.explorer = `https://stellar.expert/explorer/testnet/tx/${result.t_tx_hash}`;
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  log(`FATAL: ${e.stack ?? e}`);
  console.log(JSON.stringify({ phase, outcome: 'FAILED', error: String(e?.message ?? e) }, null, 2));
  process.exit(1);
});
