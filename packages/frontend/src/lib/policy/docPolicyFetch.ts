// Chain reads for the perch doc layer: the Perch account's `apply_doc`
// surface (`applied_doc_hash` / `applied_doc`), the `DocApplied` event
// fallback, and the interpreter's per-rule programs — composed into the
// SDK's three-tier `readPolicy`.
//
// Every read here is simulate-only / RPC-only; nothing signs. All reads are
// tolerant of accounts WITHOUT the doc surface (pre-`apply_doc` wasm): they
// resolve to "no document", which `readPolicy` classifies as tier c and the
// inspector renders as the raw rule cards.

import { rpc, Contract, scValToNative } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import {
  perch,
  perchTestnetAddresses,
  readPolicy,
  type ChainRule,
  type PolicyDoc,
  type ReadPolicyResult,
} from '@nidohq/passkey-sdk';
import { fetchDefaultRuleAuthInfo, readAccountConfiguration } from '../policyChainFetch.js';
import { adminBaseline } from './docDraft.js';
import { Client as InterpreterClient } from '@stellar-registry/perch-interpreter';
import { fetchRegistryAddress, simulateView } from '../policyChainFetch.js';
import { RPC_URL, NETWORK_PASSPHRASE } from '../network.js';
import { perchDeployment } from '../recovery/deployment.js';

/** How far back the `DocApplied` event fallback scans. Testnet RPC keeps
 *  roughly a day of events; ask for a bit less so the request never starts
 *  before retention (which errors rather than clamping). */

/** Where the applied doc's JSON was recovered from. `storage` is the
 *  lossless on-chain copy (`applied_doc`); `events` is the `DocApplied`
 *  event history, which only reaches back as far as RPC retention. */
export type DocJsonSource = 'storage';

export interface DocSurface {
  /** False when the account predates the `apply_doc` surface (the probe
   *  simulation failed) — such accounts always read as tier c. */
  supported: boolean;
  /** Stored canonical hash, or null if no document was ever applied. */
  appliedDocHash: Uint8Array | null;
}

/** Probe the account's doc surface (`applied_doc_hash`). */
export async function fetchDocSurface(account: string): Promise<DocSurface> {
  let server: rpc.Server;
  let contract: Contract;
  let appliedDocHash: Uint8Array | null;
  try {
    // Construction inside the try: an account string the SDK rejects (bad
    // checksum) must read as "no doc surface", not escape as a throw.
    server = new rpc.Server(RPC_URL);
    contract = new Contract(account);
    const rv = await simulateView(server, contract, 'applied_doc_hash');
    const native = scValToNative(rv) as Uint8Array | Buffer | null | undefined;
    appliedDocHash = native == null ? null : new Uint8Array(native);
  } catch {
    // No `applied_doc_hash` on this account (older wasm) — or the RPC is
    // down, in which case every other read on the page fails loudly anyway.
    return { supported: false, appliedDocHash: null };
  }
  return { supported: true, appliedDocHash };
}

/** Lowercase hex of raw bytes (no deps — small enough to keep local). */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export interface RecoveredDocJson {
  json: string;
  source: DocJsonSource;
  /** The configuration revision the document belongs to: what an apply
   *  composed from it names as `expected_revision`. */
  revision: bigint;
}

/**
 * The applied document's canonical JSON and the configuration revision it
 * belongs to, from the account's `document()` view (one read, stellar-
 * registry/perch#108). `json` is undefined before the first `apply_doc`;
 * the revision is still the account's (0 after the constructor). Throws
 * when the view doesn't answer.
 */
export async function fetchAppliedDocument(account: string): Promise<{ revision: bigint; json: string | undefined }> {
  const { revision, canonical } = await perch.readDocument({
    account,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  return { revision, json: canonical };
}

/**
 * Recover the applied document's JSON from the lossless on-chain copy (the
 * `document()` view, stored by `apply_doc`), with its revision. A Perch
 * account's `DocApplied` event names the hash and counts the changes but
 * carries no document, so there is no event fallback. Returns null when
 * there is no document or the view doesn't answer (readPolicy then
 * classifies the account as tier c).
 */
export async function fetchAppliedDocJson(account: string): Promise<RecoveredDocJson | null> {
  try {
    const { revision, json } = await fetchAppliedDocument(account);
    return json === undefined ? null : { json, source: 'storage', revision };
  } catch {
    // View absent (an account without Perch's consumer interface).
    return null;
  }
}

/** The interpreter the account's pinned build attaches: from the Perch
 *  deployment manifest, else the canonical testnet one. */
function interpreterAddress(): string {
  return perchDeployment()?.interpreter ?? perchTestnetAddresses().interpreter;
}

/** Fetch the interpreter's install params (program and rule-hash
 *  provenance) for each doc-managed rule, keyed by rule id. Missing/unreadable entries are simply absent (readPolicy
 *  treats absence as "cannot check program content", not as drift). */
export async function fetchInterpreterPrograms(
  account: string,
  ruleIds: number[],
): Promise<Record<number, { program: import('@nidohq/passkey-sdk').RpnProgram; ruleHash: Uint8Array }>> {
  if (ruleIds.length === 0) return {};
  const client = new InterpreterClient({
    contractId: interpreterAddress(),
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
  });
  const out: Record<number, { program: import('@nidohq/passkey-sdk').RpnProgram; ruleHash: Uint8Array }> = {};
  await Promise.all(
    ruleIds.map(async (id) => {
      try {
        const tx = await client.get_program({ smart_account: account, context_rule_id: id });
        const params = tx.result;
        if (params) {
          // `doc_hash` keeps its name, but since stellar-registry/perch#102 it
          // is the rule's hash (perch-js `ruleHash`), not the document's.
          out[id] = { program: params.program, ruleHash: new Uint8Array(params.doc_hash) };
        }
      } catch {
        // Rule carries no interpreter program (or the read failed) — skip.
      }
    }),
  );
  return out;
}

export interface DocPolicyRead {
  result: ReadPolicyResult;
  /** Where the tier-a/b document came from, or null for tier c. */
  docSource: DocJsonSource | null;
  /** Whether the account exposes the `apply_doc` surface at all. */
  surfaceSupported: boolean;
  /** True when the surface exists but NO document has ever been applied —
   *  a fresh account. The page then renders the synthesized baseline
   *  (adminBaseline over the default rule's passkey, the SAME baseline
   *  every first-apply flow composes against) as the effective policy,
   *  labeled not-yet-applied. */
  unapplied: boolean;
}

/**
 * The full doc-layer read for the policy page: probe the surface, recover
 * the document, fetch programs, and classify via the SDK's `readPolicy`.
 */
export async function readDocPolicy(
  account: string,
  chainRules: ChainRule[],
): Promise<DocPolicyRead> {
  const surface = await fetchDocSurface(account);
  const storedHex = surface.appliedDocHash === null ? null : toHex(surface.appliedDocHash);
  const recovered = storedHex === null ? null : await fetchAppliedDocJson(account);
  // Every live rule but the zero-signer recovery rule came from the
  // document (`apply_doc` replaces the whole set). The recovery rule is
  // known by the account's own flag, never by its name: a document may name
  // a rule "recovery".
  const docRuleIds = surface.appliedDocHash === null
    ? []
    : (await readAccountConfiguration(account)).rules.filter((r) => !r.recovery).map((r) => r.id);
  const programs = await fetchInterpreterPrograms(account, docRuleIds);
  const deployment = perchDeployment();
  const spendingLimitAddress =
    deployment?.spendingLimit ??
    (await fetchRegistryAddress('spending-limit-policy').catch(() => undefined));

  const result = readPolicy({
    chainRules,
    appliedDocHash: surface.appliedDocHash,
    // The on-chain canonical copy; readPolicy checks it against the stored hash.
    ...(recovered ? { storedDocJson: recovered.json } : {}),
    decompileCtx: {
      account,
      interpreterAddress: interpreterAddress(),
      ...(spendingLimitAddress !== undefined ? { spendingLimitAddress } : {}),
      programs,
    },
  });
  return {
    result,
    docSource: result.tier === 'decompiled' ? null : (recovered?.source ?? null),
    surfaceSupported: surface.supported,
    unapplied: surface.supported && surface.appliedDocHash === null,
  };
}

/**
 * The synthesized FIRST-APPLY baseline document for a fresh doc-surface
 * account: the founder admin rule over the default rule's live passkey —
 * byte-identical to what the builder and both delegate pages compose
 * against on a first apply, so the policy page's "effective policy"
 * rendering and the flows agree on one baseline. Null when the passkey
 * cannot be read (the flows fail closed on the same condition).
 */
export async function fetchUnappliedBaseline(
  account: string,
  networkPassphrase: string,
): Promise<PolicyDoc | null> {
  try {
    const info = await fetchDefaultRuleAuthInfo(account);
    const passkey = info.externalSigners[0];
    if (passkey === undefined) return null;
    return adminBaseline(
      { verifier: passkey.verifier, publicKeyHex: toHex(passkey.publicKey) },
      networkPassphrase,
    );
  } catch {
    return null;
  }
}
