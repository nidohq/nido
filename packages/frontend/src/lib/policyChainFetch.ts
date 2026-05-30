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

const RPC_URL = 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
const REGISTRY_ADDRESS = 'CAMLHKQHNZO2IOIBFUF5BGZ2V62BMS5QCWFFGRCB4NOB3G5OMDA7SGZN';

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
 *  policy and verifier addresses without going through the factory. */
export async function fetchRegistryAddress(name: string): Promise<string> {
  const server = new rpc.Server(RPC_URL);
  const rv = await simulateView(
    server,
    new Contract(REGISTRY_ADDRESS),
    'fetch_contract_id',
    nativeToScVal(name, { type: 'string' }),
  );
  // The registry returns an `Address` — scValToNative converts to a strkey.
  return scValToNative(rv) as string;
}

/** Convenience wrapper used by `scopedSessionKeyModule.buildInstall`'s
 *  `verifierAddress` injection. */
export async function fetchVerifierAddress(_account: string): Promise<string> {
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
