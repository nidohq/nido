import { describe, it, expect } from 'vitest';
import { p256 } from '@noble/curves/nist.js';
import { checkAssertionContext } from './assertionVerify.js';
import { buf2base64url } from './encoding.js';
import type { PasskeySignature } from './types.js';

const RP_ID = 'cabc.test.nido.fyi';
const ORIGIN = `https://${RP_ID}`;
const UP = 0x01;
const UV = 0x04;

async function sha256(b: Uint8Array): Promise<Uint8Array> {
  const buf = new ArrayBuffer(b.byteLength);
  new Uint8Array(buf).set(b);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

/** An assertion as an authenticator would produce it for `rpId`, signed by `priv`. */
async function assertion(
  priv: Uint8Array,
  opts: {
    challenge: Uint8Array;
    rpId?: string;
    flags?: number;
    clientData?: Record<string, unknown>;
  },
): Promise<PasskeySignature> {
  const authenticatorData = new Uint8Array(37);
  authenticatorData.set(await sha256(new TextEncoder().encode(opts.rpId ?? RP_ID)), 0);
  authenticatorData[32] = opts.flags ?? UP | UV;
  const clientDataJson = new TextEncoder().encode(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: buf2base64url(opts.challenge),
      origin: ORIGIN,
      crossOrigin: false,
      ...opts.clientData,
    }),
  );
  const msg = new Uint8Array(37 + 32);
  msg.set(authenticatorData, 0);
  msg.set(await sha256(clientDataJson), 37);
  const signature = p256.sign(await sha256(msg), priv, { prehash: false, lowS: true });
  return { authenticatorData, clientDataJson, signature };
}

describe('checkAssertionContext', () => {
  const priv = p256.utils.randomSecretKey();
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const expected = { challenge, rpId: RP_ID, origin: ORIGIN };

  it('accepts a good assertion', async () => {
    expect(await checkAssertionContext(await assertion(priv, { challenge }), expected)).toEqual({ ok: true });
  });

  it('refuses an assertion made for another relying party', async () => {
    const sig = await assertion(priv, { challenge, rpId: 'cother.test.nido.fyi' });
    expect(await checkAssertionContext(sig, expected)).toMatchObject({ ok: false, reason: 'rp_id' });
  });

  it('refuses an assertion without user verification', async () => {
    const sig = await assertion(priv, { challenge, flags: UP });
    expect(await checkAssertionContext(sig, expected)).toMatchObject({ ok: false, reason: 'user_verification' });
  });

  it('refuses an assertion without user presence', async () => {
    const sig = await assertion(priv, { challenge, flags: UV });
    expect(await checkAssertionContext(sig, expected)).toMatchObject({ ok: false, reason: 'user_presence' });
  });

  it('refuses an assertion over another challenge', async () => {
    const sig = await assertion(priv, { challenge: new Uint8Array(32).fill(7) });
    expect(await checkAssertionContext(sig, expected)).toMatchObject({ ok: false, reason: 'challenge' });
  });

  it('refuses another origin', async () => {
    const sig = await assertion(priv, { challenge, clientData: { origin: 'https://evil.example' } });
    expect(await checkAssertionContext(sig, expected)).toMatchObject({ ok: false, reason: 'origin' });
  });

  it('refuses a cross-origin frame', async () => {
    const sig = await assertion(priv, { challenge, clientData: { crossOrigin: true } });
    expect(await checkAssertionContext(sig, expected)).toMatchObject({ ok: false, reason: 'cross_origin' });
  });

  it('refuses a registration (webauthn.create) client data', async () => {
    const sig = await assertion(priv, { challenge, clientData: { type: 'webauthn.create' } });
    expect(await checkAssertionContext(sig, expected)).toMatchObject({ ok: false, reason: 'type' });
  });

  it('refuses client data that is not JSON', async () => {
    const sig = await assertion(priv, { challenge });
    sig.clientDataJson = new TextEncoder().encode('not json');
    expect(await checkAssertionContext(sig, expected)).toMatchObject({ ok: false, reason: 'client_data' });
  });

  it('refuses truncated authenticator data', async () => {
    const sig = await assertion(priv, { challenge });
    sig.authenticatorData = sig.authenticatorData.slice(0, 36);
    expect(await checkAssertionContext(sig, expected)).toMatchObject({
      ok: false,
      reason: 'authenticator_data',
    });
  });
});
