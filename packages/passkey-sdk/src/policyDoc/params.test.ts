import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { scValToNative, xdr } from '@stellar/stellar-sdk';
import { Client as PerchInterpreterClient } from '@nidohq/perch-interpreter';
import type { RpnProgram } from '@nidohq/perch-interpreter';
import { interpreterInstallParamsScVal, spendingLimitInstallParamsScVal } from './params.js';

// Wire-format parity against perch's golden byte vectors
// (packages/perch/testdata/golden/, vendored — see manifest.json there). The
// interpreter stores `#[contracttype]` values on chain; this TS encoder must
// reproduce those bytes exactly, so each golden fixture is rebuilt here and
// compared as hex. (ArgStrIn/ArgStrPrefix/ArgBytesEq/ArgI128Eq/ArgCount have
// no golden fixture upstream; ArgStrIn/ArgStrPrefix are covered by the
// decode round-trip below and the decompile tests.)

const here = dirname(fileURLToPath(import.meta.url));
const golden = (n: string) => readFileSync(resolve(here, '../../../perch/testdata/golden', n), 'utf8').trim();

// Fixed strkeys from perch-golden's fixtures.
const CONTRACT_C = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';

const DOC_HASH = '27cb38ef07bd8e4f86f07bef4d9272c070c2d9f05063d4c1ad1d4769b1d74a98';

/** Encode a bare RpnProgram through the interpreter spec (the golden `rpn`
 *  fixtures pin the program struct alone, not full InstallParams). */
function programScVal(program: RpnProgram): xdr.ScVal {
  const spec = new PerchInterpreterClient({
    contractId: CONTRACT_C,
    networkPassphrase: 'Test SDF Network ; September 2015',
    rpcUrl: 'https://soroban-testnet.stellar.org',
  }).spec;
  return spec.nativeToScVal(
    program,
    xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name: 'RpnProgram' })),
  );
}

describe('golden wire parity', () => {
  it('rpn_ci_publish: the canonical constrained-rule program', () => {
    const program: RpnProgram = {
      version: 1,
      ops: [
        { tag: 'MinSigners', values: [1] },
        { tag: 'FnIn', values: [['publish', 'publish_hash']] },
        { tag: 'ArgAddrIsSelf', values: [0] },
        { tag: 'All', values: [3] },
      ],
    };
    expect(programScVal(program).toXDR('hex')).toBe(golden('rpn_ci_publish.xdr'));
  });

  it('rpn_all_ops: every golden-pinned op variant', () => {
    const program: RpnProgram = {
      version: 1,
      ops: [
        { tag: 'MinSigners', values: [2] },
        { tag: 'FnIn', values: [['transfer']] },
        { tag: 'ArgAddrEq', values: [1, CONTRACT_C] },
        { tag: 'ArgAddrIsSelf', values: [0] },
        { tag: 'ArgSymEq', values: [2, 'kind'] },
        { tag: 'ArgU32Eq', values: [3, 42] },
        { tag: 'LedgerBefore', values: [1000] },
        { tag: 'LedgerAtOrAfter', values: [10] },
        { tag: 'Not', values: undefined as never },
        { tag: 'Any', values: [3] },
        { tag: 'All', values: [6] },
      ],
    };
    expect(programScVal(program).toXDR('hex')).toBe(golden('rpn_all_ops.xdr'));
  });

  it('oz_spending_limit: SpendingLimitAccountParams {1000000000, 17280}', () => {
    expect(spendingLimitInstallParamsScVal(1_000_000_000n, 17_280).toXDR('hex')).toBe(
      golden('oz_spending_limit.xdr'),
    );
  });
});

describe('interpreterInstallParamsScVal', () => {
  const program: RpnProgram = {
    version: 1,
    ops: [
      { tag: 'MinSigners', values: [1] },
      { tag: 'ArgStrIn', values: [0, ['a', 'b']] },
      { tag: 'ArgStrPrefix', values: [1, 'pre'] },
      { tag: 'All', values: [3] },
    ],
  };

  it('round-trips program and doc_hash through ScVal', () => {
    const val = interpreterInstallParamsScVal(program, DOC_HASH);
    const native = scValToNative(val) as { doc_hash: Buffer; program: { version: bigint | number } };
    expect(Buffer.from(native.doc_hash).toString('hex')).toBe(DOC_HASH);
    expect(Number(native.program.version)).toBe(1);
  });

  it('rejects a malformed doc_hash', () => {
    expect(() => interpreterInstallParamsScVal(program, 'abcd')).toThrow(/32 bytes/);
    expect(() => interpreterInstallParamsScVal(program, 'zz'.repeat(32))).toThrow(/32 bytes/);
  });
});
