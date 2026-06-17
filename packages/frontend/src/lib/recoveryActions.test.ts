import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as relay from './relayClient.js';
import { Buffer } from 'buffer';
import {
  Account,
  Address,
  Asset,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { encodeRotationHandoff } from '@nidohq/passkey-sdk';

// Mock the chain-read and relayer seams so the pure orchestration in
// recoveryActions can be exercised without a network. extractFuncAndAuth stays
// REAL (spread from the original) — submitRotation feeds it a genuine envelope.
vi.mock('./policyChainFetch.js', () => ({
  fetchAllChainRules: vi.fn(async () => []),
  fetchPolicyState: vi.fn(async () => ({})),
  fetchRegistryAddress: vi.fn(async () => ''),
  fetchVerifierAddress: vi.fn(async () => ''),
}));
vi.mock('./relayerClient.js', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    relayerEnabled: vi.fn(() => false),
    submitSorobanTransaction: vi.fn(),
    waitForConfirmation: vi.fn(),
  };
});

import {
  validateRecoveryTxEnvelope,
  signRotationAsFriend,
  submitRotation,
  getStaging,
  mintRelayKey,
} from './recoveryActions.js';
import { fetchAllChainRules } from './policyChainFetch.js';
import {
  relayerEnabled,
  submitSorobanTransaction,
  waitForConfirmation,
} from './relayerClient.js';

const mockedRules = vi.mocked(fetchAllChainRules);
const mockedRelayerEnabled = vi.mocked(relayerEnabled);
const mockedSubmit = vi.mocked(submitSorobanTransaction);
const mockedWait = vi.mocked(waitForConfirmation);

// Deterministic, checksum-valid C-addresses (no real keys involved).
const cAddr = (n: number) => Address.contract(Buffer.alloc(32, n)).toString();
const ACCOUNT = cAddr(1);
const FRIEND = cAddr(2);
const VERIFIER = cAddr(3);
const OTHER = cAddr(9);
const POLICY = cAddr(7);
const SRC_G = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 5));
const HASH = 'ab'.repeat(32);

function invokeContractArgs(target: string): xdr.InvokeContractArgs {
  return new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(target).toScAddress(),
    functionName: 'add_signer',
    args: [],
  });
}

function addressAuthEntry(authAddress: string): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(authAddress).toScAddress(),
        nonce: xdr.Int64.fromString('123'),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function:
        xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          invokeContractArgs(authAddress),
        ),
      subInvocations: [],
    }),
  });
}

function invokeContractOp(
  target: string,
  auth: xdr.SorobanAuthorizationEntry[],
): xdr.Operation {
  return Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeContractArgs(target)),
    auth,
  });
}

function envXdr(ops: xdr.Operation[]): string {
  const builder = new TransactionBuilder(new Account(SRC_G, '0'), {
    fee: '10000000',
    networkPassphrase: Networks.TESTNET,
  });
  for (const op of ops) builder.addOperation(op);
  return builder.setTimeout(0).build().toXDR();
}

/** A well-formed recovery envelope: 1 invokeContract op on `account`, with a
 *  single address-scoped root auth entry for `account`. */
function validRecoveryXdr(account = ACCOUNT): string {
  return envXdr([invokeContractOp(account, [addressAuthEntry(account)])]);
}

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
beforeEach(() => {
  mockedRelayerEnabled.mockReturnValue(false);
});

// --- M4: validateRecoveryTxEnvelope (security-critical, now exported) -------

describe('validateRecoveryTxEnvelope', () => {
  it('accepts a well-formed single-op recovery envelope and returns the root auth', () => {
    const rootAuth = validateRecoveryTxEnvelope(validRecoveryXdr(), ACCOUNT);
    expect(rootAuth.credentials().switch()).toBe(
      xdr.SorobanCredentialsType.sorobanCredentialsAddress(),
    );
    const authAddr = Address.fromScAddress(
      rootAuth.credentials().address().address(),
    ).toString();
    expect(authAddr).toBe(ACCOUNT);
  });

  it('rejects more than one operation', () => {
    const op = invokeContractOp(ACCOUNT, [addressAuthEntry(ACCOUNT)]);
    expect(() => validateRecoveryTxEnvelope(envXdr([op, op]), ACCOUNT)).toThrow(
      /must have one operation/i,
    );
  });

  it('rejects a non-Soroban operation', () => {
    const payment = Operation.payment({
      destination: SRC_G,
      asset: Asset.native(),
      amount: '1',
    });
    expect(() => validateRecoveryTxEnvelope(envXdr([payment]), ACCOUNT)).toThrow(
      /not a Soroban invocation/i,
    );
  });

  it('rejects a host function that does not invoke a contract', () => {
    const op = Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeUploadContractWasm(Buffer.from([0, 1, 2, 3])),
      auth: [],
    });
    expect(() => validateRecoveryTxEnvelope(envXdr([op]), ACCOUNT)).toThrow(
      /does not invoke a contract/i,
    );
  });

  it('rejects an invocation targeting a different account', () => {
    const op = invokeContractOp(OTHER, [addressAuthEntry(OTHER)]);
    expect(() => validateRecoveryTxEnvelope(envXdr([op]), ACCOUNT)).toThrow(
      /targets a different account/i,
    );
  });

  it('rejects an envelope with no auth entry', () => {
    const op = invokeContractOp(ACCOUNT, []);
    expect(() => validateRecoveryTxEnvelope(envXdr([op]), ACCOUNT)).toThrow(
      /no auth entry/i,
    );
  });

  it('rejects auth that is not account-scoped (source-account credentials)', () => {
    const auth = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function:
          xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
            invokeContractArgs(ACCOUNT),
          ),
        subInvocations: [],
      }),
    });
    expect(() =>
      validateRecoveryTxEnvelope(envXdr([invokeContractOp(ACCOUNT, [auth])]), ACCOUNT),
    ).toThrow(/not account-scoped/i);
  });

  it('rejects auth scoped to a different account', () => {
    const op = invokeContractOp(ACCOUNT, [addressAuthEntry(OTHER)]);
    expect(() => validateRecoveryTxEnvelope(envXdr([op]), ACCOUNT)).toThrow(
      /auth is for a different account/i,
    );
  });
});

// --- M5: signRotationAsFriend re-reads the rule from chain to authorize -----

describe('signRotationAsFriend friend-membership gate', () => {
  const handoff = () =>
    encodeRotationHandoff({
      version: 4,
      account: ACCOUNT,
      recoveryRuleId: 4,
      refractorTxHashes: [HASH],
      parentSignatureExpirationLedger: 123,
      relayKey: 'KEY_test123',
      relayBaseUrl: 'https://relay.nido.fyi',
    });

  const ruleWithFriends = (friends: string[]) => [
    {
      ruleId: 4,
      policies: [POLICY],
      contextType: { kind: 'call-contract', contract: ACCOUNT },
      signers: friends.map((address) => ({ kind: 'delegated', address })),
    },
  ];

  it('rejects a caller the on-chain recovery rule does not list as a friend', async () => {
    mockedRules.mockResolvedValue(ruleWithFriends([OTHER]) as never);
    await expect(signRotationAsFriend(FRIEND, handoff())).rejects.toThrow(
      /does not list your account as a friend/i,
    );
  });

  it('passes the membership gate for a listed friend (then fails later on the missing passkey)', async () => {
    mockedRules.mockResolvedValue(ruleWithFriends([FRIEND]) as never);
    // Past the gate, signRotationAsFriend needs a registered passkey, which the
    // test environment has none of — so reaching THIS error proves the
    // chain-read authorization let the listed friend through.
    await expect(signRotationAsFriend(FRIEND, handoff())).rejects.toThrow(
      /No primary passkey registered/i,
    );
  });
});

// --- M6: submitRotation relayer branch + M2 resume-by-poll idempotency ------

describe('submitRotation relayer branch', () => {
  const stagingKey = `nido.${ACCOUNT}.recovery-rotation`;

  function seedStaging(overrides: Partial<{ relayerTxId: string; submittedHash: string }> = {}) {
    const staging = {
      account: ACCOUNT,
      recoveryRuleId: 4,
      threshold: 1,
      friends: [FRIEND],
      txs: [
        {
          txXdr: validRecoveryXdr(),
          refractorTxHash: HASH,
          refractorTxUrl: `https://refractor.space/tx/${HASH}`,
          parentAuthDigestHex: 'cd'.repeat(32),
          ...overrides,
        },
      ],
      lastLedger: 1000,
      parentSignatureExpirationLedger: 2000,
      description: 'test rotation',
      collected: {
        [FRIEND]: {
          friendAccount: FRIEND,
          verifierAddress: VERIFIER,
          publicKey: Array.from(new Uint8Array(65).fill(4)),
          entries: [
            {
              authenticatorData: Array.from(new Uint8Array(37).fill(1)),
              clientDataJson: Array.from(new TextEncoder().encode('{}')),
              signature: Array.from(new Uint8Array(64).fill(2)),
              nonce: '123',
              signatureExpirationLedger: 2000,
            },
          ],
        },
      },
    };
    localStorage.setItem(stagingKey, JSON.stringify(staging));
  }

  beforeEach(() => {
    mockedRelayerEnabled.mockReturnValue(true);
  });

  it('submits via the relayer, then polls for the hash when submit returns only a job id', async () => {
    seedStaging();
    mockedSubmit.mockResolvedValue({ transactionId: 'tx_1', hash: null, status: 'pending' } as never);
    mockedWait.mockResolvedValue({ transactionId: 'tx_1', hash: 'feed01', status: 'confirmed' } as never);

    const hash = await submitRotation(ACCOUNT);

    expect(hash).toBe('feed01');
    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    expect(mockedWait).toHaveBeenCalledWith('tx_1');
    expect(getStaging(ACCOUNT)).toBeNull(); // cleared on success
  });

  it('uses the hash directly and skips waitForConfirmation when the relayer returns one', async () => {
    seedStaging();
    mockedSubmit.mockResolvedValue({ transactionId: 'tx_2', hash: 'beef02', status: 'submitted' } as never);

    const hash = await submitRotation(ACCOUNT);

    expect(hash).toBe('beef02');
    expect(mockedWait).not.toHaveBeenCalled();
  });

  it('RESUMES by polling the persisted relayer job id instead of re-submitting (M2)', async () => {
    // A prior run handed the tx to the relayer (job id persisted) but the wait
    // timed out before a terminal status. Re-submitting would reuse the
    // friends' nonces and be rejected as a replay — so this must poll, not POST.
    seedStaging({ relayerTxId: 'tx_prior' });
    mockedWait.mockResolvedValue({ transactionId: 'tx_prior', hash: 'cafe03', status: 'confirmed' } as never);

    const hash = await submitRotation(ACCOUNT);

    expect(hash).toBe('cafe03');
    expect(mockedSubmit).not.toHaveBeenCalled();
    expect(mockedWait).toHaveBeenCalledWith('tx_prior');
    expect(getStaging(ACCOUNT)).toBeNull();
  });

  it('persists the relayer job id before waiting, so a timeout leaves a resumable staging', async () => {
    seedStaging();
    mockedSubmit.mockResolvedValue({ transactionId: 'tx_to', hash: null, status: 'pending' } as never);
    mockedWait.mockRejectedValue(new Error('Timed out waiting for relayer confirmation'));

    await expect(submitRotation(ACCOUNT)).rejects.toThrow(/Timed out/i);

    const staging = getStaging(ACCOUNT);
    expect(staging).not.toBeNull();
    expect(staging!.txs[0].relayerTxId).toBe('tx_to');
    expect(staging!.txs[0].submittedHash).toBeUndefined();
  });

  it('throws a clear error when the relayer returns neither hash nor job id', async () => {
    seedStaging();
    mockedSubmit.mockResolvedValue({ transactionId: null, hash: null, status: 'pending' } as never);

    await expect(submitRotation(ACCOUNT)).rejects.toThrow(/no transaction id/i);
  });
});

describe('mintRelayKey', () => {
  it('produces a 22+ char url-safe key', () => {
    expect(mintRelayKey()).toMatch(/^[A-Za-z0-9_-]{22,}$/);
  });
  it('is unique per call', () => {
    expect(mintRelayKey()).not.toBe(mintRelayKey());
  });
});

describe('submitFriendSignatureToRelay', () => {
  it('PUTs the blob to the friend bucket', async () => {
    const put = vi.spyOn(relay, 'putFriendSignature').mockResolvedValue();
    const { submitFriendSignatureToRelay } = await import('./recoveryActions.js');
    await submitFriendSignatureToRelay('https://relay.nido.fyi', 'KEYABC', 'CFRIEND', 'theblob');
    expect(put).toHaveBeenCalledWith('https://relay.nido.fyi', 'KEYABC', 'CFRIEND', 'theblob');
  });
});

describe('collectFromRelay', () => {
  it('feeds new relay blobs through the validator and skips known ones', async () => {
    const relay = await import('./relayClient.js');
    vi.spyOn(relay, 'listFriendSignatures').mockResolvedValue([
      { friend: 'CFRIEND1', blob: 'b1' },
      { friend: 'CFRIEND2', blob: 'b2' },
    ]);
    const { collectFromRelay } = await import('./recoveryActions.js');

    const calls: Array<[string, string]> = [];
    const fakeValidator = (account: string, blob: string) => {
      calls.push([account, blob]);
      return {} as never; // RotationStaging not inspected here
    };

    const added = await collectFromRelay(
      'CACCT',
      'https://relay.nido.fyi',
      'KEY',
      new Set(['CFRIEND1']),
      fakeValidator,
    );

    expect(calls).toEqual([['CACCT', 'b2']]); // only the unknown friend validated
    expect(added).toEqual(['CFRIEND2']);
  });

  it('skips blobs the validator rejects', async () => {
    const relay = await import('./relayClient.js');
    vi.spyOn(relay, 'listFriendSignatures').mockResolvedValue([
      { friend: 'CBAD', blob: 'bad' },
    ]);
    const { collectFromRelay } = await import('./recoveryActions.js');
    const throwingValidator = () => { throw new Error('invalid blob'); };
    const added = await collectFromRelay('CACCT', 'https://relay.nido.fyi', 'KEY', new Set(), throwingValidator as never);
    expect(added).toEqual([]); // rejected → not added, no throw
  });
});
