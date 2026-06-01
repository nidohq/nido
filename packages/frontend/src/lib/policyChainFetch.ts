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
import { Client as SmartAccountClient } from 'smart-account';
import type { ContextRule, ContextRuleType, Signer } from 'smart-account';
import type { ChainRule, ChainSigner, PolicyState } from '@g2c/passkey-sdk';
import { fetchRegistryAddress as sdkFetchRegistryAddress } from '@g2c/passkey-sdk';

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

/** Read all installed context rules from a smart account via the typed bindings. */
export async function fetchAllChainRules(account: string): Promise<ChainRule[]> {
  const client = new SmartAccountClient({
    contractId: account,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
  });
  const countTx = await client.get_context_rules_count();
  const count = countTx.result as number;

  const out: ChainRule[] = [];
  for (let i = 0; i < count; i++) {
    const ruleTx = await client.get_context_rule({ context_rule_id: i });
    out.push(parseRule(ruleTx.result));
  }
  return out;
}

/** For each policy address attached to a rule, fetch its per-(account,rule)
 *  state. Currently only the multisig policy is supported — we call its
 *  `get_threshold` view method directly via simulate. */
export async function fetchPolicyState(
  account: string,
  rule: ChainRule,
): Promise<PolicyState> {
  const server = new rpc.Server(RPC_URL);
  const state: PolicyState = {};
  for (const policyAddr of rule.policies) {
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
 *  Queries each rule sequentially via `get_context_rule(i)` up to
 *  `get_context_rules_count()`. Used to discover which rule_id our session
 *  passkey lives under so the signing-side AuthPayload + computed digest
 *  both reference the correct rule. */
export async function findRuleForPubkey(
  account: string,
  pubkeyHex: string,
): Promise<number | null> {
  const server = new rpc.Server(RPC_URL);
  const countRv = await simulateView(server, new Contract(account), 'get_context_rules_count');
  const count = scValToNative(countRv) as number;
  const lowerHex = pubkeyHex.toLowerCase();
  for (let i = 0; i < count; i++) {
    const ruleRv = await simulateView(
      server,
      new Contract(account),
      'get_context_rule',
      nativeToScVal(i, { type: 'u32' }),
    );
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
        if (candidateHex && candidateHex.toLowerCase() === lowerHex) {
          return native.id ?? i;
        }
      }
    }
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

// --- Internal parsers ------------------------------------------------------

function parseRule(native: ContextRule): ChainRule {
  return {
    ruleId: native.id,
    contextType: parseContextType(native.context_type),
    name: native.name,
    signers: native.signers.map(parseSigner),
    policies: Array.from(native.policies) as string[],
    validUntil: native.valid_until ?? null,
  };
}

function parseContextType(ct: ContextRuleType): ChainRule['contextType'] {
  // ContextRuleType from bindings: { tag: 'Default' | 'CallContract' | 'CreateContract', values: [...] | void }
  if (ct.tag === 'Default') return { kind: 'default' };
  if (ct.tag === 'CallContract') return { kind: 'call-contract', contract: ct.values[0] };
  if (ct.tag === 'CreateContract')
    return { kind: 'create-contract', wasm: new Uint8Array(ct.values[0]) };
  throw new Error(`unknown context type: ${JSON.stringify(ct)}`);
}

function parseSigner(s: Signer): ChainSigner {
  if (s.tag === 'Delegated') return { kind: 'delegated', address: s.values[0] };
  if (s.tag === 'External') {
    return {
      kind: 'external',
      verifier: s.values[0],
      publicKey: new Uint8Array(s.values[1]),
    };
  }
  throw new Error(`unknown signer: ${JSON.stringify(s)}`);
}
