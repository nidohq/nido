import { describe, it, expect } from 'vitest';
import { Buffer } from 'buffer';
import { StrKey, Networks } from '@stellar/stellar-sdk';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { m2Message } from '@nidohq/passkey-sdk';
import {
  deriveM2SecretSafely,
  WalletNotDeterministicError,
  type WalletSignMessageKit,
} from './walletRecoverySign.js';

// Same synthetic-keypair approach as tests/spikes/sep53-verify.mjs and
// tests/spikes/wallet-determinism-check.mjs's `--self-test`: a real,
// locally-generated ed25519 keypair, no browser/wallet extension involved.
// A syntactically-valid (checksum-correct) placeholder contract address --
// `deriveSecretM2` calls `StrKey.decodeContract`, which validates the
// checksum -- same fixture convention as derivation.test.ts.
const PLACEHOLDER_C_ADDRESS = StrKey.encodeContract(Buffer.from(new Uint8Array(32).fill(0x11)));
const NETWORK_PASSPHRASE = Networks.TESTNET;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function makeWallet() {
  const secretKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  const gAddress = StrKey.encodeEd25519PublicKey(Buffer.from(publicKey));
  return { secretKey, gAddress };
}

function sep53Preimage(message: string): Uint8Array {
  const encoder = new TextEncoder();
  const prefix = encoder.encode('Stellar Signed Message:\n');
  const body = encoder.encode(message);
  const combined = new Uint8Array(prefix.length + body.length);
  combined.set(prefix, 0);
  combined.set(body, prefix.length);
  return sha256(combined);
}

/** A fake `WalletSignMessageKit` that returns a fixed queue of base64
 *  signatures, one per `signMessage` call, in order. */
function queueKit(signatures: Uint8Array[]): WalletSignMessageKit {
  let i = 0;
  return {
    signMessage: async () => {
      const sig = signatures[i];
      i += 1;
      if (!sig) throw new Error('queueKit: signMessage called more times than expected');
      return { signedMessage: bytesToBase64(sig) };
    },
  };
}

describe('deriveM2SecretSafely', () => {
  it('returns a secret when a deterministic wallet signs the same bytes twice', async () => {
    const { secretKey, gAddress } = makeWallet();
    const message = m2Message(PLACEHOLDER_C_ADDRESS, NETWORK_PASSPHRASE);
    const preimage = sep53Preimage(message);
    // Genuine positive case: ed25519 signing is deterministic (RFC 8032), so
    // signing the SAME preimage with the SAME key twice really does produce
    // byte-identical signatures -- exactly what a well-behaved wallet does.
    const sig1 = ed25519.sign(preimage, secretKey);
    const sig2 = ed25519.sign(preimage, secretKey);
    expect(sig1).toEqual(sig2); // sanity: our synthetic setup is genuinely deterministic

    const secret = await deriveM2SecretSafely({
      kit: queueKit([sig1, sig2]),
      account: PLACEHOLDER_C_ADDRESS,
      walletAddress: gAddress,
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    expect(typeof secret).toBe('bigint');
  });

  it('calls onStatus before each signing prompt', async () => {
    const { secretKey, gAddress } = makeWallet();
    const message = m2Message(PLACEHOLDER_C_ADDRESS, NETWORK_PASSPHRASE);
    const preimage = sep53Preimage(message);
    const sig = ed25519.sign(preimage, secretKey);
    const statuses: string[] = [];

    await deriveM2SecretSafely({
      kit: queueKit([sig, sig]),
      account: PLACEHOLDER_C_ADDRESS,
      walletAddress: gAddress,
      networkPassphrase: NETWORK_PASSPHRASE,
      onStatus: (s) => statuses.push(s),
    });

    expect(statuses.length).toBe(2);
  });

  it('throws WalletNotDeterministicError when the two signatures differ', async () => {
    const { secretKey, gAddress } = makeWallet();
    const message = m2Message(PLACEHOLDER_C_ADDRESS, NETWORK_PASSPHRASE);
    const preimage = sep53Preimage(message);
    const sig1 = ed25519.sign(preimage, secretKey);
    // Negative control: corrupt one byte of sig2 -- a genuinely nondeterministic
    // (or buggy) wallet's second signature.
    const sig2 = Uint8Array.from(sig1);
    sig2[0] ^= 0xff;
    expect(sig1).not.toEqual(sig2);

    await expect(
      deriveM2SecretSafely({
        kit: queueKit([sig1, sig2]),
        account: PLACEHOLDER_C_ADDRESS,
        walletAddress: gAddress,
        networkPassphrase: NETWORK_PASSPHRASE,
      }),
    ).rejects.toThrow(WalletNotDeterministicError);
  });

  it('throws WalletNotDeterministicError with a seed-method hint in the message', async () => {
    const { secretKey, gAddress } = makeWallet();
    const message = m2Message(PLACEHOLDER_C_ADDRESS, NETWORK_PASSPHRASE);
    const preimage = sep53Preimage(message);
    const sig1 = ed25519.sign(preimage, secretKey);
    const sig2 = Uint8Array.from(sig1);
    sig2[sig2.length - 1] ^= 0x01;

    await expect(
      deriveM2SecretSafely({
        kit: queueKit([sig1, sig2]),
        account: PLACEHOLDER_C_ADDRESS,
        walletAddress: gAddress,
        networkPassphrase: NETWORK_PASSPHRASE,
      }),
    ).rejects.toThrow(/seed-phrase method instead/);
  });

  it('throws when both signatures are byte-identical but fail SEP-53 verification', async () => {
    // Byte-identical sigs that are simply signed over the WRONG preimage (e.g.
    // a wallet that mangles the SEP-53 wrapping consistently every time) --
    // deterministic, but not a valid SEP-53 signature over this message. The
    // double-sign check alone would miss this; independent SEP-53 verification
    // must catch it.
    const { secretKey, gAddress } = makeWallet();
    const wrongMessage = m2Message(PLACEHOLDER_C_ADDRESS, Networks.PUBLIC);
    const wrongPreimage = sep53Preimage(wrongMessage);
    const sig = ed25519.sign(wrongPreimage, secretKey);

    await expect(
      deriveM2SecretSafely({
        kit: queueKit([sig, sig]),
        account: PLACEHOLDER_C_ADDRESS,
        walletAddress: gAddress,
        networkPassphrase: NETWORK_PASSPHRASE, // testnet -- sig was signed over PUBLIC's preimage
      }),
    ).rejects.toThrow(WalletNotDeterministicError);
  });

  it('throws when the signature is valid SEP-53 but for a different signer address', async () => {
    const { secretKey } = makeWallet();
    const { gAddress: otherGAddress } = makeWallet();
    const message = m2Message(PLACEHOLDER_C_ADDRESS, NETWORK_PASSPHRASE);
    const preimage = sep53Preimage(message);
    const sig = ed25519.sign(preimage, secretKey);

    await expect(
      deriveM2SecretSafely({
        kit: queueKit([sig, sig]),
        account: PLACEHOLDER_C_ADDRESS,
        walletAddress: otherGAddress, // wrong verification key
        networkPassphrase: NETWORK_PASSPHRASE,
      }),
    ).rejects.toThrow(WalletNotDeterministicError);
  });
});
