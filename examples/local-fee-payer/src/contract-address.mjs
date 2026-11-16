import { Address, StrKey, hash, xdr } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
export const saltFor = text => hash(Buffer.from(text));
export function contractAddress(network, deployer, salt) {
  return StrKey.encodeContract(hash(xdr.HashIdPreimage.envelopeTypeContractId(new xdr.HashIdPreimageContractId({
    networkId:hash(Buffer.from(network)),
    contractIdPreimage:xdr.ContractIdPreimage.contractIdPreimageFromAddress(new xdr.ContractIdPreimageFromAddress({address:new Address(deployer).toScAddress(),salt})),
  })).toXdr()));
}
export async function contractInstance(chain, address) {
  const result=await chain.getLedgerEntries(xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
    contract:new Address(address).toScAddress(),key:xdr.ScVal.scvLedgerKeyContractInstance(),durability:xdr.ContractDataDurability.persistent,
  })));
  return result.entries?.[0] || null;
}
export async function requireContractHash(chain, address, expected) {
  const entry=await contractInstance(chain,address);
  const actual=entry?.val.toJSON()?.contract_data?.val?.contract_instance?.executable?.wasm;
  if(actual!==expected)throw Error(`Contract unavailable or code differs from pinned demo: ${address}`);
}
