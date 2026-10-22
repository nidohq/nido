// The account reader every snapshot goes through, driven through perch-js's
// own `readSnapshot` and `applyDocument` over mocked contract bindings: an
// account reporting `addr_oz_v1` and pinned to a compiler other than the
// deployment's reads and applies, an account minted before the redeploy
// (`oz_rule_ids`) stays readable and is signed in its own dialect, and any
// other scheme is still refused.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { CompilerMismatch, UnsupportedCapability, applyDocument, oneTransactionBackend } from '@stellar-registry/perch';
import type { PolicyDoc } from '@stellar-registry/perch';

const chain = vi.hoisted(() => {
  const state = {
    account: '',
    authDigest: 'addr_oz_v1',
    docCompiler: '',
    revision: 5n,
    doc: '{"v":1}',
    /** The compiler every compiler client was built for, in order. */
    compilers: [] as string[],
  };
  const sim = <T>(result: T) => ({ result, simulation: { latestLedger: 100 } });
  return { state, sim };
});

vi.mock('@nidohq/perch-account', () => ({
  Client: class {
    configuration = async () =>
      chain.sim({
        revision: chain.state.revision,
        doc_hash: undefined,
        rules: [
          {
            id: 0,
            recovery: false,
            name: 'admin',
            context_type: { tag: 'CallContract', values: [chain.state.account] },
            valid_until: undefined,
            signers: [{ tag: 'External', values: [VERIFIER, Buffer.alloc(65, 4)] }],
            policies: [],
          },
        ],
        recovery_controller: undefined,
        recovery_rule: undefined,
        gate: [],
        recovery_generation: 0n,
        infra: { doc_compiler: chain.state.docCompiler, interpreter: INTERPRETER, spending_limit: SPENDING_LIMIT },
      });
    revision = async () => chain.sim(chain.state.revision);
    document = async () => chain.sim([chain.state.revision, Buffer.from(chain.state.doc)]);
    capabilities = async () =>
      chain.sim({
        interface_version: 1,
        doc_identity: 'canon_v1',
        auth_digest: chain.state.authDigest,
        apply_modes: ['one_tx'],
        snapshot_version: 1,
      });
  },
}));

vi.mock('@nidohq/perch-doc-compiler', () => ({
  Client: class {
    options: { contractId: string };
    constructor(options: { contractId: string }) {
      this.options = options;
      chain.state.compilers.push(options.contractId);
    }
    limits = async () =>
      chain.sim({
        tag: 'V1',
        values: [{ max_signers: 8, max_rules: 8, max_canonical_bytes: 4096, max_rule_name_bytes: 32 }],
      });
  },
}));

import { computeAuthDigest } from '../auth.js';
import { accountSnapshotReader, openAccountReader, readAccountSnapshot, readSnapshot, signRequestDigest } from './index.js';
import { PerchRecovery } from './recovery.js';
import { TESTNET } from './deployment.js';

const contract = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));
const VERIFIER = TESTNET.webauthnVerifier;
const INTERPRETER = contract(2);
const SPENDING_LIMIT = contract(3);
/** A compiler an earlier Perch release pinned: not the deployment's. */
const EARLIER_COMPILER = contract(4);
const ACCOUNT = contract(7);
const args = { account: ACCOUNT, rpcUrl: 'https://rpc', networkPassphrase: TESTNET.network };

const DOC = {
  version: 1,
  network: TESTNET.network,
  signers: [{ id: 'admin', verifier: VERIFIER, key: '04'.padEnd(130, '4') }],
  rules: [{ name: 'admin', scope: { type: 'self-admin' }, principals: { type: 'all', signers: ['admin'] } }],
} as unknown as PolicyDoc;

beforeEach(() => {
  chain.state.account = ACCOUNT;
  chain.state.authDigest = 'addr_oz_v1';
  chain.state.docCompiler = EARLIER_COMPILER;
  chain.state.revision = 5n;
  chain.state.compilers = [];
});

/** Apply `DOC` through perch-js's lifecycle as the wallet does, signing
 *  `signRequestDigest`; returns what was signed and the result. */
async function apply() {
  const reader = await openAccountReader(args);
  const payload = new Uint8Array(32).fill(9);
  const signed: { digest: Buffer; requestDigest: Uint8Array; ruleIds: number[] }[] = [];
  const expected: bigint[] = [];
  const op = applyDocument(
    DOC,
    oneTransactionBackend(reader, {
      async prepareApplyDoc({ expectedRevision }) {
        expected.push(expectedRevision);
        return {
          signaturePayload: payload,
          fee: { fee: 0n },
          async submit() {
            chain.state.revision += 1n;
            return { confirm: async () => ({ ledger: 100 }) };
          },
        };
      },
    }),
    {
      async sign(request) {
        signed.push({
          digest: signRequestDigest(reader, request),
          requestDigest: request.digest,
          ruleIds: [...request.selection.ruleIds],
        });
        return [{ signer: { kind: 'external', verifier: VERIFIER, key: Buffer.alloc(65, 4) }, signature: new Uint8Array(64) }];
      },
    },
  );
  const result = await op.result;
  return { reader, payload, signed, expected, result };
}

describe('account snapshot reader', () => {
  it('reads an addr_oz_v1 account through the compiler it pins, not the deployment’s', async () => {
    expect(EARLIER_COMPILER).not.toBe(TESTNET.docCompiler);
    const snap = await readAccountSnapshot(args, { document: true });
    expect(snap.capabilities.authDigest).toBe('addr_oz_v1');
    expect(snap.configuration.infra.docCompiler).toBe(EARLIER_COMPILER);
    expect(chain.state.compilers).toEqual([EARLIER_COMPILER]);
  });

  it('refuses a reader built on a compiler the account does not pin', async () => {
    await expect(readSnapshot(accountSnapshotReader({ ...args, docCompiler: TESTNET.docCompiler }))).rejects.toThrow(
      CompilerMismatch,
    );
  });

  it('keeps an oz_rule_ids account readable and reports its real scheme', async () => {
    chain.state.authDigest = 'oz_rule_ids';
    const reader = await openAccountReader(args);
    const snap = await readSnapshot(reader);
    expect(reader.authDigest).toBe('oz_rule_ids');
    expect((await readAccountSnapshot(args)).capabilities.authDigest).toBe('oz_rule_ids');
    expect(snap.configuration.revision).toBe(5n);
  });

  it('still refuses a scheme Nido does not sign', async () => {
    chain.state.authDigest = 'addr_oz_v2';
    await expect(readAccountSnapshot(args)).rejects.toThrow(UnsupportedCapability);
  });
});

describe('applyDocument through the account reader', () => {
  it('applies to an addr_oz_v1 account on an earlier compiler, signing perch-js’s bound digest', async () => {
    const { payload, signed, expected, result } = await apply();
    expect(expected).toEqual([5n]);
    expect(result.revision).toBe(6n);
    expect(signed).toHaveLength(1);
    expect(signed[0]!.ruleIds).toEqual([0]);
    expect(signed[0]!.digest).toEqual(Buffer.from(signed[0]!.requestDigest));
    expect(signed[0]!.digest).toEqual(computeAuthDigest(ACCOUNT, payload, [0], 'addr_oz_v1'));
    expect(chain.state.compilers).toEqual([EARLIER_COMPILER]);
  });

  it('applies to an oz_rule_ids account, signing its unbound digest', async () => {
    chain.state.authDigest = 'oz_rule_ids';
    const { reader, payload, signed, result } = await apply();
    expect(reader.authDigest).toBe('oz_rule_ids');
    expect(result.revision).toBe(6n);
    expect(signed[0]!.digest).toEqual(computeAuthDigest(ACCOUNT, payload, [0], 'oz_rule_ids'));
    expect(signed[0]!.digest).not.toEqual(Buffer.from(signed[0]!.requestDigest));
  });
});

describe('PerchRecovery.document', () => {
  it('reads an addr_oz_v1 account pinned to a compiler other than the deployment’s', async () => {
    const recovery = new PerchRecovery({ deployment: TESTNET, rpcUrl: 'https://rpc' });
    await expect(recovery.document(ACCOUNT)).resolves.toEqual({ revision: 5n, canonical: '{"v":1}' });
    expect(chain.state.compilers).toEqual([EARLIER_COMPILER]);
  });

  it('reads an oz_rule_ids account', async () => {
    chain.state.authDigest = 'oz_rule_ids';
    const recovery = new PerchRecovery({ deployment: TESTNET, rpcUrl: 'https://rpc' });
    await expect(recovery.document(ACCOUNT)).resolves.toEqual({ revision: 5n, canonical: '{"v":1}' });
  });
});
