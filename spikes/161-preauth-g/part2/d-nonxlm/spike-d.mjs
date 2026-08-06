#!/usr/bin/env node
// EXPERIMENT D (#161 part two): non-XLM asset end-to-end with sponsored
// trustline + zero-dust teardown.
//
//   I = issuer (friendbot), R = relayer (friendbot), G = burner (sponsored
//   create by R, startingBalance 0, never holds any XLM).
//
//   1. Deploy SAC for NIDO:I via stellar CLI (source R).
//   2. Creation tx: [Begin(G,src R), CreateAccount(G, 0, src R), End(src G)].
//   3. Build T5 (seq n+2): SAC-NIDO transfer(G -> I, 100 NIDO), SIMULATION-FREE
//      (hand-built footprint + sourceAccount auth) — trustline doesn't exist yet.
//      Build T6 (seq n+3): classic [ChangeTrust NIDO:I limit 0, AccountMerge G->R]
//      under ONE preauth signer.
//   4. Provisioning S (seq n+1): [Begin(G,src R), ChangeTrust(NIDO:I, src G),
//      SetOptions(preauth hash(T5) w1), SetOptions(preauth hash(T6) w1, master 0),
//      End(src G)] — G(live)+R sign, fee-bump by R. Discard G secret.
//   5. Exchange sim: I pays 100 NIDO to G (classic payment).
//   6. Submit T5 bare (capture exact code if rejected — G has 0 XLM), then
//      fee-bump. Expect NIDO trustline balance -> 0 (full sweep; burn to issuer).
//   7. Submit T6 bare (capture), then fee-bump. Expect trustline deleted then
//      merge succeeds; G gone; all sponsored reserves back to R.
//
// Progress -> stderr; JSON result -> stdout (also written to results.json).

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Account,
  Address,
  Asset,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';
const NET = Networks.TESTNET;
const OUT_DIR = dirname(fileURLToPath(import.meta.url));

const log = (...a) => console.error(...a);
const server = new rpc.Server(RPC_URL);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fundWithFriendbot(pubkey) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const resp = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(pubkey)}`);
    if (resp.ok) return;
    log(`friendbot HTTP ${resp.status} for ${pubkey}, attempt ${attempt}; backing off`);
    await sleep(4000 * attempt);
  }
  throw new Error(`friendbot funding failed for ${pubkey}`);
}

async function horizonAccount(pubkey, { allow404 = false } = {}) {
  for (let attempt = 1; attempt <= 10; attempt++) {
    const resp = await fetch(`${HORIZON_URL}/accounts/${pubkey}`);
    if (resp.ok) return resp.json();
    if (resp.status === 404 && allow404) return null;
    await sleep(2000);
  }
  throw new Error(`horizon account fetch failed for ${pubkey}`);
}

function acctSnapshot(a) {
  if (a === null) return { exists: false };
  return {
    exists: true,
    sequence: a.sequence,
    subentry_count: a.subentry_count,
    num_sponsoring: a.num_sponsoring,
    num_sponsored: a.num_sponsored,
    xlm: (a.balances ?? []).find((b) => b.asset_type === 'native')?.balance ?? null,
    nido: (a.balances ?? []).find((b) => b.asset_code === 'NIDO')?.balance ?? null,
    signers: (a.signers ?? []).map((s) => ({ type: s.type, key: s.key, weight: s.weight })),
  };
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

function sendErrorDetail(sent) {
  let txCode = null;
  let opCodes = null;
  try {
    txCode = sent.errorResult?.result().switch().name ?? null;
  } catch {}
  try {
    const results = sent.errorResult?.result().results?.();
    if (results) opCodes = results.map((r) => r.tr().switch().name);
  } catch {}
  return { status: sent.status, hash: sent.hash, tx_code: txCode, op_codes: opCodes };
}

async function submitAndConfirm(tx, label) {
  const sent = await server.sendTransaction(tx);
  log(`${label} sent: ${sent.hash} status ${sent.status}`);
  if (sent.status === 'ERROR') {
    throw new Error(`${label} rejected: ${JSON.stringify(sendErrorDetail(sent))}`);
  }
  const res = await pollSuccess(sent.hash, label);
  log(`${label} SUCCESS in ledger ${res.ledger}`);
  return { hash: sent.hash, ledger: res.ledger, res };
}

// bare submit: expected to be rejected at validation (fee source G has 0 XLM).
// A validation rejection never reaches apply, so seq + preauth signer survive.
async function submitBare(frozenXdr, label) {
  const tx = TransactionBuilder.fromXDR(frozenXdr, NET);
  const sent = await server.sendTransaction(tx);
  const detail = sendErrorDetail(sent);
  log(`${label} bare submit: ${JSON.stringify(detail)}`);
  if (sent.status !== 'ERROR') {
    // unexpectedly accepted — follow it to a terminal state
    const res = await server.pollTransaction(sent.hash, { attempts: 20 });
    detail.final_status = res.status;
    detail.ledger = res.ledger ?? null;
    log(`${label} bare unexpectedly accepted; final ${res.status}`);
  }
  return detail;
}

async function submitFeeBump(frozenXdr, feePayer, baseFee, label) {
  const inner = TransactionBuilder.fromXDR(frozenXdr, NET);
  if (inner.signatures.length !== 0) throw new Error(`${label}: inner tx has signatures`);
  const fb = TransactionBuilder.buildFeeBumpTransaction(feePayer.publicKey(), baseFee, inner, NET);
  fb.sign(feePayer); // only outer envelope signed
  const { hash, ledger, res } = await submitAndConfirm(fb, `${label} (fee-bump)`);
  const env = res.envelopeXdr;
  const innerSigs = env.feeBump().tx().innerTx().v1().signatures().length;
  return { outer_hash: hash, inner_hash: inner.hash().toString('hex'), ledger, inner_signature_count: innerSigs };
}

// ---------- ledger keys for the simulation-free T5 footprint ----------------
const accountKey = (g) =>
  xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(g).xdrAccountId() }),
  );

const sacInstanceKey = (sacId) =>
  xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(sacId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );

const trustlineKey = (g, asset) =>
  xdr.LedgerKey.trustline(
    new xdr.LedgerKeyTrustLine({
      accountId: Keypair.fromPublicKey(g).xdrAccountId(),
      asset: asset.toTrustLineXDRObject(),
    }),
  );

async function main() {
  const result = { experiment: 'D-nonxlm', network: 'testnet', started: new Date().toISOString() };

  // ---- keys + funding -------------------------------------------------------
  const I = Keypair.random(); // issuer
  const R = Keypair.random(); // relayer / sponsor / fee payer
  let G = Keypair.random();   // burner (secret discarded after S)
  result.accounts = { I: I.publicKey(), R: R.publicKey(), G: G.publicKey() };
  log(`I (issuer):  ${I.publicKey()}`);
  log(`R (relayer): ${R.publicKey()}`);
  log(`G (burner):  ${G.publicKey()}`);
  log('funding I + R via friendbot...');
  await fundWithFriendbot(I.publicKey());
  await fundWithFriendbot(R.publicKey());

  const NIDO = new Asset('NIDO', I.publicKey());

  // ---- 1. deploy the SAC for NIDO:I via stellar CLI (source R) --------------
  const offlineSacId = NIDO.contractId(NET);
  log(`offline-computed SAC id: ${offlineSacId}`);
  let cliOut;
  for (let attempt = 1; ; attempt++) {
    try {
      cliOut = execFileSync(
        'stellar',
        [
          'contract', 'asset', 'deploy',
          '--asset', `NIDO:${I.publicKey()}`,
          '--source-account', R.secret(),
          '--network', 'testnet',
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ).trim();
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      log(`stellar CLI deploy attempt ${attempt} failed: ${e.stderr ?? e}; retrying`);
      await sleep(5000);
    }
  }
  const sacId = cliOut.split('\n').pop().trim();
  log(`CLI-deployed SAC id:     ${sacId}`);
  if (sacId !== offlineSacId) throw new Error(`SAC id mismatch: CLI ${sacId} vs offline ${offlineSacId}`);
  result.sac = { id: sacId, matches_offline_computation: true };

  // ---- 2. sponsored creation of G with startingBalance 0 --------------------
  const rAcct = await server.getAccount(R.publicKey());
  const createTx = new TransactionBuilder(rAcct, { fee: '200', networkPassphrase: NET })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: G.publicKey(), source: R.publicKey() }))
    .addOperation(Operation.createAccount({ destination: G.publicKey(), startingBalance: '0', source: R.publicKey() }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: G.publicKey() }))
    .setTimeout(300)
    .build();
  createTx.sign(R);
  createTx.sign(G); // checkSignatureNoAccount path — G doesn't exist yet
  const create = await submitAndConfirm(createTx, 'creation');
  result.tx_creation = { hash: create.hash, ledger: create.ledger };

  const gAfterCreate = acctSnapshot(await horizonAccount(G.publicKey()));
  const rAfterCreate = acctSnapshot(await horizonAccount(R.publicKey()));
  result.after_creation = { G: gAfterCreate, R_num_sponsoring: rAfterCreate.num_sponsoring };
  log(`G after create: xlm=${gAfterCreate.xlm} subentries=${gAfterCreate.subentry_count} num_sponsored=${gAfterCreate.num_sponsored}; R num_sponsoring=${rAfterCreate.num_sponsoring}`);

  const gAcct = await server.getAccount(G.publicKey());
  const n = BigInt(gAcct.sequenceNumber());
  log(`G sequence n = ${n}`);

  // ---- 3a. build T5 SIMULATION-FREE (seq n+2) -------------------------------
  // SAC NIDO transfer(G -> I, 100 NIDO). Trustline doesn't exist yet and G holds
  // no NIDO, so simulation is impossible — hand-build footprint + auth.
  const AMOUNT = 1_000_000_000n; // 100 NIDO in stroops
  const t5Args = [
    Address.fromString(G.publicKey()).toScVal(),
    Address.fromString(I.publicKey()).toScVal(),
    nativeToScVal(AMOUNT, { type: 'i128' }),
  ];
  const t5Auth = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: Address.fromString(sacId).toScAddress(),
          functionName: 'transfer',
          args: t5Args,
        }),
      ),
      subInvocations: [],
    }),
  });
  const T5_RESOURCE_FEE = 1_000_000; // stroops; excess refunded to outer fee source
  const t5SorobanData = new SorobanDataBuilder()
    .setFootprint(
      // readOnly: SAC instance + issuer account (+ G account, harmless upper bound)
      [sacInstanceKey(sacId), accountKey(I.publicKey()), accountKey(G.publicKey())],
      // readWrite: only G's NIDO trustline changes (burn to issuer: no dest entry)
      [trustlineKey(G.publicKey(), NIDO)],
    )
    .setResources(4_000_000, 50_000, 5_000)
    .setResourceFee(T5_RESOURCE_FEE)
    .build();
  const T5 = new TransactionBuilder(new Account(G.publicKey(), (n + 1n).toString()), {
    fee: String(200 + T5_RESOURCE_FEE), // total must include resourceFee (no assemble step)
    networkPassphrase: NET,
  })
    .addOperation(
      Operation.invokeContractFunction({ contract: sacId, function: 'transfer', args: t5Args, auth: [t5Auth] }),
    )
    .setSorobanData(t5SorobanData)
    .setTimeout(3600)
    .build();
  const t5Hash = T5.hash();
  const t5Xdr = T5.toEnvelope().toXDR('base64'); // frozen bearer bytes
  result.t5 = { seq: T5.sequence, fee: T5.fee, hash: t5Hash.toString('hex'), built: 'simulation-free', xdr: t5Xdr };
  log(`T5 built simulation-free: seq ${T5.sequence}, hash ${result.t5.hash}`);

  // ---- 3b. build T6 (seq n+3): ChangeTrust limit 0 + AccountMerge, one preauth
  const T6 = new TransactionBuilder(new Account(G.publicKey(), (n + 2n).toString()), {
    fee: '200',
    networkPassphrase: NET,
  })
    .addOperation(Operation.changeTrust({ asset: NIDO, limit: '0', source: G.publicKey() }))
    .addOperation(Operation.accountMerge({ destination: R.publicKey(), source: G.publicKey() }))
    .setTimeout(3600)
    .build();
  const t6Hash = T6.hash();
  const t6Xdr = T6.toEnvelope().toXDR('base64');
  result.t6 = { seq: T6.sequence, fee: T6.fee, hash: t6Hash.toString('hex'), xdr: t6Xdr };
  log(`T6 built: seq ${T6.sequence}, hash ${result.t6.hash}`);

  // ---- 4. provisioning S (seq n+1), fee-bumped by R -------------------------
  const S = new TransactionBuilder(new Account(G.publicKey(), n.toString()), {
    fee: '200',
    networkPassphrase: NET,
  })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: G.publicKey(), source: R.publicKey() }))
    .addOperation(Operation.changeTrust({ asset: NIDO, source: G.publicKey() })) // limit = max
    .addOperation(Operation.setOptions({ signer: { preAuthTx: t5Hash, weight: 1 }, source: G.publicKey() }))
    .addOperation(Operation.setOptions({ signer: { preAuthTx: t6Hash, weight: 1 }, masterWeight: 0, source: G.publicKey() }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: G.publicKey() }))
    .setTimeout(300)
    .build();
  S.sign(G); // last use of G's live master key
  S.sign(R); // Begin op source
  const sBump = TransactionBuilder.buildFeeBumpTransaction(R.publicKey(), '2000', S, NET);
  sBump.sign(R);
  const s = await submitAndConfirm(sBump, 'provisioning S');
  result.tx_provisioning = { outer_hash: s.hash, inner_hash: S.hash().toString('hex'), ledger: s.ledger };

  // discard G's secret: from here on nothing signs as G.
  G = Keypair.fromPublicKey(result.accounts.G);
  log('G secret discarded (keypair replaced with public-only)');

  const gAfterS = acctSnapshot(await horizonAccount(result.accounts.G));
  const rAfterS = acctSnapshot(await horizonAccount(R.publicKey()));
  result.after_provisioning = { G: gAfterS, R_num_sponsoring: rAfterS.num_sponsoring };
  // verify the two preauth signers decode to hash(T5)/hash(T6)
  const preauthKeys = gAfterS.signers
    .filter((sg) => sg.type === 'preauth_tx')
    .map((sg) => StrKey.decodePreAuthTx(sg.key).toString('hex'));
  result.preauth_signers_decode = {
    on_chain: preauthKeys,
    match_t5: preauthKeys.includes(result.t5.hash),
    match_t6: preauthKeys.includes(result.t6.hash),
    master_weight: gAfterS.signers.find((sg) => sg.key === result.accounts.G)?.weight ?? null,
  };
  log(`after S: G subentries=${gAfterS.subentry_count} num_sponsored=${gAfterS.num_sponsored} xlm=${gAfterS.xlm} nido=${gAfterS.nido}; R num_sponsoring=${rAfterS.num_sponsoring}`);
  log(`preauth decode: ${JSON.stringify(result.preauth_signers_decode)}`);
  if (!result.preauth_signers_decode.match_t5 || !result.preauth_signers_decode.match_t6) {
    throw new Error('on-chain preauth signers do not match built tx hashes');
  }

  // ---- 5. exchange sim: I pays 100 NIDO to G --------------------------------
  const iAcct = await server.getAccount(I.publicKey());
  const payTx = new TransactionBuilder(iAcct, { fee: '200', networkPassphrase: NET })
    .addOperation(Operation.payment({ destination: result.accounts.G, asset: NIDO, amount: '100' }))
    .setTimeout(300)
    .build();
  payTx.sign(I);
  const pay = await submitAndConfirm(payTx, 'issuer payment');
  result.tx_payment = { hash: pay.hash, ledger: pay.ledger };
  await sleep(3000);
  const gAfterPay = acctSnapshot(await horizonAccount(result.accounts.G));
  result.after_payment = { G_nido: gAfterPay.nido, G_xlm: gAfterPay.xlm };
  log(`G after payment: nido=${gAfterPay.nido} xlm=${gAfterPay.xlm}`);
  if (gAfterPay.nido !== '100.0000000') throw new Error(`unexpected NIDO balance ${gAfterPay.nido}`);

  // ---- 6. T5: bare first (0-XLM fee source), then fee-bump ------------------
  result.t5_bare_attempt = await submitBare(t5Xdr, 'T5');
  if (result.t5_bare_attempt.final_status === 'SUCCESS') {
    result.t5_submission = { mode: 'bare', hash: result.t5_bare_attempt.hash, ledger: result.t5_bare_attempt.ledger };
  } else {
    result.t5_submission = { mode: 'feebump', ...(await submitFeeBump(t5Xdr, R, '1100000', 'T5')) };
  }
  await sleep(4000);
  const gAfterT5 = acctSnapshot(await horizonAccount(result.accounts.G));
  const rAfterT5 = acctSnapshot(await horizonAccount(R.publicKey()));
  result.after_t5 = { G: gAfterT5, R_num_sponsoring: rAfterT5.num_sponsoring };
  log(`after T5: G nido=${gAfterT5.nido} xlm=${gAfterT5.xlm} subentries=${gAfterT5.subentry_count} num_sponsored=${gAfterT5.num_sponsored} signers=${JSON.stringify(gAfterT5.signers)}; R num_sponsoring=${rAfterT5.num_sponsoring}`);
  if (gAfterT5.nido !== '0.0000000') throw new Error(`T5 did not sweep NIDO to zero: ${gAfterT5.nido}`);

  // issued-asset outstanding amount (burn check) — horizon /assets may lag
  try {
    const assetsResp = await (
      await fetch(`${HORIZON_URL}/assets?asset_code=NIDO&asset_issuer=${I.publicKey()}`)
    ).json();
    const rec = assetsResp._embedded?.records?.[0];
    result.asset_stats_after_t5 = rec
      ? { amount: rec.amount ?? rec.balances?.authorized, num_accounts: rec.num_accounts }
      : null;
  } catch (e) {
    result.asset_stats_after_t5 = `fetch failed: ${e.message}`;
  }

  // ---- 7. T6: bare first, then fee-bump -------------------------------------
  result.t6_bare_attempt = await submitBare(t6Xdr, 'T6');
  if (result.t6_bare_attempt.final_status === 'SUCCESS') {
    result.t6_submission = { mode: 'bare', hash: result.t6_bare_attempt.hash, ledger: result.t6_bare_attempt.ledger };
  } else {
    result.t6_submission = { mode: 'feebump', ...(await submitFeeBump(t6Xdr, R, '1000', 'T6')) };
  }
  await sleep(5000);
  const gFinal = await horizonAccount(result.accounts.G, { allow404: true });
  const rFinal = acctSnapshot(await horizonAccount(R.publicKey()));
  result.after_t6 = {
    G: acctSnapshot(gFinal),
    R: rFinal,
  };
  log(`after T6: G exists=${gFinal !== null}; R num_sponsoring=${rFinal.num_sponsoring} xlm=${rFinal.xlm}`);

  result.outcome =
    gFinal === null && rFinal.num_sponsoring === 0 && gAfterT5.nido === '0.0000000'
      ? 'SUCCESS'
      : 'PARTIAL';
  result.finished = new Date().toISOString();
  const json = JSON.stringify(result, null, 2);
  writeFileSync(join(OUT_DIR, 'results.json'), json);
  console.log(json);
}

main().catch((e) => {
  log(`FATAL: ${e.stack ?? e}`);
  console.log(JSON.stringify({ experiment: 'D-nonxlm', outcome: 'FAILED', error: String(e?.message ?? e) }, null, 2));
  process.exit(1);
});
