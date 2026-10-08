import {
  rpc,
  TransactionBuilder,
  Networks,
  Keypair,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk';
import {
  loadCredential,
  buildApplyDocTx,
  buildAuthHash,
  computeAuthDigest,
  getAuthEntry,
  injectAuthPayloadXdr,
  injectPasskeySignature,
  parseAssertionResponse,
  perch,
  webAuthnSigDataBytes,
  hex2buf,
  buf2hex,
  type PasskeySignature,
  type PolicyDoc,
} from '@nidohq/passkey-sdk';
import { resolveSignerRule } from './policyChainFetch.js';
import { perchDeployment } from './recovery/deployment.js';
import {
  relayerEnabled,
  signatureExpirationOffset,
} from './relayerClient';
import { RELAYER_SIM_SOURCE } from './network';
import { relayerSubmitAndConfirm, classicSubmitAndPoll } from './signing/submit';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';

// The expiration offset (relayer-mode auth-entry validity window) is computed by
// `signatureExpirationOffset()` in ./relayerClient so every relayer-submitting
// signing path (here + walletSign) shares ONE source of
// truth, passed identically to buildAuthHash and the injector.

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

const NOT_REGISTERED =
  'This passkey is not registered on any authorization rule of the account. ' +
  'If you just recovered, wait for the completion transaction to confirm and retry; ' +
  "otherwise this browser's stored passkey may not match the account on-chain.";

type Progress = (p: { phase: "build" | "sign" | "submit" | "confirm"; detail?: string }) => void;

/** An account invocation simulated and assembled, waiting for its
 *  `AuthPayload`: the Soroban signature payload a signer's digest is built
 *  from, and what `submitPrepared` needs afterwards. */
interface PreparedInvocation {
  assembledTx: Transaction;
  signaturePayload: Uint8Array;
  lastLedger: number;
  expirationOffset: number;
  /** Resource fee the simulation asked for, in stroops. */
  fee: bigint;
  submitter: Keypair | null;
  server: rpc.Server;
}

/** Simulate `operation` against the account (recording mode, which learns
 *  the account's auth entry) and assemble it. */
async function prepareInvocation(operation: xdr.Operation): Promise<PreparedInvocation> {
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
  // simulating. The operation carries the unsigned auth-entry templates that
  // the contract bindings' AssembledTransaction.simulate left on the built tx
  // (Void signature). Handed back to simulateTransaction in recording mode,
  // the simulator runs __check_auth(payload, Void, contexts) against the smart
  // account, which can't deserialize Void as AuthPayload and traps, so the
  // simulation fails before the WebAuthn prompt. Clone the XDR op so we don't
  // mutate the caller's operation.
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

  // 3. The account's auth entry and its Soroban signature payload, at the
  //    expiration the injected payload will carry.
  const authEntry = getAuthEntry(successSim);
  const lastLedger = successSim.latestLedger;
  const expirationOffset = signatureExpirationOffset();
  const signaturePayload = buildAuthHash(authEntry, Networks.TESTNET, lastLedger, expirationOffset);

  // 4. Assemble so auth entries are baked into the tx XDR before signing.
  const assembledTx = rpc.assembleTransaction(simTx, successSim).build();
  return {
    assembledTx,
    signaturePayload,
    lastLedger,
    expirationOffset,
    fee: BigInt(successSim.minResourceFee ?? '0'),
    submitter,
    server,
  };
}

/** A WebAuthn assertion over `challenge` by the stored credential. */
async function passkeyAssertion(challenge: Uint8Array, credentialId: unknown): Promise<PasskeySignature> {
  const challengeBuf = new ArrayBuffer(challenge.byteLength);
  new Uint8Array(challengeBuf).set(challenge);
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challengeBuf,
      rpId: window.location.hostname,
      allowCredentials: [{ id: credentialId as Uint8Array<ArrayBuffer>, type: 'public-key' }],
      userVerification: 'required',
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error('Passkey signing was cancelled.');
  const response = assertion.response as AuthenticatorAssertionResponse;
  return parseAssertionResponse({
    authenticatorData: response.authenticatorData,
    clientDataJSON: response.clientDataJSON,
    signature: response.signature,
  });
}

/** Submit a prepared invocation whose `AuthPayload` is injected, and wait
 *  for it to land. */
async function submitPrepared(
  p: PreparedInvocation,
  onProgress?: Progress,
): Promise<rpc.Api.SendTransactionResponse> {
  onProgress?.({ phase: "submit" });
  if (relayerEnabled()) {
    // The Channels plugin re-simulates server-side in enforce mode, builds
    // the footprint itself, and a channel account becomes the tx source with
    // the fund account fee-bumping — the enforce re-sim + fee refit + G
    // signature + RPC submission below are all its job now. We ship only the
    // host function and the passkey-signed auth entry.
    onProgress?.({ phase: "confirm" });
    const { hash } = await relayerSubmitAndConfirm(p.assembledTx);
    // Only `hash` is real (the transfer page links it to the explorer) —
    // latestLedger/latestLedgerCloseTime are placeholder zeros and the tx is
    // already confirmed ('PENDING' kept for shape compatibility).
    return { status: 'PENDING', hash, latestLedger: 0, latestLedgerCloseTime: 0 };
  }

  // Re-simulate + fee refit + sign + submit + poll (classic path).
  // See classicSubmitAndPoll for full commentary on why enforce re-sim
  // is required and why cloneFrom is used instead of assembleTransaction.
  if (!p.submitter) throw new Error('unreachable: classic path without submitter');
  onProgress?.({ phase: "confirm" });
  return classicSubmitAndPoll(p.assembledTx, p.submitter, p.server);
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
   *  already fetched. Otherwise it is the selected rule's. */
  verifierAddress?: string;
  /** Optional progress callback fired at each phase of the signing flow. */
  onProgress?: Progress;
  /** Sign through the account's rule with this name (a guardian's `guardian`
   *  rule, scoped to the recovery controller) instead of the rule holding
   *  this passkey that is scoped to the account itself. */
  ruleName?: string;
}): Promise<rpc.Api.SendTransactionResponse & { authHashHex: string }> {
  const cred = loadCredential(args.account);
  if (!cred) throw new Error('No passkey registered for this account.');

  // Select the rule this device's passkey signs under, and the verifier its
  // signer names, from the account's configuration() (one read, by name and
  // key, never an id scan). A recovered account's new passkey sits on a rule
  // the completion created, so the rule is looked up, not assumed.
  const resolved = await resolveSignerRule(args.account, cred.publicKey, args.ruleName);
  if (!resolved) throw new Error(NOT_REGISTERED);
  const verifierAddress = args.verifierAddress ?? resolved.verifier;

  args.onProgress?.({ phase: "build" });
  const prepared = await prepareInvocation(args.operation);

  //    auth_digest = sha256(signature_payload || context_rule_ids.to_xdr())
  //
  //    The same `contextRuleIds` array passed here MUST be the one passed
  //    to `injectPasskeySignature` so the AuthPayload's `context_rule_ids`
  //    and the digest the contract recomputes both refer to the same rule.
  const contextRuleIds = [resolved.ruleId];
  const challengeBytes = computeAuthDigest(prepared.signaturePayload, contextRuleIds);
  const authHashHex = buf2hex(challengeBytes);

  args.onProgress?.({ phase: "sign" });
  const parsed = await passkeyAssertion(challengeBytes, cred.credentialId);
  injectPasskeySignature(
    prepared.assembledTx,
    parsed,
    verifierAddress,
    hex2buf(cred.publicKey),
    prepared.lastLedger,
    prepared.expirationOffset,
    contextRuleIds,
  );

  const sent = await submitPrepared(prepared, args.onProgress);
  return { ...sent, authHashHex };
}

/**
 * Apply `doc` to `account` with this browser's passkey, through perch-js's
 * apply lifecycle (`perch.applyDocument`, stellar-registry/perch#108): one
 * consistent read of the account, the frozen-account and document-limit
 * checks, the signing rule selected by name at that revision, a revision
 * check right before the passkey prompt, and one `apply_doc` whose
 * `expected_revision` is `baseRevision`.
 *
 * `baseRevision` is the revision the document was composed from (what
 * `document()` returned with the base). The apply then lands only if nothing
 * changed the account since: otherwise it fails with `perch.StaleRevision`
 * before or after signing, and nothing is applied.
 */
export async function applyDocWithPasskey(args: {
  account: string;
  doc: PolicyDoc;
  baseRevision: bigint;
  approvalValidUntil?: number;
  onProgress?: Progress;
}): Promise<{ hash: string; revision: bigint }> {
  const cred = loadCredential(args.account);
  if (!cred) throw new Error('No passkey registered for this account.');
  const deployment = perchDeployment();
  if (!deployment) throw new Error('This build has no Perch deployment.');
  const reader = perch.accountSnapshotReader({
    account: args.account,
    rpcUrl: RPC_URL,
    networkPassphrase: Networks.TESTNET,
    docCompiler: deployment.docCompiler,
  });
  const signer = await resolveSignerRule(args.account, cred.publicKey);
  if (!signer) throw new Error(NOT_REGISTERED);

  let hash = '';
  const transport: perch.ApplyDocTransport = {
    async prepareApplyDoc({ account, approvalValidUntil, expectedRevision }) {
      args.onProgress?.({ phase: "build" });
      const tx = await buildApplyDocTx(args.doc, {
        account,
        rpcUrl: RPC_URL,
        networkPassphrase: Networks.TESTNET,
        approvalValidUntil,
        expectedRevision,
      });
      const prepared = await prepareInvocation(tx.operations[0]!);
      return {
        signaturePayload: prepared.signaturePayload,
        fee: { fee: prepared.fee },
        async submit(authPayload) {
          injectAuthPayloadXdr(prepared.assembledTx, authPayload, prepared.lastLedger, prepared.expirationOffset);
          const sent = await submitPrepared(prepared, args.onProgress);
          hash = sent.hash;
          return { confirm: async () => ({ ledger: sent.latestLedger }) };
        },
      };
    },
  };
  // Today's one-transaction backend, held to the base revision: the apply
  // names `baseRevision`, and a snapshot that has moved past it is refused
  // before anything is built or signed.
  const backend: perch.ApplyBackend = {
    reader,
    async plan(input) {
      const at = input.snapshot.configuration.revision;
      if (at !== args.baseRevision) throw new perch.StaleRevision(args.baseRevision, at);
      return perch.oneTransactionBackend(reader, transport).plan(input);
    },
  };

  const op = perch.applyDocument(
    args.doc,
    backend,
    {
      async sign(request) {
        args.onProgress?.({ phase: "sign" });
        const parsed = await passkeyAssertion(request.digest, cred.credentialId);
        return [
          {
            signer: { kind: 'external', verifier: signer.verifier, key: hex2buf(cred.publicKey) },
            signature: webAuthnSigDataBytes(parsed),
          },
        ];
      },
    },
    {
      rule: { name: signer.ruleName, scope: { type: 'self-admin' } },
      approvalValidUntil: args.approvalValidUntil ?? 0,
    },
  );
  try {
    const result = await op.result;
    return { hash, revision: result.revision };
  } catch (err) {
    if (err instanceof perch.StaleRevision) {
      throw new Error('Your Nido changed after this page read it. Reload the page and make the change again.');
    }
    throw err;
  }
}
