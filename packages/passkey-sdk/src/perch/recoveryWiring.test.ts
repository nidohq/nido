// `PerchRecovery` talks to the recovery stack an account enrolled with, read
// from the account, not to the deployment's. The account below enrolled
// under Perch 845c49a's controller, pool, and compiler; the deployment is
// the current `TESTNET`, whose controller has no record of it.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'buffer';
import { StrKey } from '@stellar/stellar-sdk';

const OLD = {
  controller: 'CDBIZB3MP7ANOFKIYBRKFX4AODLRODCDZUWMMYVTCFAXA4W2OH6D6LV2',
  docCompiler: 'CCYSZHRHY7GKT2OYXF6JW332GA2BL6ZKPAWIV6RVC5JW2RNPHQPSW5ZI',
  pool: 'CB3IOX2VW7C5VYKVQMNLQ5DPMNC5WSPEOVJSIRBZKXVHURGXBHII6EP7',
  adapter: 'CDLOOCAYOLNIVLGD4ZT6CYCRN23SM7OPO7FOSDUASFPHNAW3VWBMY2WH',
  circuitId: '9e39c41f4f35aad43e64b255dfe3ba13f10e8c9d36d6f56fce23c2d97c0a0b4a',
};
const ENROLLED = StrKey.encodeContract(Buffer.alloc(32, 1));
const FRESH = StrKey.encodeContract(Buffer.alloc(32, 2));
const GUARDIAN = StrKey.encodeContract(Buffer.alloc(32, 3));

interface Call {
  kind: 'account' | 'recovery' | 'compiler' | 'pool';
  contract: string;
  fn: string;
  args: unknown;
}
const { chain, fake } = vi.hoisted(() => {
  const chain = {
    calls: [] as Call[],
    answer: (_c: Call): unknown => undefined,
  };
  /** A generated client whose every method records the call and answers
   *  from `chain.answer`; a write's operation names its contract and
   *  function. */
  const fake = (kind: Call['kind']) =>
    class {
      constructor(opts: { contractId: string }) {
        return new Proxy(
          {},
          {
            get: (_t, fn) =>
              // Not a thenable: clients are returned from async functions.
              fn === 'then'
                ? undefined
                : async (args?: unknown) => {
                    const call = { kind, contract: opts.contractId, fn: String(fn), args };
                    chain.calls.push(call);
                    return { result: chain.answer(call), op: { contract: opts.contractId, fn: String(fn), args } };
                  },
          },
        );
      }
    };
  return { chain, fake };
});

vi.mock('@nidohq/perch-account', () => ({ Client: fake('account') }));
vi.mock('@nidohq/perch-doc-compiler', () => ({ Client: fake('compiler') }));
vi.mock('@nidohq/perch-zk-pool', () => ({ Client: fake('pool') }));
vi.mock('@nidohq/perch-recovery', async (orig) => ({
  ...(await orig<typeof import('@nidohq/perch-recovery')>()),
  Client: fake('recovery'),
}));
vi.mock('../assembledTx.js', () => ({
  extractXdrOperations: (tx: { op: unknown }) => [tx.op],
}));
// The account's snapshot, with the compiler it pins (`openAccountReader`
// reads that from the account itself).
vi.mock('./account.js', () => ({
  readAccountSnapshot: async (args: { account: string }) => ({
    account: args.account,
    configuration: {
      revision: 4n,
      recoveryRule: 9,
      infra: { docCompiler: 'CCYSZHRHY7GKT2OYXF6JW332GA2BL6ZKPAWIV6RVC5JW2RNPHQPSW5ZI' },
    },
    document: Buffer.from('{"applied":true}'),
  }),
}));

import { EvidenceDomain, PerchRecovery } from './recovery.js';
import { TESTNET } from './deployment.js';

const statement = {
  network_id: Buffer.alloc(32, 7),
  account: ENROLLED,
  controller: OLD.controller,
  config: { epoch: 5n, config_hash: Buffer.alloc(32, 8) },
  timing: { delay_ledgers: 10, expiry_ledgers: 100, valid_until_ledger: 200 },
  subject: {
    tag: 'LostKey',
    values: [
      {
        attempt_id: 3n,
        source_doc_hash: Buffer.alloc(32, 9),
        target_doc_hash: Buffer.alloc(32, 10),
        replacements_hash: Buffer.alloc(32, 11),
      },
    ],
  },
};

/** The chain: `ENROLLED` adopted 845c49a's controller with a `Combined`
 *  factor in 845c49a's pool and has an authorized attempt there; `FRESH`
 *  has no recovery. Every other controller knows neither. */
function answer(c: Call): unknown {
  if (c.kind === 'account' && c.fn === 'configuration') {
    return { recovery_controller: c.contract === ENROLLED ? OLD.controller : undefined };
  }
  const at = (c.args as { account?: string } | undefined)?.account;
  if (c.kind === 'recovery' && (c.contract !== OLD.controller || at !== ENROLLED)) {
    return c.fn === 'activity_gate' ? { authorized_attempt: undefined, frozen: false } : undefined;
  }
  if (c.kind === 'recovery') {
    switch (c.fn) {
      case 'config':
        return {
          mode: {
            tag: 'Combined',
            values: [
              { guardians: [GUARDIAN], quorum: 1 },
              { pool: OLD.pool, adapter: OLD.adapter, circuit_id: Buffer.from(OLD.circuitId, 'hex') },
            ],
          },
        };
      case 'activity_gate':
        return { authorized_attempt: 3n, frozen: false };
      case 'epoch':
        return 5n;
      case 'next_attempt_id':
        return 4n;
      case 'attempt':
        return { state: { tag: 'Authorized' } };
      case 'statement':
        return statement;
      case 'baseline':
        return Buffer.from('{"baseline":true}');
    }
  }
  if (c.kind === 'pool') {
    if (c.fn === 'enrollment') return { tree_id: 0, index: 2n };
    if (c.fn === 'tree') return { size: 1n };
    if (c.fn === 'leaves') return [Buffer.alloc(32, 12)];
  }
  if (c.kind === 'compiler' && c.fn === 'derive_target') return { canonical: Buffer.from('{"target":true}') };
  return undefined;
}

const client = () => new PerchRecovery({ deployment: TESTNET, rpcUrl: 'https://rpc' });
const at = (kind: Call['kind']) => chain.calls.filter((c) => c.kind === kind).map((c) => c.contract);
const replacements = {
  signers: [{ signerId: 'admin', credential: { kind: 'external' as const, verifier: TESTNET.webauthnVerifier, key: new Uint8Array(65).fill(4) } }],
};

beforeEach(() => {
  chain.calls = [];
  chain.answer = answer;
});

describe('an account enrolled under an earlier controller', () => {
  it('is read from its own controller and pool', async () => {
    expect(OLD.controller).not.toBe(TESTNET.recoveryController);
    const c = client();
    await expect(c.wiring(ENROLLED)).resolves.toEqual({ controller: OLD.controller, adopted: true });
    await expect(c.enrolledZk(ENROLLED)).resolves.toEqual({
      pool: OLD.pool,
      adapter: OLD.adapter,
      circuitId: OLD.circuitId,
    });
    expect(chain.calls.find((x) => x.fn === 'config')!.contract).toBe(OLD.controller);
  });

  it('shows the attempt its controller holds, which the deployment’s does not', async () => {
    const c = client();
    const gate = await c.activityGate(ENROLLED);
    expect(gate.authorized_attempt).toBe(3n);
    expect(await c.epoch(ENROLLED)).toBe(5n);
    expect(await c.nextAttemptId(ENROLLED)).toBe(4n);
    expect(await c.attempt(ENROLLED, 3n)).toEqual({ state: { tag: 'Authorized' } });
    const s = await c.statement(ENROLLED, 3n, EvidenceDomain.Cancel);
    expect(s.controller).toBe(OLD.controller);
    expect(s.configEpoch).toBe(5n);
    expect(new Set(at('recovery'))).toEqual(new Set([OLD.controller]));

    // The deployment's controller has no record of it.
    const current = new PerchRecovery({ deployment: TESTNET, rpcUrl: 'https://rpc' });
    chain.answer = (call) => (call.kind === 'recovery' ? answer({ ...call, contract: TESTNET.recoveryController }) : answer(call));
    expect((await current.activityGate(ENROLLED)).authorized_attempt).toBeUndefined();
  });

  it('lets the owner veto the attempt its controller shows', async () => {
    const c = client();
    const attemptId = (await c.activityGate(ENROLLED)).authorized_attempt!;
    const veto = await c.ownerCancel(ENROLLED, BigInt(attemptId));
    expect(veto.operations).toEqual([{ contract: ENROLLED, fn: 'cancel_recovery', args: { attempt_id: 3n } }]);
  });

  it('opens, approves, proves, and completes at its own controller', async () => {
    const c = client();
    const ops = [
      await c.beginLostKey(ENROLLED, replacements),
      await c.beginCompromise(ENROLLED, replacements),
      await c.submitGuardian(ENROLLED, 3n, EvidenceDomain.Initiate, GUARDIAN),
      await c.approveChange(ENROLLED, { kind: 'reconfigure-remove' }, 200, GUARDIAN),
      await c.submitZk(ENROLLED, 3n, EvidenceDomain.Initiate, {
        treeId: 0,
        root: new Uint8Array(32),
        nullifier: new Uint8Array(32),
        proof: new Uint8Array(4),
      }),
      await c.publishBaseline(ENROLLED, '{"baseline":true}'),
    ].map((b) => b.operations[0] as unknown as { contract: string; fn: string });
    expect(ops.map((o) => o.contract)).toEqual(Array(6).fill(OLD.controller));
    expect(ops.map((o) => o.fn)).toEqual([
      'begin_lost_key',
      'begin_compromise',
      'submit_guardian',
      'approve_change',
      'submit_zk',
      'publish_baseline',
    ]);

    // The completion: the baseline published at its controller, derived by
    // the compiler it pins, through its recovery rule at the snapshot's
    // revision.
    const { target, selection } = await c.prepareCompletion(ENROLLED, 'compromise', replacements);
    expect(target).toBe('{"target":true}');
    expect(selection).toEqual({ account: ENROLLED, revision: 4n, ruleIds: [9] });
    const baselineRead = chain.calls.find((x) => x.fn === 'baseline')!;
    expect(baselineRead.contract).toBe(OLD.controller);
    const derive = chain.calls.find((x) => x.fn === 'derive_target')!;
    expect(derive.contract).toBe(OLD.docCompiler);
    expect(Buffer.from((derive.args as { source_json: Buffer }).source_json).toString()).toBe('{"baseline":true}');
    const done = await c.completion(ENROLLED, target, selection, 100);
    expect(done.authMode).toBe('enforce');

    expect(new Set(at('recovery'))).toEqual(new Set([OLD.controller]));
    expect(at('compiler')).toEqual([OLD.docCompiler]);
  });

  it('proves against the pool its factor names', async () => {
    const c = client();
    expect(await c.leafPosition(ENROLLED, new Uint8Array(32).fill(5))).toEqual({ treeId: 0, index: 2 });
    expect(await c.treeLeaves(ENROLLED, 0)).toEqual([new Uint8Array(32).fill(12)]);
    expect(new Set(at('pool'))).toEqual(new Set([OLD.pool]));
  });

  it('reads where it lives once per client, and again after a failed read', async () => {
    const c = client();
    await c.epoch(ENROLLED);
    await c.attempt(ENROLLED, 3n);
    const reads = () => chain.calls.filter((x) => x.fn === 'configuration').length;
    expect(reads()).toBe(1);

    const flaky = client();
    chain.answer = (call) => {
      if (call.fn === 'configuration') throw new Error('rpc down');
      return answer(call);
    };
    await expect(flaky.epoch(ENROLLED)).rejects.toThrow(/rpc down/);
    chain.answer = answer;
    expect(await flaky.epoch(ENROLLED)).toBe(5n);
  });
});

describe('an account without recovery', () => {
  it('gets the deployment’s controller, the one a new enrollment adopts', async () => {
    const c = client();
    await expect(c.wiring(FRESH)).resolves.toEqual({
      controller: TESTNET.recoveryController,
      adopted: false,
    });
    expect(await c.enrolled(FRESH)).toBe(false);
    const publish = await c.publishBaseline(FRESH, '{}');
    expect((publish.operations[0] as unknown as { contract: string }).contract).toBe(TESTNET.recoveryController);
    await expect(c.leafPosition(FRESH, new Uint8Array(32))).rejects.toThrow(/no enrolled ZK factor/);
  });
});
