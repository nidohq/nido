import { describe, it, expect } from 'vitest';
import { makeCredential, makeAssertionCredential } from './credential';
import { parseRegistration } from '../../../packages/passkey-sdk/src/webauthn';
import { parseAssertionResponse } from '../../../packages/passkey-sdk/src/auth';
import { credentialIdForLabel, privateKeyForCredentialId, publicKeyFromPrivate } from './vault';

const SEED = new Uint8Array(32).fill(7);

describe('credential', () => {
  it('create-credential parses to the right pubkey + credentialId', async () => {
    const id = await credentialIdForLabel(SEED, 'originator');
    const pub = publicKeyFromPrivate(await privateKeyForCredentialId(SEED, id));
    const cred = await makeCredential(SEED, 'originator');
    const reg = parseRegistration(cred as any);
    expect(Array.from(reg.publicKey)).toEqual(Array.from(pub));
    expect(Array.from(reg.credentialId)).toEqual(Array.from(id));
    expect(cred.type).toBe('public-key');
  });

  it('get-credential response parses via the SDK parseAssertionResponse', async () => {
    const id = await credentialIdForLabel(SEED, 'originator');
    const cred = await makeAssertionCredential(SEED, id, new Uint8Array(32).fill(9));
    const r = cred.response as AuthenticatorAssertionResponse;
    expect(new Uint8Array(r.authenticatorData).length).toBe(37);
    const parsed = parseAssertionResponse({
      authenticatorData: r.authenticatorData,
      clientDataJSON: r.clientDataJSON,
      signature: r.signature,
    });
    expect(parsed.signature.length).toBe(64);
  });
});
