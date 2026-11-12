import { describe, it, expect, vi } from 'vitest';
import { p256 } from '@noble/curves/nist.js';
import { buf2base64url } from '@nidohq/passkey-sdk';
import type { PasskeySignature } from '@nidohq/passkey-sdk';
import { adoptExistingPasskey, adoptFailureMessage, type AdoptPasskeyDeps } from './adoptPasskey.js';

const ACCOUNT = 'CABC';
const PAGE = { rpId: 'cabc.test.nido.fyi', origin: 'https://cabc.test.nido.fyi' };

async function sha256(b: Uint8Array): Promise<Uint8Array> {
  const buf = new ArrayBuffer(b.byteLength);
  new Uint8Array(buf).set(b);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

/** A fake authenticator holding `priv`, answering for `rpId` with `flags`. */
function authenticator(priv: Uint8Array, opts: { rpId?: string; flags?: number } = {}) {
  return async (challenge: Uint8Array): Promise<{ credentialId: Uint8Array; signature: PasskeySignature }> => {
    const authenticatorData = new Uint8Array(37);
    authenticatorData.set(await sha256(new TextEncoder().encode(opts.rpId ?? PAGE.rpId)), 0);
    authenticatorData[32] = opts.flags ?? 0x05; // UP | UV
    const clientDataJson = new TextEncoder().encode(
      JSON.stringify({ type: 'webauthn.get', challenge: buf2base64url(challenge), origin: PAGE.origin }),
    );
    const msg = new Uint8Array(37 + 32);
    msg.set(authenticatorData, 0);
    msg.set(await sha256(clientDataJson), 37);
    const signature = p256.sign(await sha256(msg), priv, { prehash: false, lowS: true });
    return { credentialId: new Uint8Array([1, 2, 3]), signature: { authenticatorData, clientDataJson, signature } };
  };
}

function deps(over: Partial<AdoptPasskeyDeps>): AdoptPasskeyDeps {
  return {
    page: PAGE,
    getAssertion: async () => {
      throw new Error('no authenticator');
    },
    readSignerKeys: async () => [],
    save: vi.fn(),
    ...over,
  };
}

describe('adoptExistingPasskey', () => {
  const priv = p256.utils.randomSecretKey();
  const pub = p256.getPublicKey(priv, false);
  const other = p256.getPublicKey(p256.utils.randomSecretKey(), false);

  it("saves the passkey when its key is one of the account's signers", async () => {
    const save = vi.fn();
    const result = await adoptExistingPasskey(
      ACCOUNT,
      deps({ getAssertion: authenticator(priv), readSignerKeys: async () => [other, pub], save }),
    );
    expect(result).toEqual({ kind: 'adopted', credentialId: new Uint8Array([1, 2, 3]), publicKey: pub });
    expect(save).toHaveBeenCalledWith(ACCOUNT, new Uint8Array([1, 2, 3]), pub);
  });

  it("saves nothing when the key is not on the account", async () => {
    const save = vi.fn();
    const result = await adoptExistingPasskey(
      ACCOUNT,
      deps({ getAssertion: authenticator(priv), readSignerKeys: async () => [other], save }),
    );
    expect(result).toEqual({ kind: 'not-a-signer' });
    expect(save).not.toHaveBeenCalled();
    expect(adoptFailureMessage(result as { kind: 'not-a-signer' })).toMatch(/recover/i);
  });

  it('saves nothing when the assertion fails a local check', async () => {
    const save = vi.fn();
    const result = await adoptExistingPasskey(
      ACCOUNT,
      deps({ getAssertion: authenticator(priv, { flags: 0x01 }), readSignerKeys: async () => [pub], save }),
    );
    expect(result).toMatchObject({ kind: 'invalid', reason: 'user_verification' });
    expect(save).not.toHaveBeenCalled();
  });

  it('saves nothing for a passkey of another relying party', async () => {
    const save = vi.fn();
    const result = await adoptExistingPasskey(
      ACCOUNT,
      deps({ getAssertion: authenticator(priv, { rpId: 'cother.test.nido.fyi' }), readSignerKeys: async () => [pub], save }),
    );
    expect(result).toMatchObject({ kind: 'invalid', reason: 'rp_id' });
    expect(save).not.toHaveBeenCalled();
  });

  it('does not prompt for a passkey when the account cannot be read', async () => {
    const getAssertion = vi.fn();
    await expect(
      adoptExistingPasskey(
        ACCOUNT,
        deps({
          getAssertion,
          readSignerKeys: async () => {
            throw new Error('rpc down');
          },
        }),
      ),
    ).rejects.toThrow('rpc down');
    expect(getAssertion).not.toHaveBeenCalled();
  });
});
