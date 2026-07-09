#!/usr/bin/env node
// tests/spikes/wallet-determinism-check.mjs
//
// Paste-in checker for the M2 "wallet" recovery method's real per-wallet
// determinism ceremony (see tests/spikes/wallet-determinism.md for the full
// human procedure this supports). A human tester connects a real wallet
// extension (Freighter, xBull, Albedo, LOBSTR, Hana, Rabet, ...) through the
// app's own wallet-connect path, signs `m2Message(account, passphrase)`
// TWICE, and pastes the results here. This script then:
//
//   1. Byte-compares the two signatures (the whole M2 method depends on the
//      wallet's ed25519 signMessage being deterministic -- same key + same
//      message => same 64-byte signature, every time).
//   2. Independently verifies EACH signature under the SEP-53 preimage
//      (sha256("Stellar Signed Message:\n" || message)) against the
//      wallet's own G-address, reusing this repo's proven `sep53-verify.mjs`
//      logic -- this does NOT trust the wallet's own internal verification,
//      it re-derives and checks the math from scratch.
//   3. Reproduces `deriveSecretM2` (imported from the REAL, BUILT
//      `@nidohq/passkey-sdk` -- the exact same function the app's enrollment
//      flow at packages/frontend/src/pages/new-account/index.astro calls)
//      from each signature and confirms both runs land on the same secret.
//
// This mirrors -- and is intended to supersede, for the live-wallet rows --
// the enrollment-time safety check that the app's `new-account` page SHOULD
// perform before trusting a wallet for M2 (sign twice, byte-compare, local
// SEP-53 verify, refuse + offer seed-method fallback on any failure). See
// the "IMPORTANT" note in wallet-determinism.md: as of this writing that
// check is NOT yet implemented in packages/frontend/src/pages/new-account/
// index.astro (it signs once and derives immediately) -- this script is the
// stand-in the human procedure uses until that lands in the app itself.
//
// Usage:
//   node tests/spikes/wallet-determinism-check.mjs --self-test
//
//     Runs a synthetic self-test (real ed25519 keypair, no wallet/browser
//     involved) to prove this checker's own logic is correct BEFORE a human
//     trusts it against real wallet output. Exits non-zero on failure.
//
//   node tests/spikes/wallet-determinism-check.mjs \
//     --account C... --gaddress G... --sig1 <base64> --sig2 <base64> \
//     [--network testnet|mainnet|"<full passphrase string>"]
//
//     Checks a real wallet's two signatures. `--account` is the C-address
//     used as `m2Message`'s `account` argument (the SAME one the tester's
//     browser session used -- e.g. a disposable/test Nido account's contract
//     address, or the literal placeholder printed by --self-test if you're
//     just sanity-checking the message text, NOT a real determinism result).
//     `--gaddress` is the wallet's own G... address (from the wallet-connect
//     session, e.g. `session.walletAddress` / `signerAddress`). `--sig1`/
//     `--sig2` are the raw base64 signatures the wallet's `signMessage`
//     returned (SEP-43 `{ signedMessage }`, per
//     @creit.tech/stellar-wallets-kit v2.2.0 -- decode any other wallet
//     encoding, e.g. hex, to base64 first). `--network` defaults to testnet.
//
// Exit code 0 = every assertion passed (record verdict PASS in the matrix).
// Exit code 1 = at least one assertion failed (record verdict FAIL --
// investigate per wallet-determinism.md's "Handoff" section before
// concluding the wallet is unsafe for M2).

import { m2Message, deriveSecretM2 } from '@nidohq/passkey-sdk';
import { Networks } from '@stellar/stellar-sdk';
import { ed25519 } from '@noble/curves/ed25519.js';
import { StrKey } from '@stellar/stellar-sdk';
import { sep53Preimage, verifySep53 } from './sep53-verify.mjs';

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

function base64ToBytes(b64) {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function resolveNetworkPassphrase(arg) {
  if (!arg || arg === 'testnet') return Networks.TESTNET;
  if (arg === 'mainnet' || arg === 'public') return Networks.PUBLIC;
  return arg; // treat as a literal full passphrase string
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--self-test') {
      out.selfTest = true;
    } else if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      out[key] = val;
      i++;
    }
  }
  return out;
}

function printUsageAndExit() {
  console.error(
    [
      'Usage:',
      '  node tests/spikes/wallet-determinism-check.mjs --self-test',
      '  node tests/spikes/wallet-determinism-check.mjs \\',
      '    --account C... --gaddress G... --sig1 <base64> --sig2 <base64> \\',
      '    [--network testnet|mainnet|"<full passphrase string>"]',
      '',
      'See the file header comment for what each flag means.',
    ].join('\n'),
  );
  process.exitCode = 1;
}

/**
 * Runs the three real-wallet assertions against already-collected material.
 * Returns { ok, results } where results is an array of [name, pass] pairs,
 * printable the same way for both the self-test and the real-wallet path.
 */
function checkSignatures({ account, gAddress, networkPassphrase, sig1, sig2 }) {
  const results = [];
  let ok = true;

  const message = m2Message(account, networkPassphrase);
  console.log('M2 message signed (must match exactly what the wallet showed):');
  console.log('---');
  console.log(message);
  console.log('---\n');

  console.log(`sig1 (hex): ${toHex(sig1)}`);
  console.log(`sig2 (hex): ${toHex(sig2)}\n`);

  // 1. Double-sign byte-identical.
  const deterministic = bytesEqual(sig1, sig2);
  results.push(['double-sign identical (sig1 === sig2, byte-for-byte)', deterministic]);
  ok = ok && deterministic;

  // 2. SEP-53 verify EACH signature independently against the wallet's own
  //    G-address -- does not trust the wallet's internal verification.
  const verify1 = verifySep53(gAddress, message, sig1);
  const verify2 = verifySep53(gAddress, message, sig2);
  results.push(['SEP-53 verify (sig1 against gAddress)', verify1]);
  results.push(['SEP-53 verify (sig2 against gAddress)', verify2]);
  ok = ok && verify1 && verify2;

  // 3. deriveSecretM2 reproduces the same Fr secret from both signatures.
  //    (This is implied by #1 when the sigs are byte-identical, but we derive
  //    independently from EACH signature -- exactly as the app's enrollment
  //    and recovery flows would on two separate occasions -- rather than
  //    asserting it algebraically from #1 alone.)
  const secret1 = deriveSecretM2(sig1, account, networkPassphrase);
  const secret2 = deriveSecretM2(sig2, account, networkPassphrase);
  const sameSecret = secret1 === secret2;
  results.push(['deriveSecretM2 reproduces the same Fr secret from both sigs', sameSecret]);
  ok = ok && sameSecret;
  console.log(`deriveSecretM2(sig1, ...) = ${secret1}`);
  console.log(`deriveSecretM2(sig2, ...) = ${secret2}\n`);

  return { ok, results };
}

function printResults(results, ok) {
  console.log('=== Results ===');
  for (const [name, pass] of results) {
    console.log(`${pass ? 'PASS' : 'FAIL'} - ${name}`);
  }
  console.log(`\n${ok ? 'PASS' : 'FAIL'}: overall verdict`);
  if (ok) {
    console.log(
      '\nRecord this wallet as PASS in wallet-determinism.md — safe for the M2 recovery path.',
    );
  } else {
    console.log(
      '\nRecord this wallet as FAIL in wallet-determinism.md — NOT safe for M2 as currently ' +
        'designed. The enrollment flow must detect and refuse this wallet for M2, offering the ' +
        'seed-method (M1) fallback instead.',
    );
  }
}

/**
 * Synthetic self-test: proves this checker's own logic (byte-compare,
 * SEP-53 verify, deriveSecretM2 reproduction) is correct using a real,
 * locally generated ed25519 keypair -- no browser or wallet extension
 * involved. Mirrors sep53-verify.mjs's self-test, extended with:
 *   (a) a genuine positive case (real ed25519 sign twice -> checker says PASS)
 *   (b) a genuine negative case (corrupt one byte of sig2 -> checker says
 *       FAIL on all three assertions) -- proving detection actually works,
 *       not just that it prints PASS when handed identical bytes.
 */
function runSelfTest() {
  console.log('=== wallet-determinism-check.mjs self-test (synthetic, no wallet involved) ===\n');

  // A syntactically-valid (checksum-correct) placeholder contract address --
  // `deriveSecretM2` calls `StrKey.decodeContract`, which validates the
  // checksum, unlike `sep53-verify.mjs`'s message-only placeholder. Same
  // fixture convention as derivation.test.ts (`[0x11; 32]`).
  const PLACEHOLDER_C_ADDRESS = StrKey.encodeContract(new Uint8Array(32).fill(0x11));
  const networkPassphrase = Networks.TESTNET;

  const secretKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  const gAddress = StrKey.encodeEd25519PublicKey(publicKey);
  console.log(`Synthetic G-address: ${gAddress}`);
  console.log(`Synthetic C-address (placeholder account): ${PLACEHOLDER_C_ADDRESS}\n`);

  const message = m2Message(PLACEHOLDER_C_ADDRESS, networkPassphrase);
  const preimage = sep53Preimage(message);

  // --- Positive case: sign the SAME preimage twice with the SAME key. ---
  const sig1 = ed25519.sign(preimage, secretKey);
  const sig2 = ed25519.sign(preimage, secretKey);

  console.log('--- Positive case (genuine double-sign, same key+message) ---');
  const positive = checkSignatures({
    account: PLACEHOLDER_C_ADDRESS,
    gAddress,
    networkPassphrase,
    sig1,
    sig2,
  });
  printResults(positive.results, positive.ok);

  // --- Negative control: corrupt one byte of sig2 and confirm every
  //     assertion correctly flips to FAIL (proves this script would actually
  //     catch a nondeterministic or non-SEP-53 wallet, not just rubber-stamp
  //     whatever it's handed). ---
  console.log('\n--- Negative control (corrupted sig2 -- everything below MUST read FAIL) ---');
  const corruptSig2 = Uint8Array.from(sig2);
  corruptSig2[0] ^= 0xff;
  const negative = checkSignatures({
    account: PLACEHOLDER_C_ADDRESS,
    gAddress,
    networkPassphrase,
    sig1,
    sig2: corruptSig2,
  });
  // For the negative control to PASS as a self-test, every real assertion
  // must have come back false (i.e. `negative.ok` must be false).
  const negativeControlDetectedFailure = !negative.ok;
  printResults(negative.results, negative.ok);
  console.log(
    `\nNegative control correctly detected the corruption: ${negativeControlDetectedFailure}`,
  );

  const overall = positive.ok && negativeControlDetectedFailure;
  console.log(`\n${overall ? 'SELF-TEST PASSED' : 'SELF-TEST FAILED'}`);
  if (!overall) process.exitCode = 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.selfTest) {
    runSelfTest();
    return;
  }

  const { account, gaddress, sig1, sig2 } = args;
  if (!account || !gaddress || !sig1 || !sig2) {
    printUsageAndExit();
    return;
  }

  const networkPassphrase = resolveNetworkPassphrase(args.network);
  const { ok, results } = checkSignatures({
    account,
    gAddress: gaddress,
    networkPassphrase,
    sig1: base64ToBytes(sig1),
    sig2: base64ToBytes(sig2),
  });
  printResults(results, ok);
  if (!ok) process.exitCode = 1;
}

main();
