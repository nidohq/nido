import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { runWasi, ALLOWED_IMPORTS, LIMITS } from '../src/wasi-runner.mjs';
import { createSigningBoundary } from '../src/signing-boundary.mjs';
import { NETWORK, feeBump, unrelatedPayment, rawSignFee, verifiesFeeSignature } from '../src/stellar.mjs';
import { runtimeFixture } from './wasi-fixture.mjs';
const binary = readFileSync(new URL('../public/runtime/wallet-checker.wasm', import.meta.url));
const evaluate = input => runWasi(binary, input);
const check = input => evaluate(JSON.stringify(input));

test('real WASI module imports only approved Preview 1 functions; no signing/storage/network hostcall', async () => {
  const imports = WebAssembly.Module.imports(await WebAssembly.compile(binary));
  assert.ok(imports.length > 0);
  for (const i of imports) { assert.equal(i.module, 'wasi_snapshot_preview1'); assert.ok(ALLOWED_IMPORTS.includes(i.name)); }
});
test('runtime manifest binds binary and source; the compiled memory cannot grow beyond 64 MiB', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/runtime/manifest.json', import.meta.url)));
  assert.equal(createHash('sha256').update(binary).digest('hex'), manifest.sha256);
  for (const [path, expected] of Object.entries(manifest.sourceSha256))
    assert.equal(createHash('sha256').update(readFileSync(new URL('../' + path, import.meta.url))).digest('hex'), expected);
  const mod = await WebAssembly.compile(binary);
  const stubs = Object.fromEntries(WebAssembly.Module.imports(mod).map(i => [i.name, () => 0]));
  const instance = await WebAssembly.instantiate(mod, { wasi_snapshot_preview1: stubs });
  const mem = instance.exports.memory;
  assert.throws(() => mem.grow(1025 - mem.buffer.byteLength / 65536), RangeError);
});
test('a guest asking for a signing hostcall is rejected before instantiation', async () => {
  const forbidden = new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,2,12,1,3,101,110,118,4,115,105,103,110,0,0]);
  await assert.rejects(runWasi(forbidden, '{}'), /Unapproved WASI import: env.sign/);
});
test('Rust XDR + Perch digest + P256 + Cedar allow the exact wallet intent and produce a verifying signature', async () => {
  const { input, fee } = await runtimeFixture(); let calls = 0;
  const boundary = createSigningBoundary(evaluate, async envelope => { calls++; return rawSignFee(TransactionBuilder.fromXdr(envelope, NETWORK), fee); });
  const signed = await boundary.sign(input);
  assert.equal(verifiesFeeSignature(signed, fee.publicKey), true); assert.equal(calls, 1);
  await assert.rejects(boundary.sign(input), /consumed/); assert.equal(calls, 1);
});
test('runtime rejects tampered recipient, C, network, fee payer, credential, raw payment and caller policy/verification claims', async () => {
  const { input, fee } = await runtimeFixture();
  const edits = [
    { intent: { ...input.intent, recipient: Keypair.random().publicKey() } },
    { intent: { ...input.intent, account: Keypair.random().publicKey() } },
    { network: 'Public Global Stellar Network ; September 2015' },
    { feeAccount: Keypair.random().publicKey() }, { assertedCredentialId: 'other' },
    { envelope: feeBump(unrelatedPayment(), fee.publicKey).toXdr() },
    { policy: 'permit(principal, action, resource);' }, { passkeyVerified: true },
  ];
  for (const edit of edits) { const answer = await check({ ...input, ...edit }); assert.equal(answer.allowed, false, JSON.stringify(edit)); }
});
test('runtime rejects wrong WebAuthn origin, challenge, RP and missing UV; Cedar refuses excessive fee', async () => {
  for (const assertion of [{ client: { origin: 'http://localhost:5198' } }, { client: { challenge: 'wrong' } }, { rpId: 'localhost' }, { flags: 1 }]) {
    const { input } = await runtimeFixture({ assertion }); assert.equal((await check(input)).allowed, false);
  }
  const { input } = await runtimeFixture({ baseFee: '1000' });
  const denied = await check(input); assert.equal(denied.allowed, false); assert.match(denied.reason, /Cedar/);
});
test('wrong pinned P256 key and altered signed assertion fail in the guest', async () => {
  const a = await runtimeFixture(), b = await runtimeFixture();
  assert.equal((await check({ ...a.input, registration: { ...a.input.registration, spki: b.input.registration.spki } })).allowed, false);
  const altered = await runtimeFixture({ tamperSignature: true });
  const answer = await check(altered.input);
  assert.equal(answer.allowed, false); assert.match(answer.reason, /signature/);
});
test('denial, malformed decisions, traps and timeouts never invoke the unlocking/signing callback', async () => {
  const { input } = await runtimeFixture(); let calls = 0;
  for (const ev of [async () => ({ allowed: false }), async () => ({ allowed: true }), async () => { throw Error('trap or timeout'); }]) {
    const boundary = createSigningBoundary(ev, () => { calls++; });
    await assert.rejects(boundary.sign(input));
  }
  const good = await check(input);
  for (const edit of [{ requestId: 'stale' }, { inputHash: 'stale' }, { facts: { ...good.facts, envelopeHash: 'other' } }]) {
    await assert.rejects(createSigningBoundary(async () => ({ ...good, ...edit }), () => { calls++; }).sign(input));
  }
  assert.equal(calls, 0);
});
test('in-flight request is single-use and mutable input cannot replace the approved envelope', async () => {
  const { input } = await runtimeFixture(); const original = input.envelope; let release, received, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const boundary = createSigningBoundary(async encoded => { await gate; return evaluate(encoded); }, envelope => { received = envelope; calls++; });
  const pending = boundary.sign(input);
  input.envelope = 'attacker replacement';
  await assert.rejects(boundary.sign(input), /consumed/);
  release(); await pending;
  assert.equal(received, original); assert.equal(calls, 1);
});
test('bounded WASI input fails closed', async () => { await assert.rejects(evaluate('x'.repeat(LIMITS.input + 1)), /input limit/); });
