import test from 'node:test';
import assert from 'node:assert/strict';
import {Account,Asset,Keypair,Operation,TransactionBuilder} from '@stellar/stellar-sdk';
import {newMnemonic,derivePublicAccounts} from '../src/hd-vault.mjs';
import {signPreparedLocalEnvelope} from '../src/local-fee-signing.mjs';
import {LOCAL_NETWORK} from '../src/local-chain.mjs';

test('wallet signing changes only inner/outer signature slots, both signatures verify, identity substitution refuses',async()=>{
 const phrase=newMnemonic(),profile=await derivePublicAccounts(phrase);
 const inner=new TransactionBuilder(new Account(profile.u,'0'),{fee:'100',networkPassphrase:LOCAL_NETWORK}).addOperation(Operation.payment({destination:Keypair.random().publicKey(),asset:Asset.native(),amount:'1'})).setTimeout(120).build();
 // This tests the low-level signature assembler only; the WASI boundary refuses
 // this payment fixture before granting the assembler a real signing request.
 const unsigned=TransactionBuilder.buildFeeBumpTransaction(profile.fee,'100',inner,LOCAL_NETWORK);
 const before=unsigned.toXdr();
 const signed=await signPreparedLocalEnvelope(before,phrase,profile);
 assert.equal(unsigned.toXdr(),before);
 assert.equal(signed.innerTransaction.signatures.length,1);assert.equal(signed.signatures.length,1);
 assert.ok(Keypair.fromPublicKey(profile.u).verify(signed.innerTransaction.hash(),signed.innerTransaction.signatures[0].signature.value));
 assert.ok(Keypair.fromPublicKey(profile.fee).verify(signed.hash(),signed.signatures[0].signature.value));
 const stripped=signed.toEnvelope();stripped.feeBump.signatures=[];stripped.feeBump.tx.innerTx.v1.signatures=[];
 assert.equal(stripped.toXdr('base64'),before);
 await assert.rejects(signPreparedLocalEnvelope(before,phrase,{...profile,fee:Keypair.random().publicKey()}),/slots/);
 await assert.rejects(signPreparedLocalEnvelope(before,phrase,{...profile,u:Keypair.random().publicKey()}),/slots/);
 await assert.rejects(signPreparedLocalEnvelope(signed.toXdr(),phrase,profile),/slots/);
});
