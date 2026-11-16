import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'buffer';
import { externalPayload, perchDigest } from '../src/stellar.mjs';
// Exact upstream Rust-generated fixture, Perch dev PR #168 head:
// 0b3752d8a179a5952b05fbebd29131dbbf99fa80/testdata/auth/auth-vectors.json
const vectors = JSON.parse(readFileSync(new URL('./perch-auth-vectors.json', import.meta.url)));
test('Perch digest matches every Rust-generated vector at the reviewed dev head', () => {
  for (const v of vectors.signing_digest) {
    assert.equal(Buffer.from(perchDigest(v.account, Buffer.from(v.signature_payload, 'hex'), v.rule_ids)).toString('hex'), v.digest);
  }
});
test('external signer payload matches Perch dev Rust-generated XDR', () => {
  const v = vectors.auth_payload.find(v => v.signers.length === 1 && v.signers[0].signer.kind === 'external');
  assert.ok(v);
  const { signer, signature } = v.signers[0];
  assert.equal(Buffer.from(externalPayload(v.rule_ids, signer.verifier, Buffer.from(signer.key, 'hex'), Buffer.from(signature, 'hex')).toXdr()).toString('hex'), v.xdr);
});
