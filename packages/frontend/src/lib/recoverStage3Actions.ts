/**
 * Frontend action layer for account recovery
 * (`contracts/recovery-controller`, `@nidohq/passkey-sdk`'s
 * `recoveryStage3` module). Sibling to `zkRecoveryActions.ts` (the M1/M2
 * flow, untouched) — this file is new, plain, and intentionally minimal:
 * two submission strategies covering every call shape the controller
 * exposes:
 *
 *   - `submitPermissionlessOp` — for `begin_attempt` / `submit_zk_proof` /
 *     `submit_zk_cancel` (no `require_auth` at all on-chain). Mirrors
 *     `zkRecoveryActions.ts::submitPermissionlessOp`'s classic
 *     (funded-ephemeral-G) submission path exactly — a funded fee-payer
 *     simulates, assembles, and submits; nothing is signed beyond the
 *     ordinary transaction envelope.
 *   - `submitGuardianOp` — for `submit_guardian_approval` /
 *     `submit_guardian_cancel` (`guardian.require_auth()`). The guardian is
 *     an arbitrary G/C address, not necessarily this page's own account, so
 *     this builds a CLASSIC transaction with the GUARDIAN as both source
 *     account and signer, and hands it to the already-wired
 *     `walletConnect.ts` `StellarWalletsKit` session (`signTransaction`) —
 *     the SAME kit `stellar-wallets-kit-module`'s `NidoModule` plugs into,
 *     so a guardian who is themselves a Nido smart account signs via the
 *     existing passkey redirect ceremony with NO new code here. A
 *     G-address `require_auth()` is satisfied by an ordinary classic
 *     transaction signature over the whole envelope — no separate
 *     Soroban auth-entry digest dance needed, unlike the smart-account
 *     passkey path in `primaryPasskeySigner.ts`.
 *
 * Enrollment (`enroll`, self-authed by the recovering account) and
 * completion (`apply_doc`, via the EXISTING `buildApplyDocTx`) both reuse
 * `primaryPasskeySigner.ts::signAndSubmit` unchanged — see the page's own
 * script for those call sites.
 */
import { rpc, TransactionBuilder, Transaction, xdr } from '@stellar/stellar-sdk';
import { RPC_URL, NETWORK_PASSPHRASE } from './network.js';
import { getSubmitter } from './primaryPasskeySigner.js';
import { signTransaction as walletSignTransaction } from './walletConnect.js';

/** Submit a PERMISSIONLESS operation (no on-chain `require_auth`) using a
 *  funded ephemeral G-address as fee-payer/source. Simulate → assemble →
 *  sign (submitter only) → send → poll. */
export async function submitPermissionlessOp(
  operation: xdr.Operation,
): Promise<{ hash: string; retval: xdr.ScVal | undefined }> {
  const server = new rpc.Server(RPC_URL);
  const submitter = await getSubmitter();
  const sourceAccount = await server.getAccount(submitter.publicKey());

  const opClone = xdr.Operation.fromXDR(operation.toXDR());
  const simTx = new TransactionBuilder(sourceAccount, {
    fee: '10000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(opClone)
    .setTimeout(0)
    .build();

  const sim = await server.simulateTransaction(simTx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${(sim as rpc.Api.SimulateTransactionErrorResponse).error}`);
  }
  const successSim = sim as rpc.Api.SimulateTransactionSuccessResponse;
  const retval = successSim.result?.retval;

  const assembled = rpc.assembleTransaction(simTx, successSim).build();
  assembled.sign(submitter);
  const sendResult = await server.sendTransaction(assembled);
  if (sendResult.status === 'ERROR') {
    throw new Error(`Submit rejected: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown'}`);
  }
  const hash = await pollUntilDone(server, sendResult.hash);
  return { hash, retval };
}

/** Submit a GUARDIAN-authed operation: a plain classic transaction sourced
 *  by `guardianAddress`, signed via the connected wallet kit
 *  (`walletConnect.ts`). Fee-payer is the SAME guardian account (simplest
 *  correct thing for an experimental page — the guardian's account must be
 *  funded on testnet). */
export async function submitGuardianOp(
  operation: xdr.Operation,
  guardianAddress: string,
): Promise<{ hash: string }> {
  const server = new rpc.Server(RPC_URL);
  const sourceAccount = await server.getAccount(guardianAddress);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: '1000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(xdr.Operation.fromXDR(operation.toXDR()))
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${(sim as rpc.Api.SimulateTransactionErrorResponse).error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim as rpc.Api.SimulateTransactionSuccessResponse).build();

  const { signedTxXdr, submitted } = await walletSignTransaction(assembled.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
    address: guardianAddress,
  });
  if (submitted) {
    // The Nido module relayer-submitted already; signedTxXdr is the tx hash.
    return { hash: signedTxXdr };
  }

  const signedTx = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE) as Transaction;
  const sendResult = await server.sendTransaction(signedTx);
  if (sendResult.status === 'ERROR') {
    throw new Error(`Submit rejected: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown'}`);
  }
  const hash = await pollUntilDone(server, sendResult.hash);
  return { hash };
}

async function pollUntilDone(server: rpc.Server, hash: string): Promise<string> {
  let getResult = await server.getTransaction(hash);
  for (let i = 0; getResult.status === 'NOT_FOUND' && i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    getResult = await server.getTransaction(hash);
  }
  if (getResult.status !== 'SUCCESS') {
    throw new Error(`Tx ${hash} ${getResult.status}`);
  }
  return hash;
}
