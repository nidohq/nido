/**
 * walletRecoverySign.ts — safety wrapper around the "M2 wallet" recovery
 * method's single wallet signature.
 *
 * BACKGROUND: `deriveSecretM2` (passkey-sdk's `zkRecovery/derivation.ts`)
 * folds a wallet's ed25519 `signMessage` output straight into the account's
 * recovery secret. That is only safe if the wallet's `signMessage` is
 * deterministic (RFC 8032 ed25519 signing IS deterministic in the math, but
 * not every wallet extension's `signMessage` implementation actually follows
 * it byte-for-byte — see `tests/spikes/wallet-determinism.md`/
 * `wallet-determinism-check.mjs`, which this module supersedes for the app's
 * OWN call sites). A wallet that quietly produces a different signature
 * every time would silently make the derived secret unreproducible — the
 * account would be enrolled against a recovery method that can never be
 * used again. This module is the app-side guard the header comments of
 * `tests/spikes/wallet-determinism-check.mjs` describe as "NOT yet
 * implemented" — it now is, and every call site should route through it
 * instead of calling `signMessage` + `deriveSecretM2` directly.
 *
 * `deriveM2SecretSafely` performs, in order:
 *   1. Builds the fixed `m2Message(account, networkPassphrase)`.
 *   2. Calls the wallet's `signMessage` TWICE for that exact message.
 *   3. Byte-compares the two signatures — throws `WalletNotDeterministicError`
 *      if they differ at all.
 *   4. Independently SEP-53-verifies EACH signature against the wallet's own
 *      G-address (ported from `tests/spikes/sep53-verify.mjs` — does not
 *      trust the wallet's internal verification, re-derives the math).
 *   5. Derives `deriveSecretM2` from BOTH signatures and asserts they land on
 *      the same `Fr` secret.
 * Any failure throws `WalletNotDeterministicError` with a message that tells
 * the caller to fall back to the seed-phrase (M1) method — callers should
 * surface `err.message` as-is (it already carries that hint) rather than
 * writing their own generic wallet-failure copy.
 */
import { StrKey } from '@stellar/stellar-sdk';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { m2Message, deriveSecretM2, type Fr } from '@nidohq/passkey-sdk';

/**
 * Thrown whenever a wallet fails ANY of the double-sign / SEP-53-verify /
 * re-derive checks below — the caller should treat this as "this wallet
 * cannot be used for the wallet-signature recovery method" and offer the
 * seed-phrase method instead (the default message already says so).
 */
export class WalletNotDeterministicError extends Error {
  constructor(
    message = "This wallet did not produce a repeatable signature — ZK wallet recovery needs a deterministic wallet. Use the seed-phrase method instead.",
  ) {
    super(message);
    this.name = 'WalletNotDeterministicError';
  }
}

/** Minimal shape of `StellarWalletsKit`'s (v2.2.0, static) `signMessage` this
 *  module needs — lets tests inject a fake without pulling in the real kit. */
export interface WalletSignMessageKit {
  signMessage(
    message: string,
    opts?: { networkPassphrase?: string; address?: string; path?: string },
  ): Promise<{ signedMessage: string; signerAddress?: string }>;
}

export interface DeriveM2SecretSafelyArgs {
  /** The Wallets Kit instance (or a fake satisfying `WalletSignMessageKit`)
   *  whose `signMessage` is called TWICE. Pass the real, already-connected
   *  `StellarWalletsKit` class from `@creit.tech/stellar-wallets-kit`. */
  kit: WalletSignMessageKit;
  /** The Nido smart-account `C...` address `m2Message` binds the signature
   *  to (the SAME account passed to `deriveSecretM2`). */
  account: string;
  /** The connected wallet's own signer `G...` address (e.g.
   *  `walletConnect.ts`'s `session.walletAddress`) — passed as `signMessage`'s
   *  `address` option AND used to independently SEP-53-verify each
   *  signature. Required: without it there is nothing to verify sig64
   *  against, and step 4 of the module doc comment could not run. */
  walletAddress: string;
  networkPassphrase: string;
  /** Optional progress callback (e.g. to update a status/error element) —
   *  called before each of the two signing prompts. */
  onStatus?: (status: string) => void;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const encoder = new TextEncoder();

/**
 * SEP-53 preimage for a signed message — byte-for-byte the same construction
 * as `tests/spikes/sep53-verify.mjs::sep53Preimage`:
 *   sha256(utf8("Stellar Signed Message:\n") || utf8(message))
 */
function sep53Preimage(message: string): Uint8Array {
  const prefix = encoder.encode('Stellar Signed Message:\n');
  const body = encoder.encode(message);
  const combined = new Uint8Array(prefix.length + body.length);
  combined.set(prefix, 0);
  combined.set(body, prefix.length);
  return sha256(combined);
}

/**
 * Verifies a wallet-produced ed25519 signature against the SEP-53 preimage
 * of `message`, using the signer's Stellar `G...` address. Ported from
 * `tests/spikes/sep53-verify.mjs::verifySep53` — does NOT trust the wallet's
 * own internal verification, re-derives and checks the math from scratch.
 */
function verifySep53(gAddress: string, message: string, sig64: Uint8Array): boolean {
  // `StrKey.decodeEd25519PublicKey` returns a Node `Buffer` (or the `buffer`
  // npm polyfill's equivalent in a browser build). `Buffer` DOES extend
  // `Uint8Array`, but under a jsdom test environment (two realms, two
  // `Uint8Array` constructors) `instanceof Uint8Array` can come back false --
  // which trips `@noble/curves`' strict `abytes` argument check. Re-wrapping
  // as a fresh, same-realm `Uint8Array` sidesteps that regardless of cause.
  const pubkey = new Uint8Array(StrKey.decodeEd25519PublicKey(gAddress));
  return ed25519.verify(sig64, sep53Preimage(message), pubkey);
}

/**
 * Safely derives the "M2 wallet" recovery secret: double-signs, byte-compares,
 * independently SEP-53-verifies both signatures, and re-derives the secret
 * from each — throwing `WalletNotDeterministicError` on any mismatch, rather
 * than ever handing back a secret this device can't reproduce next time.
 */
export async function deriveM2SecretSafely(args: DeriveM2SecretSafelyArgs): Promise<Fr> {
  const { kit, account, walletAddress, networkPassphrase, onStatus } = args;
  const message = m2Message(account, networkPassphrase);
  const signOpts = { address: walletAddress, networkPassphrase };

  onStatus?.('Sign the message in your wallet (1 of 2)…');
  const first = await kit.signMessage(message, signOpts);
  const sig1 = base64ToBytes(first.signedMessage);

  onStatus?.('Sign the same message again, to confirm your wallet repeats itself…');
  const second = await kit.signMessage(message, signOpts);
  const sig2 = base64ToBytes(second.signedMessage);

  if (!bytesEqual(sig1, sig2)) {
    throw new WalletNotDeterministicError();
  }

  if (!verifySep53(walletAddress, message, sig1) || !verifySep53(walletAddress, message, sig2)) {
    throw new WalletNotDeterministicError(
      "This wallet's signature didn't verify as a standard SEP-53 signature — ZK wallet " +
        'recovery needs a deterministic wallet. Use the seed-phrase method instead.',
    );
  }

  const secret1 = deriveSecretM2(sig1, account, networkPassphrase);
  const secret2 = deriveSecretM2(sig2, account, networkPassphrase);
  if (secret1 !== secret2) {
    throw new WalletNotDeterministicError();
  }

  return secret1;
}
