import {
  rpc,
  TransactionBuilder,
  Account,
  Networks,
} from '@stellar/stellar-sdk';
import {
  loadCredential,
  buildAuthHash,
  getAuthEntry,
  injectPasskeySignature,
  parseAssertionResponse,
  hex2buf,
} from '@g2c/passkey-sdk';

const RPC_URL = 'https://soroban-testnet.stellar.org';

/**
 * Build, simulate, sign with the user's primary passkey via in-page WebAuthn,
 * and submit the given operation. The user MUST be on a page whose origin is
 * the account's subdomain (so `rpId` matches the registered credential).
 *
 * Returns the send-transaction response. Throws if no credential is found or
 * if WebAuthn is denied.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function signAndSubmit(args: {
  account: string;
  // Operation from passkey-sdk's TxBuild has a different nominal type than
  // stellar-sdk's Operation in this package context; use 'any' to bridge them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  operation: any;
  verifierAddress: string;
}): Promise<rpc.Api.SendTransactionResponse> {
  const cred = loadCredential(args.account);
  if (!cred) throw new Error('No passkey registered for this account.');

  const server = new rpc.Server(RPC_URL);

  // 1. Build & simulate the un-signed tx.
  const accountData = await server.getAccount(args.account);
  const source = new Account(accountData.accountId(), accountData.sequenceNumber());
  const sim_tx = new TransactionBuilder(source, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(args.operation)
    .setTimeout(0)
    .build();

  const sim = await server.simulateTransaction(sim_tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${(sim as rpc.Api.SimulateTransactionErrorResponse).error}`);
  }
  const successSim = sim as rpc.Api.SimulateTransactionSuccessResponse;

  // 2. Extract the auth entry and compute the hash the user must sign.
  const authEntry = getAuthEntry(successSim);
  const lastLedger = successSim.latestLedger;
  const authHash = buildAuthHash(authEntry, Networks.TESTNET, lastLedger);

  // 3. Assemble so auth entries are baked into the tx XDR before signing.
  const assembled_tx = rpc.assembleTransaction(sim_tx, successSim).build();

  // 4. Get a WebAuthn assertion over the hash.
  // authHash is a Node Buffer (Uint8Array<ArrayBufferLike>). Pass a plain
  // ArrayBuffer as the challenge since ArrayBuffer satisfies BufferSource.
  const challengeBuf = new ArrayBuffer(authHash.byteLength);
  new Uint8Array(challengeBuf).set(authHash);
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challengeBuf,
      rpId: window.location.hostname,
      allowCredentials: [{ id: cred.credentialId as unknown as Uint8Array<ArrayBuffer>, type: 'public-key' }],
      userVerification: 'required',
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error('Passkey signing was cancelled.');

  const response = assertion.response as AuthenticatorAssertionResponse;
  const parsed = parseAssertionResponse({
    authenticatorData: response.authenticatorData,
    clientDataJSON: response.clientDataJSON,
    signature: response.signature,
  });

  // 5. Inject the passkey signature into the assembled tx's auth entry.
  injectPasskeySignature(
    assembled_tx,
    parsed,
    args.verifierAddress,
    hex2buf(cred.publicKey),
    lastLedger,
  );

  // 6. Re-simulate with the signature baked in, assemble, and send.
  const final_sim = await server.simulateTransaction(assembled_tx);
  if (rpc.Api.isSimulationError(final_sim)) {
    throw new Error(`Final simulation failed: ${(final_sim as rpc.Api.SimulateTransactionErrorResponse).error}`);
  }
  const final_tx = rpc.assembleTransaction(assembled_tx, final_sim).build();
  return server.sendTransaction(final_tx);
}
