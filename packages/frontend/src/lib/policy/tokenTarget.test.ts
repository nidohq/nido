import { describe, expect, it, vi } from 'vitest';
import { Address, Asset, Networks, xdr } from '@stellar/stellar-sdk';
import {
  anyFunctionGrantProblem,
  exportsSep41Transfer,
  isTokenContract,
  rpcCodeReader,
  type CodeReader,
} from './tokenTarget.js';
import { specWasm } from '../../../../../tests/support/specWasm.mts';

const XLM = Asset.native().contractId(Networks.TESTNET);
const GAME = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';

const SEP41 = specWasm([
  { name: 'balance', inputs: ['address'] },
  { name: 'transfer', inputs: ['address', 'address', 'i128'] },
]);
const GAME_WASM = specWasm([{ name: 'guess', inputs: ['address', 'u32'] }]);

describe('exportsSep41Transfer', () => {
  it("is true for SEP-41's transfer(from: Address, to: Address, amount: i128)", () => {
    expect(exportsSep41Transfer(SEP41)).toBe(true);
  });

  it('is true when to is a MuxedAddress (CAP-67)', () => {
    expect(exportsSep41Transfer(specWasm([{ name: 'transfer', inputs: ['address', 'muxed', 'i128'] }]))).toBe(true);
  });

  it('is false for a contract with no transfer, or a transfer of another signature', () => {
    expect(exportsSep41Transfer(GAME_WASM)).toBe(false);
    expect(exportsSep41Transfer(specWasm([{ name: 'transfer', inputs: ['address', 'u32'] }]))).toBe(false);
  });

  it('is false for bytes that are not wasm', () => {
    expect(exportsSep41Transfer(Buffer.from('not wasm'))).toBe(false);
  });
});

describe('isTokenContract', () => {
  const read: CodeReader = async (id) =>
    id === XLM
      ? { kind: 'stellar-asset' }
      : id === GAME
        ? { kind: 'wasm', wasm: GAME_WASM }
        : id === 'CTOKEN'
          ? { kind: 'wasm', wasm: SEP41 }
          : null;

  it('is true for a Stellar Asset Contract and for wasm exporting SEP-41 transfer', async () => {
    expect(await isTokenContract(XLM, read)).toBe(true);
    expect(await isTokenContract('CTOKEN', read)).toBe(true);
  });

  it('is false for any other wasm', async () => {
    expect(await isTokenContract(GAME, read)).toBe(false);
  });

  it('throws for a contract it cannot find', async () => {
    await expect(isTokenContract('CNONE', read)).rejects.toThrow('no contract CNONE');
  });
});

describe('rpcCodeReader', () => {
  const instanceEntry = (executable: xdr.ContractExecutable) =>
    xdr.LedgerEntryData.contractData(
      new xdr.ContractDataEntry({
        ext: new xdr.ExtensionPoint(0),
        contract: new Address(GAME).toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
        val: xdr.ScVal.scvContractInstance(new xdr.ScContractInstance({ executable, storage: null })),
      }),
    );

  it('reads a Stellar Asset Contract from its instance alone', async () => {
    const getLedgerEntries = vi.fn().mockResolvedValue({
      entries: [{ val: instanceEntry(xdr.ContractExecutable.contractExecutableStellarAsset()) }],
    });
    expect(await rpcCodeReader({ getLedgerEntries } as never)(XLM)).toEqual({ kind: 'stellar-asset' });
    expect(getLedgerEntries).toHaveBeenCalledTimes(1);
  });

  it("reads a wasm contract's code by its instance's hash", async () => {
    const hash = Buffer.alloc(32, 7);
    const code = xdr.LedgerEntryData.contractCode(
      new xdr.ContractCodeEntry({ ext: new xdr.ContractCodeEntryExt(0), hash, code: GAME_WASM }),
    );
    const getLedgerEntries = vi
      .fn()
      .mockResolvedValueOnce({ entries: [{ val: instanceEntry(xdr.ContractExecutable.contractExecutableWasm(hash)) }] })
      .mockResolvedValueOnce({ entries: [{ val: code }] });
    const got = await rpcCodeReader({ getLedgerEntries } as never)(GAME);
    expect(got?.kind === 'wasm' && got.wasm.equals(GAME_WASM)).toBe(true);
    const codeKey = getLedgerEntries.mock.calls[1]![0] as xdr.LedgerKey;
    expect(codeKey.contractCode().hash().equals(hash)).toBe(true);
  });

  it('is null for a contract with no instance', async () => {
    const getLedgerEntries = vi.fn().mockResolvedValue({ entries: [] });
    expect(await rpcCodeReader({ getLedgerEntries } as never)(GAME)).toBeNull();
  });
});

describe('anyFunctionGrantProblem', () => {
  const read: CodeReader = async (id) =>
    id === XLM ? { kind: 'stellar-asset' } : id === GAME ? { kind: 'wasm', wasm: GAME_WASM } : null;

  it('refuses an any-function grant on a token contract', async () => {
    const problem = await anyFunctionGrantProblem([{ label: 'all-xlm', target: XLM }], read);
    expect(problem).toContain('The grant "all-xlm" may call any function');
    expect(problem).toContain('a token contract, so it could pay anyone');
  });

  it('allows an any-function grant on a contract that is not a token', async () => {
    expect(await anyFunctionGrantProblem([{ label: 'play', target: GAME }], read)).toBeUndefined();
  });

  it('refuses an any-function grant whose target cannot be checked', async () => {
    const problem = await anyFunctionGrantProblem([{ label: 'play', target: 'CNONE' }], read);
    expect(problem).toContain('could not be checked for being a token contract');
    const failing: CodeReader = () => Promise.reject(new Error('rpc down'));
    expect(await anyFunctionGrantProblem([{ label: 'play', target: GAME }], failing)).toContain('rpc down');
  });

  it('does not read a target whose grant lists its functions', async () => {
    const spy = vi.fn(read);
    expect(
      await anyFunctionGrantProblem([{ label: 'pay', target: XLM, functions: ['transfer'] }], spy),
    ).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});
