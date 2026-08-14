#!/usr/bin/env node
// Spike #161: prove a preauth-signer-only G account can execute an unsigned
// Soroban InvokeHostFunction (native SAC transfer) — optionally inside a
// fee-bump paid by another account.
//
// Usage: node spike.mjs --mode feebump|bare
// Progress logs -> stderr, machine-readable JSON result -> stdout.

import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';
const NET = Networks.TESTNET;

const log = (...a) => console.error(...a);

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const mode = arg('mode', null);
if (mode !== 'feebump' && mode !== 'bare') {
  log('usage: node spike.mjs --mode feebump|bare');
  process.exit(2);
}

const server = new rpc.Server(RPC_URL);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fundWithFriendbot(pubkey) {
  for (let attempt = 1; attempt <= 5; attempt++) {
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

function nativeBalance(acct) {
  const b = (acct.balances ?? []).find((x) => x.asset_type === 'native');
  return b ? b.balance : null;
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

async function main() {
  const result = { mode, network: 'testnet' };

  // 1. Keypairs + friendbot
  const G = Keypair.random();
  const R = Keypair.random();
  result.g_pubkey = G.publicKey();
  result.r_pubkey = R.publicKey();
  log(`G (burner):  ${G.publicKey()}`);
  log(`R (dest/fee):${R.publicKey()}`);
  log('funding via friendbot...');
  await fundWithFriendbot(G.publicKey());
  await fundWithFriendbot(R.publicKey());

  // 2. Load G's sequence n
  const gAcct = await server.getAccount(G.publicKey());
  const n = BigInt(gAcct.sequenceNumber());
  log(`G sequence n = ${n}`);

  // 3. Build T FIRST: source G, seq n+2, native SAC transfer(G, R, 5 XLM),
  //    simulate + assemble, record auth credential type, DO NOT SIGN.
  const sacId = Asset.native().contractId(NET);
  log(`native SAC: ${sacId}`);
  const tSource = new Account(G.publicKey(), (n + 1n).toString()); // builds at n+2
  const rawT = new TransactionBuilder(tSource, { fee: '1000000', networkPassphrase: NET })
    .addOperation(
      Operation.invokeContractFunction({
        contract: sacId,
        function: 'transfer',
        args: [
          nativeToScVal(G.publicKey(), { type: 'address' }),
          nativeToScVal(R.publicKey(), { type: 'address' }),
          nativeToScVal(50_000_000n, { type: 'i128' }), // 5 XLM
        ],
      }),
    )
    .setTimeout(3600)
    .build();

  const sim = await server.simulateTransaction(rawT);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulation of T failed: ${sim.error}`);
  }
  const authEntries = sim.result?.auth ?? [];
  result.auth_entry_count = authEntries.length;
  result.auth_credential_types = authEntries.map((e) => e.credentials().switch().name);
  log(`sim auth entries: ${JSON.stringify(result.auth_credential_types)}`);
  const allSourceAccount = authEntries.every(
    (e) => e.credentials().switch() === xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount(),
  );
  if (!allSourceAccount) {
    throw new Error('auth entries are NOT all sourceAccount credentials — preauth cannot cover them');
  }

  const T = rpc.assembleTransaction(rawT, sim).build();
  const tHash = T.hash(); // Buffer(32)
  const tXdr = T.toEnvelope().toXDR('base64'); // frozen bytes — submit exactly these
  result.t_inner_hash = tHash.toString('hex');
  result.t_seq = T.sequence;
  result.t_fee = T.fee;
  log(`T built: seq ${T.sequence}, fee ${T.fee}, hash ${result.t_inner_hash}`);

  // 4. Build + submit S: seq n+1, one SetOptions with preauth signer + masterWeight 0
  const sSource = new Account(G.publicKey(), n.toString()); // builds at n+1
  const S = new TransactionBuilder(sSource, { fee: '200', networkPassphrase: NET })
    .addOperation(
      Operation.setOptions({
        signer: { preAuthTx: tHash, weight: 1 },
        masterWeight: 0,
      }),
    )
    .setTimeout(300)
    .build();
  S.sign(G); // the only use of G's secret for signing an accepted tx
  const sSent = await server.sendTransaction(S);
  log(`S sent: ${sSent.hash} status ${sSent.status}`);
  if (sSent.status === 'ERROR') {
    throw new Error(`S rejected: ${txErrorName(sSent)}`);
  }
  await pollSuccess(sSent.hash, 'setup');
  result.setup_tx_hash = sSent.hash;
  log('S confirmed: preauth signer installed, master weight 0');

  // snapshot signers after S
  const gAfterS = await horizonAccount(G.publicKey());
  result.signers_after_setup = gAfterS.signers.map((s) => ({
    type: s.type,
    key: s.key,
    weight: s.weight,
  }));
  log(`signers after S: ${JSON.stringify(result.signers_after_setup)}`);

  // 5. NEGATIVE TEST: classic payment G->R at seq n+2 signed with G's master key.
  //    Master weight is 0 → expect rejection (txBAD_AUTH), seq NOT consumed.
  const negSource = new Account(G.publicKey(), (n + 1n).toString()); // builds at n+2
  const negTx = new TransactionBuilder(negSource, { fee: '200', networkPassphrase: NET })
    .addOperation(
      Operation.payment({
        destination: R.publicKey(),
        asset: Asset.native(),
        amount: '1',
      }),
    )
    .setTimeout(300)
    .build();
  negTx.sign(G);
  const negSent = await server.sendTransaction(negTx);
  result.negative_test = {
    status: negSent.status,
    error: txErrorName(negSent),
    hash: negSent.hash,
  };
  log(`negative test: status=${negSent.status} error=${result.negative_test.error}`);
  if (negSent.status !== 'ERROR') {
    // If it went through, the whole premise is broken — poll to see what happened.
    const negRes = await server.pollTransaction(negSent.hash, { attempts: 15 });
    result.negative_test.final_status = negRes.status;
    throw new Error(
      `negative test was NOT rejected at submission (status ${negSent.status}, final ${negRes.status}) — master key still usable?`,
    );
  }

  // 6. Submit T with ZERO signatures
  const unsignedT = TransactionBuilder.fromXDR(tXdr, NET);
  const innerSigCountAtSubmit = unsignedT.signatures.length;
  log(`submitting T (mode=${mode}); inner signatures at submit: ${innerSigCountAtSubmit}`);
  if (innerSigCountAtSubmit !== 0) throw new Error('T unexpectedly has signatures');

  let submitHash;
  if (mode === 'feebump') {
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      R.publicKey(),
      '2000000',
      unsignedT,
      NET,
    );
    feeBump.sign(R); // ONLY the outer envelope is signed
    const sent = await server.sendTransaction(feeBump);
    log(`fee-bump sent: ${sent.hash} status ${sent.status}`);
    if (sent.status === 'ERROR') {
      throw new Error(`fee-bump rejected: ${txErrorName(sent)}`);
    }
    submitHash = sent.hash; // OUTER hash
    result.outer_feebump_hash = sent.hash;
  } else {
    const sent = await server.sendTransaction(unsignedT);
    log(`bare T sent: ${sent.hash} status ${sent.status}`);
    if (sent.status === 'ERROR') {
      throw new Error(`bare T rejected: ${txErrorName(sent)}`);
    }
    submitHash = sent.hash;
  }

  const final = await pollSuccess(submitHash, 'T');
  result.onboard_tx_hash = submitHash;
  result.t_ledger = final.ledger;
  log(`T SUCCESS in ledger ${final.ledger}`);

  // 7. Post-checks
  // Inner signature count from the applied envelope
  const env = final.envelopeXdr;
  let appliedInnerSigs;
  if (env.switch() === xdr.EnvelopeType.envelopeTypeTxFeeBump()) {
    appliedInnerSigs = env.feeBump().tx().innerTx().v1().signatures().length;
    result.outer_signature_count = env.feeBump().signatures().length;
  } else {
    appliedInnerSigs = env.v1().signatures().length;
  }
  result.inner_signature_count = appliedInnerSigs;
  log(`applied inner signature count: ${appliedInnerSigs}`);

  // give horizon a moment to ingest
  await sleep(4000);
  const gFinal = await horizonAccount(G.publicKey());
  const rFinal = await horizonAccount(R.publicKey());
  result.g_signers_after_t = gFinal.signers.map((s) => ({
    type: s.type,
    key: s.key,
    weight: s.weight,
  }));
  result.g_master_weight_after_t = gFinal.signers.find((s) => s.key === G.publicKey())?.weight ?? null;
  result.g_balance_after = nativeBalance(gFinal);
  result.r_balance_after = nativeBalance(rFinal);
  result.g_seq_after = gFinal.sequence;
  const preauthStill = gFinal.signers.some((s) => s.type === 'preauth_tx');
  result.preauth_signer_removed = !preauthStill;
  log(`G signers after T: ${JSON.stringify(result.g_signers_after_t)}`);
  log(`G balance ${result.g_balance_after}, R balance ${result.r_balance_after}`);
  log(`preauth signer removed: ${result.preauth_signer_removed}`);

  result.outcome =
    appliedInnerSigs === 0 && result.preauth_signer_removed ? 'SUCCESS' : 'PARTIAL';
  result.explorer = `https://stellar.expert/explorer/testnet/tx/${submitHash}`;
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  log(`FATAL: ${e.stack ?? e}`);
  console.log(JSON.stringify({ mode, outcome: 'FAILED', error: String(e?.message ?? e) }, null, 2));
  process.exit(1);
});
