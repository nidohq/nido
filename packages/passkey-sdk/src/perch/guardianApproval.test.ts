// A `G…` guardian's wallet signs the whole approval transaction, and every
// `SourceAccount` authorization in it is the guardian's. These envelopes are
// what a controller's simulation can hand the wallet: only the approval
// itself, for the reviewed digest and nothing beneath it, may be signed.

import { describe, expect, it } from 'vitest';
import {
  Account,
  Address,
  Asset,
  nativeToScVal,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { guardianApprovalProblem, type GuardianApproval } from './guardianApproval.js';

const GUARDIAN = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const ATTACKER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const CONTROLLER = StrKey.encodeContract(Buffer.alloc(32, 7));
const ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 8));
const SAC = new Asset('USDC', StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3))).contractId(Networks.TESTNET);
const DIGEST = new Uint8Array(32).fill(9);

const approval: GuardianApproval = { controller: CONTROLLER, fn: 'approve_change', digest: DIGEST };

function call(contract: string, fn: string, args: xdr.ScVal[]): xdr.InvokeContractArgs {
  return new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(contract).toScAddress(),
    functionName: fn,
    args,
  });
}

function invocation(c: xdr.InvokeContractArgs, nested: xdr.SorobanAuthorizedInvocation[] = []) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(c),
    subInvocations: nested,
  });
}

const sourceAuth = (root: xdr.SorobanAuthorizedInvocation) =>
  new xdr.SorobanAuthorizationEntry({ credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(), rootInvocation: root });

/** The controller's `approve_change` as the page builds it. */
const approveChange = call(CONTROLLER, 'approve_change', [
  nativeToScVal(ACCOUNT, { type: 'address' }),
  xdr.ScVal.scvVoid(),
  nativeToScVal(1_000, { type: 'u32' }),
  nativeToScVal(GUARDIAN, { type: 'address' }),
]);
/** What the guardian authorizes: `require_auth_for_args((digest,))`. */
const approvalCall = (digest = DIGEST, at = CONTROLLER) =>
  call(at, 'approve_change', [nativeToScVal(Buffer.from(digest), { type: 'bytes' })]);
/** The guardian's whole balance of a real Stellar Asset Contract, out. */
const transfer = call(SAC, 'transfer', [
  nativeToScVal(GUARDIAN, { type: 'address' }),
  nativeToScVal(ATTACKER, { type: 'address' }),
  nativeToScVal(100n, { type: 'i128' }),
]);

function envelope(
  ops: { func?: xdr.InvokeContractArgs; auth: xdr.SorobanAuthorizationEntry[]; source?: string }[],
  from = GUARDIAN,
): string {
  const builder = new TransactionBuilder(new Account(from, '1'), { fee: '100', networkPassphrase: Networks.TESTNET });
  for (const op of ops) {
    builder.addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(op.func ?? approveChange),
        auth: op.auth,
        source: op.source,
      }),
    );
  }
  return builder.setTimeout(60).build().toXDR();
}

describe("a G… guardian's approval envelope", () => {
  it('signs the approval of the reviewed digest, with nothing beneath it', () => {
    expect(guardianApprovalProblem(envelope([{ auth: [sourceAuth(invocation(approvalCall()))] }]), GUARDIAN, approval)).toBeUndefined();
  });

  it('refuses an approval that also authorizes a token transfer out of the guardian', () => {
    const attack = envelope([{ auth: [sourceAuth(invocation(approvalCall(), [invocation(transfer)]))] }]);
    expect(guardianApprovalProblem(attack, GUARDIAN, approval)).toMatch(
      new RegExp(`would also authorize a call in your name \\(transfer on ${SAC}\\)`),
    );
  });

  it('refuses a transfer authorized beside the approval', () => {
    const beside = envelope([{ auth: [sourceAuth(invocation(approvalCall())), sourceAuth(invocation(transfer))] }]);
    expect(guardianApprovalProblem(beside, GUARDIAN, approval)).toMatch(/asks for 2 authorizations, not one/);
  });

  it('refuses a second operation', () => {
    const two = envelope([
      { auth: [sourceAuth(invocation(approvalCall()))] },
      { func: transfer, auth: [sourceAuth(invocation(transfer))] },
    ]);
    expect(guardianApprovalProblem(two, GUARDIAN, approval)).toMatch(/holds 2 operations, not one/);
  });

  it('refuses a call that is not the approval at the controller shown', () => {
    const direct = envelope([{ func: transfer, auth: [sourceAuth(invocation(transfer))] }]);
    expect(guardianApprovalProblem(direct, GUARDIAN, approval)).toMatch(
      new RegExp(`does not call approve_change on the recovery controller ${CONTROLLER}`),
    );
    const elsewhere = envelope([{ auth: [sourceAuth(invocation(approvalCall(DIGEST, ACCOUNT)))] }]);
    expect(guardianApprovalProblem(elsewhere, GUARDIAN, approval)).toMatch(
      new RegExp(`would authorize approve_change on ${ACCOUNT} instead of the approval`),
    );
    expect(
      guardianApprovalProblem(envelope([{ auth: [sourceAuth(invocation(approvalCall()))] }]), GUARDIAN, {
        ...approval,
        fn: 'submit_guardian',
      }),
    ).toMatch(/does not call submit_guardian/);
  });

  it('refuses a digest other than the reviewed one', () => {
    const other = envelope([{ auth: [sourceAuth(invocation(approvalCall(new Uint8Array(32).fill(1))))] }]);
    expect(guardianApprovalProblem(other, GUARDIAN, approval)).toMatch(/different statement than the one shown/);
  });

  it('refuses an authorization the envelope signature does not cover', () => {
    const byAddress = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: Address.fromString(GUARDIAN).toScAddress(),
          nonce: xdr.Int64.fromString('1'),
          signatureExpirationLedger: 100,
          signature: xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: invocation(approvalCall()),
    });
    expect(guardianApprovalProblem(envelope([{ auth: [byAddress] }]), GUARDIAN, approval)).toMatch(
      /authorization other than your signature/,
    );
  });

  it("refuses a transaction that is not the guardian's own", () => {
    const auth = [sourceAuth(invocation(approvalCall()))];
    expect(guardianApprovalProblem(envelope([{ auth }], ATTACKER), GUARDIAN, approval)).toMatch(
      /is not from your account/,
    );
    expect(guardianApprovalProblem(envelope([{ auth, source: ATTACKER }]), GUARDIAN, approval)).toMatch(
      /names its own source account/,
    );
  });
});
