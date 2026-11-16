import initCedar, * as cedar from '@cedar-policy/cedar-wasm/web';
import wasmUrl from '../node_modules/@cedar-policy/cedar-wasm/web/cedar_wasm_bg.wasm?url';
import { C_ACCOUNT, cChallenge, cTransaction, createFeeKey, feeBump, feeProfile, inspectC, makeIntent, rawSignFee, unrelatedPayment, verifiesFeeSignature } from './stellar.mjs';
import { LocalGate } from './gate.mjs';
import { POLICY, decide } from './policy.mjs';
import { registerPasskey, requestAssertion, verifyAssertion } from './webauthn.mjs';
import './popup-client.mjs';
import './budget-client.mjs';

const $ = id => document.getElementById(id);
let key, profile, registration, gate, pending, signed;
const status = (id, text, kind = '') => { $(id).textContent = text; $(id).className = kind; };
const message = (text, kind = '') => status('message', text, `notice ${kind}`);
function busy(value) {
  $('register').disabled = value || !key;
  $('approve-c').disabled = value || !registration;
  $('approve-fee').disabled = value || !pending;
  $('bypass').disabled = value || !key;
  $('fee').disabled = value;
}
async function action(work) {
  busy(true);
  try { await work(); } catch (error) { message(error.message || String(error), 'bad'); }
  finally { busy(false); }
}
function clearResult() {
  pending = undefined; signed = undefined; $('download').disabled = true;
  for (const id of ['c-status', 'fee-passkey-status', 'signature-status']) status(id, 'Not signed');
  status('policy-status', 'Not evaluated');
}
$('policy').textContent = POLICY;
$('c-address').textContent = C_ACCOUNT;
$('register').addEventListener('click', () => action(async () => {
  clearResult(); message('Create a demo passkey. Its public key will be pinned to fixture C in this page session.');
  registration = await registerPasskey();
  gate = new LocalGate({ cedar, key, feeAccount: profile.account, registration });
  $('credential-id').textContent = registration.credentialId;
  message('Passkey enrolled locally. Next, approve the fixture C action.', 'good');
}));
$('approve-c').addEventListener('click', () => action(async () => {
  clearResult();
  const intent = makeIntent(); const challenge = cChallenge(intent.entry);
  message('Passkey prompt 1: approve C’s fixture token transfer.');
  const assertion = await requestAssertion(registration, challenge);
  const publicKey = await verifyAssertion(assertion, registration, challenge);
  status('c-status', 'Verified', 'good');
  const tx = feeBump(cTransaction(intent, assertion, publicKey), profile.account, $('fee').value);
  try { pending = await gate.prepare(tx, assertion); }
  catch (error) { status('policy-status', 'Denied', 'bad'); throw error; }
  status('policy-status', 'Allow · preflight', 'good');
  message(`C authorization verified. The ${pending.fee}-stroop fee envelope now needs a separate approval from the same passkey.`, 'good');
}));
$('approve-fee').addEventListener('click', () => action(async () => {
  const request = pending; pending = undefined;
  message('Passkey prompt 2: approve the exact fee-bump envelope and fee limit.');
  const assertion = await requestAssertion(registration, request.challenge);
  signed = await gate.sign(request.nonce, assertion);
  status('fee-passkey-status', 'Verified · same key', 'good');
  const verifies = verifiesFeeSignature(signed, key.publicKey);
  status('signature-status', verifies ? 'Yes · Ed25519' : 'Failed', verifies ? 'good' : 'bad');
  if (!verifies) throw Error('Fee signature verification failed');
  $('download').disabled = false;
  message('The guarded flow signed the exact fee envelope. Signature verified locally; nothing was submitted to Stellar.', 'good');
}));
$('fee').addEventListener('change', () => { clearResult(); busy(false); message('Fee selection changed. Approve C again to prepare a new envelope.'); });
$('bypass').addEventListener('click', () => action(async () => {
  const tx = feeBump(unrelatedPayment(), profile.account);
  let rejected = false;
  try { inspectC(tx); } catch { rejected = true; }
  const decision = decide(cedar, { credentialId: registration?.credentialId ?? 'absent', expectedCredentialId: registration?.credentialId ?? 'expected', feeAccount: profile.account, cAccount: '', expectedC: C_ACCOUNT, feeStroops: Number(tx.fee), passkeyVerified: false, cAuthorizationVerified: false });
  if (!rejected || decision.allowed) throw Error('Unexpected policy acceptance');
  status('bypass-policy', 'Deny · no C authorization', 'bad');
  const witness = await rawSignFee(tx, key);
  if (!verifiesFeeSignature(witness, key.publicKey)) throw Error('Bypass witness did not verify');
  status('bypass-signature', 'Valid · without passkey', 'bad');
  $('bypass-message').textContent = 'The comparison’s app-owned key signed despite Cedar’s denial. This is a different key from the isolated wallet’s HD fee key; that wallet was not accessed. No ledger submission occurred.';
  message('App-owned comparison bypass reproduced. The isolated wallet’s key was not accessed.', 'bad');
}));
$('download').addEventListener('click', () => {
  if (!signed) return;
  const url = URL.createObjectURL(new Blob([signed.toXdr() + '\n'], { type: 'text/plain' }));
  const link = document.createElement('a'); link.href = url; link.download = 'nido-fee-payer-fixture.xdr'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

try {
  await initCedar({ module_or_path: wasmUrl });
  key = await createFeeKey(); profile = feeProfile(key);
  $('f-address').textContent = profile.account; $('l-address').textContent = key.publicKey;
  if (!window.isSecureContext || !navigator.credentials) throw Error('Use localhost in a browser with WebAuthn support.');
  message('Separate vulnerable comparison ready. Its temporary app-owned key can bypass its own gate.'); busy(false);
  document.documentElement.dataset.ready = 'true';
} catch (error) { message('Startup failed: ' + error.message, 'bad'); }
