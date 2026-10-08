// The SDK's auth digest and AuthPayload against the vectors Perch's Rust
// suite writes from the account's own types
// (vendor/perch/testdata/auth/auth-vectors.json, crates/integration-tests/
// tests/auth_vectors.rs there). Both delegate to perch-js, which pins the
// full set; this checks the SDK's wrappers reach it unchanged.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeAuthDigest } from './auth.js';
import { buildAuthPayloadScVal } from './multiSigner.js';

const vectors = JSON.parse(
  readFileSync(new URL('../../../vendor/perch/testdata/auth/auth-vectors.json', import.meta.url), 'utf8'),
) as {
  signing_digest: { signature_payload: string; rule_ids: number[]; digest: string }[];
  auth_payload: {
    rule_ids: number[];
    signers: { signer: { kind: string; address?: string }; signature: string }[];
    xdr: string;
  }[];
};
const hex = (s: string) => Buffer.from(s, 'hex');

describe('Perch auth vectors', () => {
  it('computeAuthDigest is the account digest for every vector', () => {
    expect(vectors.signing_digest.length).toBeGreaterThan(0);
    for (const v of vectors.signing_digest) {
      expect(computeAuthDigest(hex(v.signature_payload), v.rule_ids).toString('hex')).toBe(v.digest);
    }
  });

  it('buildAuthPayloadScVal encodes the delegated-signer payloads byte for byte', () => {
    const delegatedOnly = vectors.auth_payload.filter(
      (v) => v.signers.length > 0 && v.signers.every((s) => s.signer.kind === 'delegated'),
    );
    expect(delegatedOnly.length).toBeGreaterThan(0);
    for (const v of delegatedOnly) {
      const scv = buildAuthPayloadScVal({
        contextRuleIds: v.rule_ids,
        signers: v.signers.map((s) => ({ kind: 'delegated' as const, address: s.signer.address!, sigData: hex(s.signature) })),
      });
      expect(scv.toXDR('hex')).toBe(v.xdr);
    }
  });
});
