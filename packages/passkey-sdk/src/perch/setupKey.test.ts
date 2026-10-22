import { Buffer } from 'buffer';
import { Keypair, Networks, StrKey } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { setupBindingDigest, setupPublicKey, signSetupBinding } from './setupKey';

const FACTORY = StrKey.encodeContract(Buffer.alloc(32, 7));
const KEY = new Uint8Array(65).fill(4);
const SECRET = new Uint8Array(32).fill(1);

describe('setup key', () => {
  // The factory's own computation of the same message
  // (contracts/factory `the_binding_message_is_pinned`).
  it("signs the factory's binding message", () => {
    expect(setupBindingDigest(Networks.TESTNET, FACTORY, KEY).toString('hex')).toBe(
      '793c7c4bc48f6158c2edd30df3657752b6dc540fb7457e043cd5727d33c0e12c',
    );
  });

  // The factory accepts exactly this signature
  // (contracts/factory `the_wallets_setup_signature_creates_the_account`).
  it('signs with the key whose public half fixes the address', () => {
    const pk = setupPublicKey(SECRET);
    const sig = signSetupBinding(SECRET, Networks.TESTNET, FACTORY, KEY);
    expect(pk.toString('hex')).toBe('8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c');
    expect(sig.toString('hex')).toBe(
      '0e52483241d7fa56f55b04231fedc9794b2e014881b066471d112f02789deba3' +
        'f3f6e6c1a042e1ff8d5322c4c36c023e14668b3e22b1f9b9e85102d12cf64001',
    );
    const verifier = Keypair.fromPublicKey(StrKey.encodeEd25519PublicKey(pk));
    expect(verifier.verify(setupBindingDigest(Networks.TESTNET, FACTORY, KEY), sig)).toBe(true);
  });

  it('binds the passkey, the factory, and the network', () => {
    const digest = setupBindingDigest(Networks.TESTNET, FACTORY, KEY).toString('hex');
    const otherFactory = StrKey.encodeContract(Buffer.alloc(32, 8));
    expect(setupBindingDigest(Networks.TESTNET, FACTORY, new Uint8Array(65).fill(5)).toString('hex')).not.toBe(digest);
    expect(setupBindingDigest(Networks.TESTNET, otherFactory, KEY).toString('hex')).not.toBe(digest);
    expect(setupBindingDigest(Networks.PUBLIC, FACTORY, KEY).toString('hex')).not.toBe(digest);
  });
});
