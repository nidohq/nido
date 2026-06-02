import { describe, it, expect } from 'vitest';
import { buildAttestationObject } from './attestation';
import { parseAttestationObject } from '../../../packages/passkey-sdk/src/webauthn';
import { buf2base64url } from '../../../packages/passkey-sdk/src/encoding';
import { publicKeyFromPrivate, privateKeyForCredentialId, credentialIdForLabel } from './vault';

const SEED = new Uint8Array(32).fill(7);

describe('attestation', () => {
  it('encodes an attestationObject the SDK can parse back to the pubkey', async () => {
    const id = await credentialIdForLabel(SEED, 'originator');
    const pub = publicKeyFromPrivate(await privateKeyForCredentialId(SEED, id));
    const attObj = buildAttestationObject(id, pub);
    const got = parseAttestationObject(buf2base64url(attObj));
    expect(Array.from(got)).toEqual(Array.from(pub));
  });
});
