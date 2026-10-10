import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { buildPolicyDoc } from './build.js';
import {
  docCapProblem,
  MAX_DOC_CANONICAL_BYTES,
  MAX_DOC_RULES,
  MAX_DOC_SIGNERS,
  MAX_RULE_NAME_BYTES,
} from './caps.js';
import type { PolicyDoc } from './index.js';

const compiler = readFileSync(
  new URL('../../../../vendor/perch/crates/perch-doc-compiler/src/lib.rs', import.meta.url),
  'utf8',
);
const perchConst = (name: string) => Number(new RegExp(`pub const ${name}: u32 = ([0-9_]+);`).exec(compiler)![1]!.replace(/_/g, ''));
const G = (n: number) => StrKey.encodeEd25519PublicKey(Buffer.alloc(32, n));

/** One admin plus `n - 1` more self-admin keys, each with its own rule. */
function withKeys(n: number): PolicyDoc {
  const ids = Array.from({ length: n }, (_, i) => (i === 0 ? 'admin' : `admin-${i + 1}`));
  return buildPolicyDoc({
    signers: ids.map((id, i) => ({ id, kind: 'delegated' as const, address: G(i + 1) })),
    permissions: ids.map((id) => ({ name: id, on: 'self-admin' as const, by: [id] })),
  });
}

describe('document caps', () => {
  it("match Perch's doc compiler", () => {
    expect(MAX_DOC_SIGNERS).toBe(perchConst('MAX_DOC_SIGNERS'));
    expect(MAX_DOC_RULES).toBe(perchConst('MAX_DOC_RULES'));
    expect(MAX_DOC_CANONICAL_BYTES).toBe(perchConst('MAX_DOC_CANONICAL_BYTES'));
    expect(MAX_RULE_NAME_BYTES).toBe(20);
  });

  it('allow eight keys and refuse a ninth', () => {
    expect(docCapProblem(withKeys(MAX_DOC_SIGNERS))).toBeUndefined();
    expect(docCapProblem(withKeys(MAX_DOC_SIGNERS + 1))).toMatch(/at most 8/);
  });

  it('refuse a twelfth rule and an overlong rule name', () => {
    const doc = withKeys(1);
    const rules = Array.from({ length: MAX_DOC_RULES + 1 }, (_, i) => ({ ...doc.rules[0]!, name: `r${i}` }));
    expect(docCapProblem({ ...doc, rules })).toMatch(/at most 11/);
    expect(docCapProblem({ ...doc, rules: [{ ...doc.rules[0]!, name: 'x'.repeat(21) }] })).toMatch(/longer than 20/);
  });
});
