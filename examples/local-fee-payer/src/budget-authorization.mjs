import { Address, Operation, rpc, xdr } from '@stellar/stellar-sdk';
import { cChallenge, externalPayload } from './stellar.mjs';
import { derToCompact } from './webauthn.mjs';
import { build, simulate, sc } from './local-chain.mjs';

const randomNonce=()=>new DataView(crypto.getRandomValues(new Uint8Array(8)).buffer).getBigInt64(0);

// Passkey-authorize C.execute(executor, action, []) and preflight it.
// `approve(challenge)` asks the passkey and resolves { assertion, publicKey }.
export async function authorizeBudgetAction({ chain, profile, action, ruleIds, network, approve }) {
  const call={contract:profile.account,function:'execute',args:[sc.address(profile.executor),sc.symbol(action),sc.vec([])]};
  let tx=await build(chain,profile.u,Operation.invokeContractFunction(call),network);
  const initial=await simulate(chain,tx,'record');
  if(initial.result.auth.length!==1)throw Error('Expected one C authorization');
  let entry=xdr.SorobanAuthorizationEntry.fromXdr(initial.result.auth[0].toXdr());
  if(entry.credentials.type!=='sorobanCredentialsAddress'||Address.fromScAddress(entry.credentials.address.address).toString()!==profile.account)throw Error('Unexpected authorization');
  // Sign only what this wallet built: the same tree, byte for byte (as walletSign.ts does).
  const invocation=new xdr.SorobanAuthorizedInvocation({subInvocations:[],function:xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
    new xdr.InvokeContractArgs({contractAddress:new Address(call.contract).toScAddress(),functionName:call.function,args:call.args}))});
  if(entry.rootInvocation.toXdr('base64')!==invocation.toXdr('base64'))throw Error('The network asked your account to authorize something other than this action. Nothing was signed.');
  const latest=(await chain.getLatestLedger()).sequence;
  entry=new xdr.SorobanAuthorizationEntry({rootInvocation:invocation,credentials:xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
    address:new Address(profile.account).toScAddress(),nonce:randomNonce(),signatureExpirationLedger:Math.min(latest+100,profile.expires),signature:xdr.ScVal.scvVoid()}))});
  const challenge=cChallenge(entry,profile.account,network,ruleIds);
  const {assertion,publicKey}=await approve(challenge);
  const sig=sc.map({authenticator_data:sc.bytes(assertion.authenticatorData),client_data:sc.bytes(assertion.clientDataJSON),signature:sc.bytes(derToCompact(assertion.signature,true))}).toXdr();
  entry.credentials.address.signature=externalPayload(ruleIds,profile.verifier,publicKey,sig);
  tx=await build(chain,profile.u,Operation.invokeContractFunction({...call,auth:[entry]}),network);
  const enforced=await simulate(chain,tx,'enforce');
  return { tx:rpc.assembleTransaction(tx,enforced).build(), latest, assertion };
}
