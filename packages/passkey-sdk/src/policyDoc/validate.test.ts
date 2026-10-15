import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { StrKey } from '@stellar/stellar-sdk';
import { lowerDoc, parsePolicyDoc, validateDoc } from './index.js';
import type { PolicyDoc } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const ACCOUNT = StrKey.encodeContract(new Uint8Array(32).fill(0x54));
const TARGET = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';
const SESSION_G = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

// Random documents with perch_ir::validate's verdict for each, generated and
// pinned by crates/integration-tests/tests/it/validate_differential.rs.
const corpus = JSON.parse(
  readFileSync(resolve(here, './testdata/validate-differential.json'), 'utf8'),
) as { doc: unknown; errors: string[] }[];

// validateDoc intentionally checks something that perch_ir::validate does not yet:
// InvalidFunctionName (a function name that isn't a valid Soroban Symbol,
// which would otherwise panic in Symbol::new when lowered on-chain rather
// than failing cleanly here).
// https://github.com/bitswell-hq/stellar-registry__perch/pull/5 includes the matching check.
// Once this is merged into perch `main` and Nido re-pins, the SDK_ONLY_KINDS filter below 
// becomes a no-op and should be deleted.
const SDK_ONLY_KINDS = new Set(['InvalidFunctionName']);

describe('validateDoc: differential against perch_ir::validate', () => {
  it('covers valid documents and every reachable ValidationError variant', () => {
    expect(corpus.some((c) => c.errors.length === 0)).toBe(true);
    // 49, not 50: InvalidFunctionName (see SDK_ONLY_KINDS) never appears in a
    // corpus perch_ir itself generated, so it can't contribute to this count.
    expect(new Set(corpus.flatMap((c) => c.errors)).size).toBeGreaterThanOrEqual(49);
  });

  it('reports exactly the Rust error variants for every corpus document', () => {
    const mismatches = corpus.flatMap((c, i) => {
      const got = validateDoc(parsePolicyDoc(c.doc))
        .map((e) => e.kind)
        .filter((kind) => !SDK_ONLY_KINDS.has(kind))
        .sort();
      return JSON.stringify(got) === JSON.stringify(c.errors) ? [] : [{ i, want: c.errors, got }];
    });
    expect(mismatches).toEqual([]);
  });

  it('lowerDoc refuses every document Rust refuses and lowers every expressible one it accepts', () => {
    for (const c of corpus) {
      const doc = parsePolicyDoc(c.doc);
      const lower = () => lowerDoc(doc, { account: ACCOUNT });
      if (c.errors.length > 0) {
        expect(lower).toThrow(/invalid document/);
      } else if (doc.rules.some((r) => r.principals.type === 'self-authenticating')) {
        // Valid, but not expressible in program v1.
        expect(lower).toThrow(/self-authenticating/);
      } else {
        expect(lower).not.toThrow();
      }
    }
  });
});

describe('lowerDoc: refuses what the on-chain compiler refuses', () => {
  const doc = (signers: string[]): PolicyDoc =>
    parsePolicyDoc({
      version: 1,
      signers: [{ id: 'a', address: SESSION_G }],
      rules: [
        { name: 'r', scope: { type: 'contract', address: TARGET }, principals: { type: 'all', signers } },
      ],
    });

  it('rejects a principals list naming the same signer twice', () => {
    expect(() => lowerDoc(doc(['a']), { account: ACCOUNT })).not.toThrow();
    expect(() => lowerDoc(doc(['a', 'a']), { account: ACCOUNT })).toThrow(/repeats signer "a"/);
  });

  it('accepts a "+"-signed cap limit, which perch-ir parses as an i128', () => {
    const capped = parsePolicyDoc({
      version: 1,
      signers: [{ id: 'a', address: SESSION_G }],
      rules: [
        {
          name: 'r',
          scope: { type: 'contract', address: TARGET },
          principals: { type: 'all', signers: ['a'] },
          cap: { limit: '+5', 'period-ledgers': 100 },
        },
      ],
    });
    expect(validateDoc(capped)).toEqual([]);
    expect(lowerDoc(capped, { account: ACCOUNT }).rules[0]!.cap?.limitStroops).toBe(5n);
  });
});
