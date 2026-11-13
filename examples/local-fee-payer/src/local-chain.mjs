import { Address, Asset, Operation, TransactionBuilder, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';

export const LOCAL_NETWORK = 'Standalone Network ; February 2017';
export const sc = { address: a => new Address(a).toScVal(), symbol: s => xdr.ScVal.scvSymbol(s),
  u64: n => xdr.ScVal.scvU64(BigInt(n)), u32: n => xdr.ScVal.scvU32(n),
  i128: n => xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: BigInt(n) })),
  bytes: b => xdr.ScVal.scvBytes(b), vec: a => xdr.ScVal.scvVec(a),
  map: obj => xdr.ScVal.scvMap(Object.entries(obj).sort(([a],[b]) => a.localeCompare(b)).map(([k,val]) => new xdr.ScMapEntry({key:xdr.ScVal.scvSymbol(k),val}))) };
export const jsonSafe = obj => JSON.parse(JSON.stringify(obj, (_, v) => typeof v === 'bigint' ? v.toString() : v));
export function server(url) { return new rpc.Server(url, { allowHttp: true }); }
export async function build(server, source, operation) {
  return new TransactionBuilder(await server.getAccount(source), { networkPassphrase: LOCAL_NETWORK, fee: '100' })
    .addOperation(operation).setTimeout(180).build();
}
export async function simulate(server, tx, mode) {
  // Keep v1 auth credentials for the explicitly checked Perch digest path.
  const sim = await server.simulateTransaction(tx, undefined, mode, false);
  if (!rpc.Api.isSimulationSuccess(sim)) throw Error(sim.error || 'Local simulation failed');
  if (rpc.Api.isSimulationRestore(sim)) throw Error('Restore archived state before signing; no budget reset');
  return sim;
}
export async function submit(server, tx) {
  const sent = await server.sendTransaction(tx);
  if (!['PENDING', 'DUPLICATE'].includes(sent.status)) throw Error(`Local submission ${sent.status}: ${sent.errorResult?.toXdr('base64') || ''}`);
  for (let n = 0; n < 60; n++) {
    const result = await server.getTransaction(sent.hash);
    if (result.status === 'SUCCESS') return { ...result, hash:sent.hash };
    if (result.status === 'FAILED') throw Error(`Local transaction failed: ${sent.hash}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error(`Transaction pending; inspect ${sent.hash} before retrying`);
}
export async function read(server, source, contract, fn, args = []) {
  const tx = await build(server, source, Operation.invokeContractFunction({contract, function:fn, args}));
  return scValToNative((await simulate(server, tx)).result.retval);
}
export const nativeToken = () => Asset.native().contractId(LOCAL_NETWORK);
