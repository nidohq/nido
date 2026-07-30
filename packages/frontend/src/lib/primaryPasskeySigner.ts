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
  injectSignedAuthPayload,
  encodeMlDsaSigData,
  parseAssertionResponse,
  hex2buf,
  buf2hex,
} from '@nidohq/passkey-sdk';
import { resolveSignerRule } from './policyChainFetch.js';
import { loadBackstopKey, signDigest, type BackstopKey } from './mlDsaBackstop.js';
import {
  relayerEnabled,
} from './relayerClient';
import { RELAYER_SIM_SOURCE, RELAYER_EXPIRATION_OFFSET } from './network';
import { relayerSubmitAndConfirm, classicSubmitAndPoll } from './signing/submit';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';

// RELAYER_EXPIRATION_OFFSET (relayer-mode auth-entry validity window) now lives
// in ./network so every relayer-submitting signing path (here + walletSign)
// shares one bound. See the comment there for the security rationale.

/** localStorage key shared with `account/index.astro` so we don't
 *  proliferate ephemeral submitter accounts. */
const SUBMITTER_KEY = 'nido:name-keypair';

/**
 * Get or mint an ephemeral G-address keypair used as the tx submitter
 * (fee payer + source). The contract being invoked (the smart account) is
 * unrelated — Soroban tx envelopes always need a regular Stellar source
 * account. We use the existing Nido submitter storage key so we share the
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

/** Everything a signer needs after recording-mode simulation, before the
 *  actual signature is produced. Shared by the passkey flow below and the
 *  ML-DSA backstop flow (`mlDsaSign.ts`). */
export interface SimulatedForSigning {
  server: rpc.Server;
  /** Classic-mode ephemeral submitter; null in relayer mode. */
  submitter: Keypair | null;
  simTx: ReturnType<TransactionBuilder['build']>;
  successSim: rpc.Api.SimulateTransactionSuccessResponse;
  authEntry: ReturnType<typeof getAuthEntry>;
  lastLedger: number;
  /** Pass this SAME value to buildAuthHash and the inject helper. */
  expirationOffset: number | undefined;
  /** Auth entries baked in, ready for signature injection. */
  assembledTx: ReturnType<ReturnType<typeof rpc.assembleTransaction>['build']>;
}

/**
 * Source-selection + auth-strip + recording-mode simulate + assemble — the
 * signer-agnostic front half of a signing flow. See inline comments for why
 * auth entries MUST be stripped before simulating.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function simulateForSigning(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  operation: any,
  onProgress?: (p: { phase: 'build' | 'sign' | 'submit' | 'confirm'; detail?: string }) => void,
): Promise<SimulatedForSigning> {
  const server = new rpc.Server(RPC_URL);

  // 1. Pick the simulation source account. This is the tx source/fee-payer,
  //    NOT the smart account itself.
  //
  //    Relayer mode: no ephemeral G is created or funded — recording-mode
  //    simulation just needs SOME existing on-chain source account, so we use
  //    the relayer's (public) fund address. It never signs and never pays here.
  //    Classic mode: friendbot-funded ephemeral G as before.
  const submitter = relayerEnabled() ? null : await getSubmitter();
  if (relayerEnabled() && !RELAYER_SIM_SOURCE) {
    throw new Error('Relayer misconfigured: PUBLIC_RELAYER_URL is set but PUBLIC_RELAYER_SIM_SOURCE is not.');
  }
  const sourceAccount = submitter
    ? await server.getAccount(submitter.publicKey())
    : await server.getAccount(RELAYER_SIM_SOURCE);

  // 2. Build & simulate the un-signed tx.
  //
  // CRUCIAL: strip any existing auth entries off the operation before
  // simulating. The operation is an `xdr.Operation` carrying the
  // unsigned auth-entry templates that the contract bindings'
  // AssembledTransaction.simulate left on the built tx (Void signature,
  // SorobanAddressCredentials placeholder). If we hand those back to
  // simulateTransaction in recording mode, the simulator runs
  // __check_auth(payload, Void, contexts) against the smart account —
  // and the OZ contract can't deserialize Void as AuthPayload, traps
  // with UnreachableCodeReached, simulate returns Auth/InvalidAction,
  // and we throw BEFORE the signature ceremony.
  //
  // Mirror what AssembledTransaction.simulate does internally: build
  // from an op with no auth entries so the simulator generates them
  // fresh in recording mode. Clone the XDR op so we don't mutate the
  // caller's operation.
  onProgress?.({ phase: 'build' });
  const opClone = xdr.Operation.fromXDR(operation.toXDR());
  opClone.body().invokeHostFunctionOp().auth([]);
  const simTx = new TransactionBuilder(sourceAccount, {
    fee: '10000000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(opClone)
    .setTimeout(0)
    .build();

  const sim = await server.simulateTransaction(simTx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${(sim as rpc.Api.SimulateTransactionErrorResponse).error}`);
  }
  const successSim = sim as rpc.Api.SimulateTransactionSuccessResponse;

  const authEntry = getAuthEntry(successSim);
  const lastLedger = successSim.latestLedger;
  const expirationOffset = relayerEnabled() ? RELAYER_EXPIRATION_OFFSET : undefined;

  // Assemble so auth entries are baked into the tx XDR before signing.
  const assembledTx = rpc.assembleTransaction(simTx, successSim).build();

  return { server, submitter, simTx, successSim, authEntry, lastLedger, expirationOffset, assembledTx };
}

/**
 * Submit a signature-injected assembled tx — relayer or classic path — and
 * synthesize the response shape. The signer-agnostic back half of a signing
 * flow.
 */
export async function submitSigned(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assembledTx: any,
  submitter: Keypair | null,
  server: rpc.Server,
  authHashHex: string,
  onProgress?: (p: { phase: 'build' | 'sign' | 'submit' | 'confirm'; detail?: string }) => void,
): Promise<rpc.Api.SendTransactionResponse & { authHashHex: string }> {
  onProgress?.({ phase: 'submit' });
  if (relayerEnabled()) {
    // The Channels plugin re-simulates server-side in enforce mode, builds
    // the footprint itself, and a channel account becomes the tx source with
    // the fund account fee-bumping — the enforce re-sim + fee refit + G
    // signature + RPC submission below are all its job now. We ship only the
    // host function and the signed auth entry.
    onProgress?.({ phase: 'confirm' });
    const { hash } = await relayerSubmitAndConfirm(assembledTx);
    // Only `hash` is real (the transfer page links it to the explorer) —
    // latestLedger/latestLedgerCloseTime are placeholder zeros and the tx is
    // already confirmed ('PENDING' kept for shape compatibility).
    return {
      status: 'PENDING',
      hash,
      latestLedger: 0,
      latestLedgerCloseTime: 0,
      authHashHex,
    };
  }

  // Re-simulate + fee refit + sign + submit + poll (classic path).
  // See classicSubmitAndPoll for full commentary on why enforce re-sim
  // is required and why cloneFrom is used instead of assembleTransaction.
  if (!submitter) throw new Error('unreachable: classic path without submitter');
  onProgress?.({ phase: 'confirm' });
  const classicResult = await classicSubmitAndPoll(assembledTx, submitter, server);
  return { ...classicResult, authHashHex };
}

/**
 * Build, simulate, sign with the user's primary passkey via in-page WebAuthn,
 * and submit the given operation against the user's smart account.
 *
 * Requirements:
 *  - The page origin matches the account's subdomain so WebAuthn's `rpId`
 *    matches the registered credential.
 *  - Classic mode only: the persisted ephemeral G-address submitter exists or
 *    can be minted via friendbot (handled internally). In relayer mode
 *    (PUBLIC_RELAYER_URL set) no ephemeral keypair is created — the relayer
 *    submits and the response is synthesized from its confirmation.
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
  /** Optional progress callback fired at each phase of the signing flow. */
  onProgress?: (p: { phase: "build" | "sign" | "submit" | "confirm"; detail?: string }) => void;
}): Promise<rpc.Api.SendTransactionResponse & { authHashHex: string }> {
  const cred = loadCredential(args.account);
  if (!cred) throw new Error('No passkey registered for this account.');

  const server = new rpc.Server(RPC_URL);

  // Resolve — in ONE gap-tolerant scan — which context rule THIS device's
  // passkey lives under AND the verifier that rule's signer is registered
  // against. A ZK-recovered account installs the new passkey as a brand-new
  // Default rule (id != 0) while rule 0 keeps the OLD, now-unusable key; signing
  // must target the resolved rule (else do_check_auth rejects with Error(Auth,
  // InvalidAction)) and use that rule's verifier. Returns rule 0 for a fresh
  // (non-recovered) account, so this generalizes both. See resolveSignerRule.
  const resolved = await resolveSignerRule(args.account, cred.publicKey);
  if (!resolved) {
    throw new Error(
      'This passkey is not registered on any authorization rule of the account. ' +
        'If you just recovered, wait for the completion transaction to confirm and retry; ' +
        "otherwise this browser's stored passkey may not match the account on-chain.",
    );
  }
  const finalVerifierAddress = args.verifierAddress ?? resolved.verifier;

  // Hybrid ("paranoid") rules: a policy-less rule holding this passkey PLUS
  // other External signers is a strict AND — every co-signer must sign the
  // same digest. The only co-signer this device can satisfy is the ML-DSA
  // backstop key (matched by its 32-byte commitment). Fail BEFORE the
  // WebAuthn ceremony if a co-signer can't be satisfied.
  const coSigners = resolved.coSigners ?? [];
  let backstop: BackstopKey | null = null;
  if (coSigners.length > 0) {
    backstop = loadBackstopKey(localStorage);
    const commitmentHex = backstop ? buf2hex(backstop.commitment) : null;
    const unsatisfiable = coSigners.filter((c) => c.keyDataHex !== commitmentHex);
    if (unsatisfiable.length > 0) {
      throw new Error(
        'This signing rule requires co-signers this device cannot satisfy. ' +
          'Paranoid mode needs the ML-DSA backstop key generated on this device.',
      );
    }
  }

  // 1-2. Source selection + auth-strip + recording sim + assemble (shared
  //      with the ML-DSA backstop flow).
  const { submitter, authEntry, lastLedger, expirationOffset, assembledTx } =
    await simulateForSigning(args.operation, args.onProgress);

  // 3. Compute the OZ v0.7 auth digest:
  //
  //    auth_digest = sha256(signature_payload || context_rule_ids.to_xdr())
  //
  //    The same `contextRuleIds` array passed here MUST be the one passed
  //    to `injectPasskeySignature` so the AuthPayload's `context_rule_ids`
  //    and the digest the contract recomputes both refer to the same rule.
  const signaturePayload = buildAuthHash(authEntry, Networks.TESTNET, lastLedger, expirationOffset);
  // The signing rule was resolved up front (see resolveSignerRule above).
  const contextRuleIds = [resolved.ruleId];
  const challengeBytes = computeAuthDigest(signaturePayload, contextRuleIds);
  const authHashHex = buf2hex(challengeBytes);
  const assembled_tx = assembledTx;

  // 5. Get a WebAuthn assertion over the challenge.
  args.onProgress?.({ phase: "sign" });
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

  // 6. Inject the signature(s) into the assembled tx's auth entry. A hybrid
  //    rule bundles the ML-DSA co-signature over the SAME digest into one
  //    AuthPayload; otherwise this is the classic single-passkey injection.
  if (backstop && coSigners.length > 0) {
    injectSignedAuthPayload(
      assembled_tx,
      [
        {
          kind: 'external',
          verifierAddress: finalVerifierAddress,
          publicKey: hex2buf(cred.publicKey),
          passkeySignature: parsed,
        },
        {
          kind: 'external-bytes',
          verifierAddress: coSigners[0].verifier,
          keyData: backstop.commitment,
          sigData: encodeMlDsaSigData(
            backstop.publicKey,
            signDigest(backstop.seed, challengeBytes),
          ),
        },
      ],
      lastLedger,
      expirationOffset,
      contextRuleIds,
    );
  } else {
    injectPasskeySignature(
      assembled_tx,
      parsed,
      finalVerifierAddress,
      hex2buf(cred.publicKey),
      lastLedger,
      expirationOffset,
      contextRuleIds,
    );
  }

  // 7. Submit — relayer or classic path (shared with the ML-DSA flow).
  return submitSigned(assembled_tx, submitter, server, authHashHex, args.onProgress);
}
