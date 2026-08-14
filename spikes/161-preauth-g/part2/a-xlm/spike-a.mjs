#!/usr/bin/env node
// EXPERIMENT A (#161 part two): production-shaped XLM flow end-to-end.
//
//   R = relayer (friendbot-funded)      W = watcher/spender stand-in (friendbot)
//   G = burner  (NOT friendbot — created with fully sponsored reserves, 0 XLM)
//
// Steps:
//   1. R sponsors creation of G with startingBalance 0 (Begin/Create/End sandwich).
//   2. Approve BEFORE funding: SAC approve(G, W, 9e18, ~maxEntryTtl) at seq n+1,
//      G balance 0, inner signed G, fee-bumped by R.
//   3. Factory create_account(salt, P-256 key) as R -> real C_dest.
//   4. T1 built with ZERO SIMULATION: SAC transfer(G -> C_dest, 25 XLM), seq n+3,
//      hand-built footprint/resources/auth. Never signed.
//   5. T2: classic AccountMerge(G -> R), seq n+4. Never signed.
//   6. S (config): seq n+2, sponsored preauth signers hash(T1)+hash(T2), master
//      weight -> 0 last. G's secret used for the last time, then DISCARDED.
//   7. Negative test: classic payment at seq n+3 signed with discarded secret.
//   8. R pays exactly 25 XLM to G.
//   9. T1 submitted with a ZERO-SIGNATURE inner envelope, fee-bumped by R.
//      (Bare submission is arithmetically impossible: G's fee charge would make
//      the exact-25 transfer underfunded and CAP-0028 would burn the signer.
//      Fee-bump = production shape; inner stays completely unsigned.)
//  10. Stray deposit: R pays 7 XLM to inert G.
//  11. W sweeps via transfer_from(W, G, W, 7 XLM) — allowance survives inertness.
//  12. T2: bare attempt first (expect submission-time rejection, G balance 0),
//      then fee-bumped by R. Expect merge SUCCESS -> G deleted, reserves back to R.
//
// Progress logs -> stderr; machine-readable JSON -> stdout.

import { writeFileSync } from 'node:fs';
import { randomBytes, createECDH } from 'node:crypto';
import {
  Account,
  Address,
  Asset,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
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
const FACTORY_ID = 'CBQKB6GYPO7P2CGDKN7KYLEFEBBN6FY5NXZJ7HNR43ZK2DDOU5N7NCV5';
const SAC_ID = Asset.native().contractId(NET); // CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
const MAX_ENTRY_TTL = 3_110_400; // testnet, verified live in recon 2026-08-06

const X_STROOPS = 250_000_000n;                  // 25 XLM main deposit
const STRAY_STROOPS = 70_000_000n;               // 7 XLM stray later deposit
const HUGE_ALLOWANCE = 9_000_000_000_000_000_000n; // 9e18 stroops

const OUT_DIR = new URL('.', import.meta.url).pathname;
const log = (...a) => console.error(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = new rpc.Server(RPC_URL);

const result = { experiment: 'A-xlm', network: 'testnet', steps: {}, tx: {}, balances: [] };

// ---------------------------------------------------------------- helpers ---

async function fundWithFriendbot(pubkey) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const resp = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(pubkey)}`);
    if (resp.ok) return;
    log(`friendbot HTTP ${resp.status} for ${pubkey}, attempt ${attempt}; backing off`);
    await sleep(4000 * attempt);
  }
  throw new Error(`friendbot funding failed for ${pubkey}`);
}

// allow404: return null instead of throwing when the account doesn't exist
async function horizonAccount(pubkey, { allow404 = false } = {}) {
  for (let attempt = 1; attempt <= 10; attempt++) {
    const resp = await fetch(`${HORIZON_URL}/accounts/${pubkey}`);
    if (resp.ok) return resp.json();
    if (resp.status === 404 && allow404) return null;
    await sleep(2000);
  }
  throw new Error(`horizon account fetch failed for ${pubkey}`);
}

function nativeBalance(acct) {
  if (!acct) return null;
  const b = (acct.balances ?? []).find((x) => x.asset_type === 'native');
  return b ? b.balance : null;
}

function txErrorName(sent) {
  try {
    return sent.errorResult?.result().switch().name ?? null;
  } catch {
    return null;
  }
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

async function submitAndPoll(tx, label) {
  const sent = await server.sendTransaction(tx);
  log(`${label} sent: ${sent.hash} status ${sent.status}`);
  if (sent.status === 'ERROR') {
    throw new Error(`${label} rejected at submission: ${txErrorName(sent)}`);
  }
  const res = await pollSuccess(sent.hash, label);
  log(`${label} SUCCESS in ledger ${res.ledger}`);
  return { sent, res };
}

function feeBumpWrap(R, innerTx, baseFee) {
  const fb = TransactionBuilder.buildFeeBumpTransaction(R.publicKey(), baseFee, innerTx, NET);
  fb.sign(R);
  return fb;
}

// SAC contract-holder Balance ledger key + live read of C's XLM balance
const sacBalanceKey = (holderC) =>
  xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(SAC_ID).toScAddress(),
      key: xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('Balance'),
        Address.fromString(holderC).toScVal(),
      ]),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );

async function sacBalanceOfContract(holderC) {
  const got = await server.getLedgerEntries(sacBalanceKey(holderC));
  if (!got.entries || got.entries.length === 0) return 0n;
  const val = got.entries[0].val.contractData().val();
  const native = scValToNative(val);
  return BigInt(native.amount);
}

async function snapshot(label, { rPub, wPub, gPub, cDest }) {
  await sleep(4000); // let horizon ingest
  const [r, w, g] = await Promise.all([
    horizonAccount(rPub),
    horizonAccount(wPub),
    horizonAccount(gPub, { allow404: true }),
  ]);
  const row = {
    label,
    R: nativeBalance(r),
    R_num_sponsoring: r?.num_sponsoring ?? null,
    W: nativeBalance(w),
    G: nativeBalance(g),
    G_num_sponsored: g?.num_sponsored ?? null,
    G_subentries: g?.subentry_count ?? null,
    G_exists: g !== null,
    C_dest_sac_stroops: cDest && cDest.startsWith('C') ? (await sacBalanceOfContract(cDest)).toString() : null,
  };
  result.balances.push(row);
  log(`[balances:${label}] ${JSON.stringify(row)}`);
  return row;
}

// ------------------------------------------------------------------- main ---

async function main() {
  // ---- keys ----
  const R = Keypair.random();
  const W = Keypair.random();
  let G = Keypair.random(); // `let` so the secret can be discarded (nulled) later
  const gPub = G.publicKey();
  result.accounts = { R: R.publicKey(), W: W.publicKey(), G: gPub };
  log(`R (relayer): ${R.publicKey()}`);
  log(`W (watcher): ${W.publicKey()}`);
  log(`G (burner):  ${gPub}`);

  log('funding R + W via friendbot (G is NOT friendbot-funded)...');
  await fundWithFriendbot(R.publicKey());
  await fundWithFriendbot(W.publicKey());

  // =========================================================================
  // STEP 1 — sponsored creation of G with startingBalance '0'
  // =========================================================================
  const rAcct1 = await server.getAccount(R.publicKey());
  const createTx = new TransactionBuilder(rAcct1, { fee: '200', networkPassphrase: NET })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: gPub })) // source = R (tx source)
    .addOperation(Operation.createAccount({ destination: gPub, startingBalance: '0' }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: gPub }))
    .setTimeout(300)
    .build();
  createTx.sign(R);
  createTx.sign(G); // checkSignatureNoAccount path: G signs its own End op pre-existence
  const create = await submitAndPoll(createTx, 'step1-sponsored-create');
  result.tx.create_g = create.sent.hash;
  result.steps.step1 = { hash: create.sent.hash, ledger: create.res.ledger };

  const gAcct = await server.getAccount(gPub);
  const n = BigInt(gAcct.sequenceNumber());
  log(`G starting sequence n = ${n}`);
  const snapAfterCreate = await snapshot('after-create', { rPub: R.publicKey(), wPub: W.publicKey(), gPub });
  if (snapAfterCreate.G !== '0.0000000') {
    throw new Error(`expected G own balance 0 after sponsored create, got ${snapAfterCreate.G}`);
  }
  result.steps.step1.g_balance = snapAfterCreate.G;
  result.steps.step1.g_num_sponsored = snapAfterCreate.G_num_sponsored;

  // =========================================================================
  // STEP 2 — APPROVE BEFORE FUNDING: SAC approve(G, W, 9e18, ~max TTL), seq n+1
  //          G balance is 0. Simulate/assemble, sign inner with live G, fee-bump R.
  // =========================================================================
  const latest = await server.getLatestLedger();
  const expirationLedger = latest.sequence + (MAX_ENTRY_TTL - 10_000);
  log(`approve expiration_ledger = ${expirationLedger} (current ${latest.sequence})`);
  const rawApprove = new TransactionBuilder(new Account(gPub, n.toString()), {
    fee: '200',
    networkPassphrase: NET,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: SAC_ID,
        function: 'approve',
        args: [
          nativeToScVal(gPub, { type: 'address' }),
          nativeToScVal(W.publicKey(), { type: 'address' }),
          nativeToScVal(HUGE_ALLOWANCE, { type: 'i128' }),
          nativeToScVal(expirationLedger, { type: 'u32' }),
        ],
      }),
    )
    .setTimeout(300)
    .build();
  const approveSim = await server.simulateTransaction(rawApprove);
  if (rpc.Api.isSimulationError(approveSim)) {
    throw new Error(`approve simulation failed: ${approveSim.error}`);
  }
  const approveAuth = approveSim.result?.auth ?? [];
  result.steps.step2 = {
    auth_credential_types: approveAuth.map((e) => e.credentials().switch().name),
    g_balance_at_approve: '0.0000000',
    expiration_ledger: expirationLedger,
  };
  log(`approve auth entries: ${JSON.stringify(result.steps.step2.auth_credential_types)}`);
  const approveTx = rpc.assembleTransaction(rawApprove, approveSim).build();
  approveTx.sign(G); // live master key, pre-discard
  const approveFb = feeBumpWrap(R, approveTx, String(approveTx.fee)); // rate >= inner rate
  const approve = await submitAndPoll(approveFb, 'step2-approve-feebump');
  result.tx.approve_outer = approve.sent.hash;
  result.tx.approve_inner = approveTx.hash().toString('hex');
  result.steps.step2.outer_hash = approve.sent.hash;
  result.steps.step2.inner_hash = result.tx.approve_inner;
  result.steps.step2.ledger = approve.res.ledger;
  result.steps.step2.succeeded_with_zero_balance_g = true;

  // =========================================================================
  // STEP 3 — factory create_account(salt, key) as R -> real C_dest
  // =========================================================================
  let cDest = null;
  for (let attempt = 1; attempt <= 2 && !cDest; attempt++) {
    try {
      const salt = randomBytes(32);
      const ecdh = createECDH('prime256v1');
      ecdh.generateKeys();
      const p256Key = ecdh.getPublicKey(null, 'uncompressed'); // 65 bytes, 0x04||X||Y
      if (p256Key.length !== 65 || p256Key[0] !== 0x04) throw new Error('bad P-256 key encoding');
      const rAcct = await server.getAccount(R.publicKey());
      const rawFactory = new TransactionBuilder(rAcct, { fee: '200', networkPassphrase: NET })
        .addOperation(
          Operation.invokeContractFunction({
            contract: FACTORY_ID,
            function: 'create_account',
            args: [xdr.ScVal.scvBytes(salt), xdr.ScVal.scvBytes(p256Key)],
          }),
        )
        .setTimeout(300)
        .build();
      const factorySim = await server.simulateTransaction(rawFactory);
      if (rpc.Api.isSimulationError(factorySim)) {
        throw new Error(`factory simulation failed: ${factorySim.error}`);
      }
      const factoryTx = rpc.assembleTransaction(rawFactory, factorySim).build();
      factoryTx.sign(R);
      const factory = await submitAndPoll(factoryTx, `step3-factory-create (attempt ${attempt})`);
      cDest = scValToNative(factory.res.returnValue);
      result.tx.factory_create = factory.sent.hash;
      result.steps.step3 = {
        hash: factory.sent.hash,
        ledger: factory.res.ledger,
        c_dest: cDest,
        salt_hex: salt.toString('hex'),
        p256_key_hex: p256Key.toString('hex'),
        fallback_to_w: false,
      };
    } catch (e) {
      log(`factory attempt ${attempt} failed: ${e.message}`);
      if (attempt === 2) {
        cDest = W.publicKey(); // classic fallback — SAY SO in findings
        result.steps.step3 = { fallback_to_w: true, c_dest: cDest, error: String(e.message) };
      }
    }
  }
  log(`C_dest = ${cDest}`);
  result.accounts.C_dest = cDest;

  // =========================================================================
  // STEP 4 — T1, built with ZERO SIMULATION (headline claim).
  //          SAC transfer(G -> C_dest, 25 XLM), source G, seq n+3.
  //          Hand-built footprint + overprovisioned resources + resourceFee,
  //          hand-built sourceAccount-credential auth entry.
  //          There is NO simulateTransaction call for T1 anywhere.
  // =========================================================================
  const accountKey = (g) =>
    xdr.LedgerKey.account(
      new xdr.LedgerKeyAccount({
        accountId: xdr.PublicKey.publicKeyTypeEd25519(Address.fromString(g).toBuffer()),
      }),
    );
  const sacInstanceKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(SAC_ID).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );

  const t1Args = [
    Address.fromString(gPub).toScVal(),
    Address.fromString(cDest).toScVal(),
    nativeToScVal(X_STROOPS, { type: 'i128' }),
  ];
  // Hand-built auth: sourceAccount credentials (G == tx source), rootInvocation
  // mirrors the op's contract/fn/args exactly.
  const t1AuthEntry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: Address.fromString(SAC_ID).toScAddress(),
          functionName: 'transfer',
          args: t1Args,
        }),
      ),
      subInvocations: [],
    }),
  });
  const t1ReadWrite = [accountKey(gPub)];
  t1ReadWrite.push(cDest.startsWith('G') ? accountKey(cDest) : sacBalanceKey(cDest));
  const T1_RESOURCE_FEE = 2_000_000; // 0.2 XLM ceiling; excess refunded (to outer fee source R)
  const t1SorobanData = new SorobanDataBuilder()
    .setFootprint([sacInstanceKey], t1ReadWrite)
    .setResources(4_000_000 /* cpuInstrs */, 50_000 /* diskReadBytes */, 5_000 /* writeBytes */)
    .setResourceFee(T1_RESOURCE_FEE)
    .build();
  const T1 = new TransactionBuilder(new Account(gPub, (n + 2n).toString()), {
    fee: String(200 + T1_RESOURCE_FEE), // total = inclusion + resourceFee (1 op)
    networkPassphrase: NET,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: SAC_ID,
        function: 'transfer',
        args: t1Args,
        auth: [t1AuthEntry],
      }),
    )
    .setSorobanData(t1SorobanData)
    .setTimeout(21600) // generous: frozen tx must stay valid for the whole run
    .build();
  const t1Hash = T1.hash();
  const t1FrozenXdr = T1.toEnvelope().toXDR('base64'); // frozen bytes — submit exactly these
  writeFileSync(`${OUT_DIR}t1-frozen.xdr`, t1FrozenXdr);
  result.steps.step4 = {
    t1_hash: t1Hash.toString('hex'),
    t1_seq: T1.sequence,
    t1_fee: T1.fee,
    zero_simulation: true,
    resources: { cpuInstrs: 4_000_000, diskReadBytes: 50_000, writeBytes: 5_000, resourceFee: T1_RESOURCE_FEE },
  };
  log(`T1 built OFFLINE: seq ${T1.sequence}, fee ${T1.fee}, hash ${result.steps.step4.t1_hash}`);

  // =========================================================================
  // STEP 5 — T2: classic AccountMerge(G -> R), seq n+4, unsigned
  // =========================================================================
  const T2 = new TransactionBuilder(new Account(gPub, (n + 3n).toString()), {
    fee: '200',
    networkPassphrase: NET,
  })
    .addOperation(Operation.accountMerge({ destination: R.publicKey() }))
    .setTimeout(21600)
    .build();
  const t2Hash = T2.hash();
  const t2FrozenXdr = T2.toEnvelope().toXDR('base64');
  writeFileSync(`${OUT_DIR}t2-frozen.xdr`, t2FrozenXdr);
  result.steps.step5 = { t2_hash: t2Hash.toString('hex'), t2_seq: T2.sequence, t2_fee: T2.fee };
  log(`T2 built: seq ${T2.sequence}, hash ${result.steps.step5.t2_hash}`);

  // =========================================================================
  // STEP 6 — S (config): seq n+2, sponsored preauth signers, master zeroing LAST.
  //          Signed G (live, LAST use) + R, fee-bumped by R.
  // =========================================================================
  const S = new TransactionBuilder(new Account(gPub, (n + 1n).toString()), {
    fee: '200',
    networkPassphrase: NET,
  })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: gPub, source: R.publicKey() }))
    .addOperation(Operation.setOptions({ signer: { preAuthTx: t1Hash, weight: 1 } }))
    .addOperation(Operation.setOptions({ signer: { preAuthTx: t2Hash, weight: 1 }, masterWeight: 0 }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: gPub }))
    .setTimeout(300)
    .build();
  S.sign(G); // tx source: SetOptions (high, thresholds still 0) + End
  S.sign(R); // Begin op source
  const sFb = feeBumpWrap(R, S, '2000');
  const sRes = await submitAndPoll(sFb, 'step6-config-feebump');
  result.tx.config_outer = sRes.sent.hash;
  result.tx.config_inner = S.hash().toString('hex');
  result.steps.step6 = { outer_hash: sRes.sent.hash, inner_hash: result.tx.config_inner, ledger: sRes.res.ledger };

  const gAfterS = await horizonAccount(gPub);
  result.steps.step6.signers_after_config = gAfterS.signers.map((s) => ({ type: s.type, key: s.key, weight: s.weight }));
  result.steps.step6.g_num_sponsored = gAfterS.num_sponsored;
  log(`G signers after S: ${JSON.stringify(result.steps.step6.signers_after_config)}`);

  // Pre-sign the negative-test tx with G's secret NOW (the secret is about to be
  // discarded; the negative test proves the discarded secret is inert on-chain).
  const negTx = new TransactionBuilder(new Account(gPub, (n + 2n).toString()), {
    fee: '200',
    networkPassphrase: NET,
  })
    .addOperation(Operation.payment({ destination: R.publicKey(), asset: Asset.native(), amount: '1' }))
    .setTimeout(300)
    .build();
  negTx.sign(G);

  // DISCARD G's secret. From here on, no code path can sign as G.
  G = null;
  result.steps.step6.g_secret_discarded = true;
  log('G secret DISCARDED (keypair variable nulled). G is now controlled only by the two preauth signers.');

  await snapshot('after-config', { rPub: R.publicKey(), wPub: W.publicKey(), gPub, cDest });

  // =========================================================================
  // STEP 7 — negative test: classic payment at seq n+3 signed with the
  //          (now discarded) master secret -> expect txBadAuth, seq NOT consumed
  // =========================================================================
  const negSent = await server.sendTransaction(negTx);
  result.steps.step7 = { status: negSent.status, error: txErrorName(negSent), hash: negSent.hash };
  log(`negative test: status=${negSent.status} error=${result.steps.step7.error}`);
  if (negSent.status !== 'ERROR') {
    const negRes = await server.pollTransaction(negSent.hash, { attempts: 15 });
    result.steps.step7.final_status = negRes.status;
    throw new Error(`negative test NOT rejected (status ${negSent.status}, final ${negRes.status})`);
  }
  const gAfterNeg = await horizonAccount(gPub);
  result.steps.step7.g_sequence_after = gAfterNeg.sequence;
  // G consumed n+1 (approve) and n+2 (config S); the rejected payment at n+3
  // must NOT move the sequence past n+2.
  result.steps.step7.sequence_consumed = BigInt(gAfterNeg.sequence) !== n + 2n;
  if (result.steps.step7.sequence_consumed) throw new Error('negative test consumed a sequence number!');
  log(`negative test rejected, G sequence still ${gAfterNeg.sequence} (n+2)`);

  // =========================================================================
  // STEP 8 — exchange sim: R pays exactly 25 XLM to G
  // =========================================================================
  const rAcct2 = await server.getAccount(R.publicKey());
  const payTx = new TransactionBuilder(rAcct2, { fee: '200', networkPassphrase: NET })
    .addOperation(Operation.payment({ destination: gPub, asset: Asset.native(), amount: '25' }))
    .setTimeout(300)
    .build();
  payTx.sign(R);
  const pay = await submitAndPoll(payTx, 'step8-deposit-25');
  result.tx.deposit_25 = pay.sent.hash;
  result.steps.step8 = { hash: pay.sent.hash, ledger: pay.res.ledger };
  const snapAfterDeposit = await snapshot('after-25-deposit', { rPub: R.publicKey(), wPub: W.publicKey(), gPub, cDest });
  result.steps.step8.g_balance = snapAfterDeposit.G;

  // =========================================================================
  // STEP 9 — submit T1: inner envelope has ZERO signatures, fee-bumped by R.
  //
  // AMENDMENT vs the plan's "submit bare": bare is arithmetically impossible
  // here. A bare T1 charges its fee to G BEFORE apply (processFeeSeqNum), so G
  // would hold 25 XLM - fee when the transfer of exactly 25 XLM executes ->
  // guaranteed apply-time failure -> CAP-0028 burns the preauth signer and
  // strands the deposit. The part-one spike already proved bare submission of
  // an unsigned preauth tx works when the source can cover the fee. Production
  // shape = fee-bump by R: inner stays 100% unsigned (the actual claim), G pays
  // nothing, C_dest gets exactly 25, G returns to exactly 0, refund goes to R.
  // =========================================================================
  const unsignedT1 = TransactionBuilder.fromXDR(t1FrozenXdr, NET);
  if (unsignedT1.signatures.length !== 0) throw new Error('T1 unexpectedly has signatures');
  log(`submitting T1 (inner signatures: ${unsignedT1.signatures.length}) fee-bumped by R`);
  const t1Fb = feeBumpWrap(R, unsignedT1, '2100000'); // >= inner fee rate 2,000,200
  const t1Sub = await submitAndPoll(t1Fb, 'step9-T1-feebump');
  result.tx.t1_outer = t1Sub.sent.hash;
  result.tx.t1_inner = result.steps.step4.t1_hash;
  const t1Env = t1Sub.res.envelopeXdr;
  const t1InnerSigs =
    t1Env.switch() === xdr.EnvelopeType.envelopeTypeTxFeeBump()
      ? t1Env.feeBump().tx().innerTx().v1().signatures().length
      : t1Env.v1().signatures().length;
  const snapAfterT1 = await snapshot('after-T1', { rPub: R.publicKey(), wPub: W.publicKey(), gPub, cDest });
  const gAfterT1 = await horizonAccount(gPub);
  result.steps.step9 = {
    submitted_as: 'fee-bump (bare is arithmetically impossible for an exact-amount sweep; see comment)',
    outer_hash: t1Sub.sent.hash,
    ledger: t1Sub.res.ledger,
    inner_signature_count_applied: t1InnerSigs,
    g_balance_after: snapAfterT1.G,
    c_dest_stroops_after: snapAfterT1.C_dest_sac_stroops,
    g_signers_after: gAfterT1.signers.map((s) => ({ type: s.type, key: s.key, weight: s.weight })),
  };
  if (t1InnerSigs !== 0) throw new Error('T1 inner had signatures at apply');
  if (snapAfterT1.G !== '0.0000000') {
    throw new Error(`expected G exactly 0 after T1, got ${snapAfterT1.G}`);
  }
  log(`T1 applied with 0 inner signatures; G back to ${snapAfterT1.G}; C_dest holds ${snapAfterT1.C_dest_sac_stroops} stroops`);

  // =========================================================================
  // STEP 10 — stray later deposit: R pays 7 XLM to inert G
  // =========================================================================
  const rAcct3 = await server.getAccount(R.publicKey());
  const strayTx = new TransactionBuilder(rAcct3, { fee: '200', networkPassphrase: NET })
    .addOperation(Operation.payment({ destination: gPub, asset: Asset.native(), amount: '7' }))
    .setTimeout(300)
    .build();
  strayTx.sign(R);
  const stray = await submitAndPoll(strayTx, 'step10-stray-7');
  result.tx.stray_7 = stray.sent.hash;
  result.steps.step10 = { hash: stray.sent.hash, ledger: stray.res.ledger };

  // =========================================================================
  // STEP 11 — allowance sweep post-inertness: W submits
  //           transfer_from(W, G, W, 7 XLM), normal simulate/assemble, signed W only
  // =========================================================================
  const wAcct = await server.getAccount(W.publicKey());
  const rawSweep = new TransactionBuilder(wAcct, { fee: '200', networkPassphrase: NET })
    .addOperation(
      Operation.invokeContractFunction({
        contract: SAC_ID,
        function: 'transfer_from',
        args: [
          nativeToScVal(W.publicKey(), { type: 'address' }), // spender
          nativeToScVal(gPub, { type: 'address' }),          // from
          nativeToScVal(W.publicKey(), { type: 'address' }), // to
          nativeToScVal(STRAY_STROOPS, { type: 'i128' }),
        ],
      }),
    )
    .setTimeout(300)
    .build();
  const sweepSim = await server.simulateTransaction(rawSweep);
  if (rpc.Api.isSimulationError(sweepSim)) {
    throw new Error(`transfer_from simulation failed (allowance dead post-inertness?): ${sweepSim.error}`);
  }
  const sweepAuth = sweepSim.result?.auth ?? [];
  const sweepTx = rpc.assembleTransaction(rawSweep, sweepSim).build();
  sweepTx.sign(W); // W only — G signs nothing (it can't)
  const sweep = await submitAndPoll(sweepTx, 'step11-transfer_from-sweep');
  result.tx.sweep_transfer_from = sweep.sent.hash;
  const snapAfterSweep = await snapshot('after-sweep', { rPub: R.publicKey(), wPub: W.publicKey(), gPub, cDest });
  result.steps.step11 = {
    hash: sweep.sent.hash,
    ledger: sweep.res.ledger,
    auth_credential_types: sweepAuth.map((e) => e.credentials().switch().name),
    g_balance_after: snapAfterSweep.G,
    allowance_survived_inertness: true,
  };
  log(`transfer_from swept 7 XLM; G balance ${snapAfterSweep.G}`);

  // =========================================================================
  // STEP 12 — fire T2. Bare attempt first (G balance 0 -> expect submission-time
  //           rejection, nothing consumed), then fee-bump by R.
  // =========================================================================
  const unsignedT2 = TransactionBuilder.fromXDR(t2FrozenXdr, NET);
  if (unsignedT2.signatures.length !== 0) throw new Error('T2 unexpectedly has signatures');
  const t2BareSent = await server.sendTransaction(unsignedT2);
  result.steps.step12 = {
    bare_attempt: { status: t2BareSent.status, error: txErrorName(t2BareSent), hash: t2BareSent.hash },
  };
  log(`T2 bare attempt: status=${t2BareSent.status} error=${result.steps.step12.bare_attempt.error}`);
  let t2Final;
  if (t2BareSent.status === 'ERROR') {
    // Expected: G holds 0 XLM and cannot cover even the inclusion fee.
    log('T2 bare rejected as expected (0-balance source); resubmitting as fee-bump by R');
    const t2Fb = feeBumpWrap(R, TransactionBuilder.fromXDR(t2FrozenXdr, NET), '1000');
    const t2Sub = await submitAndPoll(t2Fb, 'step12-T2-feebump');
    result.tx.t2_outer = t2Sub.sent.hash;
    result.steps.step12.feebump = { outer_hash: t2Sub.sent.hash, ledger: t2Sub.res.ledger };
    t2Final = t2Sub.res;
  } else {
    t2Final = await pollSuccess(t2BareSent.hash, 'step12-T2-bare');
    result.tx.t2_bare = t2BareSent.hash;
    result.steps.step12.bare_succeeded = true;
  }
  result.tx.t2_inner = result.steps.step5.t2_hash;

  const snapFinal = await snapshot('after-T2-merge', { rPub: R.publicKey(), wPub: W.publicKey(), gPub, cDest });
  result.steps.step12.merge_outcome = snapFinal.G_exists ? 'G STILL EXISTS' : 'SUCCESS - G deleted (horizon 404)';
  result.steps.step12.r_num_sponsoring_after = snapFinal.R_num_sponsoring;
  log(`merge outcome: ${result.steps.step12.merge_outcome}; R num_sponsoring=${snapFinal.R_num_sponsoring}`);

  // =========================================================================
  // STEP 13 — accounting
  // =========================================================================
  const rStart = Number(result.balances[0].R);
  const rEnd = Number(snapFinal.R);
  const outbound = 25 + 7; // 25 -> C_dest (user funds), 7 -> G -> swept to W
  const netCostXlm = rStart - rEnd;
  const feesOnlyXlm = netCostXlm - outbound;
  result.accounting = {
    r_start: rStart.toFixed(7),
    r_end: rEnd.toFixed(7),
    r_net_cost_xlm: netCostXlm.toFixed(7),
    of_which_transfers_out: outbound.toFixed(7),
    of_which_fees_xlm: feesOnlyXlm.toFixed(7),
    dust_stranded_in_g: snapFinal.G_exists ? snapFinal.G : '0 (account deleted)',
    w_end: snapFinal.W,
    c_dest_final_stroops: snapFinal.C_dest_sac_stroops,
  };
  result.outcome = 'SUCCESS';
  console.log(JSON.stringify(result, null, 2));
  writeFileSync(`${OUT_DIR}results.json`, JSON.stringify(result, null, 2));
}

main().catch((e) => {
  log(`FATAL: ${e.stack ?? e}`);
  result.outcome = 'FAILED';
  result.error = String(e?.message ?? e);
  console.log(JSON.stringify(result, null, 2));
  try {
    writeFileSync(`${OUT_DIR}results.json`, JSON.stringify(result, null, 2));
  } catch {}
  process.exit(1);
});
