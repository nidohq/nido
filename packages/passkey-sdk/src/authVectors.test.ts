// The SDK's auth digest and AuthPayload against the vectors Perch's Rust
// suite writes from the account's own types
// (vendor/perch/testdata/auth/auth-vectors.json, crates/integration-tests/
// tests/auth_vectors.rs there). `computeAuthDigest` delegates the addr_oz_v1
// digest to perch-js and computes the unbound oz_rule_ids digest itself;
// `buildAuthPayloadScVal` delegates to perch-js. This checks the SDK's
// wrappers reproduce Perch's account-bound digest and payload byte for byte.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hash } from '@stellar/stellar-sdk';
import { ruleIdsXdr } from '@stellar-registry/perch';
import { computeAuthDigest } from './auth.js';
import { buildAuthPayloadScVal } from './multiSigner.js';

const vectors = JSON.parse(
  readFileSync(new URL('../../../vendor/perch/testdata/auth/auth-vectors.json', import.meta.url), 'utf8'),
) as {
  signing_digest: { account: string; signature_payload: string; rule_ids: number[]; digest: string }[];
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
      expect(computeAuthDigest(v.account, hex(v.signature_payload), v.rule_ids).toString('hex')).toBe(
        v.digest,
      );
    }
  });

  it('signs each account in its own dialect: addr_oz_v1 binds the address, oz_rule_ids does not', () => {
    const v = vectors.signing_digest[0];
    const payload = hex(v.signature_payload);
    // addr_oz_v1 (the default and the redeployed accounts) is the account-bound
    // vector digest; passing the scheme explicitly agrees with the default.
    expect(computeAuthDigest(v.account, payload, v.rule_ids, 'addr_oz_v1').toString('hex')).toBe(v.digest);
    expect(computeAuthDigest(v.account, payload, v.rule_ids).toString('hex')).toBe(v.digest);
    // oz_rule_ids (accounts minted before the redeploy) omits the address
    // binding — it is the raw OZ rule-id layer over the bare payload, so it
    // differs from the bound digest and does not depend on the account.
    const unbound = computeAuthDigest(v.account, payload, v.rule_ids, 'oz_rule_ids');
    expect(unbound).toEqual(hash(Buffer.concat([payload, ruleIdsXdr(v.rule_ids)])));
    expect(unbound.toString('hex')).not.toBe(v.digest);
    const other = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
    expect(computeAuthDigest(other, payload, v.rule_ids, 'oz_rule_ids')).toEqual(unbound);
    expect(computeAuthDigest(other, payload, v.rule_ids, 'addr_oz_v1').toString('hex')).not.toBe(v.digest);
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
