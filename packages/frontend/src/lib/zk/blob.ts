// Proof-blob layout (pinned in docs/superpowers/plans/2026-07-03-zk-recovery-m3-sdk-prover-infra.md,
// "Global Constraints"): u32-BE(#pubs) ‖ pubs (32B each, BE) ‖ proof. The verification key is
// carried separately (not part of the blob) — it's fetched/pinned via manifest.ts instead.
//
// Pure and dependency-free on purpose: this is the unit-tested core of the prover pipeline. It has
// no import of bb.js/noir_js so it can be exercised in plain Node/vitest without a browser.

/**
 * Concatenate a proof with its public inputs into the single blob the on-chain verifier (and the
 * relayer) expect: a 4-byte big-endian public-input count, followed by each 32-byte public input
 * in order, followed by the raw proof bytes.
 */
export function buildProofBlob(publicInputs: Uint8Array[], proof: Uint8Array): Uint8Array {
  for (const [i, pub] of publicInputs.entries()) {
    if (pub.length !== 32) {
      throw new Error(`buildProofBlob: public input ${i} must be 32 bytes, got ${pub.length}`);
    }
  }

  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, publicInputs.length, false);

  const blob = new Uint8Array(header.length + publicInputs.length * 32 + proof.length);
  blob.set(header, 0);
  let offset = header.length;
  for (const pub of publicInputs) {
    blob.set(pub, offset);
    offset += 32;
  }
  blob.set(proof, offset);

  return blob;
}
