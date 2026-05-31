import {
  rpc,
  TransactionBuilder,
  Networks,
  Keypair,
  xdr,
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
const FRIENDBOT_URL = 'https://friendbot.stellar.org';

/** localStorage key shared with `account/index.astro` so we don't
 *  proliferate ephemeral submitter accounts. */
const SUBMITTER_KEY = 'g2c:name-keypair';

/**
 * Get or mint an ephemeral G-address keypair used as the tx submitter
 * (fee payer + source). The contract being invoked (the smart account) is
 * unrelated — Soroban tx envelopes always need a regular Stellar source
 * account. We use the existing 'g2c:name-keypair' so we share the
 * submitter with the account-page's existing flow.
 *
 * The submitter has no privileges on the smart account; it only pays
 * fees. Auth is via the passkey on the auth entry, not the source.
 */
async function getSubmitter(): Promise<Keypair> {
  const stored = localStorage.getItem(SUBMITTER_KEY);
  if (stored) return Keypair.fromSecret(stored);
  const kp = Keypair.random();
  const resp = await fetch(`${FRIENDBOT_URL}?addr=${kp.publicKey()}`);
  if (!resp.ok) throw new Error(`Friendbot funding failed: ${resp.statusText}`);
  localStorage.setItem(SUBMITTER_KEY, kp.secret());
  return kp;
}

/**
 * Build, simulate, sign with the user's primary passkey via in-page WebAuthn,
 * and submit the given operation against the user's smart account.
 *
 * Requirements:
 *  - The page origin matches the account's subdomain so WebAuthn's `rpId`
 *    matches the registered credential.
 *  - A `g2c:name-keypair` ephemeral G-address exists or can be minted via
 *    friendbot (handled internally).
 *
 * Returns the send-transaction response. Throws if no passkey is found or
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

  // 1. Get the ephemeral submitter G-address; load its current sequence.
  //    This is the tx source/fee-payer, NOT the smart account itself.
  const submitter = await getSubmitter();
  const sourceAccount = await server.getAccount(submitter.publicKey());

  // 2. Build & simulate the un-signed tx.
  //
  // CRUCIAL: strip any existing auth entries off the operation before
  // simulating. `args.operation` is an `xdr.Operation` carrying the
  // unsigned auth-entry templates that the contract bindings'
  // AssembledTransaction.simulate left on the built tx (Void signature,
  // SorobanAddressCredentials placeholder). If we hand those back to
  // simulateTransaction in recording mode, the simulator runs
  // __check_auth(payload, Void, contexts) against the smart account —
  // and the OZ contract can't deserialize Void as AuthPayload, traps
  // with UnreachableCodeReached, simulate returns Auth/InvalidAction,
  // and we throw BEFORE the WebAuthn prompt.
  //
  // Mirror what AssembledTransaction.simulate does internally: build
  // from an op with no auth entries so the simulator generates them
  // fresh in recording mode. Clone the XDR op so we don't mutate the
  // caller's operation.
  const opClone = xdr.Operation.fromXDR(args.operation.toXDR());
  opClone.body().invokeHostFunctionOp().auth([]);
  const sim_tx = new TransactionBuilder(sourceAccount, {
    fee: '10000000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(opClone)
    .setTimeout(0)
    .build();

  const sim = await server.simulateTransaction(sim_tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${(sim as rpc.Api.SimulateTransactionErrorResponse).error}`);
  }
  const successSim = sim as rpc.Api.SimulateTransactionSuccessResponse;

  // 3. Extract the auth entry and compute the hash the user must sign.
  const authEntry = getAuthEntry(successSim);
  const lastLedger = successSim.latestLedger;
  const authHash = buildAuthHash(authEntry, Networks.TESTNET, lastLedger);

  // 4. Assemble so auth entries are baked into the tx XDR before signing.
  const assembled_tx = rpc.assembleTransaction(sim_tx, successSim).build();

  // 5. Get a WebAuthn assertion over the auth hash.
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

  // 6. Inject the passkey signature into the assembled tx's auth entry.
  injectPasskeySignature(
    assembled_tx,
    parsed,
    args.verifierAddress,
    hex2buf(cred.publicKey),
    lastLedger,
  );

  // 7. Re-simulate the now-signed tx in ENFORCE mode as a sanity check —
  //    surfaces auth failures (bad signature, expired ledger, wrong rule)
  //    BEFORE submit. simulateTransaction defaults to "record" mode,
  //    which IGNORES provided auth entries and just records what auth
  //    would be required; under that mode __check_auth runs against an
  //    empty signatures payload (`signatures: Void`) and traps even for
  //    a correctly signed tx. "enforce" makes the simulator actually
  //    verify the auth we supply.
  //
  //    Crucially, also do NOT call `rpc.assembleTransaction(...)` after
  //    injection — it rebuilds the auth entries from the sim result's
  //    unsigned templates and silently discards our signature. The
  //    initial assemble in step 4 already baked in resource fees from
  //    the first simulation, which sized them for the expected signed
  //    payload.
  const final_sim = await server.simulateTransaction(assembled_tx, undefined, 'enforce');
  if (rpc.Api.isSimulationError(final_sim)) {
    throw new Error(`Final simulation failed: ${(final_sim as rpc.Api.SimulateTransactionErrorResponse).error}`);
  }
  assembled_tx.sign(submitter);
  return server.sendTransaction(assembled_tx);
}
