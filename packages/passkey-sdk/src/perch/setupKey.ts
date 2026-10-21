/**
 * The one-time setup key that fixes a new account's address and binds its
 * passkey there (Nido's factory, `contracts/factory`).
 *
 * The browser makes 32 random bytes, the setup secret, and uses them as an
 * Ed25519 seed. The setup PUBLIC key is all the factory and the relayer see:
 * `get_c_address(setup_pk)` is the account's address, known before any
 * passkey exists, and `create_account(setup_pk, key, setup_sig)` deploys
 * there only if `setup_sig` is the setup key's signature over
 * {@link setupBindingDigest} for that passkey `key`. Whoever sees `setup_pk`
 * (the relayer, a mempool watcher, the factory's manager) can't put another
 * passkey at the address; only the holder of the secret can, so the wallet
 * signs once the passkey exists and then forgets the secret.
 */

import { Buffer } from 'buffer';
import { hash, Keypair, StrKey } from '@stellar/stellar-sdk';

const BIND_DOMAIN = 'nido/bind/v1';

function setupKeypair(secret: Uint8Array): Keypair {
  if (secret.length !== 32) throw new Error('A setup secret is 32 bytes');
  return Keypair.fromRawEd25519Seed(Buffer.from(secret));
}

/** The setup public key for `secret`: `get_c_address`'s argument. */
export function setupPublicKey(secret: Uint8Array): Buffer {
  return setupKeypair(secret).rawPublicKey();
}

/**
 * What the setup key signs for passkey `key` at `factory` on the network
 * `networkPassphrase` names:
 * `sha256("nido/bind/v1" || network_id || factory_id || key)`.
 */
export function setupBindingDigest(networkPassphrase: string, factory: string, key: Uint8Array): Buffer {
  if (key.length !== 65) throw new Error('A passkey public key is 65 bytes');
  return hash(
    Buffer.concat([
      Buffer.from(BIND_DOMAIN),
      hash(Buffer.from(networkPassphrase)),
      StrKey.decodeContract(factory),
      Buffer.from(key),
    ]),
  );
}

/** `create_account`'s `setup_sig`: the setup key's signature binding passkey
 *  `key` at `factory`. */
export function signSetupBinding(
  secret: Uint8Array,
  networkPassphrase: string,
  factory: string,
  key: Uint8Array,
): Buffer {
  return setupKeypair(secret).sign(setupBindingDigest(networkPassphrase, factory, key));
}
