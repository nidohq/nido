/**
 * FAST-lane chain double for the ZK-recovery ceremony (tests/e2e/ui/zk-recovery.spec.ts).
 *
 * The app's zk-recovery code paths (`lib/zkRecoveryActions.ts`,
 * `lib/policyChainFetch.ts`) talk to Soroban RPC (https://soroban-testnet.stellar.org),
 * a friendbot (https://friendbot.stellar.org), and the pool-indexer
 * (https://pool-indexer.nido.fyi) — all hardcoded constants, not configurable
 * from the page. The fast lane must exercise none of that, so this module
 * intercepts those three hosts via Playwright route handlers and answers with
 * hand-built (but real, `@stellar/stellar-sdk`-encoded) XDR — the SAME parsing
 * code the app runs client-side, just fed canned responses instead of a real
 * ledger. Nothing here is cryptographically enforced (there is no real chain
 * on the other end) — only structurally valid enough that the app's own
 * `rpc.Server`/`SorobanDataBuilder`/`assembleTransaction` parsing succeeds.
 *
 * Covers exactly the calls the ceremony makes:
 *  - `getLedgerEntries` (→ `getAccount`): the ephemeral fee-payer G-address
 *    `getSubmitter()` mints via friendbot.
 *  - `simulateTransaction` (recording + enforce): dispatched by
 *    (contractId, function) — registry `fetch_contract_id`, the account's
 *    `get_context_rule(0)` (verifier lookup), and the zk-recovery controller's
 *    `current_root` / `get_pending` / `next_nonce` / `initiate_recovery` /
 *    `cancel_recovery`.
 *  - `sendTransaction` / `getTransaction`: always succeeds.
 */
import type { Page } from '@playwright/test';
import {
  xdr,
  nativeToScVal,
  scValToNative,
  Address,
  Transaction,
  Networks,
} from '@stellar/stellar-sdk';

const NETWORK_PASSPHRASE = Networks.TESTNET;

/** Same unverified-registry contract id the frontend + SDK both hardcode. */
export const REGISTRY_ID = 'CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S';

// Freshly generated (via StrKey.encodeContract(randomBytes(32))), valid
// checksummed contract strkeys — unlike the passkey-registration fast-lane's
// FAKE_CONTRACT_ID (which is deliberately NOT checksum-valid and never
// round-tripped through StrKey.decodeContract/Address.fromString), the
// zk-recovery code paths DO decode the account id as a real contract address
// (`StrKey.decodeContract`, `new Contract(account)`), so this one must pass
// `StrKey.isValidContract`.
export const ZK_ACCOUNT_ID = 'CDV57KZN4NUAZMI73NSLXIJ3VVRNMOCUBXEXDWQG6SKBQZAU4WM7OSAZ';
export const ZK_CONTROLLER_ID = 'CBN7L4PQ7L4RVZ6REUZLAETJQWOP5PHN6HOBLZLVF2HK52HP6VIGBVBR';
export const ZK_VERIFIER_ID = 'CDN5WQTKTXSH7BO2CNQLHCDQ6HHOMVYQV63MJKSZOOWONHPILOUHEQIF';

const REGISTRY_MAP: Record<string, string> = {
  'zk-recovery': ZK_CONTROLLER_ID,
  verifier: ZK_VERIFIER_ID,
};

export interface PendingRecord {
  newPubkey65: Uint8Array;
  executableAfter: number;
  expiresAt: number;
}

/** Mutable scenario state the mock reads/writes as the ceremony progresses. */
export interface ChainScenario {
  /** The rebuilt pool Merkle root the client must agree with (32 bytes). */
  root: Uint8Array;
  /** Current `get_pending(account)` view. Flipped to non-null as a side
   *  effect of a mocked `initiate_recovery` call, and cleared by `cancel_recovery`. */
  pending: PendingRecord | null;
  /** `next_nonce(account)` view. */
  nonce: bigint;
  /** Seconds added to "now" for a fresh `initiate_recovery`'s `executable_after`. */
  timelockSecs: number;
  /** Hex of the primary passkey's 65-byte pubkey. When set, the mocked
   *  `get_context_rule(0)` reports it as rule 0's External signer so
   *  `signAndSubmit`'s `findRuleForPubkey` (the cancel path) resolves rule 0.
   *  Left unset for flows that never sign with the passkey. */
  primaryPubkeyHex?: string;
}

export function makeScenario(overrides: Partial<ChainScenario> = {}): ChainScenario {
  return {
    root: new Uint8Array(32),
    pending: null,
    nonce: 0n,
    timelockSecs: 90,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// XDR builders
// ---------------------------------------------------------------------------

function emptySorobanData(): string {
  const resources = new xdr.SorobanResources({
    footprint: new xdr.LedgerFootprint({ readOnly: [], readWrite: [] }),
    instructions: 0,
    diskReadBytes: 0,
    writeBytes: 0,
  });
  const data = new xdr.SorobanTransactionData({
    ext: new xdr.SorobanTransactionDataExt(0),
    resources,
    resourceFee: xdr.Int64.fromString('100000'),
  });
  return data.toXDR('base64');
}

let nonceCounter = 1;

/** A recording-mode auth-entry TEMPLATE: address credentials with a Void
 *  signature (the shape `getAuthEntry`/`buildAuthHash`/`injectPasskeySignature`
 *  expect before a signature is injected). The invocation's contents are never
 *  inspected by the client beyond being valid XDR, so they don't need to
 *  mirror the real cross-contract call tree. */
function authEntryTemplate(accountAddress: string, contractAddress: string, fn: string, args: xdr.ScVal[]): string {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(contractAddress).toScAddress(),
        functionName: fn,
        args,
      }),
    ),
    subInvocations: [],
  });
  const creds = new xdr.SorobanAddressCredentials({
    address: Address.fromString(accountAddress).toScAddress(),
    nonce: xdr.Int64.fromString(String(nonceCounter++)),
    signatureExpirationLedger: 0,
    signature: xdr.ScVal.scvVoid(),
  });
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(creds),
    rootInvocation: invocation,
  });
  return entry.toXDR('base64');
}

function simSuccess(retval: xdr.ScVal, auth: string[] = []) {
  return {
    latestLedger: 1000,
    events: [],
    transactionData: emptySorobanData(),
    minResourceFee: '100000',
    results: [{ auth, xdr: retval.toXDR('base64') }],
  };
}

function contextRuleScVal(scenario: ChainScenario): xdr.ScVal {
  // Minimal ContextRule-shaped map: `id` + `signers` are the only fields read
  // (fetchVerifierAddress reads `.signers`; findRuleForPubkey reads `.id` and
  // matches the External signer's pubkey). The signer pubkey mirrors the
  // primary passkey when the scenario knows it, so findRuleForPubkey resolves
  // rule 0; otherwise a filler that no real key matches.
  const pubkey = scenario.primaryPubkeyHex
    ? Buffer.from(scenario.primaryPubkeyHex, 'hex')
    : Buffer.alloc(65, 7);
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('id'),
      val: nativeToScVal(0, { type: 'u32' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('signers'),
      val: xdr.ScVal.scvVec([
        xdr.ScVal.scvVec([
          xdr.ScVal.scvSymbol('External'),
          new Address(ZK_VERIFIER_ID).toScVal(),
          xdr.ScVal.scvBytes(pubkey),
        ]),
      ]),
    }),
  ]);
}

function pendingScVal(pending: PendingRecord | null): xdr.ScVal {
  if (!pending) return xdr.ScVal.scvVoid();
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('new_pubkey'),
      val: xdr.ScVal.scvBytes(Buffer.from(pending.newPubkey65)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('executable_after'),
      val: nativeToScVal(BigInt(pending.executableAfter), { type: 'u64' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('expires_at'),
      val: nativeToScVal(BigInt(pending.expiresAt), { type: 'u64' }),
    }),
  ]);
}

function txMetaXdr(retval: xdr.ScVal): string {
  const sorobanMeta = new xdr.SorobanTransactionMeta({
    ext: new xdr.SorobanTransactionMetaExt(0),
    events: [],
    returnValue: retval,
    diagnosticEvents: [],
  });
  const v3 = new xdr.TransactionMetaV3({
    ext: new xdr.ExtensionPoint(0),
    txChangesBefore: [],
    operations: [],
    txChangesAfter: [],
    sorobanMeta,
  });
  return new xdr.TransactionMeta(3, v3).toXDR('base64');
}

function txResultXdr(): string {
  const ihfResult = xdr.InvokeHostFunctionResult.invokeHostFunctionSuccess(
    xdr.Hash.fromXDR(Buffer.alloc(32)),
  );
  const opResultTr = xdr.OperationResultTr.invokeHostFunction(ihfResult);
  const opResult = xdr.OperationResult.opInner(opResultTr);
  const result = xdr.TransactionResultResult.txSuccess([opResult]);
  const txResult = new xdr.TransactionResult({
    feeCharged: xdr.Int64.fromString('100000'),
    result,
    ext: new xdr.TransactionResultExt(0),
  });
  return txResult.toXDR('base64');
}

// ---------------------------------------------------------------------------
// simulateTransaction dispatch
// ---------------------------------------------------------------------------

function simulateFor(contractId: string, fn: string, args: xdr.ScVal[], scenario: ChainScenario) {
  if (contractId === REGISTRY_ID && fn === 'fetch_contract_id') {
    const name = scValToNative(args[0]) as string;
    const addr = REGISTRY_MAP[name];
    return simSuccess(addr ? new Address(addr).toScVal() : xdr.ScVal.scvVoid());
  }
  if (contractId === ZK_ACCOUNT_ID && fn === 'get_context_rule') {
    return simSuccess(contextRuleScVal(scenario));
  }
  if (contractId === ZK_ACCOUNT_ID && fn === 'get_context_rules_count') {
    // One rule (rule 0). Lets findRuleForPubkey's gap-tolerant scan stop after
    // probing id 0.
    return simSuccess(nativeToScVal(1, { type: 'u32' }));
  }
  if (contractId === ZK_CONTROLLER_ID) {
    switch (fn) {
      case 'current_root':
        return simSuccess(xdr.ScVal.scvBytes(Buffer.from(scenario.root)));
      case 'get_pending':
        return simSuccess(pendingScVal(scenario.pending));
      case 'next_nonce':
        return simSuccess(nativeToScVal(scenario.nonce, { type: 'u64' }));
      case 'initiate_recovery': {
        // Permissionless (no require_auth) — auth: [].
        const executableAfter = Math.floor(Date.now() / 1000) + scenario.timelockSecs;
        // Side effect: from here on, get_pending reflects the new recovery —
        // this is how the "staging resume" scenario observes a pending record
        // on reload without a second, separate mock installation.
        const newPubkey65 = scValToNative(args[1]) as Buffer;
        scenario.pending = {
          newPubkey65: new Uint8Array(newPubkey65),
          executableAfter,
          expiresAt: executableAfter + 3600,
        };
        return simSuccess(nativeToScVal(BigInt(executableAfter), { type: 'u64' }));
      }
      case 'cancel_recovery':
        return simSuccess(
          xdr.ScVal.scvVoid(),
          [authEntryTemplate(ZK_ACCOUNT_ID, contractId, fn, args)],
        );
      default:
        break;
    }
  }
  throw new Error(`zkChainMock: unmocked simulateTransaction ${contractId}.${fn}`);
}

// ---------------------------------------------------------------------------
// JSON-RPC dispatch
// ---------------------------------------------------------------------------

interface RpcState {
  lastEnvelopeXdr: string;
}

async function dispatch(
  method: string,
  params: Record<string, unknown>,
  scenario: ChainScenario,
  state: RpcState,
  poolLeaves: { index: number; leaf: string }[],
): Promise<unknown> {
  switch (method) {
    case 'getHealth': {
      // `fetchLeavesFromChain` reads `oldestLedger` here to pick its
      // `getEvents` start ledger (the default, no-indexer leaf source since
      // "read pool leaves from chain"). Keep the window tiny so the paging
      // loop below terminates in one page.
      return {
        status: 'healthy',
        latestLedger: 1000,
        oldestLedger: 1,
        ledgerRetentionWindow: 1000,
      };
    }
    case 'getEvents': {
      // The chain-read leaf source: one `leaf_inserted` contract event per
      // pool leaf, shaped exactly as the on-chain
      // `#[contractevent(topics = ["leaf_inserted"], data_format = "map")]`
      // emits — topic `[symbol("leaf_inserted"), u32(index)]`, data map
      // `{ leaf: bytes32 }` — so `fetchLeavesFromChain`'s
      // `scValToNative(topic[1])` / `scValToNative(value).leaf` decode works.
      const events = poolLeaves.map((l, i) => ({
        type: 'contract',
        ledger: 999,
        ledgerClosedAt: '1970-01-01T00:00:00Z',
        contractId: ZK_CONTROLLER_ID,
        id: String(i),
        pagingToken: String(i),
        topic: [
          xdr.ScVal.scvSymbol('leaf_inserted').toXDR('base64'),
          nativeToScVal(l.index, { type: 'u32' }).toXDR('base64'),
        ],
        value: xdr.ScVal
          .scvMap([
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol('leaf'),
              val: xdr.ScVal.scvBytes(Buffer.from(l.leaf, 'hex')),
            }),
          ])
          .toXDR('base64'),
        inSuccessfulContractCall: true,
      }));
      // Cursor whose TOID ledger (high 32 bits) == latestLedger, so the
      // client's page-to-the-tip loop stops after this single page.
      const cursor = `${(BigInt(1000) << 32n).toString()}-0`;
      return { latestLedger: 1000, cursor, events };
    }
    case 'getLedgerEntries': {
      const keys = params.keys as string[];
      const keyXdr = xdr.LedgerKey.fromXDR(keys[0], 'base64');
      const accountId = keyXdr.account().accountId();
      const entryData = xdr.LedgerEntryData.account(
        new xdr.AccountEntry({
          accountId,
          balance: xdr.Int64.fromString('9999999999999'),
          seqNum: xdr.SequenceNumber.fromString('1'),
          numSubEntries: 0,
          inflationDest: null,
          flags: 0,
          homeDomain: '',
          thresholds: Buffer.from([1, 0, 0, 0]),
          signers: [],
          ext: new xdr.AccountEntryExt(0),
        }),
      );
      return {
        entries: [{ lastModifiedLedgerSeq: 999, key: keys[0], xdr: entryData.toXDR('base64') }],
        latestLedger: 1000,
      };
    }
    case 'simulateTransaction': {
      const tx = new Transaction(params.transaction as string, NETWORK_PASSPHRASE);
      const op = tx.operations[0] as unknown as { type: string; func: xdr.HostFunction };
      if (op.type !== 'invokeHostFunction') {
        throw new Error(`zkChainMock: unsupported operation type ${op.type}`);
      }
      const invoke = op.func.invokeContract();
      const contractId = Address.fromScAddress(invoke.contractAddress()).toString();
      const fn = invoke.functionName().toString();
      return simulateFor(contractId, fn, invoke.args(), scenario);
    }
    case 'sendTransaction': {
      state.lastEnvelopeXdr = params.transaction as string;
      return {
        status: 'PENDING',
        hash: 'a'.repeat(64),
        latestLedger: 1000,
        latestLedgerCloseTime: String(Math.floor(Date.now() / 1000)),
      };
    }
    case 'getTransaction': {
      return {
        status: 'SUCCESS',
        latestLedger: 1001,
        latestLedgerCloseTime: String(Math.floor(Date.now() / 1000)),
        oldestLedger: 1,
        oldestLedgerCloseTime: '0',
        ledger: 1000,
        createdAt: String(Math.floor(Date.now() / 1000)),
        applicationOrder: 1,
        feeBump: false,
        envelopeXdr: state.lastEnvelopeXdr,
        resultXdr: txResultXdr(),
        resultMetaXdr: txMetaXdr(xdr.ScVal.scvVoid()),
      };
    }
    default:
      throw new Error(`zkChainMock: unmocked JSON-RPC method ${method}`);
  }
}

/**
 * Installs route handlers on `page` for friendbot, Soroban RPC, and the
 * pool-indexer. Install BEFORE navigating to the page under test (a fresh
 * `ChainScenario` per test keeps state isolated).
 */
export async function installChainMocks(
  page: Page,
  scenario: ChainScenario,
  poolLeaves: { index: number; leaf: string }[],
): Promise<void> {
  const state: RpcState = { lastEnvelopeXdr: '' };

  await page.route('https://friendbot.stellar.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );

  await page.route('https://pool-indexer.nido.fyi/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ leaves: poolLeaves }),
    }),
  );

  await page.route('https://soroban-testnet.stellar.org/**', async (route) => {
    const request = route.request();
    let body: { jsonrpc: string; id: unknown; method: string; params?: Record<string, unknown> };
    try {
      body = JSON.parse(request.postData() || '{}');
    } catch {
      await route.fulfill({ status: 400, body: 'bad request' });
      return;
    }
    try {
      const result = await dispatch(body.method, body.params ?? {}, scenario, state, poolLeaves);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result }),
      });
    } catch (err) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
        }),
      });
    }
  });
}
