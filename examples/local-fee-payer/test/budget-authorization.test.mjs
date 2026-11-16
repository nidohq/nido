import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'buffer';
import { Account, Address, Keypair, SorobanDataBuilder, StrKey, xdr } from '@stellar/stellar-sdk';
import { fakeAuthenticator } from './fixtures.mjs';
import { NETWORK } from '../src/stellar.mjs';
import { authorizeBudgetAction } from '../src/budget-authorization.mjs';

const contract = n => StrKey.encodeContract(Buffer.alloc(32, n));
const profile = { account: contract(11), executor: contract(12), verifier: contract(13), u: Keypair.random().publicKey(), expires: 900000 };
const RPC_NONCE = 42n;
const sym = s => xdr.ScVal.scvSymbol(s);

const invocation = (args, subInvocations = []) => new xdr.SorobanAuthorizedInvocation({ subInvocations,
  function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args) });
const executeArgs = (target, action) => new xdr.InvokeContractArgs({ contractAddress: new Address(profile.account).toScAddress(),
  functionName: 'execute', args: [new Address(target).toScVal(), sym(action), xdr.ScVal.scvVec([])] });
const recorded = root => new xdr.SorobanAuthorizationEntry({ rootInvocation: root,
  credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
    address: new Address(profile.account).toScAddress(), nonce: RPC_NONCE, signatureExpirationLedger: 0, signature: xdr.ScVal.scvVoid() })) });

// A stand-in RPC. `substitute` rewrites the root invocation of the recorded C entry.
function stubChain(substitute = root => root) {
  const calls = [];
  const sim = auth => ({ id: '1', latestLedger: 1000, minResourceFee: '100', events: [], _parsed: true,
    transactionData: new SorobanDataBuilder(), result: { auth, retval: xdr.ScVal.scvVoid() } });
  return { calls,
    async getAccount(source) { return new Account(source, '1'); },
    async getLatestLedger() { return { sequence: 1000 }; },
    async simulateTransaction(tx, _resources, mode) {
      const op = tx.operations[0];
      calls.push({ mode, auth: op.auth.map(entry => entry.toXdr('base64')) });
      if (mode === 'enforce') return sim(op.auth);
      return sim([recorded(substitute(invocation(op.func.invokeContract)))]);
    } };
}

async function attempt(chain) {
  const auth = await fakeAuthenticator();
  const approvals = [];
  const approve = async challenge => { approvals.push(challenge); return { assertion: await auth.assertion(challenge), publicKey: auth.publicKey }; };
  const run = authorizeBudgetAction({ chain, profile, action: 'refill', ruleIds: [0], network: NETWORK, approve });
  return { run, approvals };
}

test('an honest RPC gets the requested action authorized and preflighted', async () => {
  const chain = stubChain();
  const { run, approvals } = await attempt(chain);
  const { tx } = await run;
  assert.equal(approvals.length, 1);
  assert.deepEqual(chain.calls.map(call => call.mode), ['record', 'enforce']);
  const [entry] = tx.operations[0].auth;
  assert.equal(entry.rootInvocation.toXdr('base64'), invocation(executeArgs(profile.executor, 'refill')).toXdr('base64'));
});

for (const [name, substitute] of [
  ['a different call', () => invocation(executeArgs(contract(14), 'status'))],
  ['an added sub-invocation', root => invocation(root.function.contractFn, [invocation(executeArgs(contract(14), 'status'))])],
]) test(`an RPC that records ${name} gets no passkey prompt and no signed entry`, async () => {
  const chain = stubChain(substitute);
  const { run, approvals } = await attempt(chain);
  await assert.rejects(run, /Nothing was signed/);
  assert.equal(approvals.length, 0);
  assert.deepEqual(chain.calls.map(call => call.mode), ['record']);
});

test('the signed entry carries a wallet-chosen nonce, not the RPC-recorded one', async () => {
  const chain = stubChain();
  const { run } = await attempt(chain);
  const [entry] = (await run).tx.operations[0].auth;
  assert.notEqual(entry.credentials.address.nonce, RPC_NONCE);
});
