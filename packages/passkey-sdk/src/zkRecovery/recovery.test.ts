import { describe, it, expect } from 'vitest';
import { Buffer } from 'buffer';
import { StrKey, xdr } from '@stellar/stellar-sdk';
import { Client as ZkRecoveryClient } from '@nidohq/zk-recovery';
import { Client as SmartAccountClient } from '@nidohq/smart-account';
import {
  buildInitiateRecovery,
  buildCancelRecovery,
  buildBurnNullifier,
  buildCompleteRecovery,
} from './recovery.js';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
// Dummy contract ids -- only used to embed a bindings `Client` for its
// static `.spec`, never for any RPC call (these tests never touch a network).
const CONTROLLER_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const ACCOUNT_ID = StrKey.encodeContract(Buffer.alloc(32, 2));
const WEBAUTHN_VERIFIER_ID = StrKey.encodeContract(Buffer.alloc(32, 3));

const zkRecoverySpec = new ZkRecoveryClient({
  contractId: CONTROLLER_ID,
  networkPassphrase: TESTNET_PASSPHRASE,
  rpcUrl: 'https://soroban-testnet.stellar.org',
}).spec;

const smartAccountSpec = new SmartAccountClient({
  contractId: ACCOUNT_ID,
  networkPassphrase: TESTNET_PASSPHRASE,
  rpcUrl: 'https://soroban-testnet.stellar.org',
}).spec;

function invokeArgs(op: xdr.Operation): xdr.ScVal[] {
  expect(op.body().switch().name).toBe('invokeHostFunction');
  const hostFn = op.body().invokeHostFunctionOp().hostFunction();
  expect(hostFn.switch().name).toBe('hostFunctionTypeInvokeContract');
  return hostFn.invokeContract().args();
}

function fnName(op: xdr.Operation): string {
  return op
    .body()
    .invokeHostFunctionOp()
    .hostFunction()
    .invokeContract()
    .functionName()
    .toString();
}

const newPubkey65 = Buffer.alloc(65, 7);
const root = Buffer.alloc(32, 8);
const nullifier = Buffer.alloc(32, 9);
const proof = Buffer.alloc(20, 10);
const nonce = 4n;
const timelockSecs = 1209600; // 14 days

describe('buildInitiateRecovery', () => {
  it('produces one invoke op named initiate_recovery whose args round-trip', () => {
    const result = buildInitiateRecovery({
      controllerId: CONTROLLER_ID,
      account: ACCOUNT_ID,
      newPubkey65,
      nonce,
      timelockSecs,
      root,
      nullifier,
      proof,
    });

    expect(result.operations).toHaveLength(1);
    const [op] = result.operations;
    expect(fnName(op)).toBe('initiate_recovery');

    const args = invokeArgs(op);
    expect(args.every((v) => v instanceof xdr.ScVal)).toBe(true);

    const fn = zkRecoverySpec.getFunc('initiate_recovery');
    const inputs = fn.inputs();
    const native: Record<string, unknown> = {};
    inputs.forEach((input, i) => {
      native[input.name().toString()] = zkRecoverySpec.scValToNative(args[i], input.type());
    });

    expect(native.account).toBe(ACCOUNT_ID);
    expect(Buffer.from(native.new_pubkey as Buffer).equals(newPubkey65)).toBe(true);
    expect(native.nonce).toBe(nonce);
    expect(native.timelock_secs).toBe(timelockSecs);
    expect(Buffer.from(native.root as Buffer).equals(root)).toBe(true);
    expect(Buffer.from(native.nullifier as Buffer).equals(nullifier)).toBe(true);
    expect(Buffer.from(native.proof as Buffer).equals(proof)).toBe(true);
  });

  it('rejects a new pubkey that is not 65 bytes', () => {
    expect(() =>
      buildInitiateRecovery({
        controllerId: CONTROLLER_ID,
        account: ACCOUNT_ID,
        newPubkey65: Buffer.alloc(64, 7),
        nonce,
        timelockSecs,
        root,
        nullifier,
        proof,
      }),
    ).toThrow(/65/);
  });
});

describe('buildCancelRecovery', () => {
  it('produces one invoke op named cancel_recovery whose args round-trip', () => {
    const result = buildCancelRecovery({
      controllerId: CONTROLLER_ID,
      account: ACCOUNT_ID,
      nonce,
      root,
      nullifier,
      proof,
    });

    expect(result.operations).toHaveLength(1);
    const [op] = result.operations;
    expect(fnName(op)).toBe('cancel_recovery');

    const args = invokeArgs(op);
    const fn = zkRecoverySpec.getFunc('cancel_recovery');
    const inputs = fn.inputs();
    const native: Record<string, unknown> = {};
    inputs.forEach((input, i) => {
      native[input.name().toString()] = zkRecoverySpec.scValToNative(args[i], input.type());
    });

    expect(native.account).toBe(ACCOUNT_ID);
    expect(native.nonce).toBe(nonce);
    expect(Buffer.from(native.root as Buffer).equals(root)).toBe(true);
    expect(Buffer.from(native.nullifier as Buffer).equals(nullifier)).toBe(true);
    expect(Buffer.from(native.proof as Buffer).equals(proof)).toBe(true);
  });
});

describe('buildBurnNullifier', () => {
  it('produces one invoke op named burn_nullifier whose args round-trip', () => {
    const result = buildBurnNullifier({
      controllerId: CONTROLLER_ID,
      account: ACCOUNT_ID,
      nonce,
      root,
      nullifier,
      proof,
    });

    expect(result.operations).toHaveLength(1);
    const [op] = result.operations;
    expect(fnName(op)).toBe('burn_nullifier');

    const args = invokeArgs(op);
    const fn = zkRecoverySpec.getFunc('burn_nullifier');
    const inputs = fn.inputs();
    const native: Record<string, unknown> = {};
    inputs.forEach((input, i) => {
      native[input.name().toString()] = zkRecoverySpec.scValToNative(args[i], input.type());
    });

    expect(native.account).toBe(ACCOUNT_ID);
    expect(native.nonce).toBe(nonce);
    expect(Buffer.from(native.root as Buffer).equals(root)).toBe(true);
    expect(Buffer.from(native.nullifier as Buffer).equals(nullifier)).toBe(true);
    expect(Buffer.from(native.proof as Buffer).equals(proof)).toBe(true);
  });
});

describe('buildCompleteRecovery', () => {
  const recoveryRuleId = 3;

  it('produces an add_context_rule op naming the new rule "recovered" with a single External signer', () => {
    const result = buildCompleteRecovery({
      account: ACCOUNT_ID,
      recoveryRuleId,
      newPubkey65,
      webauthnVerifierId: WEBAUTHN_VERIFIER_ID,
    });

    expect(result.operations).toHaveLength(1);
    const [op] = result.operations;
    expect(fnName(op)).toBe('add_context_rule');
    expect(result.contextRuleIds).toEqual([recoveryRuleId]);

    const args = invokeArgs(op);
    const fn = smartAccountSpec.getFunc('add_context_rule');
    const inputs = fn.inputs();
    const native: Record<string, unknown> = {};
    inputs.forEach((input, i) => {
      native[input.name().toString()] = smartAccountSpec.scValToNative(args[i], input.type());
    });

    expect(native.context_type).toEqual({ tag: 'Default', values: undefined });
    expect(native.name).toBe('recovered');
    expect(native.valid_until).toBeNull();

    const signers = native.signers as Array<{ tag: string; values: [string, Buffer] }>;
    expect(signers).toHaveLength(1);
    expect(signers[0].tag).toBe('External');
    expect(signers[0].values[0]).toBe(WEBAUTHN_VERIFIER_ID);
    expect(Buffer.from(signers[0].values[1]).equals(newPubkey65)).toBe(true);

    // policies map must be empty.
    expect(Array.from(native.policies as Iterable<unknown>)).toHaveLength(0);
  });

  it('carries a zero-signer AuthPayload selecting only the recovery rule', () => {
    const result = buildCompleteRecovery({
      account: ACCOUNT_ID,
      recoveryRuleId,
      newPubkey65,
      webauthnVerifierId: WEBAUTHN_VERIFIER_ID,
    });

    // Mirror exactly what the downstream signing flow builds: an AuthPayload
    // with NO signers, selecting only `contextRuleIds` from this TxBuild.
    // Round-tripping it through the smart-account bindings' own Spec proves
    // (a) the shape is valid per the real contract interface, and (b) the
    // zero-signer semantics survive encode/decode.
    const authPayloadTy = xdr.ScSpecTypeDef.scSpecTypeUdt(
      new xdr.ScSpecTypeUdt({ name: 'AuthPayload' }),
    );
    const native = { signers: new Map(), context_rule_ids: result.contextRuleIds };
    const scv = smartAccountSpec.nativeToScVal(native, authPayloadTy);
    expect(scv instanceof xdr.ScVal).toBe(true);

    const decoded = smartAccountSpec.scValToNative<{
      signers: unknown[];
      context_rule_ids: number[];
    }>(scv, authPayloadTy);
    expect(Array.from(decoded.signers as Iterable<unknown>)).toHaveLength(0);
    expect(decoded.context_rule_ids).toEqual([recoveryRuleId]);
  });

  it('rejects a new pubkey that is not 65 bytes', () => {
    expect(() =>
      buildCompleteRecovery({
        account: ACCOUNT_ID,
        recoveryRuleId,
        newPubkey65: Buffer.alloc(64, 7),
        webauthnVerifierId: WEBAUTHN_VERIFIER_ID,
      }),
    ).toThrow(/65/);
  });
});
