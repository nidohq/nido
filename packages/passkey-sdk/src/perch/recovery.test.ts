import { describe, expect, it } from 'vitest';
import { Address, StrKey, scValToNative, xdr } from '@stellar/stellar-sdk';
import { buildAuthPayload } from '@stellar-registry/perch';
import { completionOperation } from './recovery';

const account = StrKey.encodeContract(Buffer.alloc(32, 7));
const selection = { account, revision: 7n, ruleIds: [3] };

describe('completionOperation', () => {
  it('carries the recovery-rule auth entry for exactly apply_doc(target, 0, Some(revision))', () => {
    const op = completionOperation(account, '{"v":1}', selection, 1000, 42n);
    const invoke = op.body().invokeHostFunctionOp();
    const call = invoke.hostFunction().invokeContract();
    expect(Address.fromScAddress(call.contractAddress()).toString()).toBe(account);
    expect(call.functionName().toString()).toBe('apply_doc');
    const [doc, until, revision] = call.args().map((a) => scValToNative(a));
    expect(call.args()).toHaveLength(3);
    expect(Buffer.from(doc).toString()).toBe('{"v":1}');
    expect(until).toBe(0);
    // The revision the target was derived at: the completion runs only there.
    expect(revision).toBe(7n);

    const [entry] = invoke.auth();
    const creds = entry!.credentials().address();
    expect(Address.fromScAddress(creds.address()).toString()).toBe(account);
    expect(creds.nonce().toString()).toBe('42');
    expect(scValToNative(creds.signature())).toEqual({ context_rule_ids: [3], signers: {} });
    // perch-js's AuthPayload for the selection, signer-free.
    expect(creds.signature().toXDR('hex')).toBe(Buffer.from(buildAuthPayload(selection, [])).toString('hex'));
    // The root invocation is the call itself, nothing more.
    const root = entry!.rootInvocation();
    expect(root.function().contractFn().toXDR('hex')).toBe(call.toXDR('hex'));
    expect(root.subInvocations()).toEqual([]);
  });

  it('draws a fresh non-negative nonce each time', () => {
    const nonce = (op: xdr.Operation) =>
      BigInt(op.body().invokeHostFunctionOp().auth()[0]!.credentials().address().nonce().toString());
    const a = nonce(completionOperation(account, '{}', selection, 1));
    const b = nonce(completionOperation(account, '{}', selection, 1));
    expect(a).not.toBe(b);
    expect(a >= 0n && b >= 0n).toBe(true);
  });

  it('refuses a selection made for another account', () => {
    const other = StrKey.encodeContract(Buffer.alloc(32, 8));
    expect(() => completionOperation(other, '{}', selection, 1)).toThrow(/selection is for/);
  });
});
