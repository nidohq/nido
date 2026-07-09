import { describe, it, expect } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { FIELD_ORDER } from './field.js';
import { m2Message, deriveSecretM1, deriveSecretM2 } from './derivation.js';

// Fixture account: contract id `[0x11; 32]`, matching the Rust-side
// `hash.rs` test fixture's `const ACCOUNT: [u8; 32] = [0x11; 32];` so the
// same underlying 32 bytes are reused across the SDK/contract test suites
// (not a cross-check vector -- there is no derivation vector in
// `vectors.json` -- just a shared, recognizable fixture).
const ACCOUNT_ID32 = new Uint8Array(32).fill(0x11);
const ACCOUNT = StrKey.encodeContract(ACCOUNT_ID32);
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

describe('m2Message', () => {
  it('produces the exact 5-line message, \\n-separated, no trailing newline', () => {
    const msg = m2Message(ACCOUNT, NETWORK_PASSPHRASE);
    const expected =
      'nido-recovery-v1\n' +
      `account: ${ACCOUNT}\n` +
      `network: ${NETWORK_PASSPHRASE}\n` +
      "purpose: derive this nido account's recovery secret\n" +
      'warning: only sign this inside the official nido enrollment or recovery flow';
    expect(msg).toBe(expected);
    expect(msg.endsWith('\n')).toBe(false);
    expect(msg.split('\n')).toHaveLength(5);
  });
});

describe('deriveSecretM1', () => {
  const MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const PASSPHRASE = 'nido-test-passphrase';

  it('is deterministic and returns a canonical Fr', async () => {
    const s1 = await deriveSecretM1(MNEMONIC, PASSPHRASE, ACCOUNT, NETWORK_PASSPHRASE);
    const s2 = await deriveSecretM1(MNEMONIC, PASSPHRASE, ACCOUNT, NETWORK_PASSPHRASE);
    expect(s1).toBe(s2);
    expect(typeof s1).toBe('bigint');
    expect(s1 >= 0n && s1 < FIELD_ORDER).toBe(true);
  });

  it('matches the pinned SDK-internal golden (computed once from this implementation)', async () => {
    const secret = await deriveSecretM1(MNEMONIC, PASSPHRASE, ACCOUNT, NETWORK_PASSPHRASE);
    // SDK-internal golden: not sourced from any external vector file (there
    // is no M1/M2 derivation vector in tests/vectors/zk-recovery/vectors.json)
    // -- pinned to lock in this implementation's HKDF/BIP-39 wiring and catch
    // any accidental drift.
    expect(secret).toBe(
      5500709943470394572937545310861981375241614510343695395661404136254653075785n,
    );
  });

  it('changes when the network passphrase changes (salt is bound in)', async () => {
    const s1 = await deriveSecretM1(MNEMONIC, PASSPHRASE, ACCOUNT, NETWORK_PASSPHRASE);
    const s2 = await deriveSecretM1(
      MNEMONIC,
      PASSPHRASE,
      ACCOUNT,
      'Public Global Stellar Network ; September 2015',
    );
    expect(s1).not.toBe(s2);
  });

  it('changes when the account changes (info is bound in)', async () => {
    const otherAccount = StrKey.encodeContract(new Uint8Array(32).fill(0x22));
    const s1 = await deriveSecretM1(MNEMONIC, PASSPHRASE, ACCOUNT, NETWORK_PASSPHRASE);
    const s2 = await deriveSecretM1(MNEMONIC, PASSPHRASE, otherAccount, NETWORK_PASSPHRASE);
    expect(s1).not.toBe(s2);
  });
});

describe('deriveSecretM2', () => {
  // Fixed synthetic 64-byte signature -- deriveSecretM2 does not verify the
  // signature (that's the caller's job, via SEP-53 verify against the
  // wallet's pubkey); it only consumes sig64 as HKDF IKM.
  const SIG64 = new Uint8Array(64);
  for (let i = 0; i < 64; i++) SIG64[i] = i;

  it('is deterministic and returns a canonical Fr', () => {
    const s1 = deriveSecretM2(SIG64, ACCOUNT, NETWORK_PASSPHRASE);
    const s2 = deriveSecretM2(SIG64, ACCOUNT, NETWORK_PASSPHRASE);
    expect(s1).toBe(s2);
    expect(typeof s1).toBe('bigint');
    expect(s1 >= 0n && s1 < FIELD_ORDER).toBe(true);
  });

  it('matches the pinned SDK-internal golden (computed once from this implementation)', () => {
    const secret = deriveSecretM2(SIG64, ACCOUNT, NETWORK_PASSPHRASE);
    expect(secret).toBe(
      1060604730369035108090893305867328341995618514356870828899378477147356926578n,
    );
  });

  it('differs from the M1 secret for the same account/network (distinct tag)', async () => {
    const m1 = await deriveSecretM1(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      'nido-test-passphrase',
      ACCOUNT,
      NETWORK_PASSPHRASE,
    );
    const m2 = deriveSecretM2(SIG64, ACCOUNT, NETWORK_PASSPHRASE);
    expect(m1).not.toBe(m2);
  });
});
