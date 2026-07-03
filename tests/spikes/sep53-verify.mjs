#!/usr/bin/env node
// tests/spikes/sep53-verify.mjs
//
// M0 de-risk spike for the "M2 wallet" recovery method.
//
// Proves the SEP-53 signature -> secret derivation math is correct and
// deterministic using a synthetic ed25519 keypair (no browser wallet
// involved). Real wallets must additionally be checked by hand -- see
// tests/spikes/wallet-determinism.md.
//
// SEP-53 preimage: sha256(utf8("Stellar Signed Message:\n") || utf8(message))
// The wallet signs this 32-byte hash with ed25519 (RFC 8032), which is a
// deterministic signature scheme: same key + same message => same 64-byte
// signature, every time. That determinism is what lets the "M2 wallet"
// recovery method treat the signature as (part of) a reproducible secret.
//
// Libraries used (both already present in the repo's lockfile / dependency
// tree -- no new packages were added):
//   - @noble/curves/ed25519.js  (ed25519 sign/verify + keygen)
//   - @noble/hashes/sha2.js     (sha256)
//   - @stellar/stellar-sdk      (StrKey ed25519 G-address encode/decode)
//
// NOTE on import paths: this repo has @noble/curves@2.2.0 and
// @noble/hashes@2.2.0 installed. In these major versions the subpath
// exports require an explicit ".js" extension and sha256 lives under
// "sha2.js" (not "sha256.js"), e.g.:
//   import { ed25519 } from '@noble/curves/ed25519.js';
//   import { sha256 } from '@noble/hashes/sha2.js';
// The extension-less forms shown in some older examples 404 against this
// version's package.json "exports" map.

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { StrKey } from '@stellar/stellar-sdk';

const encoder = new TextEncoder();

/**
 * SEP-53 preimage for a signed message:
 *   sha256(utf8("Stellar Signed Message:\n") || utf8(message))
 * @param {string} msg
 * @returns {Uint8Array} 32-byte sha256 digest
 */
export function sep53Preimage(msg) {
  const prefix = encoder.encode('Stellar Signed Message:\n');
  const body = encoder.encode(msg);
  const combined = new Uint8Array(prefix.length + body.length);
  combined.set(prefix, 0);
  combined.set(body, prefix.length);
  return sha256(combined);
}

/**
 * Verify a wallet-produced ed25519 signature against the SEP-53 preimage
 * of `msg`, using the signer's Stellar G-address (or a raw 32-byte
 * public key, for callers that already have it decoded).
 *
 * @param {string | Uint8Array} gAddressOrPubkey G... address, or raw 32-byte ed25519 public key
 * @param {string} msg the exact message that was signed (pre-SEP-53-wrapping)
 * @param {Uint8Array} sig64 the 64-byte ed25519 signature returned by the wallet
 * @returns {boolean}
 */
export function verifySep53(gAddressOrPubkey, msg, sig64) {
  const pubkey =
    typeof gAddressOrPubkey === 'string'
      ? StrKey.decodeEd25519PublicKey(gAddressOrPubkey)
      : gAddressOrPubkey;
  return ed25519.verify(sig64, sep53Preimage(msg), pubkey);
}

// ---------------------------------------------------------------------------
// The fixed M2 message format (design spec §2.1), verbatim, UTF-8, \n = 0x0A,
// no trailing newline. For this synthetic self-test we use a placeholder
// C-address and the testnet passphrase.
// ---------------------------------------------------------------------------
function buildM2Message({ cAddress, networkPassphrase }) {
  return [
    'nido-recovery-v1',
    `account: ${cAddress}`,
    `network: ${networkPassphrase}`,
    'purpose: derive this nido account\'s recovery secret',
    'warning: only sign this inside the official nido enrollment or recovery flow',
  ].join('\n');
}

const PLACEHOLDER_C_ADDRESS =
  'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF5AY';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function toHex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

function runSelfTest() {
  const results = [];
  let ok = true;

  const message = buildM2Message({
    cAddress: PLACEHOLDER_C_ADDRESS,
    networkPassphrase: TESTNET_PASSPHRASE,
  });

  console.log('=== SEP-53 synthetic self-test (M2 wallet recovery de-risk) ===\n');
  console.log('Fixed message:');
  console.log('---');
  console.log(message);
  console.log('---\n');

  const preimage = sep53Preimage(message);
  console.log(`SEP-53 preimage (sha256, hex): ${toHex(preimage)}\n`);

  // 1. Generate a synthetic ed25519 keypair.
  const secretKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  const gAddress = StrKey.encodeEd25519PublicKey(publicKey);
  console.log(`Synthetic G-address: ${gAddress}`);

  // 2. Sign the preimage twice with the same key + message.
  const sig1 = ed25519.sign(preimage, secretKey);
  const sig2 = ed25519.sign(preimage, secretKey);

  const deterministic = bytesEqual(sig1, sig2);
  results.push(['determinism (sign twice, same bytes)', deterministic]);
  ok = ok && deterministic;
  console.log(`\nsig1: ${toHex(sig1)}`);
  console.log(`sig2: ${toHex(sig2)}`);
  console.log(`determinism (sig1 === sig2): ${deterministic}`);

  // 3. Verify the signature against the raw public key under the same preimage.
  const verifiedRaw = ed25519.verify(sig1, preimage, publicKey);
  results.push(['verify (raw pubkey, direct preimage)', verifiedRaw]);
  ok = ok && verifiedRaw;
  console.log(`verify (raw pubkey, direct preimage call): ${verifiedRaw}`);

  // 4. Verify via the exported verifySep53() helper, from the raw pubkey.
  const verifiedHelperRaw = verifySep53(publicKey, message, sig1);
  results.push(['verify (verifySep53 helper, raw pubkey)', verifiedHelperRaw]);
  ok = ok && verifiedHelperRaw;
  console.log(`verify (verifySep53 helper, raw pubkey): ${verifiedHelperRaw}`);

  // 5. Verify via the exported verifySep53() helper, from the G-address
  //    (StrKey decode -> raw pubkey -> ed25519.verify). This is the code
  //    path real callers will use, since wallets return a G-address, not
  //    a raw public key.
  const verifiedHelperG = verifySep53(gAddress, message, sig1);
  results.push(['verify (verifySep53 helper, G-address)', verifiedHelperG]);
  ok = ok && verifiedHelperG;
  console.log(`verify (verifySep53 helper, G-address): ${verifiedHelperG}`);

  // 6. Negative control: a signature over a *different* message must NOT verify.
  const otherMessage = buildM2Message({
    cAddress: PLACEHOLDER_C_ADDRESS,
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
  });
  const negativeVerify = verifySep53(gAddress, otherMessage, sig1);
  const negativeControlPassed = negativeVerify === false;
  results.push(['negative control (wrong message must fail verify)', negativeControlPassed]);
  ok = ok && negativeControlPassed;
  console.log(`negative control (different message verifies as false): ${negativeControlPassed}`);

  console.log('\n=== Results ===');
  for (const [name, pass] of results) {
    console.log(`${pass ? 'PASS' : 'FAIL'} - ${name}`);
  }

  console.log(`\n${ok ? 'PASS' : 'FAIL'}: overall determinism=${deterministic} verify=${verifiedHelperG}`);

  if (!ok) {
    console.error('\nSELF-TEST FAILED');
    process.exitCode = 1;
  } else {
    console.log('\nSELF-TEST PASSED');
  }
}

// Only run the self-test when this file is executed directly (not imported).
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runSelfTest();
}
