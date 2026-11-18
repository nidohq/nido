import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Route } from '@playwright/test';
import { Address, Keypair, Networks, SorobanDataBuilder, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { serveProduction } from './productionHeaders';

/**
 * Account setup end to end, on the wallet built for mainnet against a fixture
 * Perch deployment (`dist-mainnet`), with the chain and the relayer answered
 * here. Build it with:
 *
 *   PUBLIC_STELLAR_NETWORK=mainnet \
 *   PUBLIC_PERCH_DEPLOYMENT="$(cat tests/support/perch-fixture-deployment.mainnet.json)" \
 *   PUBLIC_RELAYER_URL=https://relayer.nido.test \
 *   PUBLIC_RELAYER_SIM_SOURCE=GD6ROJBYLKQMOW3E7N4M2YBPUHMZD7PL65VRHRMO24BOVSBV5H3BQRSL \
 *     npx astro build --root ./packages/frontend --outDir ./dist-mainnet
 *
 * The account the factory "creates" is the SDK's recorded new account
 * (packages/passkey-sdk/src/perch/testdata/new-account-reads.json, `created`),
 * whose configuration names the passkey this browser registers during setup:
 * the recorded admin key is swapped for the one `create_account` was given.
 * Nothing reaches a network; no transaction is ever signed by a real key.
 */

export const DIST_MAINNET = join(process.cwd(), 'packages/frontend/dist-mainnet');
export const APEX = 'nido.fyi';
export const RPC_URL = 'https://mainnet.sorobanrpc.com';
export const RELAYER_URL = 'https://relayer.nido.test';
export const SIM_SOURCE = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey();

export const reads = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/passkey-sdk/src/perch/testdata/new-account-reads.json'), 'utf8'),
) as {
  ownerKey: string;
  created: { account: string; configuration: string; instance: string };
};
const deployment = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/support/perch-fixture-deployment.mainnet.json'), 'utf8'),
) as { factory: string };

/** The address every setup in these tests reserves and creates. */
export const ACCOUNT = reads.created.account;
export const accountOrigin = (contractId: string) => `https://${contractId.toLowerCase()}.${APEX}`;

export interface SetupChainOptions {
  /** Hold the apex's storage bridge page this long before serving it. */
  bridgeDelayMs?: number;
  /** Make the relayer's `/fund` fail. */
  fundFails?: boolean;
  /** Accounts already deployed on the mocked chain, whatever passkey they
   *  hold (the recorded account's configuration). */
  deployed?: string[];
  /** Hold the first `getLedgerEntries` answer this long. */
  firstChainReadDelayMs?: number;
}

export interface SetupChain {
  /** How many times the apex's bridge page was requested. */
  bridgeLoads: number;
  /** While true, the apex's bridge page is never served (requests to it hang). */
  bridgeDown: boolean;
}

function invocation(txXdr: string) {
  const tx = TransactionBuilder.fromXDR(txXdr, Networks.PUBLIC) as unknown as {
    operations: { func: xdr.HostFunction }[];
  };
  const call = tx.operations[0]!.func.invokeContract();
  return {
    contract: Address.fromScAddress(call.contractAddress()).toString(),
    fn: call.functionName().toString(),
    args: call.args(),
  };
}

function classicAccountEntry(g: string) {
  const accountId = Keypair.fromPublicKey(g).xdrAccountId();
  return xdr.LedgerEntryData.account(
    new xdr.AccountEntry({
      accountId,
      balance: xdr.Int64.fromString('100000000000'),
      seqNum: xdr.Int64.fromString('1'),
      numSubEntries: 0,
      inflationDest: null,
      flags: 0,
      homeDomain: '',
      thresholds: Buffer.from([1, 0, 0, 0]),
      signers: [],
      ext: new xdr.AccountEntryExt(0),
    }),
  ).toXDR('base64');
}

/** The recorded configuration, with its admin passkey replaced by `key`. */
function configurationFor(key: Buffer): string {
  const config = Buffer.from(reads.created.configuration, 'base64');
  const owner = Buffer.from(reads.ownerKey, 'hex');
  const at = config.indexOf(owner);
  if (at < 0 || key.length !== owner.length) throw new Error('setupFlowMock: cannot place the admin key');
  key.copy(config, at);
  return config.toString('base64');
}

/**
 * Route `context` for a setup: `https://*.nido.fyi` from `dist-mainnet` with
 * production headers, the mainnet RPC and the relayer answered as a
 * successful setup would see them.
 */
export async function mockSetupChain(context: BrowserContext, opts: SetupChainOptions = {}): Promise<SetupChain> {
  const state: SetupChain = { bridgeLoads: 0, bridgeDown: false };
  const deployed = new Set(opts.deployed ?? []);
  let firstChainReadDelayMs = opts.firstChainReadDelayMs ?? 0;
  const adminKeys = new Map<string, Buffer>();
  const ledger = 1_000;

  await serveProduction(context, APEX, [], DIST_MAINNET);

  await context.route(`https://${APEX}/nido-storage-bridge/`, async (route: Route) => {
    state.bridgeLoads++;
    if (state.bridgeDown) return; // never answered: the request hangs
    if (opts.bridgeDelayMs) await new Promise((r) => setTimeout(r, opts.bridgeDelayMs));
    await route.fallback();
  });

  await context.route(`${RELAYER_URL}/**`, async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON() as { params?: Record<string, unknown> } | null;
    if (path === '/fund') {
      if (opts.fundFails) return route.fulfill({ status: 500, json: { success: false, error: 'funder unavailable' } });
      return route.fulfill({ json: { success: true, data: { hash: 'ab'.repeat(32), status: 'SUCCESS' } } });
    }
    if (path === '/relay' && body?.params?.getTransaction) {
      return route.fulfill({
        json: { success: true, data: { transactionId: 'tx-1', hash: 'cd'.repeat(32), status: 'confirmed' } },
      });
    }
    if (path === '/relay') {
      // create_account lands: the account now exists with the key it was given.
      deployed.add(ACCOUNT);
      return route.fulfill({ json: { success: true, data: { transactionId: 'tx-1', hash: null, status: 'pending' } } });
    }
    return route.fulfill({ status: 404, json: { success: false, error: 'not found' } });
  });

  await context.route(`${RPC_URL}/**`, async (route: Route) => {
    const body = route.request().postDataJSON() as { id: number; method: string; params: Record<string, unknown> };
    const reply = (result: unknown) => route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result } });
    const fail = (message: string) =>
      route.fulfill({ json: { jsonrpc: '2.0', id: body.id, error: { code: -32600, message } } });

    if (body.method === 'getLatestLedger') return reply({ id: 'mock', protocolVersion: 23, sequence: ledger });
    if (body.method === 'getLedgerEntries') {
      if (firstChainReadDelayMs) {
        const delay = firstChainReadDelayMs;
        firstChainReadDelayMs = 0;
        await new Promise((r) => setTimeout(r, delay));
      }
      const entries = (body.params.keys as string[]).flatMap((key) => {
        const k = xdr.LedgerKey.fromXDR(key, 'base64');
        if (k.switch() === xdr.LedgerEntryType.account()) {
          const g = Address.account(k.account().accountId().ed25519()).toString();
          return g === SIM_SOURCE ? [{ key, xdr: classicAccountEntry(g), lastModifiedLedgerSeq: 1 }] : [];
        }
        if (k.switch() === xdr.LedgerEntryType.contractData()) {
          const contract = Address.fromScAddress(k.contractData().contract()).toString();
          if (deployed.has(contract)) return [{ key, xdr: reads.created.instance, lastModifiedLedgerSeq: 1 }];
        }
        return [];
      });
      return reply({ entries, latestLedger: ledger });
    }
    if (body.method !== 'simulateTransaction') return fail(`unmocked ${body.method}`);

    const call = invocation(body.params.transaction as string);
    let retval: xdr.ScVal | undefined;
    if (call.contract === deployment.factory && call.fn === 'get_c_address') {
      retval = Address.fromString(ACCOUNT).toScVal();
    } else if (call.contract === deployment.factory && call.fn === 'create_account') {
      adminKeys.set(ACCOUNT, Buffer.from(call.args[1]!.bytes()));
      retval = xdr.ScVal.scvVoid();
    } else if (call.fn === 'configuration' && deployed.has(call.contract)) {
      const key = adminKeys.get(call.contract);
      retval = xdr.ScVal.fromXDR(key ? configurationFor(key) : reads.created.configuration, 'base64');
    }
    if (!retval) return fail(`unmocked ${call.fn} at ${call.contract}`);
    return reply({
      latestLedger: ledger,
      minResourceFee: '100',
      transactionData: new SorobanDataBuilder().build().toXDR('base64'),
      results: [{ auth: [], xdr: retval.toXDR('base64') }],
      cost: { cpuInsns: '0', memBytes: '0' },
    });
  });

  return state;
}
