import type {
  MultisigRecoveryBlock,
  RotationRequest,
  FriendSignature,
  SignerSignature,
} from '@nidohq/passkey-sdk';
import {
  multisigRecoveryModule,
  saveFriendNickname,
  buildRotation,
  describeRotation,
  planRotation,
  buildAuthHashAt,
  computeAuthDigest,
  buildAuthPayloadScVal,
  buildFriendInvocation,
  friendSignaturePayload,
  randomNonce,
  encodeRotationHandoff,
  decodeRotationHandoff,
  decodeFriendSignature,
  encodeFriendSignature,
  loadCredential,
  parseAssertionResponse,
  hex2buf,
  type RotationHandoff,
} from '@nidohq/passkey-sdk';
import {
  rpc,
  TransactionBuilder,
  Networks,
  Keypair,
  xdr,
  Address,
} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import {
  fetchRegistryAddress,
  fetchVerifierAddress,
  fetchAllChainRules,
  fetchPolicyState,
} from './policyChainFetch.js';
import { signAndSubmit } from './primaryPasskeySigner.js';
import {
  fetchRefractorTransaction,
  refractorWebTxUrl,
  storeRefractorTransaction,
} from './refractorClient.js';
import {
  extractFuncAndAuth,
  relayerEnabled,
  submitSorobanTransaction,
  waitForConfirmation,
} from './relayerClient.js';
import * as relayClient from './relayClient.js';
import { RELAYER_SIM_SOURCE, RPC_URL } from './network.js';

export const RELAY_BASE_URL =
  (import.meta.env.PUBLIC_RECOVERY_RELAY_URL as string | undefined) ??
  'https://relay.nido.fyi';

/** Random url-safe capability for the recovery-relay bucket. */
export function mintRelayKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const FRIENDBOT_URL = 'https://friendbot.stellar.org';
const SUBMITTER_KEY = 'nido:name-keypair';
/** Ledgers the canonical parent auth-digest stays valid for (~14h on testnet
 *  at ~5s/ledger) — long enough to collect friend signatures out of band. */
const PARENT_EXPIRATION_OFFSET = 10000;

/** Extract the root (recovering account) auth entry from an assembled tx XDR. */
function assembledRootAuthEntry(txXdr: string): xdr.SorobanAuthorizationEntry {
  const envelope = xdr.TransactionEnvelope.fromXDR(txXdr, 'base64');
  const ihf = envelope.v1().tx().operations()[0].body().invokeHostFunctionOp();
  const auth = ihf.auth();
  if (auth.length === 0) throw new Error('assembled rotation tx has no auth entry');
  return auth[0];
}

export async function installRecovery(
  account: string,
  block: MultisigRecoveryBlock,
): Promise<void> {
  const built = await multisigRecoveryModule.buildInstall({
    account,
    block,
    factoryAddress: '', // unused in architecture C
    rpcUrl: RPC_URL,
    policyAddress: (name) =>
      fetchRegistryAddress(name === 'multisig' ? 'multisig-policy' : name),
    verifierAddress: () => fetchVerifierAddress(account),
  });

  const verifierAddr = await fetchVerifierAddress(account);
  await signAndSubmit({
    account,
    operation: built.operations[0],
    verifierAddress: verifierAddr,
  });

  // Persist overlay metadata only after successful submission.
  for (const f of block.friends) {
    if (f.nickname) saveFriendNickname(account, f.address, f.nickname);
  }
}

// ===========================================================================
// Recovery completion (key rotation)
// ===========================================================================
//
// Flow: the originator stages a rotation (prepareRotation), shares a per-friend
// link, each friend signs and returns a blob (addFriendSignature), and once the
// threshold is met the originator submits (submitRotation).
//
// Partial signatures persist in localStorage at the recovering account's
// subdomain — same pattern as session-key material. We never store private
// key bytes; only the friends' returned signature blobs.

const stagingKey = (account: string) => `nido.${account}.recovery-rotation`;

/** One staged rotation transaction (a rotation may need several — e.g.
 *  `add_policy` then `add_signer`, one InvokeHostFunction op per tx). */
export interface StagedRotationTx {
  /** Base64 XDR of the assembled, unsigned rotation transaction. */
  txXdr: string;
  /** Refractor transaction hash for the staged rotation tx. */
  refractorTxHash: string;
  /** Human-facing Refractor inspection URL for the staged tx. */
  refractorTxUrl: string;
  /** The parent auth digest friends authorize for THIS tx, hex-encoded. */
  parentAuthDigestHex: string;
  /** Relayer job id, persisted the moment the relayer accepts this tx (before
   *  we wait for confirmation). If a wait times out, a retried `submitRotation`
   *  RESUMES by polling this id instead of re-submitting — re-submitting would
   *  reuse the friends' nonces and be rejected as a replay while the original
   *  tx may still land. Only set on the relayer path. */
  relayerTxId?: string;
  /** Set once this tx has been submitted and confirmed (so a retried
   *  `submitRotation` skips it instead of double-submitting). */
  submittedHash?: string;
}

export interface RotationStaging {
  account: string;
  recoveryRuleId: number;
  threshold: number;
  /** All friend accounts authorized by the recovery rule. */
  friends: string[];
  /** The staged rotation transactions, in submission order. */
  txs: StagedRotationTx[];
  /** Ledger the simulation was pinned to (for expiration math). */
  lastLedger: number;
  /**
   * The canonical absolute expiration ledger written onto the PARENT auth
   * entries (shared by every staged tx). Must match the value baked into the
   * handoff and signed by every friend; the chain recomputes the parent
   * digests with it.
   */
  parentSignatureExpirationLedger: number;
  description: string;
  /** Capability for the relay bucket holding this rotation's friend sigs. */
  relayKey: string;
  /** Collected friend signatures keyed by friend account. */
  collected: Record<string, FriendSignature>;
}

function loadStaging(account: string): RotationStaging | null {
  const raw = localStorage.getItem(stagingKey(account));
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as RotationStaging & {
      // Legacy (pre-#87) staging carried a single tx + flat friend sigs.
      txXdr?: string;
      parentAuthDigestHex?: string;
      collected: Record<string, ReturnType<typeof serializeFriendSig>>;
    };
    const collected: Record<string, FriendSignature> = {};
    for (const [k, v] of Object.entries(o.collected ?? {})) {
      collected[k] = deserializeFriendSig(v);
    }
    let txs = o.txs;
    if (!Array.isArray(txs)) {
      // Pre-Refractor staging cannot be resumed because it has no Refractor hashes.
      return null;
    }
    if (
      !txs.every((t) =>
        typeof t.txXdr === 'string' &&
        typeof t.parentAuthDigestHex === 'string' &&
        typeof t.refractorTxHash === 'string' &&
        typeof t.refractorTxUrl === 'string'
      )
    ) {
      return null;
    }
    return { ...o, txs, collected };
  } catch {
    return null;
  }
}

function saveStaging(staging: RotationStaging): void {
  const collected: Record<string, ReturnType<typeof serializeFriendSig>> = {};
  for (const [k, v] of Object.entries(staging.collected)) {
    collected[k] = serializeFriendSig(v);
  }
  localStorage.setItem(
    stagingKey(staging.account),
    JSON.stringify({ ...staging, collected }),
  );
}

export function clearStaging(account: string): void {
  localStorage.removeItem(stagingKey(account));
}

export function getStaging(account: string): RotationStaging | null {
  return loadStaging(account);
}

function serializeFriendSig(s: FriendSignature) {
  return {
    friendAccount: s.friendAccount,
    verifierAddress: s.verifierAddress,
    publicKey: Array.from(s.publicKey),
    entries: s.entries.map((e) => ({
      authenticatorData: Array.from(e.authenticatorData),
      clientDataJson: Array.from(e.clientDataJson),
      signature: Array.from(e.signature),
      nonce: e.nonce,
      signatureExpirationLedger: e.signatureExpirationLedger,
    })),
  };
}

function deserializeFriendSig(
  o: ReturnType<typeof serializeFriendSig> & {
    // Legacy (pre-#87) serialization: one flat entry.
    authenticatorData?: number[];
    clientDataJson?: number[];
    signature?: number[];
    nonce?: string;
    signatureExpirationLedger?: number;
  },
): FriendSignature {
  const entries = Array.isArray(o.entries)
    ? o.entries
    : [
        {
          authenticatorData: o.authenticatorData ?? [],
          clientDataJson: o.clientDataJson ?? [],
          signature: o.signature ?? [],
          nonce: o.nonce ?? '0',
          signatureExpirationLedger: o.signatureExpirationLedger ?? 0,
        },
      ];
  return {
    friendAccount: o.friendAccount,
    verifierAddress: o.verifierAddress,
    publicKey: new Uint8Array(o.publicKey),
    entries: entries.map((e) => ({
      authenticatorData: new Uint8Array(e.authenticatorData),
      clientDataJson: new Uint8Array(e.clientDataJson),
      signature: new Uint8Array(e.signature),
      nonce: e.nonce,
      signatureExpirationLedger: e.signatureExpirationLedger,
    })),
  };
}

/** Locate the recovery rule(s): CallContract(self) rules carrying a policy. */
export interface RecoveryRuleInfo {
  ruleId: number;
  threshold: number | null;
  friends: string[];
}

export async function findRecoveryRules(account: string): Promise<RecoveryRuleInfo[]> {
  const rules = await fetchAllChainRules(account);
  const out: RecoveryRuleInfo[] = [];
  for (const r of rules) {
    if (r.policies.length === 0) continue;
    if (r.contextType.kind !== 'call-contract') continue;
    if (r.contextType.contract !== account) continue;
    const friends = r.signers
      .filter((s): s is { kind: 'delegated'; address: string } => s.kind === 'delegated')
      .map((s) => s.address);
    // Read the REAL threshold from the rule's policy (multisig-policy's
    // `get_threshold`). If no policy exposes it, leave null and let the caller
    // fall back to a heuristic.
    let threshold: number | null = null;
    try {
      const state = await fetchPolicyState(account, r);
      for (const policyAddr of r.policies) {
        const policyState = state[policyAddr] as { threshold?: unknown } | undefined;
        const t = policyState?.threshold;
        if (typeof t === 'number') {
          threshold = t;
          break;
        }
      }
    } catch {
      // leave threshold null on read failure
    }
    out.push({ ruleId: r.ruleId, threshold, friends });
  }
  return out;
}

function encodeHandoffLink(origin: string, handoff: RotationHandoff): string {
  return `${origin}/security/recover/?handoff=${encodeRotationHandoff(handoff)}`;
}

export function recoveryHandoffLinkFromStaging(
  origin: string,
  staging: RotationStaging,
): string {
  const refractorTxHashes = staging.txs.map((t) => t.refractorTxHash);
  if (!refractorTxHashes.every((tx) => /^[a-f0-9]{64}$/i.test(tx))) {
    throw new Error('This staged recovery request predates Refractor handoffs. Please stage it again.');
  }
  return encodeHandoffLink(origin, {
    version: 4,
    account: staging.account,
    recoveryRuleId: staging.recoveryRuleId,
    refractorTxHashes,
    parentSignatureExpirationLedger: staging.parentSignatureExpirationLedger,
    relayKey: staging.relayKey,
    relayBaseUrl: RELAY_BASE_URL,
  });
}

async function requireRecoveryRule(account: string, ruleId: number): Promise<RecoveryRuleInfo> {
  const rules = await findRecoveryRules(account);
  const rule = rules.find((r) => r.ruleId === ruleId);
  if (!rule) {
    throw new Error(`Recovery rule #${ruleId} was not found on ${account}.`);
  }
  return rule;
}

function describeFriendRecoveryRequest(rule: RecoveryRuleInfo, account: string): string {
  const threshold = rule.threshold ?? Math.max(1, Math.ceil(rule.friends.length / 2));
  return `Recovery request for ${account.slice(0, 8)}…${account.slice(-4)}: ` +
    `${threshold} of ${rule.friends.length} friend${rule.friends.length === 1 ? '' : 's'} required`;
}

export function validateRecoveryTxEnvelope(txXdr: string, account: string): xdr.SorobanAuthorizationEntry {
  const envelope = xdr.TransactionEnvelope.fromXDR(txXdr, 'base64');
  const tx = envelope.v1().tx();
  const operations = tx.operations();
  if (operations.length !== 1) {
    throw new Error(`Recovery transaction must have one operation, got ${operations.length}.`);
  }
  const body = operations[0].body();
  if (body.switch() !== xdr.OperationType.invokeHostFunction()) {
    throw new Error('Recovery transaction is not a Soroban invocation.');
  }
  const ihf = body.invokeHostFunctionOp();
  const hostFn = ihf.hostFunction();
  if (hostFn.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) {
    throw new Error('Recovery transaction does not invoke a contract.');
  }
  const invoke = hostFn.invokeContract();
  const target = Address.fromScAddress(invoke.contractAddress()).toString();
  if (target !== account) {
    throw new Error('Refractor transaction targets a different account.');
  }
  const rootAuth = ihf.auth()[0];
  if (!rootAuth) throw new Error('Recovery transaction has no auth entry.');
  if (rootAuth.credentials().switch() !== xdr.SorobanCredentialsType.sorobanCredentialsAddress()) {
    throw new Error('Recovery transaction auth is not account-scoped.');
  }
  const authAccount = Address.fromScAddress(rootAuth.credentials().address().address()).toString();
  if (authAccount !== account) {
    throw new Error('Recovery transaction auth is for a different account.');
  }
  return rootAuth;
}

/** State of the default rule (id 0) as far as #87 repair is concerned. */
export interface DefaultRuleRepairState {
  /** True when rule 0 is multi-signer with no policy — the N-of-N brick:
   *  every ceremony requires ALL passkeys, so single-passkey signing fails
   *  with #3002 UnvalidatedContext. */
  needsRepair: boolean;
  signerCount: number;
  policyCount: number;
}

/**
 * Detect whether the account's default rule is in the bricked
 * multi-signer/no-policy state (issue #87). The repair is a recovery-
 * authorized rotation that ONLY installs the 1-of-N threshold policy:
 * `prepareRotation` with a bare `{ defaultRuleId: 0 }` request plans exactly
 * that.
 */
export async function checkDefaultRuleRepair(
  account: string,
): Promise<DefaultRuleRepairState> {
  const rules = await fetchAllChainRules(account);
  const rule = rules.find((r) => r.ruleId === 0);
  if (!rule) return { needsRepair: false, signerCount: 0, policyCount: 0 };
  return {
    needsRepair: rule.signers.length > 1 && rule.policies.length === 0,
    signerCount: rule.signers.length,
    policyCount: rule.policies.length,
  };
}

/**
 * Read the rotated rule's current signer/policy counts so `planRotation` can
 * decide whether to auto-install the 1-of-N threshold policy (issue #87).
 * Returns the enriched request, or the original if enrichment must be
 * skipped (rule unreadable on a remove-only/repair-less request).
 */
async function enrichRotationRequest(
  account: string,
  request: RotationRequest,
): Promise<RotationRequest> {
  if (request.ruleState && request.thresholdPolicyAddress) return request;
  try {
    const rules = await fetchAllChainRules(account);
    const rule = rules.find((r) => r.ruleId === request.defaultRuleId);
    if (!rule) throw new Error(`rule ${request.defaultRuleId} not found`);
    const thresholdPolicyAddress = await fetchRegistryAddress('multisig-policy');
    return {
      ...request,
      ruleState: {
        signerCount: rule.signers.length,
        policyCount: rule.policies.length,
      },
      thresholdPolicyAddress,
    };
  } catch (e) {
    // Adding a signer to a rule whose state we cannot read could silently
    // re-create the N-of-N brick — refuse rather than fail open. A
    // remove-only rotation never makes the rule MORE locked, so let it pass.
    if (request.addPasskey) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Could not read the account's signing rule to decide whether a ` +
          `1-of-N approval policy must be installed alongside the new ` +
          `passkey: ${msg}`,
      );
    }
    return request;
  }
}

/**
 * Stage a rotation: build the (unsigned) rotation transaction(s), simulate
 * each to derive the parent auth digests the friends must authorize, and
 * persist the staging blob. Returns the per-friend handoff payload the
 * originator shares.
 *
 * A rotation may span several sequential transactions (Soroban allows one
 * InvokeHostFunction op per tx) — e.g. `add_policy` (install the 1-of-N
 * threshold) followed by `add_signer`. Friends sign every tx's digest in one
 * handoff; `submitRotation` submits them in order. The policy install is
 * ordered FIRST so an interrupted sequence never leaves the rule N-of-N.
 */
export async function prepareRotation(args: {
  account: string;
  recoveryRuleId: number;
  friends: string[];
  threshold: number;
  request: RotationRequest;
}): Promise<{ staging: RotationStaging; handoff: RotationHandoff; handoffLink: string }> {
  const { account, recoveryRuleId, friends, threshold } = args;
  const request = await enrichRotationRequest(account, args.request);

  const built = await buildRotation({
    account,
    rpcUrl: RPC_URL,
    recoveryRuleId,
    request,
  });

  const server = new rpc.Server(RPC_URL);
  const useRelayer = relayerEnabled();
  const submitter = useRelayer ? null : await getSubmitter();
  if (useRelayer && !RELAYER_SIM_SOURCE) {
    throw new Error('Relayer misconfigured: PUBLIC_RELAYER_URL is set but PUBLIC_RELAYER_SIM_SOURCE is not.');
  }
  // One Account object across all builds: TransactionBuilder.build()
  // increments its sequence, so consecutive staged txs get consecutive
  // sequence numbers (submitRotation re-sources them anyway).
  const sourceAccount = submitter
    ? await server.getAccount(submitter.publicKey())
    : await server.getAccount(RELAYER_SIM_SOURCE);

  let lastLedger = 0;
  // ONE canonical absolute expiration ledger, frozen on the first simulation
  // and shared by every staged tx. Every party (originator, friends, chain)
  // must derive the parent auth digests from exactly this value, or the
  // digests diverge.
  let parentSignatureExpirationLedger = 0;
  const txs: StagedRotationTx[] = [];

  for (const operation of built.operations) {
    // Simulate with auth stripped so the simulator generates fresh auth
    // templates in recording mode (see primaryPasskeySigner for rationale).
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
      throw new Error(`Rotation simulation failed: ${(sim as rpc.Api.SimulateTransactionErrorResponse).error}`);
    }
    const successSim = sim as rpc.Api.SimulateTransactionSuccessResponse;
    if (parentSignatureExpirationLedger === 0) {
      lastLedger = successSim.latestLedger;
      parentSignatureExpirationLedger = lastLedger + PARENT_EXPIRATION_OFFSET;
    }

    // Assemble the transaction FIRST, then derive the parent auth digest from
    // the root auth entry that actually ships — not from the pre-assemble sim
    // entry, whose invocation/nonce may differ from the assembled one.
    const assembled = rpc.assembleTransaction(simTx, successSim).build();
    const txXdr = assembled.toXDR();
    const authEntry = assembledRootAuthEntry(txXdr);
    const signaturePayload = buildAuthHashAt(
      authEntry,
      Networks.TESTNET,
      parentSignatureExpirationLedger,
    );
    const parentAuthDigest = computeAuthDigest(signaturePayload, [recoveryRuleId]);
    const refractorTx = await storeRefractorTransaction({
      network: 'testnet',
      xdr: txXdr,
    });
    txs.push({
      txXdr,
      refractorTxHash: refractorTx.hash,
      refractorTxUrl: refractorWebTxUrl(refractorTx.hash),
      parentAuthDigestHex: Buffer.from(parentAuthDigest).toString('hex'),
    });
  }

  const relayKey = mintRelayKey();
  const staging: RotationStaging = {
    account,
    recoveryRuleId,
    threshold,
    friends,
    txs,
    lastLedger,
    parentSignatureExpirationLedger,
    description: built.description,
    relayKey,
    collected: {},
  };
  saveStaging(staging);

  const handoff: RotationHandoff = {
    version: 4,
    account,
    recoveryRuleId,
    refractorTxHashes: txs.map((t) => t.refractorTxHash),
    parentSignatureExpirationLedger,
    relayKey,
    relayBaseUrl: RELAY_BASE_URL,
  };
  const handoffLink = encodeHandoffLink(window.location.origin, handoff);

  return { staging, handoff, handoffLink };
}

/**
 * Record a friend's returned signature blob into the staging area.
 * Returns the updated staging (idempotent per friend).
 */
export function addFriendSignature(account: string, blob: string): RotationStaging {
  const staging = loadStaging(account);
  if (!staging) throw new Error('No rotation in progress for this account.');
  const fs = decodeFriendSignature(blob.trim());
  if (!staging.friends.includes(fs.friendAccount)) {
    throw new Error(
      `${fs.friendAccount} is not one of this account's recovery friends.`,
    );
  }
  if (fs.entries.length !== staging.txs.length) {
    throw new Error(
      `This reply covers ${fs.entries.length} transaction(s) but the staged ` +
        `rotation has ${staging.txs.length} — ask the friend to re-sign from ` +
        `the current link.`,
    );
  }
  staging.collected[fs.friendAccount] = fs;
  saveStaging(staging);
  return staging;
}

export function collectedCount(staging: RotationStaging): number {
  return Object.keys(staging.collected).length;
}

/**
 * Assemble the full auth tree from the staged transaction plus the collected
 * friend signatures and submit it.
 *
 * The parent (recovering account) auth entry's signature is a multi-signer
 * `AuthPayload` whose `signers` map holds one `Delegated(friend)` entry per
 * contributing friend. Each friend's actual cryptographic proof rides in a
 * nested sub-invocation auth entry: the recovering account's `__check_auth`
 * calls `friend.require_auth_for_args((parent_auth_digest,))`, and the host
 * matches that against the friend's nested entry, whose own `__check_auth`
 * verifies the friend's primary passkey over the friend's auth digest.
 */
export async function submitRotation(account: string): Promise<string> {
  const staging = loadStaging(account);
  if (!staging) throw new Error('No rotation in progress.');
  const contributors = Object.values(staging.collected);
  if (contributors.length < staging.threshold) {
    throw new Error(
      `Need ${staging.threshold} friend signatures, have ${contributors.length}.`,
    );
  }
  for (const c of contributors) {
    if (c.entries.length !== staging.txs.length) {
      throw new Error(
        `Friend ${c.friendAccount}'s reply covers ${c.entries.length} ` +
          `transaction(s) but the staged rotation has ${staging.txs.length}.`,
      );
    }
  }

  const server = new rpc.Server(RPC_URL);
  const useRelayer = relayerEnabled();
  const submitter = useRelayer ? null : await getSubmitter();

  // Build the parent multi-signer AuthPayload (Delegated friends only — the
  // primary passkey is lost, so the recovery rule is the sole authority).
  // Each staged tx has exactly one operation, so its context-rule-id vector
  // is the single recovery rule id.
  const signerSpecs: SignerSignature[] = contributors.map((c) => ({
    kind: 'delegated' as const,
    address: c.friendAccount,
  }));

  let lastHash = '';
  for (let i = 0; i < staging.txs.length; i++) {
    const staged = staging.txs[i];
    // Already confirmed on a previous (partially-failed) submit run — skip.
    if (staged.submittedHash) {
      lastHash = staged.submittedHash;
      continue;
    }

    const parentAuthPayload = buildAuthPayloadScVal({
      contextRuleIds: [staging.recoveryRuleId],
      signers: signerSpecs,
    });

    // Splice the parent AuthPayload into the root auth entry and append one
    // nested friend entry per contributor.
    const envelope = xdr.TransactionEnvelope.fromXDR(staged.txXdr, 'base64');
    const innerOp = envelope.v1().tx().operations()[0];
    const ihfOp = innerOp.body().invokeHostFunctionOp();
    const rootAuth = ihfOp.auth()[0];
    const rootCreds = rootAuth.credentials().address();
    // Write the canonical expiration onto the parent entry so the chain
    // recomputes the SAME parent auth digest the originator stored and the
    // friends signed over. Without this the chain uses whatever assemble left
    // and the digest diverges.
    rootCreds.signatureExpirationLedger(staging.parentSignatureExpirationLedger);
    rootCreds.signature(parentAuthPayload);

    const friendEntries = contributors.map((c) =>
      buildFriendAuthEntry(staging.account, c, c.entries[i], staged.parentAuthDigestHex),
    );
    ihfOp.auth([rootAuth, ...friendEntries]);

    if (useRelayer) {
      // Resume: a prior run already handed this tx to the relayer but we never
      // saw a terminal status (the wait timed out). Re-submitting would reuse
      // the friends' nonces (a replay the chain rejects) while the original tx
      // may still land — so poll the existing relayer job instead.
      if (staged.relayerTxId) {
        const confirmed = await waitForConfirmation(staged.relayerTxId);
        if (!confirmed.hash) throw new Error('Relayer confirmed without a transaction hash');
        staged.submittedHash = confirmed.hash;
        saveStaging(staging);
        lastHash = confirmed.hash;
        continue;
      }

      // The relayer rebuilds/refits/submits from host function + signed auth
      // entries, so the staged envelope source sequence is irrelevant here.
      const rebuilt = TransactionBuilder.fromXDR(
        envelope.toXDR('base64'),
        Networks.TESTNET,
      ) as import('@stellar/stellar-sdk').Transaction;
      const { func, auth } = extractFuncAndAuth(rebuilt);
      const submitted = await submitSorobanTransaction({ func, auth });
      // Persist the relayer job id BEFORE waiting: if the wait times out (a
      // transient poll failure, or the validity window elapsing while the tx
      // is still in flight) a retry must RESUME by polling this id, never by
      // re-submitting.
      if (submitted.transactionId) {
        staged.relayerTxId = submitted.transactionId;
        saveStaging(staging);
      }
      let hash = submitted.hash;
      if (!hash) {
        if (!submitted.transactionId) {
          throw new Error('Relayer accepted the recovery transaction but returned no transaction id');
        }
        const confirmed = await waitForConfirmation(submitted.transactionId);
        if (!confirmed.hash) throw new Error('Relayer confirmed without a transaction hash');
        hash = confirmed.hash;
      }
      staged.submittedHash = hash;
      saveStaging(staging);
      lastHash = hash;
      continue;
    }

    if (!submitter) throw new Error('unreachable: classic recovery submit without submitter');
    // Rebuild the envelope around a FRESH submitter sequence: the staged
    // sequence may be stale by submit time, and a multi-tx rotation consumes
    // one sequence per submitted tx. The friend signatures bind to the auth
    // entries (nonce/expiration/invocation), not the envelope, so this is
    // safe.
    const sourceAccount = await server.getAccount(submitter.publicKey());
    const rebuilt = new TransactionBuilder(sourceAccount, {
      fee: '10000000',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(xdr.Operation.fromXDR(innerOp.toXDR()))
      .setTimeout(0)
      .build();

    // Enforce-mode simulation recomputes the footprint __check_auth touches
    // (and, for tx > 0, sees the on-chain effects of the previous tx).
    const finalSim = await server.simulateTransaction(rebuilt, undefined, 'enforce');
    if (rpc.Api.isSimulationError(finalSim)) {
      throw new Error(`Final rotation simulation failed: ${(finalSim as rpc.Api.SimulateTransactionErrorResponse).error}`);
    }
    const successFinal = finalSim as rpc.Api.SimulateTransactionSuccessResponse;
    const newSorobanData = successFinal.transactionData.build();
    const newResourceFee = BigInt(newSorobanData.resourceFee().toString());
    const refitted = TransactionBuilder.cloneFrom(rebuilt, {
      fee: (BigInt(rebuilt.fee) + newResourceFee).toString(),
      sorobanData: newSorobanData,
      networkPassphrase: Networks.TESTNET,
    }).build();
    refitted.sign(submitter);

    const send = await server.sendTransaction(refitted);
    if (send.status === 'ERROR') {
      throw new Error(`Submit rejected: ${send.errorResult?.toXDR('base64') ?? 'unknown'}`);
    }
    let got = await server.getTransaction(send.hash);
    for (let j = 0; got.status === 'NOT_FOUND' && j < 30; j++) {
      await new Promise((r) => setTimeout(r, 1500));
      got = await server.getTransaction(send.hash);
    }
    if (got.status !== 'SUCCESS') {
      throw new Error(
        `Rotation tx ${i + 1} of ${staging.txs.length} (${send.hash}) ${got.status}` +
          (i > 0 ? ' — earlier transactions already landed; retry to resume.' : ''),
      );
    }
    // Persist progress so a retry after a later failure skips this tx.
    staged.submittedHash = send.hash;
    saveStaging(staging);
    lastHash = send.hash;
  }

  clearStaging(account);
  return lastHash;
}

/**
 * Construct a nested `SorobanAuthorizationEntry` for a friend authorizing
 * `recovering_account.__check_auth((parent_auth_digest,))` with the friend's
 * own primary-passkey signature.
 *
 * The invocation's `contract_address` is the RECOVERING account (whose
 * `__check_auth` frame the host matches against), NOT the friend's address.
 */
function buildFriendAuthEntry(
  recoveringAccount: string,
  fs: FriendSignature,
  entry: FriendSignature['entries'][number],
  parentAuthDigestHex: string,
): xdr.SorobanAuthorizationEntry {
  const invocation = buildFriendInvocation(recoveringAccount, parentAuthDigestHex);

  // The friend's own AuthPayload (primary passkey, default rule 0). The blob
  // already holds the COMPACT 64-byte signature, so build the
  // PasskeySignature directly — do not re-run derToCompact via
  // parseAssertionResponse.
  const friendAuthPayload = buildAuthPayloadScVal({
    contextRuleIds: [0],
    signers: [
      {
        kind: 'external',
        verifierAddress: fs.verifierAddress,
        publicKey: fs.publicKey,
        passkeySignature: {
          authenticatorData: entry.authenticatorData,
          clientDataJson: entry.clientDataJson,
          signature: entry.signature,
        },
      },
    ],
  });

  const creds = new xdr.SorobanAddressCredentials({
    address: Address.fromString(fs.friendAccount).toScAddress(),
    nonce: xdr.Int64.fromString(entry.nonce),
    signatureExpirationLedger: entry.signatureExpirationLedger,
    signature: friendAuthPayload,
  });

  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(creds),
    rootInvocation: invocation,
  });
}

// --- Friend side -----------------------------------------------------------

/**
 * Friend-side: decode a handoff link, review it, sign the rotation with the
 * friend's own primary passkey, and return the blob to hand back to the
 * originator.
 *
 * `friendAccount` is the friend's own smart account (the page this runs on).
 * The friend chooses a fresh nonce + expiration; those travel back in the blob
 * so the originator reconstructs the friend's nested entry byte-identically.
 */
export async function signRotationAsFriend(
  friendAccount: string,
  handoffEncoded: string,
  onStatus?: (msg: string) => void,
): Promise<{ blob: string; description: string }> {
  const handoff = decodeRotationHandoff(handoffEncoded);

  const rule = await requireRecoveryRule(handoff.account, handoff.recoveryRuleId);
  if (!rule.friends.includes(friendAccount)) {
    throw new Error('This recovery request does not list your account as a friend.');
  }

  const cred = loadCredential(friendAccount);
  if (!cred) throw new Error('No primary passkey registered for your account on this device.');
  const verifierAddress = await fetchVerifierAddress(friendAccount);

  const server = new rpc.Server(RPC_URL);
  const latest = await server.getLatestLedger();

  // A multi-tx rotation (e.g. install the 1-of-N policy, then add the new
  // passkey) needs one passkey assertion per transaction — same review, one
  // tap each.
  const entries: FriendSignature['entries'] = [];
  for (let i = 0; i < handoff.refractorTxHashes.length; i++) {
    if (handoff.refractorTxHashes.length > 1) {
      onStatus?.(`Signing approval ${i + 1} of ${handoff.refractorTxHashes.length}…`);
    }

    // Recompute the PARENT auth digest from the shared tx so the friend signs
    // over exactly what the recovering account will require. Crucially, use
    // the CANONICAL absolute expiration the originator froze into the handoff
    // — NOT a value derived from a live `getLatestLedger`, which would
    // diverge from the originator's stored digest and the chain's
    // recomputation.
    const refractorTx = await fetchRefractorTransaction(handoff.refractorTxHashes[i]);
    if (refractorTx.network !== 'testnet') {
      throw new Error(`Unsupported Refractor network: ${refractorTx.network}`);
    }
    const parentRootAuth = validateRecoveryTxEnvelope(refractorTx.xdr, handoff.account);
    const parentSignaturePayload = buildAuthHashAt(
      parentRootAuth,
      Networks.TESTNET,
      handoff.parentSignatureExpirationLedger,
    );
    const parentAuthDigest = computeAuthDigest(parentSignaturePayload, [handoff.recoveryRuleId]);
    const parentAuthDigestHex = Buffer.from(parentAuthDigest).toString('hex');

    // Friend's own nested-entry params. The friend picks a fresh nonce + a
    // local expiration for THEIR OWN nested entry (independent of the
    // parent's). The friend's nested invocation targets the RECOVERING
    // account, not their own.
    const nonce = randomNonce();
    const signatureExpirationLedger = latest.sequence + PARENT_EXPIRATION_OFFSET;
    const friendPayload = friendSignaturePayload({
      recoveringAccount: handoff.account,
      parentAuthDigestHex,
      networkPassphrase: Networks.TESTNET,
      nonce,
      signatureExpirationLedger,
    });
    const friendDigest = computeAuthDigest(friendPayload, [0]);

    // Sign the friend digest with the friend's primary passkey.
    const challenge = new ArrayBuffer(friendDigest.byteLength);
    new Uint8Array(challenge).set(friendDigest);
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge,
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
    const parsed = parseAssertionResponse({
      authenticatorData: response.authenticatorData,
      clientDataJSON: response.clientDataJSON,
      signature: response.signature,
    });

    entries.push({
      authenticatorData: parsed.authenticatorData,
      clientDataJson: parsed.clientDataJson,
      signature: parsed.signature,
      nonce,
      signatureExpirationLedger,
    });
  }

  const blob = encodeFriendSignature({
    friendAccount,
    verifierAddress,
    publicKey: hex2buf(cred.publicKey),
    entries,
  });
  return { blob, description: describeFriendRecoveryRequest(rule, handoff.account) };
}

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
 * Pull signatures from the relay and record any not-yet-collected ones via the
 * validator (defaults to addFriendSignature). `known` is the set of friend
 * accounts already in staging. Returns the friend accounts newly added.
 * Invalid blobs are skipped (logged), never thrown.
 */
export async function collectFromRelay(
  account: string,
  relayBaseUrl: string,
  relayKey: string,
  known: Set<string>,
  addFn: (account: string, blob: string) => RotationStaging = addFriendSignature,
): Promise<string[]> {
  const all = await relayClient.listFriendSignatures(relayBaseUrl, relayKey);
  const added: string[] = [];
  for (const { friend, blob } of all) {
    if (known.has(friend)) continue;
    try {
      addFn(account, blob);
      added.push(friend);
    } catch (e) {
      console.warn(`relay blob from ${friend} rejected:`, e);
    }
  }
  return added;
}

/** Push a friend's signature blob to the relay (replaces paste-back). */
export async function submitFriendSignatureToRelay(
  relayBaseUrl: string,
  relayKey: string,
  friendAccount: string,
  blob: string,
): Promise<void> {
  await relayClient.putFriendSignature(relayBaseUrl, relayKey, friendAccount, blob);
}

export { describeRotation, planRotation };
