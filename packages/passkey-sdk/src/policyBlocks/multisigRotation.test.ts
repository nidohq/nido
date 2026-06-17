import { describe, it, expect } from 'vitest';
import { StrKey, Buffer as _Buffer, xdr } from '@stellar/stellar-sdk';
import {
  planRotation,
  describeRotation,
  thresholdInstallParam,
  type RotationPlan,
} from './multisigRotation.js';

const VERIFIER = StrKey.encodeContract(new Uint8Array(32).fill(0x56));
const POLICY = StrKey.encodeContract(new Uint8Array(32).fill(0x77));

function newPubkey(): Uint8Array {
  const p = new Uint8Array(65);
  p[0] = 0x04;
  p[1] = 0x99;
  return p;
}

describe('thresholdInstallParam (#72 dual-SDK fix)', () => {
  // The spec-built ScVal must be byte-identical to the old hand-built
  // scvMap{ threshold: u32 } so on-chain decode into SimpleThresholdAccountParams
  // is unchanged. The fix only changes WHICH stellar-base copy builds it.
  it('encodes identically to the hand-built scvMap{threshold:u32}', () => {
    const expected = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('threshold'),
        val: xdr.ScVal.scvU32(1),
      }),
    ]);
    expect(thresholdInstallParam(1).toXDR('base64')).toBe(expected.toXDR('base64'));
  });

  it('round-trips the threshold value', () => {
    const sc = thresholdInstallParam(3);
    expect(sc.toXDR('base64')).toBe(
      xdr.ScVal
        .scvMap([
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('threshold'),
            val: xdr.ScVal.scvU32(3),
          }),
        ])
        .toXDR('base64'),
    );
  });
});

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

describe('planRotation threshold-policy auto-install (#87)', () => {
  it('installs a 1-of-N policy BEFORE add_signer when the add leaves a policy-less rule N-of-N', () => {
    const plan = planRotation({
      defaultRuleId: 0,
      addPasskey: { verifierAddress: VERIFIER, publicKey: newPubkey() },
      ruleState: { signerCount: 1, policyCount: 0 },
      thresholdPolicyAddress: POLICY,
    });
    expect(plan.calls.map((c) => c.method)).toEqual(['add_policy', 'add_signer']);
    const policyCall = plan.calls[0];
    if (policyCall.method !== 'add_policy') throw new Error('expected add_policy');
    expect(policyCall.contextRuleId).toBe(0);
    expect(policyCall.policyAddress).toBe(POLICY);
    expect(policyCall.threshold).toBe(1);
  });

  it('emits no policy call when the rule already has a policy', () => {
    const plan = planRotation({
      defaultRuleId: 0,
      addPasskey: { verifierAddress: VERIFIER, publicKey: newPubkey() },
      ruleState: { signerCount: 1, policyCount: 1 },
      thresholdPolicyAddress: POLICY,
    });
    expect(plan.calls.map((c) => c.method)).toEqual(['add_signer']);
  });

  it('emits no policy call when the rotation leaves a single signer', () => {
    // add + remove on a 1-signer rule: 1 + 1 - 1 = 1 → no policy needed.
    const plan = planRotation({
      defaultRuleId: 0,
      addPasskey: { verifierAddress: VERIFIER, publicKey: newPubkey() },
      removeSignerId: 0,
      ruleState: { signerCount: 1, policyCount: 0 },
      thresholdPolicyAddress: POLICY,
    });
    expect(plan.calls.map((c) => c.method)).toEqual(['add_signer', 'remove_signer']);
  });

  it('leaves an existing policy in place when removing back down to one signer', () => {
    const plan = planRotation({
      defaultRuleId: 0,
      removeSignerId: 3,
      ruleState: { signerCount: 2, policyCount: 1 },
      thresholdPolicyAddress: POLICY,
    });
    expect(plan.calls.map((c) => c.method)).toEqual(['remove_signer']);
  });

  it('plans a repair-only add_policy for an already-bricked rule', () => {
    // No add, no remove — but the rule is multi-signer with no policy
    // (the #87 brick). The plan is the lone policy install.
    const plan = planRotation({
      defaultRuleId: 0,
      ruleState: { signerCount: 2, policyCount: 0 },
      thresholdPolicyAddress: POLICY,
    });
    expect(plan.calls.map((c) => c.method)).toEqual(['add_policy']);
  });

  it('still throws "nothing to rotate" when the rule is healthy and nothing is requested', () => {
    expect(() =>
      planRotation({
        defaultRuleId: 0,
        ruleState: { signerCount: 1, policyCount: 0 },
        thresholdPolicyAddress: POLICY,
      }),
    ).toThrow(/nothing to rotate/i);
  });

  it('emits no policy call when rule state is not provided (legacy behavior)', () => {
    const plan = planRotation({
      defaultRuleId: 0,
      addPasskey: { verifierAddress: VERIFIER, publicKey: newPubkey() },
    });
    expect(plan.calls.map((c) => c.method)).toEqual(['add_signer']);
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
});
