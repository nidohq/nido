// Whether a grant's target contract can transfer tokens, so that a grant on
// it with no functions list (any function, `transfer` included) is refused:
// a grant that may call `transfer` names its recipient, which only a grant of
// exactly `transfer` can (docRequest.ts).
//
// A target is a token when its instance runs:
//   - the built-in Stellar Asset Contract (any SAC, XLM's included); or
//   - wasm whose contract spec exports SEP-41's
//     `transfer(from: Address, to: Address | MuxedAddress, amount: i128)`.
//
// Limits: the read is of the contract as it is now; an upgradeable contract
// can become a token later. A token that moves balances under another name
// or signature is not recognised, and a contract that exports SEP-41's
// `transfer` without being a token is treated as one (refused, the safe
// side). A target that cannot be read (a failed RPC, no such contract) is
// refused too.

import { Address, contract, xdr, type rpc } from '@stellar/stellar-sdk';

/** What a contract instance runs: the built-in asset contract, or wasm. */
export type TargetCode = { kind: 'stellar-asset' } | { kind: 'wasm'; wasm: Buffer };

/** Reads a contract's code; null when there is no such contract. Tests
 *  inject their own. */
export type CodeReader = (contractId: string) => Promise<TargetCode | null>;

/** {@link CodeReader} over Soroban RPC: the contract's instance entry, then
 *  its wasm by hash. */
export function rpcCodeReader(server: Pick<rpc.Server, 'getLedgerEntries'>): CodeReader {
  return async (contractId) => {
    const instanceKey = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: new Address(contractId).toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );
    const { entries } = await server.getLedgerEntries(instanceKey);
    const entry = entries[0];
    if (!entry) return null;
    const executable = entry.val.contractData().val().instance().executable();
    if (executable.switch().name === 'contractExecutableStellarAsset') return { kind: 'stellar-asset' };
    const codeKey = xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: executable.wasmHash() }));
    const code = (await server.getLedgerEntries(codeKey)).entries[0];
    if (!code) return null;
    return { kind: 'wasm', wasm: Buffer.from(code.val.contractCode().code()) };
  };
}

const ADDRESS = new Set(['scSpecTypeAddress', 'scSpecTypeMuxedAddress']);

/** Whether `wasm`'s contract spec exports SEP-41's `transfer(from: Address,
 *  to: Address | MuxedAddress, amount: i128)`. */
export function exportsSep41Transfer(wasm: Buffer): boolean {
  let spec: contract.Spec;
  try {
    spec = contract.Spec.fromWasm(wasm);
  } catch {
    return false;
  }
  return spec.funcs().some((fn) => {
    if (fn.name().toString() !== 'transfer') return false;
    const types = fn.inputs().map((input) => input.type().switch().name);
    return (
      types.length === 3 && types[0] === 'scSpecTypeAddress' && ADDRESS.has(types[1]!) && types[2] === 'scSpecTypeI128'
    );
  });
}

/** Whether `contractId` can transfer tokens; throws when it cannot be read
 *  or does not exist (the caller refuses then too). */
export async function isTokenContract(contractId: string, read: CodeReader): Promise<boolean> {
  const code = await read(contractId);
  if (code === null) throw new Error(`no contract ${contractId} on this network`);
  return code.kind === 'stellar-asset' || exportsSep41Transfer(code.wasm);
}

/**
 * Why a request's grants cannot be approved as asked, or undefined: a grant
 * with no functions list (any function, `transfer` included) whose target is
 * a token contract, or whose target cannot be checked.
 */
export async function anyFunctionGrantProblem(
  grants: readonly { label: string; target: string; functions?: readonly string[] }[],
  read: CodeReader,
): Promise<string | undefined> {
  for (const grant of grants) {
    if (grant.functions !== undefined) continue;
    let token: boolean;
    try {
      token = await isTokenContract(grant.target, read);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      return `The grant "${grant.label}" may call any function on ${grant.target}, which could not be checked for being a token contract (${why}). The app must list the functions it may call.`;
    }
    if (token) {
      return `The grant "${grant.label}" may call any function on ${grant.target}, a token contract, so it could pay anyone. The app must list the functions it may call, and a transfer grant must name its recipient (to=).`;
    }
  }
  return undefined;
}
