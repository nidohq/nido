import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { buildPolicyDoc } from './build.js';
import { docCapProblem, type FlatDocLimits } from './caps.js';
import type { PolicyDoc } from './index.js';

// The limits a wallet reads from the account's compiler (`limits()`). The
// test takes them from Perch's compiler source, the values the deployed
// compiler reports.
const compiler = readFileSync(
  new URL('../../../../vendor/perch/crates/perch-doc-compiler/src/lib.rs', import.meta.url),
  'utf8',
);
const perchConst = (name: string) => Number(new RegExp(`pub const ${name}: u32 = ([0-9_]+);`).exec(compiler)![1]!.replace(/_/g, ''));
const limits: FlatDocLimits = {
  maxSigners: perchConst('MAX_DOC_SIGNERS'),
  maxRules: perchConst('MAX_DOC_RULES'),
  maxCanonicalBytes: perchConst('MAX_DOC_CANONICAL_BYTES'),
  // OZ's context-rule name limit, which the compiler re-exports.
  maxRuleNameBytes: 20,
};
const G = (n: number) => StrKey.encodeEd25519PublicKey(Buffer.alloc(32, n));

/** One admin plus `n - 1` more self-admin keys, each with its own rule. */
function withKeys(n: number): PolicyDoc {
  const ids = Array.from({ length: n }, (_, i) => (i === 0 ? 'admin' : `admin-${i + 1}`));
  return buildPolicyDoc({
    signers: ids.map((id, i) => ({ id, kind: 'delegated' as const, address: G(i + 1) })),
    permissions: ids.map((id) => ({ name: id, on: 'self-admin' as const, by: [id] })),
  });
}

describe('document limits (perch-js checkLimits)', () => {
  it('allow the most keys and refuse one more', () => {
    expect(docCapProblem(withKeys(limits.maxSigners), limits)).toBeUndefined();
    expect(docCapProblem(withKeys(limits.maxSigners + 1), limits)).toMatch(/at most 8/);
  });

  it('refuse one rule too many and an overlong rule name', () => {
    const doc = withKeys(1);
    const rules = Array.from({ length: limits.maxRules + 1 }, (_, i) => ({ ...doc.rules[0]!, name: `r${i}` }));
    expect(docCapProblem({ ...doc, rules }, limits)).toMatch(/at most 11/);
    const long = 'x'.repeat(21);
    expect(docCapProblem({ ...doc, rules: [{ ...doc.rules[0]!, name: long }] }, limits)).toBe(
      `The rule name "${long}" is 21 bytes; Perch allows at most 20.`,
    );
  });

  it('follow the limits the account reports, not a constant', () => {
    expect(docCapProblem(withKeys(3), { ...limits, maxSigners: 2 })).toMatch(/at most 2/);
  });
});
