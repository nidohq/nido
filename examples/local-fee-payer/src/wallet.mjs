import { Address, TransactionBuilder } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { APP_ORIGIN, WALLET_ORIGIN, expectedMessage, validateWalletRequest } from './wallet-protocol.mjs';
import { C_ACCOUNT, NETWORK, cChallenge, cTransaction, feeBump, makeIntent, rawSignFee, verifiesFeeSignature } from './stellar.mjs';
import { newMnemonic, derivePublicAccounts, withFeeKey, sealMnemonic, openMnemonic } from './hd-vault.mjs';
import { b64, unb64, registerPasskey, requestAssertion, sha256, utf8, verifyAssertion } from './webauthn.mjs';
import { evaluateInWallet } from './wasi-client.mjs';
import { createSigningBoundary } from './signing-boundary.mjs';
import manifest from '../public/runtime/manifest.json';

const $ = id => document.getElementById(id);
const storageKey = 'nido-fee-lab-prf-vault-v1';
const requestId = location.hash.slice(1);
let vault, request, consumed = false, busy = false;
const binding = credentialId => JSON.stringify(['nido/demo-seed-v1', WALLET_ORIGIN, C_ACCOUNT, credentialId]);
const message = (text, bad = false) => { $('wallet-message').textContent = text; $('wallet-message').className = 'notice ' + (bad ? 'bad' : 'good'); };
const registration = () => ({ ...vault.registration, spki: unb64(vault.registration.spki) });
function controls() {
  $('create-vault').disabled = busy || !!vault;
  $('wallet-approve').disabled = busy || !vault || !request || consumed;
  $('wallet-reject').disabled = busy || !request || consumed;
}
function showVault() {
  $('vault-state').textContent = vault ? 'Encrypted · locked' : 'Not created';
  if (vault) { $('hd-u').textContent = vault.publicKeys.u; $('hd-f').textContent = vault.publicKeys.fee; }
  controls();
}
function reply(payload) { window.opener?.postMessage({ kind: 'wallet-result', requestId, ...payload }, APP_ORIGIN); }

async function createVault() {
  busy = true; controls(); let prf, phrase;
  try {
    message('Create a demo passkey with PRF support, then verify it to encrypt a fresh seed.');
    const reg = await registerPasskey({ prf: {} });
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const challenge = await sha256(crypto.getRandomValues(new Uint8Array(32)));
    const assertion = await requestAssertion(reg, challenge, { prf: { eval: { first: salt } } });
    await verifyAssertion(assertion, reg, challenge); prf = assertion.prf;
    if (!prf) throw Error('This authenticator does not provide PRF. No seed created; no insecure fallback.');
    phrase = newMnemonic();
    const publicKeys = await derivePublicAccounts(phrase);
    const sealed = await sealMnemonic(phrase, prf, binding(reg.credentialId));
    vault = { version: 1, registration: { ...reg, spki: b64(reg.spki) }, salt: b64(salt), sealed, publicKeys };
    localStorage.setItem(storageKey, JSON.stringify(vault));
    message('Seed encrypted. Review the request, then use this same passkey to authorize C and unlock fee signing.');
  } catch (error) { message(error.message, true); }
  finally { prf?.fill(0); phrase = undefined; busy = false; showVault(); }
}

async function approve() {
  if (!request || !vault || consumed || busy) return;
  busy = true; consumed = true; controls(); let prf, phrase;
  try {
    // Revalidate the immutable intent and construct the authorization inside the wallet.
    const approved = validateWalletRequest(request);
    const intent = makeIntent();
    intent.recipient = approved.recipient;
    intent.args[1] = new Address(approved.recipient).toScVal();
    intent.entry.rootInvocation.function.contractFn.args = intent.args;
    const challenge = cChallenge(intent.entry);
    message('Use the wallet passkey. This assertion signs C and its PRF unlocks the encrypted seed.');
    const assertion = await requestAssertion(registration(), challenge, { prf: { eval: { first: unb64(vault.salt) } } });
    const publicKey = await verifyAssertion(assertion, registration(), challenge); prf = assertion.prf;
    if (!prf) throw Error('Passkey PRF unavailable; vault stays locked');
    const inner = cTransaction(intent, assertion, publicKey);
    const tx = feeBump(inner, vault.publicKeys.fee);
    $('runtime-state').textContent = 'Checking exact XDR in WASI…';
    const signer = createSigningBoundary(evaluateInWallet, async (envelope, expectedFee, decision) => {
      $('runtime-state').textContent = 'Allowed · Perch + passkey + Cedar';
      $('runtime-evidence').textContent = JSON.stringify({ module: manifest.sha256, ...decision }, null, 2);
      phrase = await openMnemonic(vault.sealed, prf, binding(vault.registration.credentialId));
      return withFeeKey(phrase, async key => {
        if (key.publicKey !== expectedFee || expectedFee !== vault.publicKeys.fee) throw Error('Derived fee identity mismatch');
        return rawSignFee(TransactionBuilder.fromXdr(envelope, NETWORK), key);
      });
    });
    // This public snapshot intentionally excludes the seed, PRF output and keys.
    const signed = await signer.sign({ requestId, network: NETWORK, envelope: tx.toXdr(), intent: approved,
      registration: { credentialId: vault.registration.credentialId, spki: Buffer.from(registration().spki).toString('base64') },
      assertedCredentialId: assertion.credentialId, feeAccount: vault.publicKeys.fee });
    if (!verifiesFeeSignature(signed, vault.publicKeys.fee)) throw Error('Fee signature failed verification');
    reply({ ok: true, xdr: signed.toXdr(), publicKeys: vault.publicKeys });
    message('Signed envelope returned. The app received public keys and XDR, never the phrase, PRF output or a signing key.');
  } catch (error) { $('runtime-state').textContent = 'Refused or failed · no envelope released'; reply({ ok: false, error: error.message }); message(error.message, true); }
  finally { prf?.fill(0); phrase = undefined; busy = false; showVault(); }
}

try {
  if (location.origin !== WALLET_ORIGIN || window.top !== window.self) throw Error('Open this wallet as a top-level popup at wallet.localhost:5199.');
  $('runtime-state').textContent = 'Ready · WASI Preview 1 / Cedar 4.14.1';
  const stored = localStorage.getItem(storageKey); vault = stored ? JSON.parse(stored) : undefined;
  if (vault && (vault.version !== 1 || vault.registration.origin !== WALLET_ORIGIN || vault.registration.rpId !== 'wallet.localhost')) throw Error('Unexpected vault binding');
  showVault();
  $('create-vault').addEventListener('click', createVault);
  $('wallet-approve').addEventListener('click', approve);
  $('wallet-reject').addEventListener('click', () => { consumed = true; reply({ ok: false, error: 'User rejected request' }); controls(); message('Request rejected. Vault stayed locked.'); });
  window.addEventListener('message', event => {
    if (!expectedMessage(event, APP_ORIGIN, window.opener, requestId) || event.data?.kind !== 'wallet-request' || consumed || request) return;
    try {
      request = validateWalletRequest(event.data.request);
      $('request-origin').textContent = event.origin; $('request-c').textContent = request.account; $('request-recipient').textContent = request.recipient;
      message(vault ? 'Review this intent. Approval happens here, outside the requesting app.' : 'Create a demo vault to try this request.'); controls();
    } catch (error) { consumed = true; reply({ ok: false, error: error.message }); message(error.message, true); controls(); }
  });
  window.opener?.postMessage({ kind: 'wallet-ready', requestId }, APP_ORIGIN);
  document.documentElement.dataset.walletReady = 'true';
  if (!window.opener) message('This wallet accepts requests from the lab at localhost:5198. No request is open.');
} catch (error) { message(error.message, true); }
