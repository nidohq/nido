/**
 * Local-submitter mode (./localSubmitterGate): what the relayer does for the
 * wallet, done in the browser. The submitter is primaryPasskeySigner's
 * friendbot-funded G keypair, stored in this origin's localStorage only.
 */
import { Operation, TransactionBuilder, rpc, type Keypair, type Transaction } from "@stellar/stellar-sdk";
import { getSubmitter } from "./primaryPasskeySigner";
import { classicSubmitAndPoll } from "./signing/submit";
import { LOCAL_SUBMITTER, RELAYER_SIM_SOURCE, NETWORK_PASSPHRASE, RPC_URL } from "./network";

const FRIENDBOT_URL = "https://friendbot.stellar.org";

let submitter: Promise<Keypair> | null = null;

/** This browser's submitter, minted and friendbot-funded once per page even
 *  when several steps ask for it at the same time. */
export function localSubmitter(): Promise<Keypair> {
  submitter ??= getSubmitter().catch((err) => {
    submitter = null;
    throw err;
  });
  return submitter;
}

/** The existing account a simulation names as its source: this browser's
 *  submitter in local-submitter mode, else the relayer's fund address
 *  (empty when no relayer is configured). */
export async function simulationSource(): Promise<string> {
  return LOCAL_SUBMITTER ? (await localSubmitter()).publicKey() : RELAYER_SIM_SOURCE;
}

/** Submit `tx`'s host function and auth entries with this browser's
 *  submitter as source and fee payer, straight to RPC, and wait for it to
 *  land. Returns the transaction hash. */
export async function submitLocally(tx: Transaction, server = new rpc.Server(RPC_URL)): Promise<string> {
  const op = tx.toEnvelope().v1().tx().operations()[0].body().invokeHostFunctionOp();
  const key = await localSubmitter();
  const local = new TransactionBuilder(await server.getAccount(key.publicKey()), {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.invokeHostFunction({ func: op.hostFunction(), auth: op.auth() }))
    .setTimeout(0)
    .build();
  return (await classicSubmitAndPoll(local, key, server)).hash;
}

/** Fund `destination` (a G or C address) from testnet friendbot. Returns
 *  the funding transaction's hash. */
export async function fundWithFriendbot(destination: string): Promise<string> {
  const resp = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(destination)}`);
  const body = await resp.json().catch(() => null);
  if (!resp.ok || typeof body?.hash !== "string") {
    throw new Error(`Friendbot funding failed: ${body?.detail || body?.title || `HTTP ${resp.status}`}`);
  }
  return body.hash;
}
