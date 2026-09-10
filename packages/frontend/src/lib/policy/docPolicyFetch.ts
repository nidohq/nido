// Chain reads for the perch doc layer: the smart account's `apply_doc`
// surface (`applied_doc_hash` / `doc_rule_ids` / `get_applied_doc`), the
// `DocApplied` event fallback, and the interpreter's per-rule programs —
// composed into the SDK's three-tier `readPolicy`.
//
// Every read here is simulate-only / RPC-only; nothing signs. All reads are
// tolerant of accounts WITHOUT the doc surface (pre-`apply_doc` wasm): they
// resolve to "no document", which `readPolicy` classifies as tier c and the
// inspector renders as the raw rule cards.

import { rpc, Contract, scValToNative, xdr } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import {
  DOC_APPLIED_EVENT,
  perchTestnetAddresses,
  readPolicy,
  type ChainRule,
  type ReadPolicyResult,
} from '@nidohq/passkey-sdk';
import { Client as InterpreterClient } from '@stellar-registry/perch-interpreter';
import { fetchRegistryAddress, simulateView } from '../policyChainFetch.js';
import { RPC_URL, NETWORK_PASSPHRASE } from '../network.js';

/** How far back the `DocApplied` event fallback scans. Testnet RPC keeps
 *  roughly a day of events; ask for a bit less so the request never starts
 *  before retention (which errors rather than clamping). */
const EVENT_LOOKBACK_LEDGERS = 16000;

/** Where the applied doc's JSON was recovered from. `storage` is the
 *  lossless on-chain copy (`get_applied_doc`); `events` is the `DocApplied`
 *  event history, which only reaches back as far as RPC retention. */
export type DocJsonSource = 'storage' | 'events';

export interface DocSurface {
  /** False when the account predates the `apply_doc` surface (the probe
   *  simulation failed) — such accounts always read as tier c. */
  supported: boolean;
  /** Stored canonical hash, or null if no document was ever applied. */
  appliedDocHash: Uint8Array | null;
  /** Rule ids of the doc-managed rules, in document order. */
  docRuleIds: number[];
}

/** Probe the account's doc surface (`applied_doc_hash` + `doc_rule_ids`). */
export async function fetchDocSurface(account: string): Promise<DocSurface> {
  const server = new rpc.Server(RPC_URL);
  const contract = new Contract(account);
  let appliedDocHash: Uint8Array | null;
  try {
    const rv = await simulateView(server, contract, 'applied_doc_hash');
    const native = scValToNative(rv) as Uint8Array | Buffer | null | undefined;
    appliedDocHash = native == null ? null : new Uint8Array(native);
  } catch {
    // No `applied_doc_hash` on this account (older wasm) — or the RPC is
    // down, in which case every other read on the page fails loudly anyway.
    return { supported: false, appliedDocHash: null, docRuleIds: [] };
  }
  let docRuleIds: number[] = [];
  try {
    const rv = await simulateView(server, contract, 'doc_rule_ids');
    docRuleIds = (scValToNative(rv) as number[]).map(Number);
  } catch {
    docRuleIds = [];
  }
  return { supported: true, appliedDocHash, docRuleIds };
}

/** Decode a `DocApplied` event's data payload to the doc JSON string.
 *  Exported for tests. The generated event data is `{ doc_json: Bytes }`;
 *  accept a bare bytes payload too, so a wire-shape drift degrades to "still
 *  works" rather than "silently tier c". */
export function docJsonFromEventValue(native: unknown): string | null {
  // Realm-safe bytes check: scValToNative yields Buffer, and test
  // environments (jsdom) hand over Uint8Arrays from another realm, so a
  // plain `instanceof` misses both.
  const isBytes = (v: unknown): v is Uint8Array =>
    v instanceof Uint8Array || Object.prototype.toString.call(v) === '[object Uint8Array]';
  const bytes = isBytes(native)
    ? native
    : native != null && typeof native === 'object' && isBytes((native as Record<string, unknown>).doc_json)
      ? ((native as Record<string, unknown>).doc_json as Uint8Array)
      : null;
  if (bytes === null) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
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
}

/**
 * Recover the applied document's JSON. Prefers the lossless on-chain copy
 * (the `get_applied_doc` view, stored by `apply_doc`); falls back to the
 * account's latest `DocApplied` event whose `doc_hash` topic matches the
 * stored hash. Returns null when neither path reaches a document (readPolicy
 * then classifies the account as tier c).
 */
export async function fetchAppliedDocJson(
  account: string,
  storedHashHex: string,
): Promise<RecoveredDocJson | null> {
  const server = new rpc.Server(RPC_URL);

  // Lossless path: the canonical doc JSON in instance storage.
  try {
    const rv = await simulateView(server, new Contract(account), 'get_applied_doc');
    const native = scValToNative(rv) as Uint8Array | Buffer | null | undefined;
    if (native != null) {
      return { json: Buffer.from(native).toString('utf8'), source: 'storage' };
    }
  } catch {
    // View absent (wasm predates doc-JSON storage) — fall through to events.
  }

  // Event fallback: newest DocApplied whose doc_hash topic == stored hash.
  try {
    const latest = await server.getLatestLedger();
    const startLedger = Math.max(1, latest.sequence - EVENT_LOOKBACK_LEDGERS);
    const resp = await server.getEvents({
      startLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [account],
          topics: [[xdr.ScVal.scvSymbol(DOC_APPLIED_EVENT).toXDR('base64'), '*']],
        },
      ],
      limit: 100,
    });
    for (const ev of [...resp.events].reverse()) {
      const hashTopic = ev.topic[1] !== undefined ? (scValToNative(ev.topic[1]) as Uint8Array) : null;
      if (hashTopic === null || toHex(new Uint8Array(hashTopic)) !== storedHashHex) continue;
      const json = docJsonFromEventValue(scValToNative(ev.value));
      if (json !== null) return { json, source: 'events' };
    }
  } catch {
    // Retention exceeded / RPC hiccup — no document recoverable.
  }
  return null;
}

/** Fetch the interpreter's install params for each doc-managed rule, keyed
 *  by rule id. Missing/unreadable entries are simply absent (readPolicy
 *  treats absence as "cannot check program content", not as drift). */
export async function fetchInterpreterPrograms(
  account: string,
  ruleIds: number[],
): Promise<Record<number, { program: import('@nidohq/passkey-sdk').RpnProgram; docHash: Uint8Array }>> {
  if (ruleIds.length === 0) return {};
  const client = new InterpreterClient({
    contractId: perchTestnetAddresses().interpreter,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
  });
  const out: Record<number, { program: import('@nidohq/passkey-sdk').RpnProgram; docHash: Uint8Array }> = {};
  await Promise.all(
    ruleIds.map(async (id) => {
      try {
        const tx = await client.get_program({ smart_account: account, context_rule_id: id });
        const params = tx.result;
        if (params) {
          out[id] = { program: params.program, docHash: new Uint8Array(params.doc_hash) };
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
  const recovered = storedHex === null ? null : await fetchAppliedDocJson(account, storedHex);
  const programs =
    surface.docRuleIds.length > 0
      ? await fetchInterpreterPrograms(account, surface.docRuleIds)
      : {};
  const spendingLimitAddress = await fetchRegistryAddress('spending-limit-policy').catch(
    () => undefined,
  );

  const result = readPolicy({
    chainRules,
    appliedDocHash: surface.appliedDocHash,
    docRuleIds: surface.docRuleIds,
    // View-first, matching the SDK's input surface: the on-chain canonical
    // copy is `storedDocJson`; an event-recovered doc is the fallback field.
    ...(recovered?.source === 'storage' ? { storedDocJson: recovered.json } : {}),
    ...(recovered?.source === 'events' ? { eventDocJson: recovered.json } : {}),
    decompileCtx: {
      account,
      interpreterAddress: perchTestnetAddresses().interpreter,
      ...(spendingLimitAddress !== undefined ? { spendingLimitAddress } : {}),
      programs,
    },
  });
  return {
    result,
    docSource: result.tier === 'decompiled' ? null : (recovered?.source ?? null),
    surfaceSupported: surface.supported,
  };
}
