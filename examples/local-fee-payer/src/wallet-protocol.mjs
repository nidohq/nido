import { StrKey } from '@stellar/stellar-sdk';
import { C_ACCOUNT } from './stellar.mjs';

export const APP_ORIGIN = 'http://localhost:5198';
export const WALLET_ORIGIN = 'http://wallet.localhost:5199';
export function validateWalletRequest(request) {
  if (!request || typeof request !== 'object' || Object.keys(request).sort().join() !== 'account,kind,recipient') throw Error('Unsupported request fields');
  if (request.kind !== 'sponsor-demo-transfer') throw Error('No raw signing or key-export API');
  if (request.account !== C_ACCOUNT) throw Error('Wallet policy: wrong C account');
  if (typeof request.recipient !== 'string' || !StrKey.isValidEd25519PublicKey(request.recipient)) throw Error('Invalid recipient');
  // The caller cannot choose a derivation path, network, token, function, amount or fee.
  return Object.freeze({ kind: request.kind, account: C_ACCOUNT, recipient: request.recipient });
}
export function expectedMessage(event, expectedOrigin, expectedSource, requestId) {
  return event.origin === expectedOrigin && event.source === expectedSource && event.data?.requestId === requestId;
}
