import { describe, it, expect } from 'vitest';
import { StrKey, Buffer as _Buffer } from '@stellar/stellar-sdk';
import {
  planRotation,
  describeRotation,
  type RotationPlan,
} from './multisigRotation.js';

const VERIFIER = StrKey.encodeContract(new Uint8Array(32).fill(0x56));
const MULTISIG_POLICY = StrKey.encodeContract(new Uint8Array(32).fill(0x77));

function newPubkey(): Uint8Array {
  const p = new Uint8Array(65);
  p[0] = 0x04;
  p[1] = 0x99;
  return p;
}

describe('planRotation', () => {
  it('emits an add_signer call for a new passkey', () => {
    const plan = planRotation({
      defaultRuleId: 0,
      addPasskey: { verifierAddress: VERIFIER, publicKey: newPubkey() },
    });
    expect(plan.calls.length).toBe(1);
    const c = plan.calls[0];
    expect(c.method).toBe('add_signer');
    expect(c.contextRuleId).toBe(0);
    expect(c.signer.tag).toBe('External');
    expect(c.signer.values[0]).toBe(VERIFIER);
  });

  it('emits a remove_signer call for an old signer id', () => {
    const plan = planRotation({
      defaultRuleId: 0,
      removeSignerId: 3,
    });
    expect(plan.calls.length).toBe(1);
    expect(plan.calls[0].method).toBe('remove_signer');
    expect(plan.calls[0].signerId).toBe(3);
  });

  it('emits an add_policy call for default-rule threshold repair', () => {
    const plan = planRotation({
      defaultRuleId: 0,
      installDefaultThreshold: { policyAddress: MULTISIG_POLICY },
    });
    expect(plan.calls.length).toBe(1);
    const c = plan.calls[0];
    expect(c.method).toBe('add_policy');
    expect(c.contextRuleId).toBe(0);
    expect(c.policyAddress).toBe(MULTISIG_POLICY);
    const entries = c.installParam.map();
    expect(entries?.[0].key().sym().toString()).toBe('threshold');
    expect(entries?.[0].val().u32()).toBe(1);
  });

  it('rejects invalid threshold repair params', () => {
    expect(() =>
      planRotation({
        defaultRuleId: 0,
        installDefaultThreshold: { policyAddress: MULTISIG_POLICY, threshold: 0 },
      }),
    ).toThrow(/positive integer/);
  });

  it('emits both add and remove when rotating', () => {
    const plan = planRotation({
      defaultRuleId: 0,
      addPasskey: { verifierAddress: VERIFIER, publicKey: newPubkey() },
      removeSignerId: 5,
    });
    expect(plan.calls.map((c) => c.method)).toEqual(['add_signer', 'remove_signer']);
  });

  it('throws when neither add nor remove is requested', () => {
    expect(() => planRotation({ defaultRuleId: 0 })).toThrow(/nothing to rotate/i);
  });

  it('rejects a public key that is not 65 SEC1 bytes', () => {
    expect(() =>
      planRotation({
        defaultRuleId: 0,
        addPasskey: { verifierAddress: VERIFIER, publicKey: new Uint8Array(33) },
      }),
    ).toThrow(/65/);
  });
});

describe('describeRotation', () => {
  it('describes adding a key', () => {
    const plan: RotationPlan = planRotation({
      defaultRuleId: 0,
      addPasskey: { verifierAddress: VERIFIER, publicKey: newPubkey() },
    });
    expect(describeRotation(plan)).toMatch(/add/i);
  });

  it('describes a full rotation', () => {
    const plan = planRotation({
      defaultRuleId: 0,
      addPasskey: { verifierAddress: VERIFIER, publicKey: newPubkey() },
      removeSignerId: 2,
    });
    const d = describeRotation(plan);
    expect(d).toMatch(/add/i);
    expect(d).toMatch(/remove/i);
  });

  it('describes threshold repair', () => {
    const plan = planRotation({
      defaultRuleId: 0,
      installDefaultThreshold: { policyAddress: MULTISIG_POLICY },
    });
    expect(describeRotation(plan)).toMatch(/1-of-N default-rule/i);
  });
});
