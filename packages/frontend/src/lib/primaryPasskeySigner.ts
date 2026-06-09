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
  computeAuthDigest,
  getAuthEntry,
  injectPasskeySignature,
  parseAssertionResponse,
  hex2buf,
} from '@g2c/passkey-sdk';
import { fetchVerifierAddress } from './policyChainFetch.js';
import {
  relayerEnabled,
  extractFuncAndAuth,
  submitSorobanTransaction,
  waitForConfirmation,
} from './relayerClient';
import { RELAYER_SIM_SOURCE } from './network';

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
export async function getSubmitter(): Promise<Keypair> {
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
  /** Optional: skip the on-chain probe by passing a verifier address you've
   *  already fetched. Otherwise we'll read it from the account's default
   *  rule. */
  verifierAddress?: string;
}): Promise<rpc.Api.SendTransactionResponse> {
  const cred = loadCredential(args.account);
  if (!cred) throw new Error('No passkey registered for this account.');

  const server = new rpc.Server(RPC_URL);

  const finalVerifierAddress =
    args.verifierAddress ?? (await fetchVerifierAddress(args.account));

  // 1. Pick the simulation source account. This is the tx source/fee-payer,
  //    NOT the smart account itself.
  //
  //    Relayer mode: no ephemeral G is created or funded — recording-mode
  //    simulation just needs SOME existing on-chain source account, so we use
  //    the relayer's (public) fund address. It never signs and never pays here.
  //    Classic mode: friendbot-funded ephemeral G as before.
  const submitter = relayerEnabled() ? null : await getSubmitter();
  const sourceAccount = submitter
    ? await server.getAccount(submitter.publicKey())
    : await server.getAccount(RELAYER_SIM_SOURCE);

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

  // 3. Extract the auth entry and compute the OZ v0.7 auth digest:
  //
  //    auth_digest = sha256(signature_payload || context_rule_ids.to_xdr())
  //
  //    The same `contextRuleIds` array passed here MUST be the one passed
  //    to `injectPasskeySignature` so the AuthPayload's `context_rule_ids`
  //    and the digest the contract recomputes both refer to the same rule.
  const authEntry = getAuthEntry(successSim);
  const lastLedger = successSim.latestLedger;
  const signaturePayload = buildAuthHash(authEntry, Networks.TESTNET, lastLedger);
  const contextRuleIds = [0];
  const challengeBytes = computeAuthDigest(signaturePayload, contextRuleIds);

  // 4. Assemble so auth entries are baked into the tx XDR before signing.
  const assembled_tx = rpc.assembleTransaction(sim_tx, successSim).build();

  // 5. Get a WebAuthn assertion over the challenge.
  const challengeBuf = new ArrayBuffer(challengeBytes.byteLength);
  new Uint8Array(challengeBuf).set(challengeBytes);
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
    finalVerifierAddress,
    hex2buf(cred.publicKey),
    lastLedger,
    undefined,
    contextRuleIds,
  );

  if (relayerEnabled()) {
    // The Channels plugin re-simulates server-side in enforce mode, builds
    // the footprint itself, and a channel account becomes the tx source with
    // the fund account fee-bumping — the enforce re-sim + fee refit + G
    // signature + RPC submission below are all its job now. We ship only the
    // host function and the passkey-signed auth entry.
    const { func, auth } = extractFuncAndAuth(assembled_tx);
    const submitted = await submitSorobanTransaction({ func, auth });
    if (!submitted.transactionId) {
      throw new Error('Relayer accepted the transaction but returned no transaction id');
    }
    const confirmed = await waitForConfirmation(submitted.transactionId);
    if (!confirmed.hash) throw new Error('Relayer confirmed without a transaction hash');
    return {
      status: 'PENDING',
      hash: confirmed.hash,
      latestLedger: 0,
      latestLedgerCloseTime: 0,
    } as unknown as rpc.Api.SendTransactionResponse;
  }

  // 7. Re-simulate the now-signed tx in ENFORCE mode — both to verify
  //    the auth (surfaces bad sig / wrong rule before submit) AND to
  //    recompute the resource footprint to cover __check_auth's reads.
  //
  //    The initial assemble in step 4 sized resources based on a
  //    simulation we ran with auth=[] (had to, otherwise the unsigned
  //    auth templates would trap recording-mode __check_auth against
  //    `signatures: Void`). That footprint covers the operation but
  //    NOT the storage keys __check_auth touches when actually
  //    verifying signers — so submit would later trap with
  //    "trying to access contract data key outside of the footprint"
  //    (scecExceededLimit on ContextRuleData), even though everything
  //    else was correct.
  //
  //    `simulateTransaction` defaults to "record" mode which ignores
  //    provided auth entries entirely. Passing "enforce" makes it run
  //    __check_auth against our injected signature, producing both a
  //    pass/fail signal AND a fresh `transactionData` (sorobanData)
  //    with the correct read-write footprint and resource fees.
  //
  //    Splice that fresh sorobanData into the existing assembled tx
  //    via TransactionBuilder.cloneFrom — do NOT call
  //    `rpc.assembleTransaction` to do it: that function rebuilds the
  //    auth entries from the sim result's UNSIGNED templates and
  //    silently discards our signature.
  const final_sim = await server.simulateTransaction(assembled_tx, undefined, 'enforce');
  if (rpc.Api.isSimulationError(final_sim)) {
    throw new Error(`Final simulation failed: ${(final_sim as rpc.Api.SimulateTransactionErrorResponse).error}`);
  }
  const successFinalSim = final_sim as rpc.Api.SimulateTransactionSuccessResponse;
  const newSorobanData = successFinalSim.transactionData.build();
  const newResourceFee = BigInt(newSorobanData.resourceFee().toString());
  const classicFee = BigInt(assembled_tx.fee) - BigInt(
    // Walk the previous sorobanData's resourceFee out of the envelope.
    (assembled_tx.toEnvelope().v1().tx().ext().value() as xdr.SorobanTransactionData | undefined)
      ?.resourceFee().toString() ?? '0',
  );
  const refittedBuilder = TransactionBuilder.cloneFrom(assembled_tx, {
    fee: (classicFee + newResourceFee).toString(),
    sorobanData: newSorobanData,
    networkPassphrase: Networks.TESTNET,
  });
  // cloneFrom carries operations across as-is (including the signed
  // auth entries on our InvokeHostFunction op). build() emits a new
  // Transaction with the right footprint AND our signature intact.
  const refitted_tx = refittedBuilder.build();
  if (!submitter) throw new Error('unreachable: classic path without submitter');
  refitted_tx.sign(submitter);
  // 8. Submit and wait for chain confirmation. A successful enforce-mode
  //    sim isn't proof the tx lands — fee-bid races, ledger close failures,
  //    or out-of-band footprint errors can still drop a tx. Returning the
  //    PENDING SendTransactionResponse without polling let callers happily
  //    say "Done" while the rule we just paid to install never persisted
  //    (rediscovered when the dApp then tried to use it and __check_auth
  //    failed because no such rule was on-chain).
  const sendResult = await server.sendTransaction(refitted_tx);
  if (sendResult.status === 'ERROR') {
    const detail = sendResult.errorResult?.toXDR('base64') ?? 'unknown';
    throw new Error(`Submit rejected: ${detail}`);
  }
  if (sendResult.status === 'DUPLICATE' || sendResult.status === 'TRY_AGAIN_LATER') {
    throw new Error(`Submit ${sendResult.status}: ${sendResult.hash}`);
  }
  // PENDING — poll until we see SUCCESS or FAILED.
  let getResult = await server.getTransaction(sendResult.hash);
  for (let i = 0; getResult.status === 'NOT_FOUND' && i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    getResult = await server.getTransaction(sendResult.hash);
  }
  if (getResult.status !== 'SUCCESS') {
    throw new Error(`Tx ${sendResult.hash} ${getResult.status}`);
  }
  return sendResult;
}
