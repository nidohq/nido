import { beforeEach, describe, expect, it, vi } from 'vitest';
import { xdr, Address, Account, Asset, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

vi.mock('@openzeppelin/relayer-plugin-channels', () => ({
  handler: vi.fn(async () => ({ success: true, data: { delegatedToUpstream: true } })),
}));

const { handler } = await import('./index');
const { handler: channelsHandlerMock } = await import('@openzeppelin/relayer-plugin-channels');

const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const FACTORY_ADDRESS = 'CBJRCUECFC2FSJBSVOVYHWC73A2SN7LIKSLWJBQUNEOWPE4PXG33M54H';
const CURRENT_ACCOUNT_HASH = 'd3d4c28a01b37660c23ac03622b712608d2c0f853b634a597f3cd617e7b66df5';
const PRE_255_ACCOUNT_HASH = 'bbb30174bbd85a2956a2f6146a156769621254011a6bdcac707cf787ce7bcd52';

// Real, unrelated addresses used only as distinct identifiers in these tests.
const UNRELATED_CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'; // testnet native XLM SAC
const A_NIDO_ACCOUNT = 'CCPKR4NPM5IYJX2CUEPZRHAXTLAJZSNXVLTVO22NRV7TKUDXCAENOZXF'; // real pre-#255 account
const AN_UNRELATED_G_ADDRESS = 'GCYVFKNTVZA5AY3KJWPW4NU4247UDDFFOCT4C3WCOKUDQQABIZRZ46I3';

beforeEach(() => {
  vi.clearAllMocks();
});

function funcXdr(address: string): string {
  const hostFn = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: new Address(address).toScAddress(),
      functionName: 'init',
      args: [],
    }),
  );
  return hostFn.toXDR('base64');
}

/** A `getLedgerEntries` response naming the given wasm hash as the contract's
 *  executable, or no entries at all when `wasmHash` is undefined. */
function rpcLedgerEntriesResponse(wasmHash: string | undefined) {
  if (!wasmHash) return { jsonrpc: '2.0', id: 1, result: { entries: [] } };
  const instance = new xdr.ScContractInstance({
    executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(wasmHash, 'hex')),
    storage: null,
  });
  const entryData = xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: new xdr.ExtensionPoint(0),
      contract: new Address(A_NIDO_ACCOUNT).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
      val: xdr.ScVal.scvContractInstance(instance),
    }),
  );
  return {
    jsonrpc: '2.0',
    id: 1,
    result: { entries: [{ key: '', xdr: entryData.toXDR('base64'), lastModifiedLedgerSeq: 1 }] },
  };
}

/** A `getLedgerEntries` response for a non-Wasm executable (e.g. a Stellar
 *  Asset Contract) — present, but not something we can read a wasm hash from. */
function rpcStellarAssetResponse() {
  const instance = new xdr.ScContractInstance({
    executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
    storage: null,
  });
  const entryData = xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: new xdr.ExtensionPoint(0),
      contract: new Address(UNRELATED_CONTRACT).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
      val: xdr.ScVal.scvContractInstance(instance),
    }),
  );
  return {
    jsonrpc: '2.0',
    id: 1,
    result: { entries: [{ key: '', xdr: entryData.toXDR('base64'), lastModifiedLedgerSeq: 1 }] },
  };
}

function makeContext(params: any, rpcImpl: (req: any) => Promise<any>) {
  return {
    params,
    config: { networkPassphrase: NETWORK_PASSPHRASE },
    api: { useRelayer: () => ({ rpc: rpcImpl }) },
  } as any;
}

describe('extractInvokedContractId (via handler)', () => {
  it('skips the gate and delegates straight through for management requests', async () => {
    const rpc = vi.fn();
    const context = makeContext({ management: { action: 'setChannelAccounts' } }, rpc);
    await handler(context);
    expect(rpc).not.toHaveBeenCalled();
    expect(channelsHandlerMock).toHaveBeenCalledWith(context);
  });

  it('rejects a target that is a G-address, not a contract', async () => {
    // A G-address can't have contract functions invoked on it at all — no
    // contract id can be extracted. This must reject, not pass through: see
    // the classic-transaction regression test below for why a silent
    // pass-through here is a real sponsorship bypass, not just an edge case.
    const rpc = vi.fn();
    const context = makeContext({ func: funcXdr(AN_UNRELATED_G_ADDRESS), auth: [] }, rpc);
    await expect(handler(context)).rejects.toMatchObject({
      code: 'UNRECOGNIZED_RELAY_REQUEST',
      status: 400,
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(channelsHandlerMock).not.toHaveBeenCalled();
  });

  it('rejects a signed classic (non-Soroban) transaction instead of forwarding it for sponsorship', async () => {
    // Regression test for a real bypass found locally: the upstream plugin's
    // already-signed-XDR path (`validateExistingTransactionForSubmitOnly`)
    // doesn't require an invokeHostFunction at all, so a signed classic
    // `payment` from an unrelated account reached real fee-bump submission
    // before this plugin rejected unidentifiable targets outright. Confirmed
    // against the real local relayer: it got all the way to
    // "[channels] Sending fee bump tx" before failing only because the test
    // account had no on-chain history.
    const kp = Keypair.random();
    const account = new Account(kp.publicKey(), '0');
    const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(Operation.payment({ destination: kp.publicKey(), asset: Asset.native(), amount: '1' }))
      .setTimeout(30)
      .build();
    tx.sign(kp);

    const rpc = vi.fn();
    const context = makeContext({ xdr: tx.toXDR() }, rpc);
    await expect(handler(context)).rejects.toMatchObject({
      code: 'UNRECOGNIZED_RELAY_REQUEST',
      status: 400,
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(channelsHandlerMock).not.toHaveBeenCalled();
  });
});

describe('assertIsNidoDestination (via handler)', () => {
  it('allows the factory address without an RPC call (account creation)', async () => {
    const rpc = vi.fn();
    const context = makeContext({ func: funcXdr(FACTORY_ADDRESS), auth: [] }, rpc);
    await handler(context);
    expect(rpc).not.toHaveBeenCalled();
    expect(channelsHandlerMock).toHaveBeenCalledWith(context);
  });

  it('allows a real account on the current (post-#255) wasm hash', async () => {
    const rpc = vi.fn(async () => rpcLedgerEntriesResponse(CURRENT_ACCOUNT_HASH));
    const context = makeContext({ func: funcXdr(A_NIDO_ACCOUNT), auth: [] }, rpc);
    await handler(context);
    expect(channelsHandlerMock).toHaveBeenCalledWith(context);
  });

  it('allows a real account on the pre-#255 wasm hash (no account is stranded)', async () => {
    const rpc = vi.fn(async () => rpcLedgerEntriesResponse(PRE_255_ACCOUNT_HASH));
    const context = makeContext({ func: funcXdr(A_NIDO_ACCOUNT), auth: [] }, rpc);
    await handler(context);
    expect(channelsHandlerMock).toHaveBeenCalledWith(context);
  });

  it('rejects a contract with no matching wasm hash (not a Perch account)', async () => {
    const rpc = vi.fn(async () => rpcLedgerEntriesResponse(undefined));
    const context = makeContext({ func: funcXdr(UNRELATED_CONTRACT), auth: [] }, rpc);
    await expect(handler(context)).rejects.toMatchObject({
      code: 'NOT_A_PERCH_ACCOUNT',
      status: 403,
    });
    expect(channelsHandlerMock).not.toHaveBeenCalled();
  });

  it('rejects a Stellar Asset Contract (real contract, but not Wasm-executable)', async () => {
    const rpc = vi.fn(async () => rpcStellarAssetResponse());
    const context = makeContext({ func: funcXdr(UNRELATED_CONTRACT), auth: [] }, rpc);
    await expect(handler(context)).rejects.toMatchObject({
      code: 'NOT_A_PERCH_ACCOUNT',
      status: 403,
    });
  });

  it('fails closed (not NOT_A_PERCH_ACCOUNT) when the RPC call throws', async () => {
    const rpc = vi.fn(async () => {
      throw new Error('network error');
    });
    const context = makeContext({ func: funcXdr(A_NIDO_ACCOUNT), auth: [] }, rpc);
    await expect(handler(context)).rejects.toMatchObject({
      code: 'ACCOUNT_VERIFICATION_FAILED',
      status: 502,
    });
    expect(channelsHandlerMock).not.toHaveBeenCalled();
  });

  it('fails closed when the RPC call resolves with a JSON-RPC error body instead of throwing', async () => {
    // Regression test: a provider error observed locally resolved rather than
    // rejected, with no usable `result` — the gate must not read that as
    // "ledger entry not found" (NOT_A_PERCH_ACCOUNT) for a real account.
    const rpc = vi.fn(async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'boom' } }));
    const context = makeContext({ func: funcXdr(A_NIDO_ACCOUNT), auth: [] }, rpc);
    await expect(handler(context)).rejects.toMatchObject({
      code: 'ACCOUNT_VERIFICATION_FAILED',
      status: 502,
    });
  });

  it('fails closed when the RPC response is missing `result` entirely', async () => {
    const rpc = vi.fn(async () => ({ jsonrpc: '2.0', id: 1 }));
    const context = makeContext({ func: funcXdr(A_NIDO_ACCOUNT), auth: [] }, rpc);
    await expect(handler(context)).rejects.toMatchObject({
      code: 'ACCOUNT_VERIFICATION_FAILED',
      status: 502,
    });
  });
});
