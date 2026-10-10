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
import { fetchRegistryAddress as sdkFetchRegistryAddress, perch } from '@nidohq/passkey-sdk';
import { Client as SpendingLimitPolicyClient } from '@nidohq/spending-limit-policy';
import { perchDeployment } from './recovery/deployment.js';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
// Unverified registry on testnet — the one that holds bare-name → contract-id
// mappings. The verified registry (CAMLHK…) doesn't dispatch prefixed names
// natively; the CLI does that client-side. We target unverified directly so
// `fetch_contract_id("verifier")` resolves without a prefix.
const REGISTRY_ADDRESS = 'CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S';

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

/** The account's `configuration()` view: every installed rule (its OZ id,
 *  name, scope, signers, policies, and whether it is the recovery rule),
 *  the recovery rule's id, the freeze, and the revision they all belong to,
 *  in one read (stellar-registry/perch#108). Selection runs on this, never
 *  on an id scan: ids move when a document replaces a rule, and OZ never
 *  reuses one. */
export async function readAccountConfiguration(account: string): Promise<perch.AccountConfiguration> {
  const deployment = perchDeployment();
  if (!deployment) throw new Error('This build has no Perch deployment.');
  const reader = perch.accountSnapshotReader({
    account,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    docCompiler: deployment.docCompiler,
  });
  return (await reader.configuration()).value;
}

/** An installed Perch rule in the `ChainRule` shape the UI consumes. */
export function chainRuleOf(r: perch.InstalledRule): ChainRule {
  return {
    ruleId: r.id,
    contextType: { kind: 'call-contract', contract: r.contract },
    name: r.name,
    signers: r.signers.map((s): ChainSigner =>
      s.kind === 'delegated'
        ? { kind: 'delegated', address: s.address }
        : { kind: 'external', verifier: s.verifier, publicKey: s.key },
    ),
    policies: r.policies.map((x) => x.policy),
    validUntil: r.validUntil,
  };
}

/** Every rule installed on a smart account, the recovery rule included, from
 *  one `configuration()` read. */
export async function fetchAllChainRules(account: string): Promise<ChainRule[]> {
  return (await readAccountConfiguration(account)).rules.map(chainRuleOf);
}

/** For each policy address attached to a rule, fetch its per-(account,rule)
 *  state. The multisig policy yields `{ threshold }` (via its `get_threshold`
 *  view); the spending-limit policy yields `{ spendingLimit }` (via
 *  `fetchSpendingLimit`); the Perch recovery controller yields
 *  `{ recoveryController: true }` (its configuration is the applied
 *  document's `recovery` member, read by the recovery pages). Unknown /
 *  unreadable policies yield `{}`. */
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
    if (policyAddr === perchDeployment()?.recoveryController) {
      state[policyAddr] = { recoveryController: true };
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
  return sdkFetchRegistryAddress(name, {
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    registryId: REGISTRY_ADDRESS,
  });
}

/** The account factory new Nidos are minted by: the Perch deployment's (Nido's
 *  factory around Perch's account) when this build has one, otherwise the
 *  registry's `factory`. */
export async function fetchFactoryAddress(): Promise<string> {
  return perchDeployment()?.factory ?? fetchRegistryAddress('factory');
}

/** The id of the rule on `account` that holds an External signer with the
 *  given public key (see `resolveSignerRule`), or `null` when none does
 *  (e.g. the delegation never committed, or the rule was removed). */
export async function findRuleForPubkey(
  account: string,
  pubkeyHex: string,
): Promise<number | null> {
  const resolved = await resolveSignerRule(account, pubkeyHex);
  return resolved ? resolved.ruleId : null;
}

const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** The rule a passkey signs under, the verifier its External signer names,
 *  and the configuration revision they were read at, from one
 *  `configuration()` read (see `selectSignerRule`). `null` when no rule
 *  holds the passkey. */
export async function resolveSignerRule(
  account: string,
  pubkeyHex: string,
  ruleName?: string,
): Promise<{ ruleId: number; ruleName: string; verifier: string; revision: bigint } | null> {
  return selectSignerRule(await readAccountConfiguration(account), account, pubkeyHex, ruleName);
}

/** Pure selection over one configuration: with `ruleName`, only that rule;
 *  without, a rule scoped to the account itself (the admin authority
 *  `execute` and `apply_doc` need) before any other. The recovery rule never
 *  matches. Exported for unit testing. */
export function selectSignerRule(
  config: perch.AccountConfiguration,
  account: string,
  pubkeyHex: string,
  ruleName?: string,
): { ruleId: number; ruleName: string; verifier: string; revision: bigint } | null {
  const wanted = pubkeyHex.toLowerCase();
  const holders = config.rules
    .filter((r) => !r.recovery && (ruleName === undefined || r.name === ruleName))
    .flatMap((r) =>
      r.signers
        .filter((sg) => sg.kind === 'external' && toHex(sg.key) === wanted)
        .map((sg) => ({ rule: r, verifier: (sg as { verifier: string }).verifier })),
    );
  const pick = holders.find((h) => h.rule.contract === account) ?? holders[0];
  return pick
    ? { ruleId: pick.rule.id, ruleName: pick.rule.name, verifier: pick.verifier, revision: config.revision }
    : null;
}

/** The verifier the account's admin passkey is registered against: the
 *  first External signer of its `admin` rule (selected by name, as perch-js
 *  does), falling back to the deployment's verifier, then the registry's. */
export async function fetchVerifierAddress(account: string): Promise<string> {
  try {
    const admin = (await readAccountConfiguration(account)).rules.find(
      (r) => !r.recovery && r.name === 'admin' && r.contract === account,
    );
    const external = admin?.signers.find((sg) => sg.kind === 'external');
    if (external?.kind === 'external') return external.verifier;
  } catch {
    // fall through to the deployment's verifier, then the registry
  }
  return perchDeployment()?.webauthnVerifier ?? fetchRegistryAddress('verifier');
}

/** What the wallet's sign ceremony needs to know about the signing rule
 *  (the account's `admin` rule unless another is named) before running
 *  WebAuthn (issue #87). */
export interface DefaultRuleAuthInfo {
  /** External (passkey) signers on the rule. */
  externalSigners: { verifier: string; publicKey: Uint8Array }[];
  /** Delegated (account-address) signers on the rule. */
  delegatedCount: number;
  /** Number of policies attached to the rule. */
  policyCount: number;
  /** Simple-threshold M, when one of the policies exposes `get_threshold`
   *  (> 0 means installed); null when no policy reports a threshold. */
  threshold: number | null;
}

/** Read the signing rule's signers, policies, and (if installed) the
 *  simple-threshold M: rule `ruleId`, or the account's `admin` rule. Drives the sign-ceremony preflight: a policy-less multi-signer rule is
 *  N-of-N under OZ semantics, so the ceremony must collect N signatures (or
 *  bail out with a human-readable explanation) instead of letting the
 *  enforce-simulation fail with a raw #3002 HostError. */
export async function fetchDefaultRuleAuthInfo(
  account: string,
  ruleId?: number,
): Promise<DefaultRuleAuthInfo> {
  // The named rule, or the account's `admin` rule, from `configuration()`.
  const rules = (await readAccountConfiguration(account)).rules;
  const installed =
    ruleId === undefined
      ? rules.find((r) => !r.recovery && r.name === 'admin' && r.contract === account)
      : rules.find((r) => r.id === ruleId);
  if (!installed) throw new Error(`no ${ruleId === undefined ? 'admin' : `#${ruleId}`} rule on ${account}`);
  const rule = chainRuleOf(installed);

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
