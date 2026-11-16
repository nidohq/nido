import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePublicAccounts, openMnemonic, sealMnemonic, withFeeKey } from '../src/hd-vault.mjs';
import { APP_ORIGIN, WALLET_ORIGIN, expectedMessage, validateWalletRequest } from '../src/wallet-protocol.mjs';
import { C_ACCOUNT, feeBump, rawSignFee, unrelatedPayment, verifiesFeeSignature } from '../src/stellar.mjs';

// Public test vector, NEVER a real wallet: Stellar SEP-5, test 5.
const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
test('U and fee paths match independent SEP-5 known-answer vectors', async () => {
  const keys = await derivePublicAccounts(phrase);
  assert.equal(keys.u, 'GB3JDWCQJCWMJ3IILWIGDTQJJC5567PGVEVXSCVPEQOTDN64VJBDQBYX');
  assert.equal(keys.fee, 'GDVSYYTUAJ3ACHTPQNSTQBDQ4LDHQCMNY4FCEQH5TJUMSSLWQSTG42MV');
});
test('PRF-encrypted vault rejects another PRF, altered ciphertext and altered binding', async () => {
  const prf = crypto.getRandomValues(new Uint8Array(32));
  const sealed = await sealMnemonic(phrase, prf, 'wallet+C+credential');
  assert.equal(await openMnemonic(sealed, prf, 'wallet+C+credential'), phrase);
  await assert.rejects(openMnemonic(sealed, crypto.getRandomValues(new Uint8Array(32)), 'wallet+C+credential'));
  await assert.rejects(openMnemonic(sealed, prf, 'attacker'));
  await assert.rejects(openMnemonic({ ...sealed, ciphertext: (sealed.ciphertext[0] === 'A' ? 'B' : 'A') + sealed.ciphertext.slice(1) }, prf, 'wallet+C+credential'));
  await assert.rejects(sealMnemonic(phrase, undefined, 'binding'), /PRF/);
});
test('holding the backup phrase still bypasses wallet policy: HD is not a restriction', async () => {
  const signed = await withFeeKey(phrase, key => rawSignFee(feeBump(unrelatedPayment(), key.publicKey), key));
  assert.equal(verifiesFeeSignature(signed, (await derivePublicAccounts(phrase)).fee), true);
});
test('wallet intent interface cannot request arbitrary keys, raw signing or another C', () => {
  const request = { kind: 'sponsor-demo-transfer', account: C_ACCOUNT, recipient: 'GB3JDWCQJCWMJ3IILWIGDTQJJC5567PGVEVXSCVPEQOTDN64VJBDQBYX' };
  assert.equal(validateWalletRequest(request).account, C_ACCOUNT);
  for (const edit of [{ account: 'other' }, { kind: 'signBytes' }, { path: "m/44'/148'/0'" }, { fee: '999999' }, { exportSeed: true }]) assert.throws(() => validateWalletRequest({ ...request, ...edit }));
});
test('popup protocol requires exact origin, exact source window and matching request ID', () => {
  const source = {}; const event = { origin: APP_ORIGIN, source, data: { requestId: 'one' } };
  assert.equal(expectedMessage(event, APP_ORIGIN, source, 'one'), true);
  assert.equal(expectedMessage(event, WALLET_ORIGIN, source, 'one'), false);
  assert.equal(expectedMessage(event, APP_ORIGIN, {}, 'one'), false);
  assert.equal(expectedMessage(event, APP_ORIGIN, source, 'two'), false);
});
