import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,StrKey} from '@stellar/stellar-sdk';
import {walletAddresses} from '../src/wallet-addresses.mjs';

test('post-setup card shows U as the permanent-G stand-in and F, with full addresses',()=>{
 const profile={u:Keypair.random().publicKey(),fee:Keypair.random().publicKey()};
 const [g,f]=walletAddresses(profile);
 assert.equal(g.address,profile.u);assert.match(g.label,/^G · test-only U/);assert.match(g.note,/permanent G/);assert.match(g.note,/not implement/);
 assert.equal(f.address,profile.fee);assert.match(f.label,/^F · fee account/);
});
test('card refuses anything that is not a classic G-form account',()=>{
 const ok=Keypair.random().publicKey(),contract=StrKey.encodeContract(new Uint8Array(32).fill(9));
 for(const profile of [{u:contract,fee:ok},{u:ok,fee:contract},{u:ok},{u:'',fee:ok}])assert.throws(()=>walletAddresses(profile));
});
