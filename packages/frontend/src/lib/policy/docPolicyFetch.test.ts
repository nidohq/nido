import { beforeEach, describe, it, expect, vi } from 'vitest';
import { StrKey, xdr } from '@stellar/stellar-sdk';

const contract = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));
const ACCOUNT = contract(30);
// What the account pins: an older factory's account pins older ones than the
// wallet's deployment names.
const INFRA = { docCompiler: contract(40), interpreter: contract(41), spendingLimit: contract(42) };

const seen = vi.hoisted(() => ({ interpreterIds: [] as string[] }));

vi.mock('../policyChainFetch.js', () => ({
  readAccountConfiguration: vi.fn(async () => ({
    revision: 1n,
    docHash: new Uint8Array(32).fill(7),
    rules: [
      { id: 0, recovery: false, name: 'admin', contract: ACCOUNT, validUntil: null, signers: [], policies: [] },
      { id: 1, recovery: true, name: 'recovery', contract: ACCOUNT, validUntil: null, signers: [], policies: [] },
    ],
    recoveryController: null,
    recoveryRule: 1,
    gate: null,
    recoveryGeneration: 0n,
    infra: INFRA,
  })),
  // `applied_doc_hash`: a document has been applied.
  simulateView: vi.fn(async () => xdr.ScVal.scvBytes(Buffer.alloc(32, 7))),
  fetchDefaultRuleAuthInfo: vi.fn(),
}));
vi.mock('@stellar-registry/perch-interpreter', () => ({
  Client: class {
    constructor(opts: { contractId: string }) {
      seen.interpreterIds.push(opts.contractId);
    }
    async get_program() {
      return { result: undefined };
    }
  },
}));
vi.mock('@nidohq/passkey-sdk', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@nidohq/passkey-sdk')>();
  return {
    ...sdk,
    readPolicy: vi.fn(sdk.readPolicy),
    perch: { ...sdk.perch, readDocument: vi.fn(async () => ({ revision: 1n, canonical: undefined })) },
  };
});

import { readPolicy } from '@nidohq/passkey-sdk';
import { readDocPolicy, toHex } from './docPolicyFetch.js';

describe('toHex', () => {
  it('lowercase-hex-encodes with zero padding', () => {
    expect(toHex(new Uint8Array([0, 1, 0xab, 0xff]))).toBe('0001abff');
  });
});

describe('readDocPolicy', () => {
  beforeEach(() => {
    seen.interpreterIds.length = 0;
    vi.mocked(readPolicy).mockClear();
  });

  it("reads programs from the interpreter the account pins", async () => {
    await readDocPolicy(ACCOUNT, []);
    expect(seen.interpreterIds).toEqual([INFRA.interpreter]);
  });

  it("decompiles against the account's pinned interpreter and spending limit", async () => {
    await readDocPolicy(ACCOUNT, []);
    expect(vi.mocked(readPolicy).mock.calls[0]?.[0].decompileCtx).toMatchObject({
      account: ACCOUNT,
      interpreterAddress: INFRA.interpreter,
      spendingLimitAddress: INFRA.spendingLimit,
    });
  });
});
