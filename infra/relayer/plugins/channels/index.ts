/**
 * index.ts
 *
 * Entry point for the nido channels relayer plugin. Delegates directly to the upstream
 * OpenZeppelin `@openzeppelin/relayer-plugin-channels` handler.
 *
 * ## Rate limiting
 *
 * The upstream plugin has a per-API-key fee/spend tracker (`FeeTracker` in
 * `@openzeppelin/relayer-plugin-channels`, gated on the `apiKeyHeader` config and
 * `feeLimit`/`feeResetPeriodMs`), which caps total fees submitted per API key per
 * reset period. That is a spend limit, not a per-IP request counter. The deployment's
 * global `FEE_LIMIT` (100 XLM/24h, `infra/relayer/fly.toml`) is the true drain
 * backstop, and a per-IP token bucket in front of the relayer (`infra/relayer/Caddyfile`,
 * zone `relay_per_ip`) raises the cost of request flooding. None of these is a security
 * boundary.
 *
 * There is NO on-chain recovery rate limit in the current stack: Perch's recovery
 * controller enforces none. (A former Nido contract, `contracts/zk-recovery`, capped
 * `initiate_recovery` at 5 per rolling 90 days; it is retired, not in this tree, and
 * not deployed to mainnet — AUDIT_SCOPE "Retired Nido contracts".) On-chain auth on
 * each submitted call is the only enforced gate (AGENTS.md "Relayer channels plugin").
 *
 * TODO(rate-limit): if finer per-IP control is wanted inside this plugin rather than at
 * the Caddy layer, add a token bucket keyed on the deployment's trusted client-IP header
 * (e.g. `context.headers['x-forwarded-for']`) via the plugin's `kv` store. Until then,
 * the Caddy bucket and the global `FEE_LIMIT` are the anti-spam controls.
 */
import type { PluginContext } from '@openzeppelin/relayer-sdk';
import { pluginError } from '@openzeppelin/relayer-sdk';
import { handler as channelsHandler } from '@openzeppelin/relayer-plugin-channels';
import { Address, xdr, StrKey, Transaction } from '@stellar/stellar-sdk';

/** This checks to make sure that the account calling the relay is a valid nido / perch
 * account which acts as a rudimentary way to get the relayer to only be available for
 * nido users.
 *
 * This check is done by comparing the invoked contract's on-chain wasm hash (or address,
 * for account creation) against known-good values below.
 *
 * These two constants mirror perch.TESTNET's factory/accountWasmHash by hand, since this
 * plugin can't import them (isolated build, no access to sibling workspace packages — see
 * ../../Dockerfile). Override per-deploy via config.json's `plugins[].config` instead of a
 * code change if needed.
 *
 * We're keeping a list of expected wasm hashes, because old accounts outlive factory redeploys and
 * this will allow them to stay sponsorable, and able to continue to use the relayer.
 */
const DEFAULT_EXPECTED_ACCOUNT_WASM_HASHES = [
  'd3d4c28a01b37660c23ac03622b712608d2c0f853b634a597f3cd617e7b66df5', // current (PR #255)
  'bbb30174bbd85a2956a2f6146a156769621254011a6bdcac707cf787ce7bcd52', // pre-#255
];
const DEFAULT_FACTORY_ADDRESS = 'CBJRCUECFC2FSJBSVOVYHWC73A2SN7LIKSLWJBQUNEOWPE4PXG33M54H';

/** Relayer id used to issue the read-only RPC call below. Any configured
 *  relayer on the right network works — it's just a network passthrough,
 *  not signing anything. Defaults to the fund relayer's id. */
const DEFAULT_RPC_RELAYER_ID = 'channels-fund';

/**
 * Relayer sponsor gate limited to Perch/Nido accounts
 * Before sponsoring anything, this confirms that the transaction is either:
 * a creation of a Perch/Nido account by the factory, or an invocation of a
 * Perch/Nido account.
 * To confirm that this is an invocation by a Perch/Nido account, we check that
 * the account's on-chain wasm hash matches a known account build.
 *
 * This is different from the the function-name allowlist removed in commit 2533c9a
 * that gated *which functions* a request could call; this gates *whose contract*
 * it's calling, independent of which function.
 */
async function assertIsNidoDestination(contractId: string, context: PluginContext): Promise<void> {
  const factoryAddress: string = context.config?.factoryAddress ?? DEFAULT_FACTORY_ADDRESS;
  if (contractId === factoryAddress) return; // account creation: the factory itself, not an account yet

  const expectedHashes: string[] =
    context.config?.expectedAccountWasmHashes ?? DEFAULT_EXPECTED_ACCOUNT_WASM_HASHES;
  const rpcRelayerId: string = context.config?.rpcRelayerId ?? DEFAULT_RPC_RELAYER_ID;

  const instanceKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );

  let wasmHash: string | undefined;
  try {
    const response: any = await context.api.useRelayer(rpcRelayerId).rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'getLedgerEntries',
      params: { keys: [instanceKey.toXDR('base64')] },
    });
    // A failed RPC provider call doesn't always throw: the relayer can resolve
    // this with a JSON-RPC error body (or no `result` at all) instead of
    // rejecting the promise — observed locally when the configured RPC node
    // returned a non-JSON body. Treat that the same as a thrown error, not as
    // "ledger entry not found" (which would otherwise wrongly reject a real Perch
    // account as NOT_A_PERCH_ACCOUNT during an RPC outage instead of the "couldn't verify").
    if (response?.error || typeof response?.result !== 'object' || response.result === null) {
      throw new Error(
        response?.error ? JSON.stringify(response.error) : 'RPC response missing result',
      );
    }
    const entryXdr = response.result?.entries?.[0]?.xdr;
    if (typeof entryXdr === 'string') {
      const entryData = xdr.LedgerEntryData.fromXDR(entryXdr, 'base64');
      const instance = entryData.contractData().val().instance();
      const executable = instance.executable();
      if (executable.switch() === xdr.ContractExecutableType.contractExecutableWasm()) {
        wasmHash = (executable.wasmHash() as unknown as Buffer).toString('hex');
      }
    }
  } catch (e) {
    // Default to rejecting, not allowing, when we can't verify: an RPC error
    // means we can't confirm this is a Perch account, which is the same as
    // confirming it isn't.
    throw pluginError('Could not verify the invoked contract is a Perch account', {
      code: 'ACCOUNT_VERIFICATION_FAILED',
      status: 502,
      details: { contractId, message: e instanceof Error ? e.message : String(e) },
    });
  }

  if (!wasmHash || !expectedHashes.includes(wasmHash)) {
    throw pluginError('Refusing to sponsor: not a recognized Perch account', {
      code: 'NOT_A_PERCH_ACCOUNT',
      status: 403,
      details: { contractId, wasmHash: wasmHash ?? null, expectedHashes },
    });
  }
}

/** `management`/`getTransaction` requests aren't asking to sponsor anything —
 *  there's no contract invocation to check, so they skip the gate entirely.
 *  Everything else reaching this plugin IS a sponsorship request, and must
 *  resolve to a recognized target below (see `handler`). */
function isAdminRequest(params: any): boolean {
  return !!params && typeof params === 'object' && ('management' in params || 'getTransaction' in params);
}

/** Extract the C-address of the contract a func+auth or raw-XDR relay
 *  request is invoking, or undefined if none can be identified (malformed,
 *  multiple operations, a non-invoke host function, or a target that isn't a
 *  contract at all). `handler` treats undefined here as a rejection, not a
 *  pass-through — see its comment for why. */
function extractInvokedContractId(params: any, networkPassphrase: string): string | undefined {
  try {
    if (!params || typeof params !== 'object') return undefined;

    let func: xdr.HostFunction;
    if (typeof params.xdr === 'string') {
      const tx = new Transaction(params.xdr, networkPassphrase);
      if (tx.operations.length !== 1 || tx.operations[0].type !== 'invokeHostFunction') {
        return undefined;
      }
      func = (tx.operations[0] as unknown as { func: xdr.HostFunction }).func;
    } else if (typeof params.func === 'string') {
      func = xdr.HostFunction.fromXDR(params.func, 'base64');
    } else {
      return undefined;
    }
    if (func.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) return undefined;
    // xdr.Hash's .d.ts claims `Opaque[]`, but it's a real Buffer at runtime
    // (confirmed in @stellar/js-xdr's opaque.js: `Buffer.isBuffer(value)`).
    const contractIdHash = func.invokeContract().contractAddress().contractId() as unknown as Buffer;
    return StrKey.encodeContract(contractIdHash);
  } catch {
    return undefined;
  }
}

/**
 * Wrapped plugin handler exported for OpenZeppelin Relayer. Runs the
 * account-identity gate above before delegating to the upstream handler for
 * everything else (channel selection, fee-bump, submission).
 */
export async function handler(context: PluginContext): Promise<any> {
  if (!isAdminRequest(context.params)) {
    const networkPassphrase: string =
      context.config?.networkPassphrase ?? 'Test SDF Network ; September 2015';
    const contractId = extractInvokedContractId(context.params, networkPassphrase);
    // Default to rejecting a request when we can't identify a target:
    // every non-admin request reaching this plugin is asking to be sponsored.
    // A target that we can't identify is not safe to forward. The upstream
    // handler's "already-signed XDR" path will fee-bump and submit *any*
    // valid signed transaction, not just Soroban contract invocations
    // (before this check a signed classic `payment` operation from an unrelated
    // account reached real fee-bump submission). Rejecting here is what restricts
    // sponsorship to Perch/Nido accounts.
    if (!contractId) {
      throw pluginError('Could not identify a Perch account or factory invocation in this request', {
        code: 'UNRECOGNIZED_RELAY_REQUEST',
        status: 400,
      });
    }
    await assertIsNidoDestination(contractId, context);
  }
  return channelsHandler(context);
}
