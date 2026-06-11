/**
 * Wallet-side signing for the stellar-wallets-kit ceremony at
 * `<account>.<base>/sign/`.
 *
 * Unlike `primaryPasskeySigner.signAndSubmit` (which BUILDS the tx and SUBMITS
 * it), the kit's `signTransaction` is handed a finished XDR by the dApp and
 * must return that XDR *with the wallet's signature attached* — submission is
 * the dApp's job (SEP-43 semantics). So these helpers take a tx XDR, attach a
 * primary-passkey signature, and return the new XDR.
 *
 * Two paths:
 *   - Soroban tx (single InvokeHostFunction op): we simulate to discover the
 *     smart account's auth entry, compute the OZ v0.7 auth digest, get a
 *     WebAuthn assertion over it, and inject the passkey signature into the
 *     auth entry. Returns the signed tx XDR.
 *   - Classic tx: a g2c smart account is a contract (C-address) and cannot be
 *     the source/signer of a classic Stellar operation, so there's nothing for
 *     the passkey to sign in the classic envelope. We surface a clear error
 *     rather than returning an unsigned tx that the dApp would think is signed.
 *     (Documented limitation; see issue #29 follow-ups.)
 */

import {
  rpc,
  TransactionBuilder,
  Networks,
  xdr,
  Transaction,
  FeeBumpTransaction,
  Operation,
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
import { assertDefaultRuleSinglePasskeySignable } from './defaultRuleSigning.js';

const RPC_URL = 'https://soroban-testnet.stellar.org';

/** Does this transaction carry exactly one InvokeHostFunction op (i.e. Soroban)? */
function isSorobanTx(tx: Transaction): boolean {
  return (
    tx.operations.length === 1 &&
    tx.operations[0].type === 'invokeHostFunction'
  );
}

/**
 * Sign a transaction XDR with the account's primary passkey and return the
 * signed XDR (NOT submitted).
 *
 * @param account   The smart-account C-address (must match the page subdomain
 *                  so WebAuthn's rpId matches the registered credential).
 * @param txXdr     base64 XDR of a `Transaction` or `FeeBumpTransaction`.
 * @param networkPassphrase  Network the tx is for.
 */
export async function signTransactionXdr(args: {
  account: string;
  txXdr: string;
  networkPassphrase?: string;
}): Promise<string> {
  const networkPassphrase = args.networkPassphrase ?? Networks.TESTNET;
  const cred = loadCredential(args.account);
  if (!cred) throw new Error('No passkey registered for this account.');
  await assertDefaultRuleSinglePasskeySignable(args.account);

  const parsed = TransactionBuilder.fromXDR(args.txXdr, networkPassphrase);
  if (parsed instanceof FeeBumpTransaction) {
    throw new Error('Fee-bump transactions are not supported by the g2c passkey signer.');
  }
  const tx = parsed as Transaction;

  if (!isSorobanTx(tx)) {
    throw new Error(
      'This transaction is not a Soroban contract invocation. A g2c smart ' +
        'account (a contract address) can only authorize Soroban operations, ' +
        'so there is nothing for the passkey to sign on a classic Stellar ' +
        'transaction.',
    );
  }

  const server = new rpc.Server(RPC_URL);
  const verifierAddress = await fetchVerifierAddress(args.account);

  // Strip any auth templates and simulate fresh in recording mode so the
  // simulator regenerates the smart account's auth entry — same reasoning as
  // primaryPasskeySigner.signAndSubmit (Void signatures trap recording-mode
  // __check_auth otherwise). Rebuild the tx from the host function with no
  // auth, using the SAME source/sequence/fee the dApp chose so the simulation
  // footprint matches what the dApp will submit.
  const op = tx.operations[0] as Operation.InvokeHostFunction;
  const sourceAccount = await server.getAccount(tx.source);
  const simTx = new TransactionBuilder(sourceAccount, {
    fee: tx.fee,
    networkPassphrase,
  })
    .addOperation(Operation.invokeHostFunction({ func: op.func, auth: [] }))
    .setTimeout(0)
    .build();

  const sim = await server.simulateTransaction(simTx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${(sim as rpc.Api.SimulateTransactionErrorResponse).error}`);
  }
  const successSim = sim as rpc.Api.SimulateTransactionSuccessResponse;

  const authEntry = getAuthEntry(successSim);
  const lastLedger = successSim.latestLedger;
  const signaturePayload = buildAuthHash(authEntry, networkPassphrase, lastLedger);
  const contextRuleIds = [0];
  const challengeBytes = computeAuthDigest(signaturePayload, contextRuleIds);

  const assembledTx = rpc.assembleTransaction(simTx, successSim).build();

  const challengeBuf = new ArrayBuffer(challengeBytes.byteLength);
  new Uint8Array(challengeBuf).set(challengeBytes);
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challengeBuf,
      rpId: window.location.hostname,
      allowCredentials: [
        { id: cred.credentialId as unknown as Uint8Array<ArrayBuffer>, type: 'public-key' },
      ],
      userVerification: 'required',
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error('Passkey signing was cancelled.');

  const response = assertion.response as AuthenticatorAssertionResponse;
  const parsedSig = parseAssertionResponse({
    authenticatorData: response.authenticatorData,
    clientDataJSON: response.clientDataJSON,
    signature: response.signature,
  });

  injectPasskeySignature(
    assembledTx,
    parsedSig,
    verifierAddress,
    hex2buf(cred.publicKey),
    lastLedger,
    undefined,
    contextRuleIds,
  );

  // Re-simulate in enforce mode to recompute the footprint that __check_auth
  // touches, then splice the fresh sorobanData in (see signAndSubmit notes).
  const finalSim = await server.simulateTransaction(assembledTx, undefined, 'enforce');
  if (rpc.Api.isSimulationError(finalSim)) {
    throw new Error(`Final simulation failed: ${(finalSim as rpc.Api.SimulateTransactionErrorResponse).error}`);
  }
  const successFinalSim = finalSim as rpc.Api.SimulateTransactionSuccessResponse;
  const newSorobanData = successFinalSim.transactionData.build();
  const newResourceFee = BigInt(newSorobanData.resourceFee().toString());
  const classicFee =
    BigInt(assembledTx.fee) -
    BigInt(
      (assembledTx.toEnvelope().v1().tx().ext().value() as xdr.SorobanTransactionData | undefined)
        ?.resourceFee()
        .toString() ?? '0',
    );
  const refitted = TransactionBuilder.cloneFrom(assembledTx, {
    fee: (classicFee + newResourceFee).toString(),
    sorobanData: newSorobanData,
    networkPassphrase,
  }).build();

  // Return the signed XDR. The smart account's auth entry now carries the
  // passkey signature; the dApp is responsible for adding a tx-source
  // signature (fee payer) and submitting.
  return refitted.toXDR();
}

/**
 * Run the primary-passkey WebAuthn ceremony over an arbitrary 32-byte
 * challenge and return the assertion components, base64url-JSON-encoded.
 *
 * Shared by message and auth-entry signing. Because a g2c smart account
 * verifies P-256/WebAuthn assertions (not Ed25519), the "signature" the wallet
 * produces is the full WebAuthn assertion (authenticatorData + clientData +
 * P-256 signature) plus the signer public key — not a bare 64-byte Stellar
 * signature. A relying contract feeds these to the webauthn-verifier.
 */
async function passkeyAssertEnvelope(account: string, challenge32: Uint8Array): Promise<string> {
  const cred = loadCredential(account);
  if (!cred) throw new Error('No passkey registered for this account.');
  if (challenge32.byteLength !== 32) throw new Error('challenge must be 32 bytes');

  const challengeBuf = new ArrayBuffer(32);
  new Uint8Array(challengeBuf).set(challenge32);
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challengeBuf,
      rpId: window.location.hostname,
      allowCredentials: [
        { id: cred.credentialId as unknown as Uint8Array<ArrayBuffer>, type: 'public-key' },
      ],
      userVerification: 'required',
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error('Passkey signing was cancelled.');

  const response = assertion.response as AuthenticatorAssertionResponse;
  const sig = parseAssertionResponse({
    authenticatorData: response.authenticatorData,
    clientDataJSON: response.clientDataJSON,
    signature: response.signature,
  });

  const envelope = {
    type: 'g2c-webauthn-assertion',
    publicKey: cred.publicKey,
    authenticatorData: bytesToHex(sig.authenticatorData),
    clientData: bytesToHex(sig.clientDataJson),
    signature: bytesToHex(sig.signature),
  };
  return base64urlJson(envelope);
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function base64urlJson(o: unknown): string {
  const json = JSON.stringify(o);
  // btoa over UTF-8-safe bytes, then URL-safe.
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Sign an arbitrary message string with the primary passkey. The message is
 * hashed (SHA-256) to a 32-byte challenge per common SEP-43 practice; returns
 * the base64url-JSON WebAuthn assertion envelope (see `passkeyAssertEnvelope`).
 */
export async function signMessageRaw(args: { account: string; message: string }): Promise<string> {
  const { hash } = await import('@stellar/stellar-sdk');
  const digest = new Uint8Array(hash(Buffer.from(args.message, 'utf-8')));
  return passkeyAssertEnvelope(args.account, digest);
}

/**
 * Sign a Soroban auth-entry preimage with the primary passkey. `authEntryXdr`
 * is the base64 XDR of a `HashIdPreimageSorobanAuthorization`; we SHA-256 it to
 * the signature payload, apply the OZ v0.7 auth digest (context rule `[0]`),
 * and produce the WebAuthn assertion envelope. The caller assembles the entry.
 */
export async function signAuthEntryXdr(args: { account: string; authEntryXdr: string }): Promise<string> {
  const { hash } = await import('@stellar/stellar-sdk');
  const preimage = xdr.HashIdPreimage.fromXDR(args.authEntryXdr, 'base64');
  const signaturePayload = new Uint8Array(hash(preimage.toXDR()));
  const digest = new Uint8Array(computeAuthDigest(signaturePayload, [0]));
  return passkeyAssertEnvelope(args.account, digest);
}
