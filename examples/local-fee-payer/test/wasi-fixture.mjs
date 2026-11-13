import { Buffer } from 'buffer';
import { createFeeKey, makeIntent, cChallenge, cTransaction, feeBump, C_ACCOUNT, NETWORK } from '../src/stellar.mjs';
import { fakeAuthenticator } from './fixtures.mjs';
export async function runtimeFixture(options = {}) {
  const auth = await fakeAuthenticator();
  auth.registration.origin = 'http://wallet.localhost:5199'; auth.registration.rpId = 'wallet.localhost';
  const intent = makeIntent();
  const assertion = await auth.assertion(cChallenge(intent.entry), options.assertion);
  if (options.tamperSignature) assertion.signature[assertion.signature.length - 1] ^= 1;
  const fee = await createFeeKey();
  const tx = feeBump(cTransaction(intent, assertion, auth.publicKey), fee.publicKey, options.baseFee || '100');
  const input = { requestId: crypto.randomUUID(), network: NETWORK, envelope: tx.toXdr(),
    intent: { kind: 'sponsor-demo-transfer', account: C_ACCOUNT, recipient: intent.recipient },
    registration: { credentialId: auth.registration.credentialId, spki: Buffer.from(auth.registration.spki).toString('base64') },
    assertedCredentialId: assertion.credentialId, feeAccount: fee.publicKey };
  return { input, fee, tx, auth };
}
