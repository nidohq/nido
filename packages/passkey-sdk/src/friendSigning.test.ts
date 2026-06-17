import { describe, it, expect } from 'vitest';
import { p256 } from '@noble/curves/nist.js';
import { computeAuthDigest } from './auth.js';
import { buildSyntheticAssertion } from './syntheticAssertion.js';
import {
  encodeRotationHandoff,
  decodeRotationHandoff,
  encodeFriendSignature,
  decodeFriendSignature,
  type RotationHandoff,
} from './friendSigning.js';

const VERIFIER = 'CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S';
const ACCOUNT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH';
const REFRACTOR_TX_HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const REFRACTOR_TX_HASH_2 = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

function sampleHandoff(): RotationHandoff {
  return {
    version: 4,
    account: ACCOUNT,
    recoveryRuleId: 4,
    refractorTxHashes: [REFRACTOR_TX_HASH],
    parentSignatureExpirationLedger: 1234567,
    relayKey: 'KEY_test123',
    relayBaseUrl: 'https://relay.nido.fyi',
  };
}

function b64uJson(o: unknown): string {
  return Buffer.from(JSON.stringify(o))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('rotation handoff encoding', () => {
  it('round-trips through a URL-safe string', () => {
    const h = sampleHandoff();
    const encoded = encodeRotationHandoff(h);
    expect(typeof encoded).toBe('string');
    expect(encoded).not.toMatch(/[+/=]/); // URL-safe
    expect(encoded).not.toContain('not-a-real-envelope');
    const decoded = decodeRotationHandoff(encoded);
    expect(decoded).toEqual(h);
  });

  it('does not put friends or transaction XDR in the handoff payload', () => {
    const encoded = encodeRotationHandoff(sampleHandoff());
    const json = new TextDecoder().decode(
      Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
    );
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed).toEqual({
      v: 4,
      a: ACCOUNT,
      r: 4,
      tx: [REFRACTOR_TX_HASH],
      exp: 1234567,
      k: 'KEY_test123',
      u: 'https://relay.nido.fyi',
    });
    expect(parsed).not.toHaveProperty('txXdr');
    expect(parsed).not.toHaveProperty('txXdrs');
    expect(parsed).not.toHaveProperty('friends');
  });

  it('round-trips a multi-tx Refractor handoff', () => {
    const h: RotationHandoff = {
      ...sampleHandoff(),
      refractorTxHashes: [REFRACTOR_TX_HASH, REFRACTOR_TX_HASH_2],
    };
    const decoded = decodeRotationHandoff(encodeRotationHandoff(h));
    expect(decoded.version).toBe(4);
    expect(decoded.refractorTxHashes).toEqual(h.refractorTxHashes);
  });

  it('rejects a handoff with the wrong version', () => {
    const encoded = b64uJson({
      v: 99,
      a: ACCOUNT,
      r: 4,
      tx: [REFRACTOR_TX_HASH],
      exp: 123,
    });
    expect(() => decodeRotationHandoff(encoded)).toThrow(/version/i);
  });

  it('rejects garbage input', () => {
    expect(() => decodeRotationHandoff('!!!not base64!!!')).toThrow();
  });

  it('rejects a handoff missing the canonical parent expiration ledger', () => {
    const { parentSignatureExpirationLedger, ...rest } = sampleHandoff();
    void parentSignatureExpirationLedger;
    const encoded = b64uJson({
      v: 4,
      a: rest.account,
      r: rest.recoveryRuleId,
      tx: rest.refractorTxHashes,
      k: rest.relayKey,
      u: rest.relayBaseUrl,
      // exp omitted intentionally
    });
    expect(() => decodeRotationHandoff(encoded)).toThrow(/malformed/i);
  });

  it('rejects a handoff with an empty Refractor tx list', () => {
    const encoded = b64uJson({
      v: 4,
      a: ACCOUNT,
      r: 4,
      tx: [],
      exp: 1234567,
      k: 'KEY_test123',
      u: 'https://relay.nido.fyi',
    });
    expect(() => decodeRotationHandoff(encoded)).toThrow(/malformed/i);
  });

  it('round-trips the canonical parent expiration ledger', () => {
    const h = sampleHandoff();
    const decoded = decodeRotationHandoff(encodeRotationHandoff(h));
    expect(decoded.parentSignatureExpirationLedger).toBe(
      h.parentSignatureExpirationLedger,
    );
  });

  it('rejects malformed Refractor transaction hashes', () => {
    const encoded = b64uJson({
      v: 4,
      a: ACCOUNT,
      r: 4,
      tx: ['not-a-hash'],
      exp: 1234567,
      k: 'KEY_test123',
      u: 'https://relay.nido.fyi',
    });
    expect(() => decodeRotationHandoff(encoded)).toThrow(/malformed/i);
  });
});

describe('friend signature encoding', () => {
  it('round-trips a single-entry friend signature blob (v1 wire)', async () => {
    const priv = p256.utils.randomSecretKey();
    const pub = p256.getPublicKey(priv, false); // 65-byte uncompressed
    // Friend signs their OWN auth digest.
    const friendPayload = new Uint8Array(32).fill(0x42);
    const friendDigest = computeAuthDigest(friendPayload, [0]);
    const assertion = await buildSyntheticAssertion(priv, new Uint8Array(friendDigest));

    const blob = encodeFriendSignature({
      friendAccount: ACCOUNT,
      verifierAddress: VERIFIER,
      publicKey: pub,
      entries: [
        {
          authenticatorData: assertion.authenticatorData,
          clientDataJson: assertion.clientDataJSON,
          signature: assertion.signature,
          nonce: '12345',
          signatureExpirationLedger: 99999,
        },
      ],
    });
    expect(typeof blob).toBe('string');
    // Single-entry blobs stay on the v1 wire for older originators.
    const wire = JSON.parse(
      Buffer.from(blob.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    ) as { v: number; sig?: string };
    expect(wire.v).toBe(1);
    expect(typeof wire.sig).toBe('string');

    const decoded = decodeFriendSignature(blob);
    expect(decoded.friendAccount).toBe(ACCOUNT);
    expect(decoded.verifierAddress).toBe(VERIFIER);
    expect(decoded.entries.length).toBe(1);
    expect(decoded.entries[0].nonce).toBe('12345');
    expect(decoded.entries[0].signatureExpirationLedger).toBe(99999);
    expect(Array.from(decoded.publicKey)).toEqual(Array.from(pub));
    expect(Array.from(decoded.entries[0].signature)).toEqual(
      Array.from(assertion.signature),
    );
  });

  it('round-trips a multi-entry friend signature blob (v2 wire)', async () => {
    const priv = p256.utils.randomSecretKey();
    const pub = p256.getPublicKey(priv, false);
    const mkEntry = async (fill: number, nonce: string) => {
      const digest = computeAuthDigest(new Uint8Array(32).fill(fill), [0]);
      const a = await buildSyntheticAssertion(priv, new Uint8Array(digest));
      return {
        authenticatorData: a.authenticatorData,
        clientDataJson: a.clientDataJSON,
        signature: a.signature,
        nonce,
        signatureExpirationLedger: 88888,
      };
    };
    const entries = [await mkEntry(0x01, '111'), await mkEntry(0x02, '222')];
    const blob = encodeFriendSignature({
      friendAccount: ACCOUNT,
      verifierAddress: VERIFIER,
      publicKey: pub,
      entries,
    });
    const decoded = decodeFriendSignature(blob);
    expect(decoded.entries.length).toBe(2);
    expect(decoded.entries.map((e) => e.nonce)).toEqual(['111', '222']);
    expect(Array.from(decoded.entries[1].signature)).toEqual(
      Array.from(entries[1].signature),
    );
  });

  it('decodes a legacy v1 wire blob into a one-entry FriendSignature', () => {
    const legacy = {
      v: 1,
      friend: ACCOUNT,
      verifier: VERIFIER,
      pub: '04ab',
      ad: '0001',
      cd: '7b7d',
      sig: 'ff'.repeat(64),
      nonce: '777',
      exp: 555,
    };
    const blob = Buffer.from(JSON.stringify(legacy))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const decoded = decodeFriendSignature(blob);
    expect(decoded.entries.length).toBe(1);
    expect(decoded.entries[0].nonce).toBe('777');
    expect(decoded.entries[0].signatureExpirationLedger).toBe(555);
  });

  it('produces a signature the P-256 verifier accepts over the friend digest', async () => {
    // This mirrors what the on-chain WebAuthn verifier checks: the signature
    // is over sha256(authenticatorData || sha256(clientDataJSON)).
    const priv = p256.utils.randomSecretKey();
    const pub = p256.getPublicKey(priv, false);
    const friendPayload = new Uint8Array(32).fill(0x7e);
    const friendDigest = new Uint8Array(computeAuthDigest(friendPayload, [0]));
    const assertion = await buildSyntheticAssertion(priv, friendDigest);

    const cdHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', assertion.clientDataJSON),
    );
    const msg = new Uint8Array(assertion.authenticatorData.length + cdHash.length);
    msg.set(assertion.authenticatorData, 0);
    msg.set(cdHash, assertion.authenticatorData.length);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', msg));

    expect(p256.verify(assertion.signature, digest, pub, { prehash: false })).toBe(true);
  });
});

const HASH = 'a'.repeat(64);

describe('RotationHandoff v4 (relayKey)', () => {
  const h: RotationHandoff = {
    version: 4,
    account: 'CACCOUNT',
    recoveryRuleId: 2,
    refractorTxHashes: [HASH],
    parentSignatureExpirationLedger: 123,
    relayKey: 'KEY_abc123-xyz',
    relayBaseUrl: 'https://relay.nido.fyi',
  };
  it('round-trips a v4 handoff including relayKey + relayBaseUrl', () => {
    expect(decodeRotationHandoff(encodeRotationHandoff(h))).toEqual(h);
  });
  it('rejects a stale v3 link', () => {
    const v3wire = btoa(JSON.stringify({ v: 3, a: 'C', r: 1, tx: [HASH], exp: 1 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(() => decodeRotationHandoff(v3wire)).toThrow(/version/i);
  });
  it('rejects a v4 handoff missing relayKey', () => {
    const bad = { ...h } as Partial<RotationHandoff>;
    delete bad.relayKey;
    expect(() => encodeRotationHandoff(bad as RotationHandoff)).toThrow(/relayKey/i);
  });
});
