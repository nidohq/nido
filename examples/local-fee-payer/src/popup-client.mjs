import { Keypair, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { C_ACCOUNT, NETWORK, inspectC, verifiesFeeSignature } from './stellar.mjs';
import { APP_ORIGIN, WALLET_ORIGIN, expectedMessage } from './wallet-protocol.mjs';
const status = document.getElementById('popup-message');
let current;
function openWallet(wrongAccount = false) {
  if (location.origin !== APP_ORIGIN) { status.textContent = 'Use http://localhost:5198/ for this demo’s exact origin allowlist.'; return; }
  if (current && !current.window.closed && !current.done) { current.window.focus(); status.textContent = 'Finish the pending request in the wallet first.'; return; }
  const requestId = crypto.randomUUID();
  const request = { kind: 'sponsor-demo-transfer', account: wrongAccount ? StrKey.encodeContract(new Uint8Array(32).fill(9)) : C_ACCOUNT, recipient: Keypair.random().publicKey() };
  const popup = window.open(`${WALLET_ORIGIN}/wallet.html#${requestId}`, `nido-demo-${requestId}`, 'popup,width=660,height=920');
  if (!popup) { status.textContent = 'Popup blocked. Allow this local demo to open its wallet window.'; return; }
  current = { window: popup, requestId, request, done: false };
  status.textContent = 'Review the request in wallet.localhost. The app cannot read that window’s vault.';
}
document.getElementById('open-wallet').addEventListener('click', () => openWallet());
document.getElementById('wrong-wallet').addEventListener('click', () => openWallet(true));
window.addEventListener('message', event => {
  if (!current || current.done || !expectedMessage(event, WALLET_ORIGIN, current.window, current.requestId)) return;
  if (event.data.kind === 'wallet-ready') {
    current.window.postMessage({ kind: 'wallet-request', requestId: current.requestId, request: current.request }, WALLET_ORIGIN);
  } else if (event.data.kind === 'wallet-result') {
    current.done = true;
    if (!event.data.ok) { status.textContent = 'Wallet refused: ' + event.data.error; status.className = 'notice bad'; return; }
    try {
      const tx = TransactionBuilder.fromXdr(event.data.xdr, NETWORK);
      inspectC(tx);
      if (tx.feeSource !== event.data.publicKeys.fee || !verifiesFeeSignature(tx, event.data.publicKeys.fee)) throw Error('Invalid returned fee signature');
      status.textContent = 'Wallet approved. Fee signature independently verified. The app received the signed fixture and public keys only. No transaction was submitted.';
      status.className = 'notice good'; status.dataset.signed = 'true';
    } catch (error) { status.textContent = error.message; status.className = 'notice bad'; }
  }
});
