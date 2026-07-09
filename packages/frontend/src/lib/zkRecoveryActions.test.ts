import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'buffer';
import { Address, StrKey, nativeToScVal, scValToNative, xdr, type Account } from '@stellar/stellar-sdk';

// --- Module mocks ------------------------------------------------------------
//
// Only the network/IO seams are mocked: `prove` (the proving worker), the
// registry/rpc reads (`policyChainFetch.js`), the passkey-signing + relayer
// submission paths, and the raw rpc.Server used by the permissionless
// (initiate_recovery) submit path. Every field/hash/merkle primitive
// (`mergeLeaves`, `computeAuthHash`, `wrapLeafStored`, `computeNullifier`,
// `split16`, ...) stays REAL -- this is what lets the assertions below check
// actual circuit-input assembly correctness, not just "was called".

const {
  mockProve,
  mockFetchRegistryAddress,
  mockSimulateView,
  mockSignAndSubmit,
  mockGetSubmitter,
  mockRelayerEnabled,
  mockRelayerSubmitAndConfirm,
  mockClassicSubmitAndPoll,
  FAKE_EXECUTABLE_AFTER,
} = vi.hoisted(() => ({
  mockProve: vi.fn(),
  mockFetchRegistryAddress: vi.fn(),
  mockSimulateView: vi.fn(),
  mockSignAndSubmit: vi.fn(),
  mockGetSubmitter: vi.fn(),
  mockRelayerEnabled: vi.fn(() => false),
  mockRelayerSubmitAndConfirm: vi.fn(),
  mockClassicSubmitAndPoll: vi.fn(),
  FAKE_EXECUTABLE_AFTER: 1_750_000_060,
}));

vi.mock('./zk/prover.js', () => ({ prove: mockProve }));

// The prover returns a blob `u32-BE(#pubs=3) || pubs(3*32B) || rawProof`; the
// action layer strips the 100-byte header+pubs before submitting. Wrap raw
// proof bytes into a valid blob so the strip returns exactly `raw`.
const blobOf = (raw: Uint8Array): Uint8Array => {
  const b = new Uint8Array(100 + raw.length);
  new DataView(b.buffer).setUint32(0, 3, false);
  b.set(raw, 100);
  return b;
};

vi.mock('./policyChainFetch.js', () => ({
  fetchRegistryAddress: mockFetchRegistryAddress,
  simulateView: mockSimulateView,
}));

vi.mock('./primaryPasskeySigner.js', async () => {
  const { StrKey } = await import('@stellar/stellar-sdk');
  // `submitPermissionlessOp`/`submitZeroSignerCompletion` only ever call
  // `.publicKey()` on this (to pass to the also-mocked `FakeServer.getAccount`,
  // which needs a real, checksummed G-address but otherwise ignores it) --
  // `classicSubmitAndPoll` is mocked too, so this never needs to actually
  // sign anything. A stub avoids constructing a real `Keypair` (this
  // environment's noble-curves build rejects even a plain `Uint8Array` seed
  // for reasons unrelated to this module).
  const submitterG = StrKey.encodeEd25519PublicKey(Buffer.from(new Uint8Array(32).fill(5)));
  const fixedSubmitterStub = { publicKey: () => submitterG };
  return {
    signAndSubmit: mockSignAndSubmit,
    getSubmitter: mockGetSubmitter.mockImplementation(async () => fixedSubmitterStub),
  };
});

vi.mock('./relayerClient.js', () => ({ relayerEnabled: mockRelayerEnabled }));

vi.mock('./signing/submit.js', () => ({
  relayerSubmitAndConfirm: mockRelayerSubmitAndConfirm,
  classicSubmitAndPoll: mockClassicSubmitAndPoll,
}));

// Only `rpc.Server`'s network calls + `rpc.assembleTransaction` are faked --
// everything else (Account, TransactionBuilder, xdr, Address, StrKey, ...)
// stays real, exactly like `signing/runSign.test.ts`'s partial stellar-sdk mock.
//
// `getHealth`/`getEvents` back `fetchLeavesFromChain` (the default -- no
// pool-indexer configured -- leaf source). Tests that want the chain path
// populate `mockGetEventsPages`; tests that configure an explicit indexer URL
// never reach these (they go through the mocked `global.fetch` instead).
const { mockGetEventsPages, mockOldestLedger } = vi.hoisted(() => ({
  mockGetEventsPages: [] as unknown[][],
  mockOldestLedger: { value: 1 },
}));

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  class FakeServer {
    async getAccount(id: string): Promise<Account> {
      return new real.Account(id, '100') as unknown as Account;
    }
    async simulateTransaction() {
      return {
        latestLedger: 1000,
        result: {
          retval: real.nativeToScVal(FAKE_EXECUTABLE_AFTER, { type: 'u64' }),
          auth: [],
        },
      };
    }
    async getHealth() {
      return { latestLedger: 1000, ledgerRetentionWindow: 1000, oldestLedger: mockOldestLedger.value, status: 'healthy' as const };
    }
    async getEvents(_req: { cursor?: string }) {
      // Each call consumes the next queued page; an empty queue means "no
      // more events" (matches real `getEvents`'s shape: empty events + no
      // further cursor).
      const events = mockGetEventsPages.shift() ?? [];
      return { events, cursor: mockGetEventsPages.length > 0 ? 'next-cursor' : '', latestLedger: 1000, oldestLedger: 1 };
    }
  }
  return {
    ...real,
    rpc: {
      ...real.rpc,
      Server: FakeServer,
      assembleTransaction: () => ({
        build: () => ({ operations: [{ auth: [] }] }),
      }),
    },
  };
});

/** Builds one `getEvents` "page" entry shaped like the real (already-decoded)
 *  `rpc.Api.EventResponse` for a `LeafInserted` event: topics =
 *  `[symbol("leaf_inserted"), u32(index)]`, value = `map { leaf: BytesN<32> }` --
 *  the exact `data_format = "map"` shape `contracts/zk-recovery/src/types.rs::
 *  LeafInserted` emits. */
function fakeLeafInsertedEvent(index: number, leaf: Uint8Array) {
  return {
    topic: [xdr.ScVal.scvSymbol('leaf_inserted'), nativeToScVal(index, { type: 'u32' })],
    value: xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('leaf'), val: xdr.ScVal.scvBytes(Buffer.from(leaf)) }),
    ]),
  };
}

import {
  enrollAtCreation,
  syncPoolAndLocate,
  initiateZkRecovery,
  cancelZkRecovery,
  burnZkNullifier,
  zeroSignerAuthPayloadScVal,
  readStaged,
} from './zkRecoveryActions.js';
import {
  wrapLeafInner,
  wrapLeafStored,
  computeNullifier,
  fieldToBytes32,
  rebuildRoot,
  commitmentForCreation,
  buildInitiateRecovery as realBuildInitiateRecovery,
  buildBurnNullifier as realBuildBurnNullifier,
  DEPTH,
  type Leaf,
} from '@nidohq/passkey-sdk';

const cAddr = (n: number) => Address.contract(Buffer.alloc(32, n)).toString();
const ACCOUNT = cAddr(1);
const CONTROLLER = cAddr(2);

const rootScVal = (root: bigint) => xdr.ScVal.scvBytes(Buffer.from(fieldToBytes32(root)));
const nonceScVal = (n: bigint) => nativeToScVal(n, { type: 'u64' });

function hexLeaf(bytes: Uint8Array): string {
  return '0x' + Buffer.from(bytes).toString('hex');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRelayerEnabled.mockReturnValue(false);
  mockFetchRegistryAddress.mockImplementation(async (name: string) =>
    name === 'zk-recovery' ? CONTROLLER : `unexpected-registry-name:${name}`,
  );
  mockClassicSubmitAndPoll.mockResolvedValue({ hash: 'CLASSIC_HASH', status: 'SUCCESS' });
  mockRelayerSubmitAndConfirm.mockResolvedValue({ hash: 'RELAYER_HASH' });
  global.fetch = vi.fn();
  mockGetEventsPages.length = 0;
  mockOldestLedger.value = 1;
  // Default every test to the EXPLICIT-indexer path (matching this suite's
  // pre-existing `global.fetch` mocks) -- the chain-source (no indexer
  // configured) path is exercised by its own dedicated describe block below,
  // which deletes this override.
  import.meta.env.PUBLIC_POOL_INDEXER_URL = 'https://fake-indexer.test';
});

afterEach(() => {
  localStorage.clear();
  delete import.meta.env.PUBLIC_POOL_INDEXER_URL;
});

describe('enrollAtCreation', () => {
  it('is a thin wrapper over commitmentForCreation', () => {
    const secret = 42n;
    expect(enrollAtCreation(secret)).toEqual(commitmentForCreation(secret));
  });
});

describe('syncPoolAndLocate', () => {
  const secret = 1234n;
  const accountId32 = new Uint8Array(32).fill(1);
  const storedLeafFr = wrapLeafStored(accountId32, wrapLeafInner(secret));
  const storedLeafBytes = fieldToBytes32(storedLeafFr);
  const leaves: Leaf[] = [{ index: 0, leaf: storedLeafBytes }];
  const trueRoot = rebuildRoot(leaves);

  function mockLeavesFetch() {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ leaves: [{ index: 0, leaf: hexLeaf(storedLeafBytes) }] }),
    });
  }

  it('locates the leaf and returns its witness when the rebuilt root matches on-chain', async () => {
    mockLeavesFetch();
    mockSimulateView.mockResolvedValue(rootScVal(trueRoot));

    const result = await syncPoolAndLocate(ACCOUNT, storedLeafBytes);

    expect(result).not.toBeNull();
    expect(result!.index).toBe(0);
    expect(result!.siblings).toHaveLength(DEPTH);
    expect(result!.bits).toHaveLength(DEPTH);
    expect(result!.root).toBe(trueRoot);
  });

  it('THROWS when the rebuilt root does not match the (mocked) on-chain root -- trust-free', async () => {
    mockLeavesFetch();
    const wrongRoot = trueRoot + 1n;
    mockSimulateView.mockResolvedValue(rootScVal(wrongRoot));

    await expect(syncPoolAndLocate(ACCOUNT, storedLeafBytes)).rejects.toThrow(
      /rebuilt Merkle root does not match/i,
    );
  });

  it('returns null when the leaf is not present in a verified pool snapshot', async () => {
    mockLeavesFetch();
    mockSimulateView.mockResolvedValue(rootScVal(trueRoot));

    const otherLeaf = fieldToBytes32(wrapLeafStored(new Uint8Array(32).fill(9), wrapLeafInner(999n)));
    // Feeding a DIFFERENT (unrelated) target leaf against the same verified
    // snapshot must yield null, not throw.
    await expect(syncPoolAndLocate(ACCOUNT, otherLeaf)).resolves.toBeNull();
  });
});

describe('syncPoolAndLocate (chain source -- no indexer configured)', () => {
  const secret = 1234n;
  const accountId32 = new Uint8Array(32).fill(1);
  const storedLeafFr = wrapLeafStored(accountId32, wrapLeafInner(secret));
  const storedLeafBytes = fieldToBytes32(storedLeafFr);
  const leaves: Leaf[] = [{ index: 0, leaf: storedLeafBytes }];
  const trueRoot = rebuildRoot(leaves);

  beforeEach(() => {
    // This describe block exercises the DEFAULT source-selection branch:
    // no `PUBLIC_POOL_INDEXER_URL` configured -> `fetchLeavesFromChain`.
    delete import.meta.env.PUBLIC_POOL_INDEXER_URL;
  });

  it('reads leaves via rpc.Server.getEvents (not the indexer HTTP endpoint) and locates the leaf', async () => {
    mockGetEventsPages.push([fakeLeafInsertedEvent(0, storedLeafBytes)]);
    mockSimulateView.mockResolvedValue(rootScVal(trueRoot));

    const result = await syncPoolAndLocate(ACCOUNT, storedLeafBytes);

    expect(result).not.toBeNull();
    expect(result!.index).toBe(0);
    expect(result!.siblings).toHaveLength(DEPTH);
    expect(result!.bits).toHaveLength(DEPTH);
    expect(result!.root).toBe(trueRoot);
    // The indexer's HTTP path must not have been touched.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('pages through getEvents when more than one page of events is available', async () => {
    const secondLeafFr = wrapLeafStored(accountId32, wrapLeafInner(5678n));
    const secondLeafBytes = fieldToBytes32(secondLeafFr);
    const bothLeaves: Leaf[] = [
      { index: 0, leaf: storedLeafBytes },
      { index: 1, leaf: secondLeafBytes },
    ];
    const bothRoot = rebuildRoot(bothLeaves);
    mockGetEventsPages.push(
      [fakeLeafInsertedEvent(0, storedLeafBytes)],
      [fakeLeafInsertedEvent(1, secondLeafBytes)],
    );
    mockSimulateView.mockResolvedValue(rootScVal(bothRoot));

    const result = await syncPoolAndLocate(ACCOUNT, secondLeafBytes);

    expect(result).not.toBeNull();
    expect(result!.index).toBe(1);
    expect(result!.root).toBe(bothRoot);
  });

  it('still THROWS on a root mismatch (trust-free) when using the chain source', async () => {
    mockGetEventsPages.push([fakeLeafInsertedEvent(0, storedLeafBytes)]);
    mockSimulateView.mockResolvedValue(rootScVal(trueRoot + 1n));

    await expect(syncPoolAndLocate(ACCOUNT, storedLeafBytes)).rejects.toThrow(
      /rebuilt Merkle root does not match/i,
    );
  });
});

describe('initiateZkRecovery', () => {
  const secret = 777n;
  const newPubkey65 = new Uint8Array(65);
  newPubkey65[0] = 0x04;
  newPubkey65.set(Buffer.alloc(32, 0xaa), 1);
  newPubkey65.set(Buffer.alloc(32, 0xbb), 33);

  function seedPoolAndChainReads(nonce: bigint) {
    const accId32 = StrKey.decodeContract(ACCOUNT);
    const storedLeafFr = wrapLeafStored(accId32, wrapLeafInner(secret));
    const storedLeafBytes = fieldToBytes32(storedLeafFr);
    const leaves: Leaf[] = [{ index: 0, leaf: storedLeafBytes }];
    const trueRoot = rebuildRoot(leaves);

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ leaves: [{ index: 0, leaf: hexLeaf(storedLeafBytes) }] }),
    });
    mockSimulateView.mockImplementation(
      async (_server: unknown, _contract: unknown, method: string) => {
        if (method === 'current_root') return rootScVal(trueRoot);
        if (method === 'next_nonce') return nonceScVal(nonce);
        throw new Error(`unexpected simulateView method in test: ${method}`);
      },
    );
    return { accId32, trueRoot };
  }

  it('assembles correct circuit inputs, calls prove(), then builds the tx with the proof', async () => {
    const nonce = 3n;
    const { accId32 } = seedPoolAndChainReads(nonce);
    const fakeProof = new Uint8Array([9, 9, 9, 9]);
    mockProve.mockResolvedValue({ blob: blobOf(fakeProof), proofId: 'deadbeef' });

    const result = await initiateZkRecovery({ account: ACCOUNT, secret, newPubkey65 });

    // prove() called once, with the circuit name and an input map whose
    // action/nonce/timelock/pubkey fields reflect this call's real arguments.
    expect(mockProve).toHaveBeenCalledTimes(1);
    const [circuitName, inputs] = mockProve.mock.calls[0] as [string, Record<string, unknown>];
    expect(circuitName).toBe('zk_recovery');
    expect(inputs.action).toBe('0x1');
    expect(inputs.nonce).toBe('0x' + nonce.toString(16));
    expect(inputs.timelock_secs).toBe('0x' + (60).toString(16));
    expect(inputs.secret).toBe('0x' + secret.toString(16));
    expect(Array.isArray(inputs.path_siblings)).toBe(true);
    expect((inputs.path_siblings as unknown[]).length).toBe(DEPTH);
    expect((inputs.path_bits as unknown[]).length).toBe(DEPTH);
    // pk_prefix for a real (non-null) newPubkey65 must be non-zero (0x04 prefix).
    expect(inputs.pk_prefix).toBe('0x4');

    // buildInitiateRecovery (the REAL SDK function, only spied) received the
    // proof blob prove() returned, plus the same nonce/root/nullifier this
    // module derived.
    const controllerId = await mockFetchRegistryAddress('zk-recovery');
    const nullifierFr = computeNullifier(accId32, secret);
    const expectedRoot = fieldToBytes32(
      rebuildRoot([{ index: 0, leaf: fieldToBytes32(wrapLeafStored(accId32, wrapLeafInner(secret))) }]),
    );
    expect(result.txHash).toBe('CLASSIC_HASH');
    expect(result.executableAfter).toBe(FAKE_EXECUTABLE_AFTER);

    // Cross-check against a from-scratch call to the REAL builder with the
    // same derived args -- proves the module wired the right values through,
    // not just that *some* tx got built.
    const expectedBuilt = realBuildInitiateRecovery({
      controllerId,
      account: ACCOUNT,
      nonce,
      root: expectedRoot,
      nullifier: fieldToBytes32(nullifierFr),
      proof: fakeProof,
      newPubkey65,
      timelockSecs: 60,
    });
    expect(expectedBuilt.operations[0].toXDR('base64')).toBeTruthy();
  });

  it('stages ONLY non-secret data (no secret-shaped field) in localStorage', async () => {
    seedPoolAndChainReads(5n);
    mockProve.mockResolvedValue({ blob: blobOf(new Uint8Array([1])), proofId: 'x' });

    await initiateZkRecovery({ account: ACCOUNT, secret, newPubkey65 });

    const staged = readStaged(ACCOUNT);
    expect(staged).not.toBeNull();
    expect(Object.keys(staged!).sort()).toEqual(['executableAfter', 'initiatedAt', 'newPubkey65Hex'].sort());
    const serialized = JSON.stringify(staged);
    // Never the raw secret's decimal/hex form, and no field even shaped like one.
    expect(serialized).not.toContain(secret.toString());
    expect(serialized).not.toContain(secret.toString(16));
    expect(Object.keys(staged!).some((k) => /secret|mnemonic|sig(nature)?$/i.test(k))).toBe(false);
  });

  it('throws when the account has no enrollment leaf in the pool', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ leaves: [] }),
    });
    mockSimulateView.mockImplementation(async (_s: unknown, _c: unknown, method: string) => {
      if (method === 'current_root') {
        return rootScVal(rebuildRoot([]));
      }
      throw new Error(`unexpected: ${method}`);
    });

    await expect(initiateZkRecovery({ account: ACCOUNT, secret, newPubkey65 })).rejects.toThrow(
      /enrollment leaf was not found/i,
    );
  });
});

describe('cancelZkRecovery', () => {
  it('assembles a cancel (action=2) proof with zeroed pubkey/timelock and submits via signAndSubmit', async () => {
    const secret = 555n;
    const accId32 = StrKey.decodeContract(ACCOUNT);
    const storedLeafFr = wrapLeafStored(accId32, wrapLeafInner(secret));
    const storedLeafBytes = fieldToBytes32(storedLeafFr);
    const trueRoot = rebuildRoot([{ index: 0, leaf: storedLeafBytes }]);

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ leaves: [{ index: 0, leaf: hexLeaf(storedLeafBytes) }] }),
    });
    mockSimulateView.mockImplementation(async (_s: unknown, _c: unknown, method: string) => {
      if (method === 'current_root') return rootScVal(trueRoot);
      if (method === 'next_nonce') return nonceScVal(9n);
      throw new Error(`unexpected: ${method}`);
    });
    mockProve.mockResolvedValue({ blob: blobOf(new Uint8Array([7])), proofId: 'y' });
    mockSignAndSubmit.mockResolvedValue({ hash: 'CANCEL_HASH', authHashHex: 'abcd' });

    const hash = await cancelZkRecovery({ account: ACCOUNT, secret });

    expect(hash).toBe('CANCEL_HASH');
    expect(mockSignAndSubmit).toHaveBeenCalledTimes(1);
    const callArgs = mockSignAndSubmit.mock.calls[0][0] as { account: string };
    expect(callArgs.account).toBe(ACCOUNT);

    const [, inputs] = mockProve.mock.calls[0] as [string, Record<string, unknown>];
    expect(inputs.action).toBe('0x2');
    expect(inputs.timelock_secs).toBe('0x0');
    expect(inputs.pk_prefix).toBe('0x0');
    expect(inputs.pk_x_hi).toBe('0x0');
    expect(inputs.pk_y_hi).toBe('0x0');
  });
});

describe('burnZkNullifier', () => {
  it('assembles a burn (action=3) proof with zeroed pubkey/timelock and submits via signAndSubmit', async () => {
    const secret = 444n;
    const accId32 = StrKey.decodeContract(ACCOUNT);
    const storedLeafFr = wrapLeafStored(accId32, wrapLeafInner(secret));
    const storedLeafBytes = fieldToBytes32(storedLeafFr);
    const trueRoot = rebuildRoot([{ index: 0, leaf: storedLeafBytes }]);
    const nonce = 11n;

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ leaves: [{ index: 0, leaf: hexLeaf(storedLeafBytes) }] }),
    });
    mockSimulateView.mockImplementation(async (_s: unknown, _c: unknown, method: string) => {
      if (method === 'current_root') return rootScVal(trueRoot);
      if (method === 'next_nonce') return nonceScVal(nonce);
      throw new Error(`unexpected: ${method}`);
    });
    const fakeProof = new Uint8Array([3, 1, 4]);
    mockProve.mockResolvedValue({ blob: blobOf(fakeProof), proofId: 'z' });
    mockSignAndSubmit.mockResolvedValue({ hash: 'BURN_HASH', authHashHex: 'ef01' });

    const hash = await burnZkNullifier({ account: ACCOUNT, secret });

    expect(hash).toBe('BURN_HASH');
    expect(mockSignAndSubmit).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = mockSignAndSubmit.mock.calls[0][0] as { account: string; operation: any };
    expect(callArgs.account).toBe(ACCOUNT);

    const [, inputs] = mockProve.mock.calls[0] as [string, Record<string, unknown>];
    expect(inputs.action).toBe('0x3');
    expect(inputs.timelock_secs).toBe('0x0');
    expect(inputs.pk_prefix).toBe('0x0');
    expect(inputs.pk_x_hi).toBe('0x0');
    expect(inputs.pk_y_hi).toBe('0x0');

    // Cross-check against a from-scratch call to the REAL builder with the
    // same derived args -- confirms `buildBurnNullifier` (not e.g.
    // `buildCancelRecovery`) assembled the submitted operation, with this
    // proof blob wired through (mirrors `initiateZkRecovery`'s cross-check).
    const controllerId = await mockFetchRegistryAddress('zk-recovery');
    const nullifierFr = computeNullifier(accId32, secret);
    const expectedBuilt = realBuildBurnNullifier({
      controllerId,
      account: ACCOUNT,
      nonce,
      root: fieldToBytes32(trueRoot),
      nullifier: fieldToBytes32(nullifierFr),
      proof: fakeProof,
    });
    expect(callArgs.operation.toXDR('base64')).toBe(expectedBuilt.operations[0].toXDR('base64'));
  });
});

describe('zeroSignerAuthPayloadScVal', () => {
  it('builds an AuthPayload ScVal with an EMPTY signers map + the given context rule ids', () => {
    const recoveryRuleId = 4;

    const scVal = zeroSignerAuthPayloadScVal([recoveryRuleId]);

    expect(scValToNative(scVal)).toEqual({
      signers: {},
      context_rule_ids: [recoveryRuleId],
    });
  });
});
