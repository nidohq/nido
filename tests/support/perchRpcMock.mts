import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Page, Route } from '@playwright/test';
import { Address, contract, Networks, scValToNative, SorobanDataBuilder, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { Client as AccountClient } from '@nidohq/perch-account';
import { Client as CompilerClient } from '@nidohq/perch-doc-compiler';
import { Client as RecoveryClient } from '@nidohq/perch-recovery';

/**
 * A browser page against the frontend built for a fixture Perch deployment
 * (`dist-perch`, built with `PUBLIC_PERCH_DEPLOYMENT` set to
 * tests/support/perch-fixture-deployment.json), with Soroban RPC answered
 * here: every contract view a page reads is a simulation, answered from
 * `views` and encoded with the contract's own spec, so the page decodes it
 * as it would a real answer. No chain, no server: the page's own origin is
 * served from the build directory.
 */

export const DIST_PERCH = join(process.cwd(), 'packages/frontend/dist-perch');
export const deployment = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/support/perch-fixture-deployment.json'), 'utf-8'),
) as {
  network: string;
  docCompiler: string;
  interpreter: string;
  spendingLimit: string;
  recoveryController: string;
  webauthnVerifier: string;
  zkPool: string;
  zkAdapter: string;
  circuitId: string;
};

const RPC_URL = 'https://soroban-testnet.stellar.org';
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** One contract invocation the page simulated. */
export interface Invocation {
  contract: string;
  fn: string;
  args: unknown[];
}

/** A view's answer, by `${contract}:${fn}`: a native value as the bindings
 *  return it, or a function of the call's native arguments. Return
 *  `undefined` from a function to answer with an RPC error. */
export type Views = Record<string, unknown | ((args: unknown[]) => unknown)>;

const opts = (contractId: string) => ({ contractId, networkPassphrase: Networks.TESTNET, rpcUrl: RPC_URL });

/** The spec of the contract at `id`: an account, unless it is one of the
 *  deployment's. */
function specOf(id: string): contract.Spec {
  if (id === deployment.recoveryController) return new RecoveryClient(opts(id)).spec;
  if (id === deployment.docCompiler) return new CompilerClient(opts(id)).spec;
  return new AccountClient(opts(id)).spec;
}

/** `value` as `fn`'s return value: a `Result` is its `Ok` value, as a
 *  simulation returns it. */
function encodeResult(spec: contract.Spec, fn: string, value: unknown): xdr.ScVal {
  let out = spec.getFunc(fn).outputs()[0];
  if (out === undefined) return xdr.ScVal.scvVoid();
  if (out.switch() === xdr.ScSpecType.scSpecTypeResult()) out = out.result().okType();
  return spec.nativeToScVal(value, out);
}

function invocationOf(txXdr: string): Invocation {
  const tx = TransactionBuilder.fromXDR(txXdr, Networks.TESTNET) as unknown as {
    operations: { func: xdr.HostFunction }[];
  };
  const call = tx.operations[0]!.func.invokeContract();
  const id = Address.fromScAddress(call.contractAddress()).toString();
  return {
    contract: id,
    fn: call.functionName().toString(),
    args: call.args().map((a) => scValToNative(a)),
  };
}

/**
 * Route `page`: its origin from the `dist-perch` build, Soroban RPC from
 * `views`, and nothing else. Every simulated invocation is pushed onto the
 * returned list, answered or not.
 */
export async function mockPerchChain(page: Page, views: Views): Promise<Invocation[]> {
  const seen: Invocation[] = [];
  const ledger = 1_000;
  await page.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.origin === RPC_URL) {
      const body = route.request().postDataJSON() as { id: number; method: string; params: Record<string, unknown> };
      const reply = (result: unknown) => route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result } });
      const fail = (message: string) =>
        route.fulfill({ json: { jsonrpc: '2.0', id: body.id, error: { code: -32600, message } } });
      if (body.method === 'getLatestLedger') return reply({ id: 'mock', protocolVersion: 23, sequence: ledger });
      if (body.method !== 'simulateTransaction') return fail(`unmocked ${body.method}`);
      const call = invocationOf(body.params.transaction as string);
      seen.push(call);
      const view = views[`${call.contract}:${call.fn}`];
      const value = typeof view === 'function' ? (view as (a: unknown[]) => unknown)(call.args) : view;
      if (value === undefined) return fail(`unmocked ${call.fn} at ${call.contract}`);
      return reply({
        latestLedger: ledger,
        minResourceFee: '100',
        transactionData: new SorobanDataBuilder().build().toXDR('base64'),
        results: [{ auth: [], xdr: encodeResult(specOf(call.contract), call.fn, value).toXDR('base64') }],
        cost: { cpuInsns: '0', memBytes: '0' },
      });
    }
    if (url.hostname.endsWith('localhost')) {
      let file = join(DIST_PERCH, decodeURIComponent(url.pathname));
      if (!extname(file)) file = join(file, 'index.html');
      if (!file.startsWith(DIST_PERCH)) return route.fulfill({ status: 404 });
      try {
        return await route.fulfill({ body: readFileSync(file), contentType: TYPES[extname(file)] ?? 'application/octet-stream' });
      } catch {
        return route.fulfill({ status: 404 });
      }
    }
    return route.abort();
  });
  return seen;
}

/** What an account's `configuration()`, `capabilities()`, `revision()` and
 *  `document()` answer, at revision 1 with `canonical` applied. */
export function accountViews(account: string, opts: { canonical?: string; rules?: unknown[] }): Views {
  return {
    [`${account}:configuration`]: {
      revision: 1n,
      doc_hash: undefined,
      gate: [],
      infra: { doc_compiler: deployment.docCompiler, interpreter: deployment.interpreter, spending_limit: deployment.spendingLimit },
      recovery_controller: deployment.recoveryController,
      recovery_generation: 0n,
      recovery_rule: undefined,
      rules: opts.rules ?? [],
    },
    [`${account}:capabilities`]: {
      apply_modes: [],
      auth_digest: 'oz_rule_ids',
      doc_identity: 'canon_v1',
      interface_version: 1,
      snapshot_version: 1,
    },
    [`${account}:revision`]: 1n,
    [`${account}:document`]: [1n, opts.canonical === undefined ? undefined : Buffer.from(opts.canonical, 'utf8')],
  };
}

/** The deployment's compiler limits and the controller's per-account reads. */
export function deploymentViews(): Views {
  return {
    [`${deployment.docCompiler}:limits`]: {
      tag: 'V1',
      values: [{ max_signers: 16, max_rules: 16, max_canonical_bytes: 65_536, max_rule_name_bytes: 64 }],
    },
    [`${deployment.recoveryController}:activity_gate`]: { authorized_attempt: undefined, frozen: false, until: 0 },
    [`${deployment.recoveryController}:epoch`]: 0n,
  };
}

/** A guardian rule on a guardian's own account: its admin signers allowed to
 *  act at the controller. */
export function guardianRule(): unknown {
  return {
    context_type: { tag: 'CallContract', values: [deployment.recoveryController] },
    id: 1,
    name: 'guardian',
    policies: [],
    recovery: false,
    signers: [],
    valid_until: undefined,
  };
}
