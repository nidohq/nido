#!/usr/bin/env node
// Stage 3 recovery-controller ZK evidence proof generator
// (`contracts/recovery-controller`, `circuits/zk_recovery_doc`).
//
// EXPERIMENTAL: shells out to the pinned `nargo`/`bb` toolchain (same
// invocations as `circuits/zk_recovery/scripts/gen_artifacts.sh`), appropriate
// for a Node-based CLI/experimental flow, NOT a production mobile/browser
// wallet proof-generation path — see `contracts/recovery-controller/src/
// lib.rs`'s "Known limits" for why in-browser proof generation (@aztec/bb.js
// + noir_js) is out of scope here. This script exists so `submit_zk_proof`/
// `submit_zk_cancel` (`@nidohq/passkey-sdk`'s `recoveryStage3/evidence.ts`)
// have something real to submit against a live testnet controller, without
// taking on a full in-browser prover integration.
//
// What it does:
//   1. Reads a witness JSON (see --help) with the circuit's PRIVATE inputs
//      (secret, Merkle path) plus the public commitment fields
//      (account, controller, network passphrase, target_doc_hash,
//      cfg_version, baseline, attempt_id, timelock_secs, action).
//   2. Computes `root`/`nullifier`/`auth_hash` client-side via
//      `@nidohq/passkey-sdk`'s `recoveryStage3` module (the SAME
//      `computeDocAuthHash` this repo's `docAuthHash.test.ts` proves matches
//      `contracts/recovery-controller/src/zk.rs`'s on-chain recompute
//      byte-for-byte) — never hand-rolled here, so this script cannot drift
//      from the parity-gated implementation.
//   3. Copies `circuits/zk_recovery_doc` (Nargo.toml + src/) into an ISOLATED
//      temp working directory and writes a `Prover.toml` there — this NEVER
//      writes into the real `circuits/` tree (explicitly out of scope to
//      touch for this task).
//   4. Runs `nargo execute` (solves the witness) then `bb prove
//      --verifier_target evm-no-zk` (produces a real UltraHonk proof) in that
//      temp directory, reusing the checked-in ACIR the copy carries — no
//      `nargo compile`/`bb write_vk` needed, since the circuit and its VK are
//      already built and unchanged.
//   5. Writes `proof` / `public_inputs` (raw bytes) plus a `result.json`
//      summary (hex `root`/`nullifier`/`authHash`/`proof`, ready to pass
//      straight into `buildSubmitZkProof`/`buildSubmitZkCancel`) to --out.
//
// Prerequisites:
//   - `npm install && npm run build -w @nidohq/passkey-sdk` (this script
//     imports the BUILT `@nidohq/passkey-sdk` package, not its TS sources).
//   - The pinned `nargo`/`bb` toolchain on PATH (see REQUIRED_NARGO_VERSION/
//     REQUIRED_BB_VERSION below) — install via the same `bbup`/`noirup` flow
//     `circuits/zk_recovery/scripts/gen_artifacts.sh`'s header documents.
//     Unlike that script, this one does NOT fall back to Docker for bb —
//     if your local bb can't run natively (e.g. glibc < 2.38), run this
//     script inside the same Ubuntu 24.04 container
//     `circuits/zk_recovery/scripts/Dockerfile` builds.
//
// Usage:
//   node scripts/generate-recovery-proof.mjs --witness path/to/witness.json --out path/to/out-dir
//
// witness.json shape:
//   {
//     "account": "CA...",              // recovering smart account (C-address)
//     "controller": "CB...",           // deployed nido-recovery-controller (C-address)
//     "networkPassphrase": "Test SDF Network ; September 2015",
//     "action": "LostKey" | "Compromise" | "Cancel",
//     "targetDocHash": "0x...(32 bytes)",
//     "cfgVersion": 1,
//     "baseline": "0x...(32 bytes)",   // config.baseline_doc_hash for Compromise,
//                                      // or the LostKey source-snapshot hash
//     "attemptId": 1,
//     "timelockSecs": 1209600,
//     "secret": "0x...",               // the enrollment secret (Fr, from M1/M2 derivation
//                                      // or a fresh @nidohq/passkey-sdk-generated secret)
//     "leafIndex": 0,                  // this account's leaf index in the zk-recovery pool
//     "pathSiblings": ["0x...", ... 24 entries]  // this leaf's Merkle path,
//       // obtained via @nidohq/passkey-sdk's poolSync.ts (locateLeaf), the
//       // SAME helper the M1 frontend flow uses to sync the pool -- this
//       // script does not fetch chain state itself.
//   }
//
// For a `Cancel` evidence proof (`submit_zk_cancel`), pass the SAME
// targetDocHash/cfgVersion/baseline/attemptId/timelockSecs as the attempt's
// ORIGINAL initiation commitment, with `"action": "Cancel"` -- this mirrors
// `contract.rs::submit_zk_cancel`'s `cancel_commitment` construction
// (`ProposalCommitment { action: Cancel, ..attempt.commitment }`).

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { StrKey } from '@stellar/stellar-sdk';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  wrapLeafInner,
  wrapLeafStored,
  computeNullifier,
  computeRoot,
  fieldToBytes32,
  bytesToFieldCanonical,
  computeDocAuthHash,
  ACTION_LOST_KEY,
  ACTION_COMPROMISE,
  ACTION_CANCEL,
  buf2hex,
} from '@nidohq/passkey-sdk';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_CIRCUIT_DIR = join(REPO_ROOT, 'circuits', 'zk_recovery_doc');
const CIRCUIT_NAME = 'zk_recovery_doc';

// Same pins as circuits/zk_recovery/scripts/gen_artifacts.sh (the VK/proof
// wire format bb produces can change across builds even for byte-identical
// ACIR -- see that script's comment on --verifier_target/--oracle_hash).
const REQUIRED_NARGO_VERSION = '1.0.0-beta.18';
const REQUIRED_BB_VERSION = '3.0.0-nightly.20260102';

const ACTION_CODES = { LostKey: ACTION_LOST_KEY, Compromise: ACTION_COMPROMISE, Cancel: ACTION_CANCEL };

function fail(message) {
  console.error(`generate-recovery-proof: ${message}`);
  process.exit(1);
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function hexToBytes(hex, expectedLen, label) {
  const s = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (expectedLen !== undefined && s.length !== expectedLen * 2) {
    fail(`${label}: expected ${expectedLen} bytes (${expectedLen * 2} hex digits), got ${s.length} digits`);
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Formats a canonical field element as a `0x`-prefixed 32-byte hex string,
 *  matching `circuits/zk_recovery_doc/Prover.toml`'s convention exactly. */
function frToml(x) {
  return `0x${buf2hex(fieldToBytes32(x))}`;
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 62).join('\n'));
    return;
  }

  const witnessPath = arg('witness');
  if (!witnessPath) fail('--witness <path-to-witness.json> is required (see --help)');
  const outDir = resolve(arg('out', join(REPO_ROOT, 'target', 'recovery-proof-out')));
  const circuitDir = resolve(arg('circuit-dir', DEFAULT_CIRCUIT_DIR));

  const w = JSON.parse(readFileSync(witnessPath, 'utf8'));
  for (const field of [
    'account', 'controller', 'networkPassphrase', 'action', 'targetDocHash',
    'cfgVersion', 'baseline', 'attemptId', 'timelockSecs', 'secret', 'leafIndex', 'pathSiblings',
  ]) {
    if (w[field] === undefined) fail(`witness JSON missing required field "${field}"`);
  }
  const actionCode = ACTION_CODES[w.action];
  if (!actionCode) fail(`witness.action must be one of ${Object.keys(ACTION_CODES).join(', ')}, got "${w.action}"`);
  if (!Array.isArray(w.pathSiblings) || w.pathSiblings.length !== 24) {
    fail(`witness.pathSiblings must be an array of exactly 24 hex field elements, got ${w.pathSiblings?.length}`);
  }

  // --- 1. Compute the witness's public/derived values client-side ---------
  const accountId32 = StrKey.decodeContract(w.account);
  const controllerId32 = StrKey.decodeContract(w.controller);
  const secret = bytesToFieldCanonical(hexToBytes(w.secret, 32, 'secret'));
  const [acctHi, acctLo] = split32(accountId32);

  const inner = wrapLeafInner(secret);
  const stored = wrapLeafStored(accountId32, inner);
  const siblings = w.pathSiblings.map((h, i) => bytesToFieldCanonical(hexToBytes(h, 32, `pathSiblings[${i}]`)));
  const root = computeRoot(stored, w.leafIndex, siblings);
  const nullifier = computeNullifier(accountId32, secret);

  const targetDocHash32 = hexToBytes(w.targetDocHash, 32, 'targetDocHash');
  const baseline32 = hexToBytes(w.baseline, 32, 'baseline');
  const authHash = computeDocAuthHash({
    action: actionCode,
    accountId32,
    networkPassphrase: w.networkPassphrase,
    controllerId32,
    targetDocHash32,
    configVersion: w.cfgVersion,
    baselineOrSourceId32: baseline32,
    attemptId: BigInt(w.attemptId),
    timelockSecs: w.timelockSecs,
  });

  const bits = [];
  for (let level = 0; level < 24; level++) bits.push((w.leafIndex >> level) & 1);

  // --- 2. Write Prover.toml into an ISOLATED temp copy of the circuit -----
  if (!existsSync(circuitDir)) fail(`circuit directory not found: ${circuitDir}`);
  const workDir = mkdtempSync(join(tmpdir(), 'nido-recovery-proof-'));
  cpSync(circuitDir, workDir, { recursive: true, filter: (src) => !src.includes(`${circuitDir}/target`) });
  mkdirSync(join(workDir, 'target'), { recursive: true });

  const proverToml = [
    '# GENERATED by scripts/generate-recovery-proof.mjs -- a throwaway temp',
    '# copy, never written back into circuits/zk_recovery_doc/.',
    `root = "${frToml(root)}"`,
    `nullifier = "${frToml(nullifier)}"`,
    `auth_hash = "${frToml(authHash)}"`,
    '',
    `secret = "${frToml(secret)}"`,
    `acct_hi = "${frToml(acctHi)}"`,
    `acct_lo = "${frToml(acctLo)}"`,
    '',
    `path_bits = [${bits.map((b) => `"${frToml(BigInt(b))}"`).join(', ')}]`,
    '',
    `path_siblings = [${siblings.map((s) => `"${frToml(s)}"`).join(', ')}]`,
    '',
    `action = "${frToml(BigInt(actionCode))}"`,
    `npass_hi = "${frToml(splitNetworkPassphrase(w.networkPassphrase)[0])}"`,
    `npass_lo = "${frToml(splitNetworkPassphrase(w.networkPassphrase)[1])}"`,
    `ctrl_hi = "${frToml(split32(controllerId32)[0])}"`,
    `ctrl_lo = "${frToml(split32(controllerId32)[1])}"`,
    `doc_hash_hi = "${frToml(split32(targetDocHash32)[0])}"`,
    `doc_hash_lo = "${frToml(split32(targetDocHash32)[1])}"`,
    `cfg_version = "${frToml(BigInt(w.cfgVersion))}"`,
    `baseline_hi = "${frToml(split32(baseline32)[0])}"`,
    `baseline_lo = "${frToml(split32(baseline32)[1])}"`,
    `nonce = "${frToml(BigInt(w.attemptId))}"`,
    `timelock_secs = "${frToml(BigInt(w.timelockSecs))}"`,
    '',
  ].join('\n');
  writeFileSync(join(workDir, 'Prover.toml'), proverToml);
  console.error(`[i] witness computed, working in ${workDir}`);

  // --- 3. nargo execute + bb prove -----------------------------------------
  const nargoBin = process.env.NARGO || 'nargo';
  const bbBin = process.env.BB || 'bb';
  const nargoVersion = tryVersion(nargoBin);
  if (!nargoVersion.includes(REQUIRED_NARGO_VERSION)) {
    fail(`expected nargo ${REQUIRED_NARGO_VERSION}, got "${nargoVersion || '(not found)'}" -- set NARGO=/path/to/nargo`);
  }
  console.error(`[1/4] nargo compile (${nargoVersion.split('\n')[0]})`);
  execFileSync(nargoBin, ['compile'], { cwd: workDir, stdio: 'inherit' });

  console.error('[2/4] nargo execute (solve witness from the generated Prover.toml)');
  execFileSync(nargoBin, ['execute'], { cwd: workDir, stdio: 'inherit' });

  const acir = join(workDir, 'target', `${CIRCUIT_NAME}.json`);
  const wit = join(workDir, 'target', `${CIRCUIT_NAME}.gz`);
  if (!existsSync(acir)) fail(`nargo execute did not produce ${acir}`);
  if (!existsSync(wit)) fail(`nargo execute did not produce ${wit}`);

  const bbVersion = tryVersion(bbBin);
  if (!bbVersion.includes(REQUIRED_BB_VERSION)) {
    fail(
      `expected bb ${REQUIRED_BB_VERSION}, got "${bbVersion || '(not found / does not run natively)'}" -- ` +
        'see this script\'s header comment for the Docker fallback.',
    );
  }
  // `bb prove` reads a verification key even though it doesn't take one as
  // an explicit required flag (defaults to `./target/vk`, resolved against
  // its OWN cwd) -- write it first, exactly like
  // circuits/zk_recovery/scripts/gen_artifacts.sh's step 3 does, and run
  // both bb invocations with cwd=workDir so every relative path resolves
  // inside the isolated temp copy, never against this script's own cwd.
  console.error(`[3/4] bb write_vk --verifier_target evm-no-zk (${bbVersion.split('\n')[0]})`);
  execFileSync(
    bbBin,
    ['write_vk', '--verifier_target', 'evm-no-zk', '--bytecode_path', acir, '--output_path', join(workDir, 'target')],
    { cwd: workDir, stdio: 'inherit' },
  );

  console.error('[4/4] bb prove --verifier_target evm-no-zk');
  execFileSync(
    bbBin,
    ['prove', '--verifier_target', 'evm-no-zk', '--bytecode_path', acir, '--witness_path', wit, '--output_path', join(workDir, 'target')],
    { cwd: workDir, stdio: 'inherit' },
  );

  let proofPath = join(workDir, 'target', 'proof');
  let publicInputsPath = join(workDir, 'target', 'public_inputs');
  // bb sometimes writes a directory instead of a flat file -- flatten, same
  // as gen_artifacts.sh does.
  for (const p of [proofPath, publicInputsPath]) {
    const inner = join(p, p.endsWith('proof') ? 'proof' : 'public_inputs');
    if (!existsSync(p) && existsSync(inner)) {
      cpSync(inner, p);
    }
  }
  if (!existsSync(proofPath) || !existsSync(publicInputsPath)) {
    fail(`bb prove did not produce proof/public_inputs under ${join(workDir, 'target')}`);
  }

  const proofBytes = readFileSync(proofPath);
  const publicInputsBytes = readFileSync(publicInputsPath);
  const expectedPublicInputs = Buffer.concat([
    Buffer.from(fieldToBytes32(root)),
    Buffer.from(fieldToBytes32(nullifier)),
    Buffer.from(fieldToBytes32(authHash)),
  ]);
  if (!publicInputsBytes.equals(expectedPublicInputs)) {
    fail('bb-produced public_inputs does not equal our own root||nullifier||auth_hash -- refusing to hand back a mismatched proof');
  }

  // --- 4. Stage outputs -----------------------------------------------------
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'proof'), proofBytes);
  writeFileSync(join(outDir, 'public_inputs'), publicInputsBytes);
  const result = {
    account: w.account,
    controller: w.controller,
    action: w.action,
    attemptId: w.attemptId,
    root: `0x${buf2hex(fieldToBytes32(root))}`,
    nullifier: `0x${buf2hex(fieldToBytes32(nullifier))}`,
    authHash: `0x${buf2hex(fieldToBytes32(authHash))}`,
    proof: `0x${buf2hex(proofBytes)}`,
  };
  writeFileSync(join(outDir, 'result.json'), JSON.stringify(result, null, 2));
  console.error(`[ok] wrote ${join(outDir, 'proof')}, public_inputs, result.json`);
  console.log(JSON.stringify(result, null, 2));
}

function tryVersion(bin) {
  try {
    return execFileSync(bin, ['--version'], { encoding: 'utf8' });
  } catch {
    return '';
  }
}

/** BE 16/16 split of a raw 32-byte value into two zero-extended 32-byte
 *  field elements (`split_addr`/`split16` in `zk.rs`) — used for
 *  `acct_hi/lo`, `ctrl_hi/lo`, `doc_hash_hi/lo`, `baseline_hi/lo`. */
function split32(bytes32) {
  const hi = new Uint8Array(32);
  hi.set(bytes32.subarray(0, 16), 16);
  const lo = new Uint8Array(32);
  lo.set(bytes32.subarray(16, 32), 16);
  return [bytesToFieldCanonical(hi), bytesToFieldCanonical(lo)];
}

function splitNetworkPassphrase(passphrase) {
  // sha256(passphrase) split the same way as every other 32-byte field --
  // mirrors zk.rs::compute_doc_auth_hash's npass_hi/lo derivation.
  const hash = sha256(new TextEncoder().encode(passphrase));
  return split32(hash);
}

main();
