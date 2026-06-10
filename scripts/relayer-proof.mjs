#!/usr/bin/env node
/**
 * Testnet gas-abstraction proof (#72).
 *
 * Claim: a user account AUTHORIZES a Soroban contract call but pays NOTHING;
 * a fee-bump from non-user accounts (the OZ Relayer Channels plugin: channel
 * account as tx source, fund account as fee payer) sources and pays for it,
 * so the user's balance and sequence are untouched.
 *
 * What this script does:
 *   1. Creates a fresh ed25519 keypair ("the user") and funds it via
 *      friendbot — it must exist on-chain to authorize, but it never spends.
 *   2. Records the user's native balance and sequence via Horizon.
 *   3. Builds an invoke of the status-message demo contract and simulates it
 *      in recording mode against soroban-testnet RPC.
 *   4. Signs ONLY the resulting SorobanAuthorizationEntry with the user's key
 *      via stellar-sdk's authorizeEntry — exactly what the wallet does with a
 *      passkey.
 *   5. Ships {func, auth} to POST ${RELAYER}/relay and waits for "confirmed".
 *   6. Asserts on-chain: the landed envelope IS a fee-bump and neither the
 *      fee source nor the inner tx source is the user; AND — chain of
 *      custody — the landed inner tx carries THIS run's host function and
 *      signed auth entry byte-for-byte. The per-run random nonce inside the
 *      signed entry makes that an unforgeable link between the
 *      relayer-returned hash and this run's authorization.
 *   7. Asserts the user's balance and sequence are byte-identical to before.
 *
 * Usage:
 *   node scripts/relayer-proof.mjs [relayer-url]     # default https://nido.fly.dev
 *   node scripts/relayer-proof.mjs --self-test       # verify fee-bump extraction helper offline
 *   node scripts/relayer-proof.mjs --dry-run [url]   # stop after building the /relay request body
 *
 * Requires Node >= 18 (global fetch) and @stellar/stellar-sdk (workspace root).
 */

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  authorizeEntry,
  encodeMuxedAccountToAddress,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const RPC_URL = "https://soroban-testnet.stellar.org";
const FRIENDBOT_URL = "https://friendbot.stellar.org";
const DEFAULT_RELAYER_URL = "https://nido.fly.dev";
const EXPLORER_TX_URL = "https://stellar.expert/explorer/testnet/tx";

// Status Message demo contract (see DEPLOYED.md). Deployed from
// contracts/status-message in this repo, whose entry point is the historic
// typo `udpate_message(message: String, author: Address)` — that is the name
// the deployed contract actually exposes, so that is what we call.
const CONTRACT_ID = "CD5FK6CQ7QIZ5ONARG36Y53ERI5PIBGELSJUTD7OXYLK6EQAS4N3TFBV";
const CONTRACT_FN = "udpate_message";

/** Progress goes to stderr; stdout is reserved for the proof JSON + verdict. */
function log(...args) {
  console.error(...args);
}

function fail(message, details) {
  console.error(`PROOF FAILED: ${message}`);
  if (details !== undefined) {
    console.error(typeof details === "string" ? details : JSON.stringify(details, null, 2));
  }
  process.exit(1);
}

/** Decode an xdr.MuxedAccount into its address string (G... or M...) plus the
 *  underlying ed25519 base address, so comparisons against a plain G-key are
 *  robust even if the relayer uses muxed channel/fund accounts. */
function describeMuxed(muxed) {
  const address = encodeMuxedAccountToAddress(muxed);
  const baseAddress =
    muxed.switch() === xdr.CryptoKeyType.keyTypeMuxedEd25519()
      ? StrKey.encodeEd25519PublicKey(muxed.med25519().ed25519())
      : address;
  return { address, baseAddress };
}

/** Given a (round-tripped) xdr.TransactionEnvelope, assert it is a fee-bump
 *  envelope and return its fee source + inner tx source. */
function extractFeeBumpParties(envelope) {
  if (envelope.switch() !== xdr.EnvelopeType.envelopeTypeTxFeeBump()) {
    throw new Error(
      `expected a fee-bump envelope, got ${envelope.switch().name} — the relayer did not fee-bump this transaction`,
    );
  }
  const feeBumpTx = envelope.feeBump().tx();
  return {
    feeSource: describeMuxed(feeBumpTx.feeSource()),
    innerSource: describeMuxed(feeBumpTx.innerTx().v1().tx().sourceAccount()),
  };
}

/** Offline check that extractFeeBumpParties works against a real fee-bump
 *  envelope: build one in-memory with two throwaway keypairs, round-trip it
 *  through base64 XDR (exactly like an envelope fetched from RPC), and verify
 *  both parties come back out. */
function selfTest() {
  const innerKp = Keypair.random();
  const feeKp = Keypair.random();

  const innerTx = new TransactionBuilder(new Account(innerKp.publicKey(), "0"), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: "1" }))
    .setTimeout(300)
    .build();
  innerTx.sign(innerKp);

  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    feeKp.publicKey(),
    "200",
    innerTx,
    Networks.TESTNET,
  );
  const envelope = xdr.TransactionEnvelope.fromXDR(feeBump.toEnvelope().toXDR("base64"), "base64");

  const { feeSource, innerSource } = extractFeeBumpParties(envelope);
  if (feeSource.address !== feeKp.publicKey()) {
    fail(`self-test: feeSource ${feeSource.address} !== ${feeKp.publicKey()}`);
  }
  if (innerSource.address !== innerKp.publicKey()) {
    fail(`self-test: innerSource ${innerSource.address} !== ${innerKp.publicKey()}`);
  }
  // Also prove the negative path: a plain v1 envelope must be rejected with
  // the dedicated diagnostic, not some incidental accessor error.
  const v1Envelope = xdr.TransactionEnvelope.fromXDR(innerTx.toEnvelope().toXDR("base64"), "base64");
  try {
    extractFeeBumpParties(v1Envelope);
    fail("self-test: extractFeeBumpParties accepted a non-fee-bump envelope");
  } catch (err) {
    if (!String(err.message).includes("expected a fee-bump envelope")) {
      fail(`self-test: non-fee-bump envelope rejected with the wrong error: ${err.message}`);
    }
  }
  console.log("SELF-TEST OK: fee-bump extraction round-trips", {
    feeSource: feeSource.address,
    innerSource: innerSource.address,
  });
}

async function fetchAccountState(publicKey) {
  const resp = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
  if (!resp.ok) {
    throw new Error(`Horizon returned HTTP ${resp.status} for account ${publicKey}`);
  }
  const account = await resp.json();
  const native = (account.balances ?? []).find((b) => b.asset_type === "native");
  if (!native) throw new Error(`account ${publicKey} has no native balance entry`);
  return { balance: native.balance, sequence: account.sequence };
}

/** POST {params} to the relayer and unwrap the Channels-plugin envelope.
 *  Handles both documented nestings: {success, data: {...}} and
 *  {success, data: {result: {...}}}. */
async function relayerCall(relayerUrl, params) {
  let resp;
  try {
    resp = await fetch(`${relayerUrl}/relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params }),
    });
  } catch (err) {
    throw new Error(`could not reach relayer at ${relayerUrl}/relay: ${err.message}`);
  }
  let body;
  try {
    body = (await resp.json()) ?? {};
  } catch {
    throw new Error(`relayer returned non-JSON (HTTP ${resp.status})`);
  }
  if (body.success === false || (!resp.ok && body.error)) {
    const code = body.data && typeof body.data === "object" ? body.data.code : undefined;
    throw new Error(
      `relayer rejected the request${code ? ` [${code}]` : ""}: ${body.error ?? `HTTP ${resp.status}`}`,
    );
  }
  if (!resp.ok) throw new Error(`relayer HTTP ${resp.status}`);
  const payload = body.data && typeof body.data === "object" && body.data.result
    ? body.data.result
    : body.data;
  if (!payload || typeof payload !== "object") {
    throw new Error(`relayer returned an empty payload: ${JSON.stringify(body)}`);
  }
  return payload;
}

async function getTransactionWithRetry(server, hash, { attempts = 10, intervalMs = 2000 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    last = await server.getTransaction(hash);
    if (last.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return last;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    selfTest();
    return;
  }
  const dryRun = args.includes("--dry-run");
  const relayerUrl = (args.find((a) => !a.startsWith("--")) ?? DEFAULT_RELAYER_URL).replace(/\/+$/, "");

  log(`relayer:  ${relayerUrl}`);
  log(`contract: ${CONTRACT_ID} (${CONTRACT_FN})`);

  // 1. Fresh user keypair, funded via friendbot. The account must exist
  //    on-chain to authorize, but it never signs a transaction and never pays.
  const user = Keypair.random();
  log(`user:     ${user.publicKey()}`);
  const friendbot = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(user.publicKey())}`);
  if (!friendbot.ok) {
    fail(`friendbot funding failed (HTTP ${friendbot.status})`, await friendbot.text().catch(() => undefined));
  }
  log("friendbot: funded");

  // 2. Pre-call balance + sequence via Horizon.
  const { balance: userBalanceBefore, sequence: userSequenceBefore } = await fetchAccountState(
    user.publicKey(),
  );
  log(`balance before: ${userBalanceBefore} XLM (sequence ${userSequenceBefore})`);

  // 3. Build the invoke op and simulate in recording mode.
  //
  //    The sim source is a fabricated, never-funded account — NOT the user.
  //    Soroban preflight records auth required from the tx source account as
  //    sorobanCredentialsSourceAccount (verified empirically against testnet
  //    RPC), which authorizeEntry cannot sign and which would bind the
  //    authorization to the relayer's channel account once it becomes the
  //    real tx source. A foreign sim source makes the user's auth record as
  //    sorobanCredentialsAddress, the signable form the relayer flow needs.
  const message = `gas-abstraction proof ${new Date().toISOString()}`;
  const op = new Contract(CONTRACT_ID).call(
    CONTRACT_FN,
    nativeToScVal(message, { type: "string" }),
    new Address(user.publicKey()).toScVal(),
  );
  const server = new rpc.Server(RPC_URL);
  const simSource = new Account(Keypair.random().publicKey(), "0");
  const simTx = new TransactionBuilder(simSource, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(op)
    .setTimeout(300)
    .build();
  const sim = await server.simulateTransaction(simTx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    fail("simulation failed", sim.error);
  }
  const recordedAuth = sim.result?.auth ?? [];
  if (recordedAuth.length !== 1) {
    fail(`expected exactly 1 recorded auth entry, got ${recordedAuth.length}`);
  }
  const entry = recordedAuth[0];
  if (entry.credentials().switch() !== xdr.SorobanCredentialsType.sorobanCredentialsAddress()) {
    fail(`recorded auth entry has ${entry.credentials().switch().name} credentials, expected address credentials`);
  }
  const authorizer = Address.fromScAddress(entry.credentials().address().address()).toString();
  if (authorizer !== user.publicKey()) {
    fail(`recorded auth entry authorizes ${authorizer}, expected the user ${user.publicKey()}`);
  }
  log(`simulated: latestLedger=${sim.latestLedger}, 1 address-credentialed auth entry for the user`);

  // 4. The ONLY thing the user ever signs: the authorization entry. Its
  //    base64 XDR (random nonce + signature included) is kept for the
  //    chain-of-custody check against the landed transaction below.
  const signedEntry = await authorizeEntry(entry, user, sim.latestLedger + 600, Networks.TESTNET);
  const signedEntryXdr = signedEntry.toXDR("base64");

  // 5. {func, auth} — the exact shape the Channels plugin consumes.
  const func = simTx
    .toEnvelope()
    .v1()
    .tx()
    .operations()[0]
    .body()
    .invokeHostFunctionOp()
    .hostFunction()
    .toXDR("base64");
  const params = { func, auth: [signedEntryXdr], skipWait: false };

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, relayerUrl, body: { params } }, null, 2));
    console.log("DRY RUN: request body built; not submitted.");
    return;
  }

  log("submitting to relayer (skipWait=false)...");
  let payload;
  try {
    payload = await relayerCall(relayerUrl, params);
  } catch (err) {
    fail(err.message);
  }
  log(`relayer payload: ${JSON.stringify(payload)}`);

  // 6. The relayer must report a transaction hash on a non-failed status.
  //    skipWait=false normally yields "confirmed", but under congestion the
  //    plugin can still answer "submitted"/"sent" with a hash — the on-chain
  //    getTransaction SUCCESS check below is the arbiter either way.
  if (payload.status === "failed" || payload.status === "expired") {
    fail(`relayer reported status "${payload.status}"`, payload);
  }
  if (!["confirmed", "submitted", "sent"].includes(payload.status)) {
    fail(`relayer status is "${payload.status}", expected "confirmed" (or "submitted"/"sent" with a hash)`, payload);
  }
  const hash = payload.hash;
  if (!hash || typeof hash !== "string") {
    fail(`relayer reported "${payload.status}" but returned no transaction hash`, payload);
  }
  if (payload.status !== "confirmed") {
    log(`relayer status "${payload.status}" (not yet "confirmed") — deferring to on-chain verification`);
  }

  // 7. Independently verify on-chain success via RPC.
  const txResp = await getTransactionWithRetry(server, hash);
  if (!txResp || txResp.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    fail(`getTransaction(${hash}) status is ${txResp?.status}, expected SUCCESS`);
  }
  log(`on-chain: ${hash} SUCCESS (ledger ${txResp.ledger})`);

  // 8. Fee abstraction: the landed envelope must be a fee-bump, and neither
  //    the fee payer nor the inner tx source may be the user.
  let parties;
  try {
    parties = extractFeeBumpParties(txResp.envelopeXdr);
  } catch (err) {
    fail(err.message);
  }
  const { feeSource, innerSource } = parties;
  log(`fee source:   ${feeSource.address}`);
  log(`inner source: ${innerSource.address}`);
  if (feeSource.baseAddress === user.publicKey()) {
    fail(`fee source ${feeSource.address} is the user — the user paid the fee`);
  }
  if (innerSource.baseAddress === user.publicKey()) {
    fail(`inner tx source ${innerSource.address} is the user — the user sourced the transaction`);
  }

  // 9. Chain of custody: the landed inner tx must carry THIS run's host
  //    function and THIS run's signed auth entry byte-for-byte. The signed
  //    entry embeds a per-run random nonce and the user's signature over it,
  //    so a byte-equal match is an unforgeable link between the
  //    relayer-returned hash and the authorization produced above — the
  //    relayer cannot satisfy this with any prior transaction.
  const innerOps = txResp.envelopeXdr.feeBump().tx().innerTx().v1().tx().operations();
  if (innerOps.length !== 1) {
    fail(`landed inner tx has ${innerOps.length} operations, expected exactly 1`);
  }
  const innerBody = innerOps[0].body();
  if (innerBody.switch() !== xdr.OperationType.invokeHostFunction()) {
    fail(`landed inner op is ${innerBody.switch().name}, expected invokeHostFunction`);
  }
  const landedOp = innerBody.invokeHostFunctionOp();
  if (landedOp.hostFunction().toXDR("base64") !== func) {
    fail("landed host function does not byte-match the one this run submitted");
  }
  if (!landedOp.auth().some((a) => a.toXDR("base64") === signedEntryXdr)) {
    fail("landed inner tx does not contain this run's signed auth entry (byte-for-byte)");
  }
  log("chain of custody: landed inner tx carries this run's host function + signed auth entry");

  // 10. The user's balance and sequence must be byte-identical: not one
  //     stroop spent, not one transaction sourced.
  const { balance: userBalanceAfter, sequence: userSequenceAfter } = await fetchAccountState(
    user.publicKey(),
  );
  log(`balance after:  ${userBalanceAfter} XLM (sequence ${userSequenceAfter})`);
  if (userBalanceAfter !== userBalanceBefore) {
    fail(`user balance changed: ${userBalanceBefore} -> ${userBalanceAfter}`);
  }
  if (userSequenceAfter !== userSequenceBefore) {
    fail(`user sequence changed: ${userSequenceBefore} -> ${userSequenceAfter}`);
  }

  console.log(
    JSON.stringify(
      {
        hash,
        explorer: `${EXPLORER_TX_URL}/${hash}`,
        contract: CONTRACT_ID,
        function: CONTRACT_FN,
        message,
        user: user.publicKey(),
        feeBump: true,
        feeSource: feeSource.address,
        innerSource: innerSource.address,
        hostFunctionMatchedOnChain: true,
        authEntryMatchedOnChain: true,
        userBalanceBefore,
        userBalanceAfter,
        userSequenceBefore,
        userSequenceAfter,
        userPaidNothing: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PROOF OK: user authorized the call and paid nothing; a fee-bump from non-user accounts (the relayer's channel/fund) sourced and paid for it.",
  );
}

// Deliberate assertion failures call fail() directly with clean messages;
// anything that lands here is unexpected, so keep the stack for debugging.
main().catch((err) => fail(err.stack ?? err.message ?? String(err)));
