import { readFileSync } from 'node:fs';
import { Buffer } from 'buffer';
import { describe, expect, it, vi } from 'vitest';
import { Client as AccountClient } from '@nidohq/perch-account';
import { decodeConfiguration, type AccountConfiguration } from '@stellar-registry/perch';
import { xdr } from '@stellar/stellar-sdk';
import { TESTNET } from './deployment.js';
import {
  accountCodeOf,
  checkNewAccount,
  NewAccountRefused,
  verifyNewAccount,
  type AccountCode,
  type NewAccountExpectation,
  type NewAccountReads,
} from './newAccount.js';

const ACCOUNT = 'CDLZFC2SYJYDZT7K7VJRL2CU7LQV6AFZ2K2QJLY7QV53KIGWXJOANPYY';
const OTHER = 'CAAUAAK4VM4GM5JHNMDQT5TDXADXWNMLEXGP5PBD5Y7DPDTFB6MIXLVJ';
const KEY = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i));
const OTHER_KEY = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : 255 - i));

const expectation: NewAccountExpectation = { account: ACCOUNT, adminKey: KEY, deployment: TESTNET };
const code: AccountCode = { wasmHash: TESTNET.accountWasmHash };

/** The account `create_account(setup_pk, KEY, setup_sig)` leaves behind. */
function fresh(): AccountConfiguration {
  return {
    revision: 0n,
    docHash: null,
    rules: [
      {
        id: 0,
        recovery: false,
        name: 'admin',
        contract: ACCOUNT,
        validUntil: null,
        signers: [{ kind: 'external', verifier: TESTNET.webauthnVerifier, key: KEY }],
        policies: [],
      },
    ],
    recoveryController: null,
    recoveryRule: null,
    gate: null,
    recoveryGeneration: 0n,
    infra: {
      docCompiler: TESTNET.docCompiler,
      interpreter: TESTNET.interpreter,
      spendingLimit: TESTNET.spendingLimit,
    },
  };
}

function withAdmin(change: Partial<AccountConfiguration['rules'][number]>): AccountConfiguration {
  const c = fresh();
  c.rules = [{ ...c.rules[0]!, ...change }];
  return c;
}

describe('checkNewAccount', () => {
  it('accepts the account the user’s own setup creates', () => {
    expect(checkNewAccount(expectation, code, fresh())).toBeNull();
  });

  it('refuses other code', () => {
    expect(checkNewAccount(expectation, { wasmHash: '00'.repeat(32) }, fresh())).toBe('code');
    expect(checkNewAccount(expectation, { wasmHash: null }, fresh())).toBe('code');
  });

  it('refuses another admin key', () => {
    const c = withAdmin({ signers: [{ kind: 'external', verifier: TESTNET.webauthnVerifier, key: OTHER_KEY }] });
    expect(checkNewAccount(expectation, code, c)).toBe('key');
    const truncated = withAdmin({
      signers: [{ kind: 'external', verifier: TESTNET.webauthnVerifier, key: KEY.slice(0, 64) }],
    });
    expect(checkNewAccount(expectation, code, truncated)).toBe('key');
  });

  it('refuses a delegated admin', () => {
    expect(checkNewAccount(expectation, code, withAdmin({ signers: [{ kind: 'delegated', address: OTHER }] }))).toBe(
      'key',
    );
  });

  it('refuses the user’s key under another verifier', () => {
    const c = withAdmin({ signers: [{ kind: 'external', verifier: OTHER, key: KEY }] });
    expect(checkNewAccount(expectation, code, c)).toBe('verifier');
  });

  it.each<[string, Partial<AccountConfiguration>]>([
    ['a later revision', { revision: 1n }],
    ['an applied document', { docHash: new Uint8Array(32) }],
    ['a recovery controller', { recoveryController: OTHER }],
    ['a recovery rule', { recoveryRule: 1 }],
    ['a freeze', { gate: { attemptId: 1n, until: 10 } }],
    ['a later recovery generation', { recoveryGeneration: 1n }],
  ])('refuses an account with %s', (_, change) => {
    expect(checkNewAccount(expectation, code, { ...fresh(), ...change })).toBe('configured');
  });

  it.each(['docCompiler', 'interpreter', 'spendingLimit'] as const)('refuses another %s pin', (pin) => {
    const c = fresh();
    c.infra = { ...c.infra, [pin]: OTHER };
    expect(checkNewAccount(expectation, code, c)).toBe('infra');
  });

  it.each<[string, Partial<AccountConfiguration['rules'][number]>]>([
    ['is the recovery rule', { recovery: true }],
    ['has another name', { name: 'owner' }],
    ['is scoped to another contract', { contract: OTHER }],
    ['expires', { validUntil: 2_000 }],
    ['carries a policy', { policies: [{ policy: OTHER, params: new Uint8Array() }] }],
    [
      'has a second signer',
      {
        signers: [
          { kind: 'external', verifier: TESTNET.webauthnVerifier, key: KEY },
          { kind: 'external', verifier: TESTNET.webauthnVerifier, key: OTHER_KEY },
        ],
      },
    ],
  ])('refuses an admin rule that %s', (_, change) => {
    expect(checkNewAccount(expectation, code, withAdmin(change))).toBe('rules');
  });

  it('refuses any rule beside the admin rule, and no rule at all', () => {
    const extra = fresh();
    extra.rules = [...extra.rules, { ...extra.rules[0]!, id: 1, name: 'app', contract: OTHER }];
    expect(checkNewAccount(expectation, code, extra)).toBe('rules');
    expect(checkNewAccount(expectation, code, { ...fresh(), rules: [] })).toBe('rules');
  });
});

function reads(found: AccountCode | null, configuration = fresh()): NewAccountReads & {
  code: ReturnType<typeof vi.fn>;
  configuration: ReturnType<typeof vi.fn>;
} {
  return { code: vi.fn(async () => found), configuration: vi.fn(async () => configuration) };
}

const args = { rpcUrl: 'https://rpc.invalid', networkPassphrase: TESTNET.network };

describe('verifyNewAccount', () => {
  it('resolves for the user’s own account, reading the expected address', async () => {
    const r = reads(code);
    await verifyNewAccount(args, expectation, { reads: r });
    expect(r.code).toHaveBeenCalledWith({ ...args, account: ACCOUNT });
    expect(r.configuration).toHaveBeenCalledWith({ ...args, account: ACCOUNT });
  });

  it('refuses an address with nothing deployed, after the given reads', async () => {
    const r = reads(null);
    await expect(verifyNewAccount(args, expectation, { reads: r, attempts: 3, delayMs: 0 })).rejects.toEqual(
      new NewAccountRefused('missing'),
    );
    expect(r.code).toHaveBeenCalledTimes(3);
  });

  it('waits out an RPC that has not seen the account yet', async () => {
    const r = reads(code);
    r.code.mockResolvedValueOnce(null);
    await verifyNewAccount(args, expectation, { reads: r, attempts: 3, delayMs: 0 });
    expect(r.code).toHaveBeenCalledTimes(2);
  });

  it('refuses other code without asking it for a configuration', async () => {
    const r = reads({ wasmHash: '11'.repeat(32) });
    await expect(verifyNewAccount(args, expectation, { reads: r, attempts: 3, delayMs: 0 })).rejects.toEqual(
      new NewAccountRefused('code'),
    );
    expect(r.code).toHaveBeenCalledTimes(1);
    expect(r.configuration).not.toHaveBeenCalled();
  });

  it('refuses a mismatch at once, without retrying', async () => {
    const claimed = withAdmin({ signers: [{ kind: 'external', verifier: TESTNET.webauthnVerifier, key: OTHER_KEY }] });
    const r = reads(code, claimed);
    await expect(verifyNewAccount(args, expectation, { reads: r, attempts: 3, delayMs: 0 })).rejects.toEqual(
      new NewAccountRefused('key'),
    );
    expect(r.code).toHaveBeenCalledTimes(1);
  });

  it('passes a failed read through rather than accepting', async () => {
    const r = reads(code);
    r.configuration.mockRejectedValueOnce(new Error('rpc down'));
    await expect(verifyNewAccount(args, expectation, { reads: r })).rejects.toThrow('rpc down');
  });
});

// Real reads from the integration suite (`new_account_reads.rs`): accounts
// created through Nido's factory and Perch's account wasm, one by the owner
// and two by a front-runner that held the owner's setup secret and bound its
// own key first.
describe('accounts a front-runner created first', () => {
  interface Recorded {
    account: string;
    instance: string;
    configuration: string;
  }
  const recorded = JSON.parse(
    readFileSync(new URL('./testdata/new-account-reads.json', import.meta.url), 'utf8'),
  ) as {
    deployment: NewAccountExpectation['deployment'];
    ownerKey: string;
    claimantKey: string;
    created: Recorded;
    claimed: Recorded;
    handedOver: Recorded;
  };
  const decoder = new AccountClient({
    contractId: recorded.created.account,
    networkPassphrase: TESTNET.network,
    rpcUrl: args.rpcUrl,
  });
  // The decoding the wallet's RPC reads go through.
  const chainReads = (r: Recorded): NewAccountReads => ({
    code: async () => accountCodeOf(xdr.LedgerEntryData.fromXDR(r.instance, 'base64')),
    configuration: async () =>
      decodeConfiguration(decoder.spec.funcResToNative('configuration', r.configuration) as Record<string, unknown>),
  });
  const ownerExpects = (r: Recorded): NewAccountExpectation => ({
    account: r.account,
    adminKey: Buffer.from(recorded.ownerKey, 'hex'),
    deployment: recorded.deployment,
  });

  it('accepts the owner’s own account', async () => {
    await verifyNewAccount(args, ownerExpects(recorded.created), { reads: chainReads(recorded.created) });
  });

  it('refuses the address a front-runner claimed with its own key', async () => {
    const config = await chainReads(recorded.claimed).configuration({ ...args, account: recorded.claimed.account });
    const admin = config.rules[0]!.signers[0]!;
    expect(admin.kind === 'external' && Buffer.from(admin.key).toString('hex')).toBe(recorded.claimantKey);
    await expect(
      verifyNewAccount(args, ownerExpects(recorded.claimed), { reads: chainReads(recorded.claimed) }),
    ).rejects.toEqual(new NewAccountRefused('key'));
  });

  it('refuses a claimed address even after its admin was handed to the owner’s key', async () => {
    const config = await chainReads(recorded.handedOver).configuration({
      ...args,
      account: recorded.handedOver.account,
    });
    const admin = config.rules.find((r) => r.name === 'admin')!.signers[0]!;
    expect(admin.kind === 'external' && Buffer.from(admin.key).toString('hex')).toBe(recorded.ownerKey);
    await expect(
      verifyNewAccount(args, ownerExpects(recorded.handedOver), { reads: chainReads(recorded.handedOver) }),
    ).rejects.toEqual(new NewAccountRefused('configured'));
  });
});
