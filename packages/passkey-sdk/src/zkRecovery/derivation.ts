//! Client-side recovery-secret derivation for the "M1" (BIP-39 mnemonic) and
//! "M2" (SEP-53 wallet-signature) recovery methods. Nothing derived here is
//! ever persisted -- the caller re-derives the secret each time it's needed
//! (enrollment, initiate/complete recovery) and discards it afterward.
//!
//! Both methods funnel into the same HKDF-SHA256 construction
//! (`hkdfSecret`), differing only in the tag (`'m1'` | `'m2'`) mixed into
//! `info` and in what key material (`ikm`) feeds the KDF:
//!   - M1: `ikm = BIP-39 seed(mnemonic, passphrase)` (PBKDF2, via
//!     `@scure/bip39`'s `mnemonicToSeedSync`).
//!   - M2: `ikm = sig64`, the wallet's ed25519 signature (SEP-53, RFC 8032
//!     deterministic) over `m2Message(account, networkPassphrase)`. The
//!     signature itself is produced by the wallet (e.g. via kit
//!     `signMessage`) and is *not* verified here -- verifying that `sig64`
//!     actually came from the account's signer is the caller's job (see
//!     `tests/spikes/sep53-verify.mjs` for the SEP-53 preimage/verify
//!     logic this module's message format must stay byte-compatible with).
//!
//! HKDF params (byte-exact, per the M3 plan's Global Constraints):
//!   - `salt = UTF8(networkPassphrase)`
//!   - `info = UTF8("nido-recovery-v1:" + tag) || 0x00 || contractIdBytes(account)`
//!   - `L = 48`, then `reduce384(okm)` folds the 48-byte OKM into a
//!     canonical BN254 scalar-field element.
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { mnemonicToSeedSync } from '@scure/bip39';
import { StrKey } from '@stellar/stellar-sdk';
import { reduce384, type Fr } from './field.js';

const encoder = new TextEncoder();

/**
 * Decodes a `C...` contract-address StrKey into its raw 32-byte contract
 * id. Never feed the StrKey string itself into field math -- only these
 * raw bytes (mirrors the contract's `contractIdBytes`/`split16` inputs).
 */
function contractIdBytes(account: string): Uint8Array {
  return StrKey.decodeContract(account);
}

/**
 * The exact message a wallet signs (via SEP-53 `signMessage`) to derive the
 * "M2" recovery secret. Byte-exact per the M3 plan's Global Constraints:
 * 5 lines, `\n`-separated, UTF-8, NO trailing newline. Any change here is a
 * breaking change to every M2-enrolled account's recoverability.
 */
export function m2Message(account: string, networkPassphrase: string): string {
  return [
    'nido-recovery-v1',
    `account: ${account}`,
    `network: ${networkPassphrase}`,
    "purpose: derive this nido account's recovery secret",
    'warning: only sign this inside the official nido enrollment or recovery flow',
  ].join('\n');
}

/**
 * HKDF-SHA256(ikm, salt=UTF8(networkPassphrase),
 * info=UTF8("nido-recovery-v1:"+tag) || 0x00 || accountId32, L=48), folded
 * into a canonical `Fr` via `reduce384`. Shared by both M1 and M2 -- the
 * only difference between the two methods is `ikm` and `tag`.
 */
function hkdfSecret(
  ikm: Uint8Array,
  methodTag: 'm1' | 'm2',
  accountId32: Uint8Array,
  networkPassphrase: string,
): Fr {
  const salt = encoder.encode(networkPassphrase);
  const tagBytes = encoder.encode(`nido-recovery-v1:${methodTag}`);
  const info = new Uint8Array(tagBytes.length + 1 + accountId32.length);
  info.set(tagBytes, 0);
  info[tagBytes.length] = 0x00;
  info.set(accountId32, tagBytes.length + 1);
  const okm = hkdf(sha256, ikm, salt, info, 48);
  return reduce384(okm);
}

/**
 * Derives the "M1" (BIP-39 mnemonic) recovery secret. `seed64 = BIP-39
 * PBKDF2(mnemonic, passphrase)` (`@scure/bip39`'s `mnemonicToSeedSync`)
 * feeds `hkdfSecret` as `ikm`, tagged `'m1'`.
 */
export async function deriveSecretM1(
  mnemonic: string,
  passphrase: string,
  account: string,
  networkPassphrase: string,
): Promise<Fr> {
  const seed64 = mnemonicToSeedSync(mnemonic, passphrase);
  const accountId32 = contractIdBytes(account);
  return hkdfSecret(seed64, 'm1', accountId32, networkPassphrase);
}

/**
 * Derives the "M2" (SEP-53 wallet-signature) recovery secret from a
 * wallet-produced `sig64` (the ed25519 signature over the SEP-53 preimage
 * of `m2Message(account, networkPassphrase)`). Does not sign or verify --
 * callers must obtain `sig64` from the wallet and verify it against the
 * account's signer before trusting the derived secret.
 */
export function deriveSecretM2(sig64: Uint8Array, account: string, networkPassphrase: string): Fr {
  const accountId32 = contractIdBytes(account);
  return hkdfSecret(sig64, 'm2', accountId32, networkPassphrase);
}
