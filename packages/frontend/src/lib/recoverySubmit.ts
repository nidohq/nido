/**
 * Two submission strategies for recovery calls that are not the account's
 * own passkey-signed operations (those use `primaryPasskeySigner.ts`):
 *
 *   - `submitPermissionlessOp`: opening attempts, ZK evidence, baselines,
 *     and completions (the completion's auth entry selects the zero-signer
 *     recovery rule, so it carries no signature). A funded ephemeral G pays;
 *     simulation runs with any pre-filled auth entries, so the footprint
 *     includes the account's `__check_auth`.
 *   - `submitGuardianOp`: a `G…` guardian's approval. The guardian is both
 *     source and signer of a classic transaction signed through the
 *     `walletConnect.ts` session; a `require_auth` of a G-address is
 *     satisfied by the envelope signature.
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
