import { buildSyntheticAssertion } from '../../../packages/passkey-sdk/src/syntheticAssertion';
import { privateKeyForCredentialId } from './vault';

export interface Assertion {
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
}

/** Build a WebAuthn assertion over `challenge32` for the key behind
 *  `credentialId`. Verifier ignores origin/rpIdHash, so the SDK's synthetic
 *  assertion is accepted as-is. */
export async function makeAssertion(
  seed: Uint8Array,
  credentialId: Uint8Array,
  challenge32: Uint8Array,
): Promise<Assertion> {
  const d = await privateKeyForCredentialId(seed, credentialId);
  return buildSyntheticAssertion(d, challenge32);
}
