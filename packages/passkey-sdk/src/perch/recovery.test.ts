import { describe, expect, it } from 'vitest';
import { Address, StrKey, scValToNative, xdr } from '@stellar/stellar-sdk';
import { completionOperation } from './recovery';

const account = StrKey.encodeContract(Buffer.alloc(32, 7));

describe('completionOperation', () => {
  it('carries the recovery-rule auth entry for exactly apply_doc(target, 0)', () => {
    const op = completionOperation(account, '{"v":1}', 3, 1000, 42n);
    const invoke = op.body().invokeHostFunctionOp();
    const call = invoke.hostFunction().invokeContract();
    expect(Address.fromScAddress(call.contractAddress()).toString()).toBe(account);
    expect(call.functionName().toString()).toBe('apply_doc');
    const [doc, until] = call.args().map((a) => scValToNative(a));
    expect(Buffer.from(doc).toString()).toBe('{"v":1}');
    expect(until).toBe(0);

    const [entry] = invoke.auth();
    const creds = entry!.credentials().address();
    expect(Address.fromScAddress(creds.address()).toString()).toBe(account);
    expect(creds.nonce().toString()).toBe('42');
    expect(scValToNative(creds.signature())).toEqual({ context_rule_ids: [3], signers: {} });
    // The root invocation is the call itself, nothing more.
    const root = entry!.rootInvocation();
    expect(root.function().contractFn().toXDR('hex')).toBe(call.toXDR('hex'));
    expect(root.subInvocations()).toEqual([]);
  });

  it('draws a fresh non-negative nonce each time', () => {
    const nonce = (op: xdr.Operation) =>
      BigInt(op.body().invokeHostFunctionOp().auth()[0]!.credentials().address().nonce().toString());
    const a = nonce(completionOperation(account, '{}', 0, 1));
    const b = nonce(completionOperation(account, '{}', 0, 1));
    expect(a).not.toBe(b);
    expect(a >= 0n && b >= 0n).toBe(true);
  });
});
