import {
  rpc,
  Contract,
  TransactionBuilder,
  Account,
  Networks,
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import type { ChainRule, ChainSigner, PolicyState } from '@nidohq/passkey-sdk';
import { fetchRegistryAddress as sdkFetchRegistryAddress } from '@nidohq/passkey-sdk';
import { Client as SpendingLimitPolicyClient } from '@nidohq/spending-limit-policy';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
// Unverified registry on testnet — the one that holds bare-name → contract-id
// mappings. The verified registry (CAMLHK…) doesn't dispatch prefixed names
// natively; the CLI does that client-side. We target unverified directly so
// `fetch_contract_id("verifier")` resolves without a prefix.
const REGISTRY_ADDRESS = 'CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S';

// --- ZK preview mode (PR-preview builds only; testnet) ---------------------
//
// When `PUBLIC_ZK_PREVIEW` is set at build time, `fetchRegistryAddress`
// resolves `factory` / `zk-recovery` to this hardcoded testnet PAIR instead of
// going through the registry, so a PR-preview build can exercise
// `create_account_v2`'s genesis-insert (on-chain invisibility) without
// touching the production registry entries. Production (`PUBLIC_ZK_PREVIEW`
// unset/falsy) is completely unaffected — this block is dead code in that
// build. See DEPLOYED.md's "Preview (factory-v2)" section.
const ZK_PREVIEW_ENABLED = Boolean(import.meta.env.PUBLIC_ZK_PREVIEW);
/** TESTNET PREVIEW ONLY — factory-v2-preview, supports `create_account_v2`. */
const ZK_PREVIEW_FACTORY_ADDRESS = 'CA2NQS3V6XCNA4FZDPQ4JLSQ65CRWMHHLYQEZ5YQ7MYQX2G5USZ4GWBL';
/** TESTNET PREVIEW ONLY — pool-v2-preview, the recovery pool bound to the factory above. */
const ZK_PREVIEW_ZK_RECOVERY_ADDRESS = 'CDXT3DCXYFNZNKBST7VZMN5RJWH24HQXO3WLENQEP7YMPAEZJTQNMEKS';
const ZK_PREVIEW_ADDRESSES: Record<string, string> = {
  factory: ZK_PREVIEW_FACTORY_ADDRESS,
  'zk-recovery': ZK_PREVIEW_ZK_RECOVERY_ADDRESS,
};

/** Simulate-only invocation of a contract view method. Returns the result ScVal. */
export async function simulateView(
  server: rpc.Server,
  contract: Contract,
  method: string,
  ...args: xdr.ScVal[]
): Promise<xdr.ScVal> {
  // Dummy source account — same pattern used in fetchXlmBalance.
  const sourceAccount = new Account(
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    '0',
  );
  const tx = new TransactionBuilder(sourceAccount, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(0)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulateView ${method}: ${(sim as rpc.Api.SimulateTransactionErrorResponse).error}`);
  }
  const result = (sim as rpc.Api.SimulateTransactionSuccessResponse).result;
  if (!result) throw new Error(`simulateView ${method}: no result`);
  return result.retval;
}

/** OZ's SmartAccountError::ContextRuleNotFound surfaces from a failed
 *  simulation as `Error(Contract, #3000)`. Rule ids are MONOTONIC and never
 *  reused (`NextId`), while `get_context_rules_count` only counts live rules —
 *  so any revoke that isn't the newest rule leaves an id gap that panics
 *  `get_context_rule`. Enumerators must treat this error as "skip". */
export function isRuleNotFound(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Error\(Contract, #3000\)|ContextRuleNotFound/.test(msg);
}

/** Read all installed context rules from a smart account.
 *
 *  Decodes rules RAW (`scValToNative` with no type hint) rather than through the
 *  typed `smart-account` bindings. The typed Spec decode is strict and throws
 *  `Type … was not vec, but … is` (stellar-sdk `spec.js` `scValToNative`) when an
 *  account's on-chain `ContextRule` shape predates the regenerated bindings —
 *  e.g. built against a slightly different soroban-sdk minor. `findRuleForPubkey`
 *  and `fetchVerifierAddress` already decode raw for exactly this reason; this is
 *  the last loader to follow suit, so the Trusted-friends list no longer breaks
 *  with "Couldn't load: Type [object Object] was not vec…". */
export async function fetchAllChainRules(account: string): Promise<ChainRule[]> {
  const server = new rpc.Server(RPC_URL);
  const contract = new Contract(account);

  const countRv = await simulateView(server, contract, 'get_context_rules_count');
  const count = scValToNative(countRv) as number;

  const out: ChainRule[] = [];
  // Scan ids upward, skipping revoke-created gaps, until `count` rules are
  // found. The scan bound only guards a pathological account (more than 100
  // revoked rules below the live ones) from looping forever.
  for (let id = 0, found = 0; found < count && id < count + 100; id++) {
    let ruleRv;
    try {
      ruleRv = await simulateView(
        server,
        contract,
        'get_context_rule',
        nativeToScVal(id, { type: 'u32' }),
      );
    } catch (err) {
      if (isRuleNotFound(err)) continue;
      throw err;
    }
    out.push(parseRule(scValToNative(ruleRv)));
    found++;
  }
  // A truncated scan must be LOUD: returning a silently short list re-creates
  // the original invisible-rule symptom (and callers may react destructively,
  // e.g. wiping material and re-delegating at an even higher id).
  if (out.length < count) {
    throw new Error(
      `context-rule scan exhausted: found ${out.length} of ${count} live rules within ids 0..${count + 99}`,
    );
  }
  return out;
}

/** For each policy address attached to a rule, fetch its per-(account,rule)
 *  state. The multisig policy yields `{ threshold }` (via its `get_threshold`
 *  view); the spending-limit policy yields `{ spendingLimit }` (via
 *  `fetchSpendingLimit`). Unknown / unreadable policies yield `{}`. */
export async function fetchPolicyState(
  account: string,
  rule: ChainRule,
): Promise<PolicyState> {
  const server = new rpc.Server(RPC_URL);
  const state: PolicyState = {};
  const limitPolicyAddr = await spendingLimitPolicyId().catch(() => null);
  for (const policyAddr of rule.policies) {
    if (policyAddr === limitPolicyAddr) {
      const limit = await fetchSpendingLimit(account, rule);
      // 'unreadable' (not {}): the rule verifiably carries the spending-limit
      // policy, so an unreadable limit must not make the whole block vanish
      // from the UI (and with it the only Revoke path).
      state[policyAddr] = limit ? { spendingLimit: limit } : { spendingLimit: 'unreadable' };
      continue;
    }
    try {
      const rv = await simulateView(
        server,
        new Contract(policyAddr),
        'get_threshold',
        nativeToScVal(rule.ruleId, { type: 'u32' }),
        Address.fromString(account).toScVal(),
      );
      const threshold = scValToNative(rv) as number;
      state[policyAddr] = { threshold };
    } catch {
      state[policyAddr] = {};
    }
  }
  return state;
}

// Registry-resolved spending-limit-policy address, cached as a promise (same
// pattern as the account page's `nameRegistryId`): all rules on a page share
// one lookup.
let _spendingLimitPolicyIdPromise: Promise<string> | null = null;
function spendingLimitPolicyId(): Promise<string> {
  return (_spendingLimitPolicyIdPromise ??= fetchRegistryAddress('spending-limit-policy'));
}

/** Read the spending limit installed on `rule` for `account`, if the rule
 *  carries the registry-resolved spending-limit policy. READ-ONLY: the
 *  generated bindings client simulates `get_spending_limit({context_rule_id,
 *  smart_account})` and we never sign or send. Returns `null` when the rule
 *  has no spending-limit policy, the params aren't installed, or the read
 *  fails (mirrors `fetchPolicyState`'s tolerant threshold read). */
export async function fetchSpendingLimit(
  account: string,
  rule: ChainRule,
): Promise<{ stroops: bigint; periodLedgers: number } | null> {
  let policyAddr: string;
  try {
    policyAddr = await spendingLimitPolicyId();
  } catch {
    return null; // registry unreachable
  }
  if (!rule.policies.includes(policyAddr)) return null;
  try {
    const client = new SpendingLimitPolicyClient({
      contractId: policyAddr,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
    });
    const tx = await client.get_spending_limit({
      context_rule_id: rule.ruleId,
      smart_account: account,
    });
    const params = tx.result; // Option<SpendingLimitAccountParams>
    if (!params) return null;
    return {
      stroops: BigInt(params.spending_limit),
      periodLedgers: Number(params.period_ledgers),
    };
  } catch {
    return null;
  }
}

/** Resolve a canonical contract name via the on-chain registry. The factory
 *  uses this same lookup; the frontend mirrors it so SDK helpers can resolve
 *  policy and verifier addresses without going through the factory.
 *
 *  Delegates to the SDK's `fetchRegistryAddress` (single source of truth for
 *  registry routing + hardcoded fallbacks), pinned to this frontend's testnet
 *  RPC / network / registry constants. */
export async function fetchRegistryAddress(name: string): Promise<string> {
  if (ZK_PREVIEW_ENABLED && name in ZK_PREVIEW_ADDRESSES) {
    return ZK_PREVIEW_ADDRESSES[name];
  }
  return sdkFetchRegistryAddress(name, {
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    registryId: REGISTRY_ADDRESS,
  });
}

/** Resolve the verifier address that THIS account actually trusts for its
 *  primary passkey, by reading the External signer on the default rule.
 *
 *  Critical: do NOT just look up `unverified/verifier` in the registry.
 *  Accounts created by an old factory (pre-Architecture-C) reference a
 *  verifier contract whose address differs from the currently-registered
 *  one — the factory hardcodes a wasm hash and lazy-deploys, which yields
 *  a different deterministic address per factory build. If we sign citing
 *  a verifier the rule doesn't list, the smart account's signer-map
 *  lookup fails and __check_auth traps with Auth/InvalidAction even
 *  though the signature itself is perfectly valid.
 *
 *  Falls back to the registry if the account has no External signer on
 *  rule 0 (would only happen on a non-standard / freshly-uninstalled
 *  account), so existing call sites that pass an arbitrary account don't
 *  crash.
 */
/** Find the context-rule id on `account` that contains an External signer
 *  with the given public key. Returns `null` if no such rule exists (e.g.
 *  delegation install transaction never actually committed, or the rule
 *  has been revoked).
 *
 *  Scans rule ids (gap-tolerant) until `get_context_rules_count()` rules
 *  have been seen. Used to discover which rule_id our session
 *  passkey lives under so the signing-side AuthPayload + computed digest
 *  both reference the correct rule. */
export async function findRuleForPubkey(
  account: string,
  pubkeyHex: string,
): Promise<number | null> {
  const resolved = await resolveSignerRule(account, pubkeyHex);
  return resolved ? resolved.ruleId : null;
}

/** The rule a passkey signs under, plus the verifier that rule's External
 *  signer is registered against. Returns both from ONE gap-tolerant scan so a
 *  caller needs neither a separate `get_context_rule(0)` (fetchVerifierAddress)
 *  nor a second scan — and the verifier comes from the RESOLVED rule, not an
 *  assumed rule 0 (which diverges for a recovered account whose new passkey
 *  lives in a later rule). `null` when the pubkey is on no rule. */
export async function resolveSignerRule(
  account: string,
  pubkeyHex: string,
): Promise<{ ruleId: number; verifier: string } | null> {
  const server = new rpc.Server(RPC_URL);
  const countRv = await simulateView(server, new Contract(account), 'get_context_rules_count');
  const count = scValToNative(countRv) as number;
  const lowerHex = pubkeyHex.toLowerCase();
  // Gap-tolerant id scan — see isRuleNotFound for why ids aren't contiguous.
  let found = 0;
  for (let id = 0; found < count && id < count + 100; id++) {
    let ruleRv;
    try {
      ruleRv = await simulateView(
        server,
        new Contract(account),
        'get_context_rule',
        nativeToScVal(id, { type: 'u32' }),
      );
    } catch (err) {
      if (isRuleNotFound(err)) continue;
      throw err;
    }
    found++;
    const native = scValToNative(ruleRv) as { id?: number; signers?: unknown[] };
    for (const s of native.signers ?? []) {
      // ["External", verifier, pubkey_bytes_as_array_or_buffer]
      if (Array.isArray(s) && s[0] === 'External') {
        const raw = s[2];
        let candidateHex: string | null = null;
        if (raw instanceof Uint8Array) {
          candidateHex = Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('');
        } else if (Array.isArray(raw)) {
          candidateHex = (raw as number[])
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        } else if (typeof raw === 'object' && raw !== null) {
          // scValToNative sometimes hands back the buffer as an object with
          // numeric keys; rebuild as bytes.
          const obj = raw as Record<string, number>;
          const ordered: number[] = [];
          for (let j = 0; obj[j as unknown as string] !== undefined; j++) {
            ordered.push(obj[j as unknown as string]);
          }
          if (ordered.length > 0) {
            candidateHex = ordered.map((b) => b.toString(16).padStart(2, '0')).join('');
          }
        }
        if (candidateHex && candidateHex === lowerHex) {
          const verifier = typeof s[1] === 'string' ? s[1] : String(s[1]);
          return { ruleId: native.id ?? id, verifier };
        }
      }
    }
  }
  // A truncated scan must be LOUD: returning a silently short list re-creates
  // the original invisible-rule symptom (and callers may react destructively,
  // e.g. wiping material and re-delegating at an even higher id).
  if (found < count) {
    throw new Error(
      `context-rule scan exhausted: found ${found} of ${count} live rules within ids 0..${count + 99}`,
    );
  }
  return null;
}

/** Read the verifier address the account's default rule references.
 *
 *  Reads `get_context_rule(0).signers` via raw `scValToNative` (not the
 *  typed bindings, whose ContextRule shape would mismatch if the account
 *  was built against a slightly different soroban-sdk minor). Returns the
 *  first External signer's verifier address, falling back to the registry
 *  if the account hasn't been queryable or has no external signer. */
export async function fetchVerifierAddress(account: string): Promise<string> {
  try {
    const server = new rpc.Server(RPC_URL);
    const rv = await simulateView(
      server,
      new Contract(account),
      'get_context_rule',
      nativeToScVal(0, { type: 'u32' }),
    );
    const native = scValToNative(rv) as { signers?: unknown[] };
    for (const s of native.signers ?? []) {
      // scValToNative decodes a Soroban Signer enum (tuple variant) as a
      // plain array: ["External", verifier_address, pubkey_bytes].
      if (Array.isArray(s) && s[0] === 'External' && typeof s[1] === 'string') {
        return s[1];
      }
    }
  } catch {
    // fall through to registry
  }
  return fetchRegistryAddress('verifier');
}

/** What the wallet's sign ceremony needs to know about the default rule
 *  (id 0) before running WebAuthn (issue #87). */
export interface DefaultRuleAuthInfo {
  /** External (passkey) signers on rule 0. */
  externalSigners: { verifier: string; publicKey: Uint8Array }[];
  /** Delegated (account-address) signers on rule 0. */
  delegatedCount: number;
  /** Number of policies attached to rule 0. */
  policyCount: number;
  /** Simple-threshold M, when one of the policies exposes `get_threshold`
   *  (> 0 means installed); null when no policy reports a threshold. */
  threshold: number | null;
}

/** Read rule 0's signers, policies, and (if installed) the simple-threshold
 *  M. Drives the sign-ceremony preflight: a policy-less multi-signer rule is
 *  N-of-N under OZ semantics, so the ceremony must collect N signatures (or
 *  bail out with a human-readable explanation) instead of letting the
 *  enforce-simulation fail with a raw #3002 HostError. */
export async function fetchDefaultRuleAuthInfo(
  account: string,
  ruleId = 0,
): Promise<DefaultRuleAuthInfo> {
  const server = new rpc.Server(RPC_URL);
  const rv = await simulateView(
    server,
    new Contract(account),
    'get_context_rule',
    nativeToScVal(ruleId, { type: 'u32' }),
  );
  const rule = parseRule(scValToNative(rv) as RawContextRule);

  const externalSigners = rule.signers
    .filter((s): s is { kind: 'external'; verifier: string; publicKey: Uint8Array } => s.kind === 'external')
    .map((s) => ({ verifier: s.verifier, publicKey: s.publicKey }));
  const delegatedCount = rule.signers.length - externalSigners.length;

  let threshold: number | null = null;
  if (rule.policies.length > 0) {
    try {
      const state = await fetchPolicyState(account, rule);
      for (const policyAddr of rule.policies) {
        const t = (state[policyAddr] as { threshold?: unknown } | undefined)?.threshold;
        if (typeof t === 'number' && t > 0) {
          threshold = t;
          break;
        }
      }
    } catch {
      // leave threshold null on read failure
    }
  }

  return {
    externalSigners,
    delegatedCount,
    policyCount: rule.policies.length,
    threshold,
  };
}

/** Result of locating the single old passkey to remove during recovery. */
export type RemovableSigner =
  | { ok: true; signerId: number; publicKey: Uint8Array }
  | { ok: false; reason: 'none' | 'multiple' | 'unreadable'; count?: number };

/**
 * Pure selection: given rule 0's parsed signers and their positionally-aligned
 * `signer_ids`, decide which single External (passkey) signer the recovery
 * "remove the lost device's key" checkbox targets. We auto-pick only when there
 * is exactly one External signer; 0, >1, or a missing id is reported so the
 * caller never guesses. Exported for unit testing.
 */
export function selectRemovableSigner(
  signers: ChainSigner[],
  signerIds: number[],
): RemovableSigner {
  const externals = signers
    .map((signer, i) => ({ signer, id: signerIds[i] }))
    .filter(
      (e): e is { signer: { kind: 'external'; verifier: string; publicKey: Uint8Array }; id: number } =>
        e.signer.kind === 'external',
    );

  if (externals.length === 0) return { ok: false, reason: 'none' };
  if (externals.length > 1) return { ok: false, reason: 'multiple', count: externals.length };
  if (!Number.isInteger(externals[0].id)) return { ok: false, reason: 'unreadable' };
  return { ok: true, signerId: externals[0].id, publicKey: externals[0].signer.publicKey };
}

/**
 * Find the External (passkey) signer to remove from rule 0 during recovery.
 *
 * The on-chain `ContextRule` carries `signer_ids: Vec<u32>` positionally
 * aligned with `signers`, but `parseRule` drops it — so we re-decode the raw
 * struct here to recover each signer's removable id. During recovery the new
 * passkey isn't on-chain yet, so the existing External signer(s) on rule 0 are
 * the lost device's key. Delegates the decision to `selectRemovableSigner`.
 */
export async function findRemovableOldSigner(account: string): Promise<RemovableSigner> {
  let native: RawContextRule & { signer_ids?: (number | bigint)[] };
  try {
    const server = new rpc.Server(RPC_URL);
    const rv = await simulateView(
      server,
      new Contract(account),
      'get_context_rule',
      nativeToScVal(0, { type: 'u32' }),
    );
    native = scValToNative(rv) as RawContextRule & { signer_ids?: (number | bigint)[] };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }

  const signers = (native.signers ?? []).map(parseSigner);
  const signerIds = Array.from(native.signer_ids ?? []).map((n) => Number(n));
  return selectRemovableSigner(signers, signerIds);
}

// --- Internal parsers ------------------------------------------------------

/** Raw `scValToNative` shape of one ContextRule: a Soroban struct decodes to a
 *  plain object with snake_case keys; its enum fields decode to tag-first arrays
 *  (e.g. `["External", verifier, bytes]`). A fieldless variant may arrive as a
 *  bare `"Default"` symbol or `["Default"]` — `enumTag` normalizes both. */
interface RawContextRule {
  id: number | bigint;
  context_type: unknown;
  name: string;
  signers?: unknown[];
  policies?: unknown[];
  valid_until?: number | bigint | null;
}

/** Map a raw-decoded ContextRule into the typed `ChainRule` the UI consumes.
 *  Exported for unit testing. */
export function parseRule(native: RawContextRule): ChainRule {
  return {
    ruleId: Number(native.id),
    contextType: parseContextType(native.context_type),
    name: native.name,
    signers: (native.signers ?? []).map(parseSigner),
    policies: Array.from(native.policies ?? []).map((p) => String(p)),
    validUntil: native.valid_until == null ? null : Number(native.valid_until),
  };
}

/** Normalize a raw-decoded Soroban enum (tag-first array, or bare symbol for a
 *  fieldless variant) to `{ tag, values }`. */
function enumTag(v: unknown): { tag: string; values: unknown[] } {
  if (Array.isArray(v)) return { tag: String(v[0]), values: v.slice(1) };
  return { tag: String(v), values: [] };
}

function parseContextType(ct: unknown): ChainRule['contextType'] {
  const { tag, values } = enumTag(ct);
  if (tag === 'Default') return { kind: 'default' };
  if (tag === 'CallContract')
    return { kind: 'call-contract', contract: String(values[0]) };
  if (tag === 'CreateContract')
    return {
      kind: 'create-contract',
      wasm: new Uint8Array(values[0] as ArrayLike<number>),
    };
  throw new Error(`unknown context type: ${tag}`);
}

function parseSigner(s: unknown): ChainSigner {
  const { tag, values } = enumTag(s);
  if (tag === 'Delegated') return { kind: 'delegated', address: String(values[0]) };
  if (tag === 'External') {
    return {
      kind: 'external',
      verifier: String(values[0]),
      publicKey: new Uint8Array(values[1] as ArrayLike<number>),
    };
  }
  throw new Error(`unknown signer: ${tag}`);
}
