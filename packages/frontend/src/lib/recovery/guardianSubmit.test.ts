// `submitGuardianOp` (`../recoverySubmit.ts`): a `G…` guardian signs the
// whole approval transaction, and the controller writes its authorization
// tree when it is simulated. The wallet is handed the envelope only when that
// tree is exactly the reviewed approval. (Beside the guardian page so the
// recovery pages' CI step runs it.)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Address,
  Asset,
  nativeToScVal,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk';
import type { perch } from '@nidohq/passkey-sdk';

const rpcState = vi.hoisted(() => ({
  /** The guardian authorization the controller's simulation reports. */
  auth: [] as unknown[],
  simulated: [] as unknown[],
  sent: [] as unknown[],
}));

vi.mock('@stellar/stellar-sdk', async (orig) => {
  const sdk = await orig<typeof import('@stellar/stellar-sdk')>();
  class Server {
    async getAccount(id: string) {
      return new sdk.Account(id, '1');
    }
    async simulateTransaction(tx: unknown) {
      rpcState.simulated.push(tx);
      return sdk.rpc.parseRawSimulation({
        id: '1',
        latestLedger: 100,
        minResourceFee: '100',
        transactionData: new sdk.SorobanDataBuilder().build().toXDR('base64'),
        results: [
          { auth: (rpcState.auth as xdr.SorobanAuthorizationEntry[]).map((a) => a.toXDR('base64')), xdr: sdk.xdr.ScVal.scvVoid().toXDR('base64') },
        ],
      } as never);
    }
    async sendTransaction(tx: unknown) {
      rpcState.sent.push(tx);
      return { status: 'PENDING', hash: 'f'.repeat(64) };
    }
    async getTransaction() {
      return { status: 'SUCCESS' };
    }
  }
  return { ...sdk, rpc: { ...sdk.rpc, Server } };
});
vi.mock('../network.js', () => ({
  RPC_URL: 'http://rpc.invalid',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
}));
vi.mock('../primaryPasskeySigner.js', () => ({ getSubmitter: vi.fn() }));
vi.mock('../walletConnect.js', () => ({
  signTransaction: vi.fn(async (envelope: string) => ({ signedTxXdr: envelope })),
}));

import { submitGuardianOp } from '../recoverySubmit.js';
import { signTransaction } from '../walletConnect.js';

const GUARDIAN = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const ATTACKER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const CONTROLLER = StrKey.encodeContract(Buffer.alloc(32, 7));
const ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 8));
const SAC = new Asset('USDC', StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3))).contractId(Networks.TESTNET);
const DIGEST = new Uint8Array(32).fill(9);
const approval: perch.GuardianApproval = { controller: CONTROLLER, fn: 'approve_change', digest: DIGEST };

function call(contract: string, fn: string, args: xdr.ScVal[]): xdr.InvokeContractArgs {
  return new xdr.InvokeContractArgs({ contractAddress: Address.fromString(contract).toScAddress(), functionName: fn, args });
}
const invocation = (c: xdr.InvokeContractArgs, nested: xdr.SorobanAuthorizedInvocation[] = []) =>
  new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(c),
    subInvocations: nested,
  });
const sourceAuth = (root: xdr.SorobanAuthorizedInvocation) =>
  new xdr.SorobanAuthorizationEntry({ credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(), rootInvocation: root });

/** `require_auth_for_args((digest,))` at the controller's `approve_change`. */
const approved = call(CONTROLLER, 'approve_change', [nativeToScVal(Buffer.from(DIGEST), { type: 'bytes' })]);
const transfer = call(SAC, 'transfer', [
  nativeToScVal(GUARDIAN, { type: 'address' }),
  nativeToScVal(ATTACKER, { type: 'address' }),
  nativeToScVal(100n, { type: 'i128' }),
]);

/** The operation as the binding leaves it: its own simulation ran from a
 *  placeholder source, so the guardian's entry carries address credentials. */
function bindingOperation(): xdr.Operation {
  const approveChange = call(CONTROLLER, 'approve_change', [
    nativeToScVal(ACCOUNT, { type: 'address' }),
    xdr.ScVal.scvVoid(),
    nativeToScVal(1_000, { type: 'u32' }),
    nativeToScVal(GUARDIAN, { type: 'address' }),
  ]);
  const byAddress = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(GUARDIAN).toScAddress(),
        nonce: xdr.Int64.fromString('5'),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: invocation(approved),
  });
  return Operation.invokeHostFunction({ func: xdr.HostFunction.hostFunctionTypeInvokeContract(approveChange), auth: [byAddress] });
}

const authOf = (envelope: string) =>
  (TransactionBuilder.fromXDR(envelope, Networks.TESTNET) as Transaction).operations[0] as Operation.InvokeHostFunction;

beforeEach(() => {
  vi.clearAllMocks();
  rpcState.simulated = [];
  rpcState.sent = [];
});

describe("a G… guardian's approval", () => {
  it('signs the approval of the reviewed digest, recorded with the guardian as source', async () => {
    rpcState.auth = [sourceAuth(invocation(approved))];
    await expect(submitGuardianOp(bindingOperation(), GUARDIAN, approval)).resolves.toEqual({ hash: 'f'.repeat(64) });

    // Simulated afresh, without the binding's entry.
    expect(((rpcState.simulated[0] as Transaction).operations[0] as Operation.InvokeHostFunction).auth).toEqual([]);
    expect(signTransaction).toHaveBeenCalledTimes(1);
    const [envelope, opts] = vi.mocked(signTransaction).mock.calls[0]!;
    expect(opts).toEqual({ networkPassphrase: Networks.TESTNET, address: GUARDIAN });
    const auth = authOf(envelope).auth!;
    expect(auth.map((a) => a.toXDR('base64'))).toEqual([sourceAuth(invocation(approved)).toXDR('base64')]);
    expect(rpcState.sent).toHaveLength(1);
  });

  it('never hands the wallet an approval that also moves the guardian’s tokens', async () => {
    // A controller whose `approve_change` also calls a Stellar Asset
    // Contract's `transfer` out of the guardian: the source account's
    // authorization covers it unless refused.
    rpcState.auth = [sourceAuth(invocation(approved, [invocation(transfer)]))];
    await expect(submitGuardianOp(bindingOperation(), GUARDIAN, approval)).rejects.toThrow(
      `would also authorize a call in your name (transfer on ${SAC})`,
    );
    expect(signTransaction).not.toHaveBeenCalled();
    expect(rpcState.sent).toHaveLength(0);
  });

  it('never hands the wallet a transfer authorized beside the approval', async () => {
    rpcState.auth = [sourceAuth(invocation(approved)), sourceAuth(invocation(transfer))];
    await expect(submitGuardianOp(bindingOperation(), GUARDIAN, approval)).rejects.toThrow(
      'asks for 2 authorizations, not one',
    );
    expect(signTransaction).not.toHaveBeenCalled();
  });
});
