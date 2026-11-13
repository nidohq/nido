import { Keypair, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { withAccessKey, withFeeKey } from './hd-vault.mjs';
import { LOCAL_NETWORK } from './local-chain.mjs';
import { TESTNET_NETWORK } from './demo-config.mjs';

// Wallet-internal. Called only after the bound WASI decision. It has no API
// that is callable by another origin and never receives caller replacement XDR.
export async function signPreparedLocalEnvelope(encoded, phrase, profile) {
  const network=profile.network || LOCAL_NETWORK;
  if (![LOCAL_NETWORK, TESTNET_NETWORK].includes(network)) throw Error('Unsupported signing network');
  const parsed=TransactionBuilder.fromXdr(encoded,network);
  if(!parsed.innerTransaction||parsed.feeSource!==profile.fee||parsed.innerTransaction.source!==profile.u||parsed.signatures.length||parsed.innerTransaction.signatures.length)throw Error('Unexpected prepared signing slots');
  const env=parsed.toEnvelope(),inner=parsed.innerTransaction;
  const signature=await withAccessKey(phrase,async key=>{
    if(key.publicKey!==profile.u)throw Error('U mismatch');
    return new Uint8Array(await crypto.subtle.sign('Ed25519',key.privateKey,inner.hash()));
  });
  env.feeBump.tx.innerTx.v1.signatures.push(new xdr.DecoratedSignature({hint:Keypair.fromPublicKey(profile.u).signatureHint(),signature}));
  const signed=TransactionBuilder.fromXdr(env.toXdr('base64'),network);
  await withFeeKey(phrase,async key=>{
    if(key.publicKey!==profile.fee)throw Error('F mismatch');
    signed.addSignature(key.publicKey,Buffer.from(await crypto.subtle.sign('Ed25519',key.privateKey,signed.hash())).toString('base64'));
  });
  return signed;
}
