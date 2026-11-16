import { Address, Asset, Operation, TransactionBuilder, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { DEMO } from './demo-config.mjs';

export const LOCAL_NETWORK = 'Standalone Network ; February 2017';
export const sc = { address: a => new Address(a).toScVal(), symbol: s => xdr.ScVal.scvSymbol(s),
  u64: n => xdr.ScVal.scvU64(BigInt(n)), u32: n => xdr.ScVal.scvU32(n),
  i128: n => xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: BigInt(n) })),
  bytes: b => xdr.ScVal.scvBytes(b), vec: a => xdr.ScVal.scvVec(a),
  map: obj => xdr.ScVal.scvMap(Object.entries(obj).sort(([a],[b]) => a.localeCompare(b)).map(([k,val]) => new xdr.ScMapEntry({key:xdr.ScVal.scvSymbol(k),val}))) };
export const jsonSafe = obj => JSON.parse(JSON.stringify(obj, (_, v) => typeof v === 'bigint' ? v.toString() : v));
export function server(url) { return new rpc.Server(url, { allowHttp: true }); }
export async function build(server, source, operation, network = DEMO.network) {
  return new TransactionBuilder(await server.getAccount(source), { networkPassphrase: network, fee: '100' })
    .addOperation(operation).setTimeout(180).build();
}
export async function simulate(server, tx, mode) {
  // Keep v1 auth credentials for the explicitly checked Perch digest path.
  for (let attempt = 0; ; attempt++) {
    const sim = await server.simulateTransaction(tx, undefined, mode, false);
    // Public testnet occasionally saturates preflight. Only retry this explicit
    // read-only capacity response, never an authorization failure or submission.
    if (sim.error?.includes('preflight queue full') && attempt < 4) {
      await new Promise(resolve => setTimeout(resolve, 750 * 2 ** attempt));
      continue;
    }
    if (rpc.Api.isSimulationRestore(sim)) throw Error('Restore archived state before signing; no budget reset');
    if (!rpc.Api.isSimulationSuccess(sim)) throw Error(sim.error || 'Simulation failed');
    return sim;
  }
}
export async function submit(server, tx) {
  const sent = await server.sendTransaction(tx);
  if (!['PENDING', 'DUPLICATE'].includes(sent.status)) throw Error(`Submission ${sent.status}: ${sent.errorResult?.toXdr('base64') || ''}`);
  for (let n = 0; n < 60; n++) {
    const result = await server.getTransaction(sent.hash);
    if (result.status === 'SUCCESS') return { ...result, hash:sent.hash };
    if (result.status === 'FAILED') throw Error(`Transaction failed: ${sent.hash}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error(`Transaction pending; inspect ${sent.hash} before retrying`);
}
export async function read(server, source, contract, fn, args = [], network = DEMO.network) {
  const tx = await build(server, source, Operation.invokeContractFunction({contract, function:fn, args}), network);
  return scValToNative((await simulate(server, tx)).result.retval);
}
export const nativeToken = (network = DEMO.network) => Asset.native().contractId(network);
