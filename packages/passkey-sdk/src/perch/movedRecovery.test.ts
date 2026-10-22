// Moving an account's recovery onto the current deployment's stack keeps
// every setting the owner chose and changes only the controller, plus a ZK
// factor's pool, adapter, and circuit when they moved too. A factor on
// another pool needs a new credential: the account refuses a changed factor
// that keeps its enrollment id.

import { describe, expect, it } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { buildPolicyDoc } from '../policyDoc/index.js';
import { TESTNET, type PerchDeployment } from './deployment.js';
import {
  configHash,
  movedRecovery,
  recoveryFromWire,
  recoverySpec,
  recoveryStackDrift,
  withRecovery,
  type RecoveryChoice,
} from './doc.js';

const contract = (n: number) => StrKey.encodeContract(new Uint8Array(32).fill(n));
/** The stack the account enrolled with: every recovery address moved since. */
const EARLIER: PerchDeployment = {
  ...TESTNET,
  recoveryController: contract(40),
  zkPool: contract(41),
  zkAdapter: contract(42),
};
const GUARDIANS = [contract(1), contract(2)];
const zk = (n: number) => ({ enrollmentId: new Uint8Array(32).fill(n), commitment: new Uint8Array(32).fill(n + 1) });

const base = buildPolicyDoc({
  network: TESTNET.network,
  signers: [{ id: 'admin', kind: 'passkey', verifier: TESTNET.webauthnVerifier, publicKey: new Uint8Array(65).fill(7) }],
  permissions: [{ name: 'admin', on: 'self-admin', by: ['admin'] }],
});

function enrolled(choice: Partial<RecoveryChoice>) {
  return withRecovery(
    base,
    recoverySpec(EARLIER, {
      profile: 'protected',
      mode: 'combined',
      guardians: GUARDIANS,
      quorum: 2,
      zk: zk(5),
      replaceable: ['admin'],
      baselineDocHash: 'ab'.repeat(32),
      delayLedgers: 50,
      expiryLedgers: 500,
      maxCancels: 2,
      ...choice,
    }),
  );
}

describe('recoveryFromWire', () => {
  it('reads a member back as the spec that wrote it', () => {
    const spec = recoverySpec(EARLIER, {
      profile: 'loss',
      mode: 'combined',
      guardians: GUARDIANS,
      quorum: 1,
      zk: zk(5),
      replaceable: ['admin'],
      baselineDocHash: 'cd'.repeat(32),
    });
    expect(recoveryFromWire(withRecovery(base, spec).recovery!)).toEqual(spec);
  });
});

describe('recoveryStackDrift', () => {
  it('names what the deployment moved', () => {
    const doc = enrolled({});
    expect(recoveryStackDrift(TESTNET, recoveryFromWire(doc.recovery!))).toEqual({ controller: true, zk: true });
    expect(recoveryStackDrift(EARLIER, recoveryFromWire(doc.recovery!))).toEqual({ controller: false, zk: false });
    const guardians = enrolled({ mode: 'guardian-only', zk: undefined });
    expect(recoveryStackDrift(TESTNET, recoveryFromWire(guardians.recovery!))).toEqual({ controller: true, zk: false });
  });
});

describe('movedRecovery', () => {
  it('moves a guardian configuration to the deployment’s controller and nothing else', () => {
    const doc = enrolled({ mode: 'guardian-only', zk: undefined });
    const before = recoveryFromWire(doc.recovery!);
    const moved = movedRecovery(TESTNET, before);
    expect(moved).toEqual({ ...before, controller: TESTNET.recoveryController });
    expect(recoveryStackDrift(TESTNET, moved)).toEqual({ controller: false, zk: false });
    // A different configuration: under Protected, a reconfiguration the
    // controller it leaves must approve.
    expect(configHash(withRecovery(doc, moved))).not.toEqual(configHash(doc));
  });

  it('needs a new credential to move a ZK factor to another pool', () => {
    const before = recoveryFromWire(enrolled({}).recovery!);
    expect(() => movedRecovery(TESTNET, before)).toThrow(/needs a new recovery kit/);

    const moved = movedRecovery(TESTNET, before, zk(9));
    expect(moved.controller).toBe(TESTNET.recoveryController);
    expect(moved.mode).toEqual({
      kind: 'combined',
      guardians: GUARDIANS,
      quorum: 2,
      adapter: TESTNET.zkAdapter,
      circuitId: TESTNET.circuitId,
      pool: TESTNET.zkPool,
      enrollmentId: '09'.repeat(32),
      commitment: '0a'.repeat(32),
    });
    // Every setting the owner chose stays.
    const { mode: _m, controller: _c, ...kept } = moved;
    const { mode: _bm, controller: _bc, ...was } = before;
    expect(kept).toEqual(was);
  });

  it('keeps a ZK factor already on the deployment’s pool when only the controller moved', () => {
    const onlyController: PerchDeployment = { ...TESTNET, recoveryController: contract(40) };
    const doc = withRecovery(
      base,
      recoverySpec(onlyController, { profile: 'loss', mode: 'zk-only', zk: zk(5), replaceable: ['admin'] }),
    );
    const before = recoveryFromWire(doc.recovery!);
    expect(movedRecovery(TESTNET, before)).toEqual({ ...before, controller: TESTNET.recoveryController });
  });
});
