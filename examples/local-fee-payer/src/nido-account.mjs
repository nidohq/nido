import { StrKey } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { DEMO } from './demo-config.mjs';
import { read } from './local-chain.mjs';
import { requireContractHash } from './contract-address.mjs';
// Same native Perch account and verifier pinned by Nido's factory deployment.
export const NIDO_ACCOUNT_HASH='7a03f4c29b8a7fe099929d31c1fe87ca4f19d8b791baeb3ae17b7316b9a48220';
export const NIDO_VERIFIER='CDPT2W5ZYRHKD7ESV4OXPKYBWCCCAZRKRDAI4EAE7ACXE5ZN76F23OZP';
export function nidoAccountAt(origin, suffix=DEMO.walletSuffix) {
  if(!suffix)return null;
  const url=new URL(origin);
  if(url.protocol!=='https:'||url.port||!url.hostname.endsWith(suffix))return null;
  const account=url.hostname.slice(0,-suffix.length).toUpperCase();
  return StrKey.isValidContract(account) && url.origin===`https://${account.toLowerCase()}${suffix}` ? account : null;
}
export async function nidoRegistration(account,storage=localStorage) {
  const origin=location.origin;
  if(nidoAccountAt(origin)!==account)throw Error('Open Fees on your Nido account domain.');
  const credentialId=storage.getItem(`passkey:${account}:credentialId`);
  const hex=storage.getItem(`passkey:${account}:publicKey`);
  if(!credentialId||!hex||!/^[0-9a-f]{130}$/i.test(hex))throw Error('Connect this browser to your Nido passkey first. Fees never creates a second passkey.');
  const key=await crypto.subtle.importKey('raw',Buffer.from(hex,'hex'),{name:'ECDSA',namedCurve:'P-256'},true,['verify']);
  return {credentialId,spki:new Uint8Array(await crypto.subtle.exportKey('spki',key)),origin,rpId:location.hostname};
}
export function ownerRule(config,account,passkey) {
  const rules=config.rules.filter(r=>r.name==='admin' && !r.recovery && r.context_type?.[0]==='CallContract' && r.context_type[1]===account && r.signers.length===1 && r.signers[0][0]==='External' && r.signers[0][1]===NIDO_VERIFIER && Buffer.from(r.signers[0][2]).toString('base64')===passkey);
  if(rules.length!==1)throw Error('This passkey is not the current Nido owner. Reconnect or recover through Nido first.');
  return rules[0].id;
}
export async function verifyNidoOwner(chain,source,account,passkey) {
  await requireContractHash(chain,account,NIDO_ACCOUNT_HASH);
  const config=await read(chain,source,account,'configuration');
  const caps=await read(chain,source,account,'capabilities');
  if(caps.auth_digest!=='addr_oz_v1')throw Error('Unsupported Nido signing scheme');
  return ownerRule(config,account,passkey);
}
