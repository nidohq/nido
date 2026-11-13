import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'buffer';
import cedar from '@cedar-policy/cedar-wasm/nodejs';
import { Keypair, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { fakeAuthenticator } from './fixtures.mjs';
import { b64, derToCompact, verifyAssertion } from '../src/webauthn.mjs';
import { C_ACCOUNT, NETWORK, cChallenge, cTransaction, createFeeKey, feeBump, feeProfile, inspectC, makeIntent, rawSignFee, unrelatedPayment, verifiesFeeSignature } from '../src/stellar.mjs';
import { LocalGate, feeChallenge } from '../src/gate.mjs';
import { decide } from '../src/policy.mjs';

async function fixture() {
  const auth = await fakeAuthenticator();
  const key = await createFeeKey();
  const profile = feeProfile(key);
  const intent = makeIntent();
  const assertion = await auth.assertion(cChallenge(intent.entry));
  const inner = cTransaction(intent, assertion, auth.publicKey);
  const tx = feeBump(inner, profile.account);
  const gate = new LocalGate({ cedar, key, feeAccount: profile.account, registration: auth.registration });
  return { auth, key, profile, intent, assertion, inner, tx, gate };
}

test('same passkey authorizes C and exact fee envelope; real Ed25519 signature verifies', async () => {
  const f = await fixture();
  const pending = await f.gate.prepare(f.tx, f.assertion);
  assert.equal(pending.decision.allowed, true);
  const signed = await f.gate.sign(pending.nonce, await f.auth.assertion(pending.challenge));
  assert.equal(verifiesFeeSignature(signed, f.key.publicKey), true);
  assert.equal(signed.feeSource, f.profile.account);
  assert.equal(inspectC(signed).account, C_ACCOUNT);
  assert.equal(signed.fee, '200');
  assert.equal(TransactionBuilder.fromXdr(signed.toXdr(), NETWORK).toXdr(), signed.toXdr());
});

test('non-exportable key still signs an unrelated fee bump without any passkey: counterexample', async () => {
  const f = await fixture();
  assert.equal(f.key.privateKey.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('pkcs8', f.key.privateKey));
  const unrelated = feeBump(unrelatedPayment(), f.profile.account);
  await assert.rejects(f.gate.prepare(unrelated, f.assertion), /Not the C/);
  const signed = await rawSignFee(unrelated, f.key);
  assert.equal(verifiesFeeSignature(signed, f.key.publicKey), true);
  assert.equal(signed.innerTransaction.operations[0].type, 'payment');
  assert.equal(f.profile.localWeight >= f.profile.low, true);
  assert.equal(f.profile.localWeight >= f.profile.medium, false);
  // Cryptographic witness only; fixture accounts are unfunded, no ledger submission.
});

test('Cedar rejects unverified, wrong-account, wrong-key and over-budget requests; errors fail closed', () => {
  const facts = { credentialId: 'a', expectedCredentialId: 'a', feeAccount: 'fee', cAccount: 'c', expectedC: 'c', feeStroops: 200, passkeyVerified: true, cAuthorizationVerified: true };
  assert.equal(decide(cedar, facts).allowed, true);
  for (const change of [{ passkeyVerified: false }, { cAuthorizationVerified: false }, { cAccount: 'other' }, { credentialId: 'other' }, { feeStroops: 1001 }, { feeStroops: 0 }]) assert.equal(decide(cedar, { ...facts, ...change }).allowed, false);
  assert.equal(decide(cedar, facts, 'broken policy').allowed, false);
  assert.equal(decide({ isAuthorized() { throw Error('unavailable'); } }, facts).allowed, false);
});

test('different credential and forged credential ID cannot authorize fees', async () => {
  const f = await fixture(); const other = await fakeAuthenticator();
  const p = await f.gate.prepare(f.tx, f.assertion);
  const wrong = await other.assertion(p.challenge);
  await assert.rejects(f.gate.sign(p.nonce, wrong), /Wrong passkey credential/);
  const p2 = await f.gate.prepare(f.tx, f.assertion);
  const forged = await other.assertion(p2.challenge); forged.credentialId = f.auth.registration.credentialId;
  await assert.rejects(f.gate.sign(p2.nonce, forged), /Invalid passkey signature/);
});

test('C assertion is not a fee approval; changed fee and transaction change the fee challenge', async () => {
  const f = await fixture(); const p = await f.gate.prepare(f.tx, f.assertion);
  await assert.rejects(f.gate.sign(p.nonce, f.assertion), /Wrong passkey challenge/);
  assert.notEqual(b64(await feeChallenge(f.tx, 'n', 10)), b64(await feeChallenge(feeBump(f.inner, f.profile.account, '200'), 'n', 10)));
  assert.notEqual(b64(await feeChallenge(f.tx, 'n', 10)), b64(await feeChallenge(feeBump(unrelatedPayment(), f.profile.account), 'n', 10)));
  await assert.rejects(f.gate.prepare(feeBump(f.inner, f.profile.account, '1000'), f.assertion), /Cedar denied/);
});

test('approval is one-use, expires, and cannot sign concurrently twice', async () => {
  const f = await fixture(); const p = await f.gate.prepare(f.tx, f.assertion); const a = await f.auth.assertion(p.challenge);
  const results = await Promise.allSettled([f.gate.sign(p.nonce, a), f.gate.sign(p.nonce, a)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  let now = 1000;
  const gate = new LocalGate({ cedar, key: f.key, feeAccount: f.profile.account, registration: f.auth.registration, now: () => now });
  const p2 = await gate.prepare(f.tx, f.assertion); now += 60000;
  await assert.rejects(gate.sign(p2.nonce, await f.auth.assertion(p2.challenge)), /expired/);
});

test('origin, RP, presence, verification and backup flags are checked cryptographically', async () => {
  const a = await fakeAuthenticator(); const challenge = crypto.getRandomValues(new Uint8Array(32));
  for (const changes of [{ client: { origin: 'https://attacker.test' } }, { client: { crossOrigin: true } }, { rpId: 'other.test' }, { flags: 1 }, { flags: 4 }, { flags: 21 }]) {
    await assert.rejects(verifyAssertion(await a.assertion(challenge, changes), a.registration, challenge));
  }
  const forged = await a.assertion(challenge); forged.signature[forged.signature.length - 1] ^= 1;
  await assert.rejects(verifyAssertion(forged, a.registration, challenge), /Invalid passkey signature/);
});

test('DER parser rejects truncated, trailing, oversized and non-canonical signatures', () => {
  const invalid = [[48, 6, 2, 1, 0, 2, 1, 1], [48, 7, 2, 1, 1, 2, 1, 1, 0], [48, 7, 2, 2, 0, 1, 2, 1, 1], [48, 6, 2, 33, 1, 2, 1, 1], [48, 6, 2, 1, 128, 2, 1, 1]];
  for (const value of invalid) assert.throws(() => derToCompact(new Uint8Array(value)));
});

test('C authorization changes with a valid different C, network, nonce, expiry or invocation', async () => {
  const f = await fixture(); const expected = b64(cChallenge(f.intent.entry));
  const { StrKey } = await import('@stellar/stellar-sdk');
  assert.notEqual(expected, b64(cChallenge(f.intent.entry, StrKey.encodeContract(Buffer.alloc(32, 9)))));
  assert.notEqual(expected, b64(cChallenge(f.intent.entry, C_ACCOUNT, 'another network')));
  for (const edit of [e => e.credentials.address.nonce = 8n, e => e.credentials.address.signatureExpirationLedger = 12346, e => e.rootInvocation.function.contractFn.functionName = new xdr.XdrString('burn')]) {
    const e = xdr.SorobanAuthorizationEntry.fromXdr(f.intent.entry.toXdr()); edit(e);
    assert.notEqual(expected, b64(cChallenge(e)));
  }
});

test('gate rejects an embedded signature that differs from the checked assertion', async () => {
  const f = await fixture(); const other = await fakeAuthenticator();
  const inner = cTransaction(f.intent, await other.assertion(cChallenge(f.intent.entry)), other.publicKey);
  await assert.rejects(f.gate.prepare(feeBump(inner, f.profile.account), f.assertion), /Embedded C signature differs/);
});

test('fee signature commits to wrapper bytes and cannot authorize a modified fee', async () => {
  const f = await fixture(); const signed = await rawSignFee(f.tx, f.key);
  const altered = feeBump(f.inner, f.profile.account, '200');
  altered.signatures.push(...signed.signatures);
  assert.equal(verifiesFeeSignature(altered, f.key.publicKey), false);
});
