/**
 * FAST-lane chain double for the Adsum example dApp
 * (`tests/e2e/ui/adsum.spec.ts`). Mirrors `zkChainMock.ts`'s approach
 * (route-interception answering real `@stellar/stellar-sdk`-encoded XDR,
 * dispatched by contract id + function) — read that module first if you
 * haven't; this one is the same shape, scoped to the two staging contracts
 * Adsum's committed generated clients call:
 *
 *  - `petitions`   (`CAUPKCFWVRFRMZXKVMSSZPN6OURTTDS6TDKS6JGXR5XE3D2BEYGT2QJH`)
 *  - `web_of_trust` (`CDI5YRC4K54QHJW63ONUQPZ6GOAU254GP43OWGCPK3QVPUKPIQIQGIFS`)
 *
 * Both ids come from `examples/adsum/environments.toml`'s `[staging.contracts]`
 * (bound-by-id, no on-chain deploy needed) and are baked into the built
 * `dist` bundle verbatim — confirmed by grepping the built JS.
 *
 * The app's `rpcUrl` (`examples/adsum/src/contracts/util.ts`, sourced from
 * `PUBLIC_STELLAR_RPC_URL`) is `https://soroban-testnet.stellar.org` for the
 * staging build (`examples/adsum/environments.toml`'s `[staging.network]`),
 * same host `zkChainMock` intercepts — so this module answers the same two
 * JSON-RPC methods Adsum's read paths actually call:
 *
 *  - `simulateTransaction`, dispatched by (contractId, function) for
 *    `petition_count` / `get_petition` / `get_signers` / `has_signed`
 *    (petitions) and `vouches_received` / `vouches_given` / `get_pre_vouch`
 *    (web_of_trust). None of the four fast-lane tests exercise a
 *    wallet-signed write (create/sign/vouch/claim), so `sendTransaction` /
 *    `getTransaction` / account lookups are intentionally NOT mocked here —
 *    unlike `zkChainMock`, every generated-client call Adsum's read pages
 *    make happens with no `publicKey` option, which the SDK's
 *    `AssembledTransaction` resolves to a `NULL_ACCOUNT` source WITHOUT any
 *    `getAccount`/`getLedgerEntries` round-trip first.
 *  - `getLatestLedger`, called directly by `src/lib/rpc.ts`'s
 *    `getLatestLedgerSeq()` (used for ledger-time display, e.g. "posted ≈
 *    <date>" and the deadline countdown). Its parser
 *    (`@stellar/stellar-sdk/rpc`'s `parseRawLatestLedger`) requires REAL,
 *    parseable `headerXdr`/`metadataXdr` — not just present strings — so
 *    this builds a minimal-but-valid `LedgerHeader` + `LedgerCloseMetaV0`.
 *
 * Also covers the two things Adsum's UI reads OUTSIDE Soroban RPC entirely:
 *
 *  - The Nido name resolver (`src/lib/nidoResolver.ts`): every page that
 *    shows an address (Petition's byline, Vouch's card, Claim's letter)
 *    reverse-looks-up a Nido name via `GET
 *    <address-lowercased>.nido.fyi/.well-known/nido.json` — a REAL,
 *    uncontrolled subdomain fetch if left alone. Intercepted by regex (the
 *    label varies per address) and answered from `scenario.names`, 404
 *    otherwise (mirrors an unregistered address — `lookupNidoName` reads
 *    that as "no name", not an error).
 *  - Google Fonts (`index.html` links `fonts.googleapis.com` /
 *    `fonts.gstatic.com` directly, unrelated to any chain or resolver
 *    concern) — aborted outright so the fast lane never depends on live
 *    internet access.
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

/** The staging `petitions` contract id (`environments.toml`'s `[staging.contracts]`). */
export const PETITIONS_ID = 'CAUPKCFWVRFRMZXKVMSSZPN6OURTTDS6TDKS6JGXR5XE3D2BEYGT2QJH';
/** The staging `web_of_trust` contract id (`environments.toml`'s `[staging.contracts]`). */
export const WEB_OF_TRUST_ID = 'CDI5YRC4K54QHJW63ONUQPZ6GOAU254GP43OWGCPK3QVPUKPIQIQGIFS';

/** Seed for one row of `get_petition`/`petition_count`/`get_signers`/`has_signed`. */
export interface PetitionSeed {
  id: number;
  creator: string;
  title: string;
  body: string;
  /** `null`/omitted -> the contract's `Option<u32>` `None` (open-ended). */
  goal?: number | null;
  /** `null`/omitted -> the contract's `Option<u32>` `None` (open-ended). */
  deadline?: number | null;
  sigCount: number;
  createdLedger: number;
  /** Addresses `get_signers`/`has_signed` report for this petition. */
  signers?: string[];
}

/** Seed for one row of `get_pre_vouch`, keyed by the invite's derived pubkey. */
export interface PreVouchSeed {
  /** Hex-encoded 32-byte ed25519 pubkey — matches `get_pre_vouch`'s `key` arg. */
  pubkeyHex: string;
  from: string;
  /** `null`/omitted -> the contract's `Option<u32>` `None` (never expires). */
  expires?: number | null;
  maxClaims: number;
  claims: number;
}

export interface AdsumScenario {
  petitions: PetitionSeed[];
  vouches?: {
    /** `vouches_received(a)` -> the addresses that vouch for `a`. */
    received?: Record<string, string[]>;
    /** `vouches_given(a)` -> the addresses `a` vouches for. */
    given?: Record<string, string[]>;
  };
  preVouches?: PreVouchSeed[];
  /** address (any case) -> the Nido name it reverse-resolves to. Addresses
   *  absent from this map read as unregistered (404 -> `lookupNidoName`
   *  resolves `null`, so the UI falls back to the truncated address). */
  names?: Record<string, string>;
  /** `getLatestLedger`'s reported ledger sequence. Default: 1000. */
  latestLedger?: number;
}

// ---------------------------------------------------------------------------
// XDR builders
// ---------------------------------------------------------------------------

function mapEntry(key: string, val: xdr.ScVal): xdr.ScMapEntry {
  return new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
}

function optionU32(value: number | null | undefined): xdr.ScVal {
  return value == null ? xdr.ScVal.scvVoid() : nativeToScVal(value, { type: 'u32' });
}

/**
 * `Petition` struct as a `ScMap`, fields in the EXACT alphabetical order the
 * generated client's `ContractSpec#structToNative` decodes by (it matches
 * map entries to struct fields positionally, not by name — see
 * `packages/petitions/src/index.ts`'s embedded spec / the `Petition`
 * interface's own field order, which the codegen already emits
 * alphabetically for the same reason).
 */
function petitionScVal(p: PetitionSeed): xdr.ScVal {
  return xdr.ScVal.scvMap([
    mapEntry('body', xdr.ScVal.scvString(p.body)),
    mapEntry('created_ledger', nativeToScVal(p.createdLedger, { type: 'u32' })),
    mapEntry('creator', new Address(p.creator).toScVal()),
    mapEntry('deadline', optionU32(p.deadline)),
    mapEntry('goal', optionU32(p.goal)),
    mapEntry('sig_count', nativeToScVal(p.sigCount, { type: 'u32' })),
    mapEntry('title', xdr.ScVal.scvString(p.title)),
  ]);
}

/** `PreVouch` struct as a `ScMap` — same positional-decode caveat as above;
 *  field order here is `claims, expires, from, max_claims` (alphabetical). */
function preVouchScVal(pv: PreVouchSeed): xdr.ScVal {
  return xdr.ScVal.scvMap([
    mapEntry('claims', nativeToScVal(pv.claims, { type: 'u32' })),
    mapEntry('expires', optionU32(pv.expires)),
    mapEntry('from', new Address(pv.from).toScVal()),
    mapEntry('max_claims', nativeToScVal(pv.maxClaims, { type: 'u32' })),
  ]);
}

function addressVec(addresses: string[]): xdr.ScVal {
  return xdr.ScVal.scvVec(addresses.map((a) => new Address(a).toScVal()));
}

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

function simSuccess(retval: xdr.ScVal) {
  return {
    latestLedger: 1000,
    events: [],
    transactionData: emptySorobanData(),
    minResourceFee: '100000',
    results: [{ auth: [], xdr: retval.toXDR('base64') }],
  };
}

// --- `getLatestLedger`: a minimal-but-real LedgerHeader/LedgerCloseMetaV0. ---

function hash32(fill = 0): Buffer {
  return Buffer.alloc(32, fill);
}

function stellarValue(): xdr.StellarValue {
  return new xdr.StellarValue({
    txSetHash: hash32(),
    closeTime: xdr.Uint64.fromString('0'),
    upgrades: [],
    ext: xdr.StellarValueExt.stellarValueBasic(),
  });
}

function ledgerHeader(sequence: number): xdr.LedgerHeader {
  return new xdr.LedgerHeader({
    ledgerVersion: 20,
    previousLedgerHash: hash32(),
    scpValue: stellarValue(),
    txSetResultHash: hash32(),
    bucketListHash: hash32(),
    ledgerSeq: sequence,
    totalCoins: xdr.Int64.fromString('0'),
    feePool: xdr.Int64.fromString('0'),
    inflationSeq: 0,
    idPool: xdr.Uint64.fromString('0'),
    baseFee: 100,
    baseReserve: 100,
    maxTxSetSize: 100,
    skipList: [hash32(), hash32(), hash32(), hash32()],
    ext: new xdr.LedgerHeaderExt(0),
  });
}

function ledgerCloseMetaV0(sequence: number): xdr.LedgerCloseMeta {
  const historyEntry = new xdr.LedgerHeaderHistoryEntry({
    hash: hash32(),
    header: ledgerHeader(sequence),
    ext: new xdr.LedgerHeaderHistoryEntryExt(0),
  });
  const txSet = new xdr.TransactionSet({ previousLedgerHash: hash32(), txes: [] });
  const v0 = new xdr.LedgerCloseMetaV0({
    ledgerHeader: historyEntry,
    txSet,
    txProcessing: [],
    upgradesProcessing: [],
    scpInfo: [],
  });
  return new xdr.LedgerCloseMeta(0, v0);
}

function latestLedgerRaw(sequence: number) {
  return {
    id: hash32(1).toString('hex'),
    sequence,
    protocolVersion: 20,
    closeTime: '0',
    headerXdr: ledgerHeader(sequence).toXDR('base64'),
    metadataXdr: ledgerCloseMetaV0(sequence).toXDR('base64'),
  };
}

// ---------------------------------------------------------------------------
// simulateTransaction dispatch
// ---------------------------------------------------------------------------

function simulateFor(
  contractId: string,
  fn: string,
  args: xdr.ScVal[],
  scenario: AdsumScenario,
) {
  if (contractId === PETITIONS_ID) {
    switch (fn) {
      case 'petition_count':
        return simSuccess(nativeToScVal(scenario.petitions.length, { type: 'u32' }));
      case 'get_petition': {
        const id = scValToNative(args[0]) as number;
        const p = scenario.petitions.find((x) => x.id === id);
        return simSuccess(p ? petitionScVal(p) : xdr.ScVal.scvVoid());
      }
      case 'get_signers': {
        const id = scValToNative(args[0]) as number;
        const start = scValToNative(args[1]) as number;
        const limit = scValToNative(args[2]) as number;
        const p = scenario.petitions.find((x) => x.id === id);
        const signers = (p?.signers ?? []).slice(start, start + limit);
        return simSuccess(addressVec(signers));
      }
      case 'has_signed': {
        const id = scValToNative(args[0]) as number;
        const addr = scValToNative(args[1]) as string;
        const p = scenario.petitions.find((x) => x.id === id);
        return simSuccess(xdr.ScVal.scvBool((p?.signers ?? []).includes(addr)));
      }
      default:
        break;
    }
  }
  if (contractId === WEB_OF_TRUST_ID) {
    switch (fn) {
      case 'vouches_received': {
        const a = scValToNative(args[0]) as string;
        return simSuccess(addressVec(scenario.vouches?.received?.[a] ?? []));
      }
      case 'vouches_given': {
        const a = scValToNative(args[0]) as string;
        return simSuccess(addressVec(scenario.vouches?.given?.[a] ?? []));
      }
      case 'get_pre_vouch': {
        const key = scValToNative(args[0]) as Buffer;
        const keyHex = Buffer.from(key).toString('hex').toLowerCase();
        const pv = scenario.preVouches?.find((x) => x.pubkeyHex.toLowerCase() === keyHex);
        return simSuccess(pv ? preVouchScVal(pv) : xdr.ScVal.scvVoid());
      }
      default:
        break;
    }
  }
  throw new Error(`adsumChainMock: unmocked simulateTransaction ${contractId}.${fn}`);
}

// ---------------------------------------------------------------------------
// JSON-RPC dispatch
// ---------------------------------------------------------------------------

async function dispatch(
  method: string,
  params: Record<string, unknown>,
  scenario: AdsumScenario,
): Promise<unknown> {
  switch (method) {
    case 'getLatestLedger':
      return latestLedgerRaw(scenario.latestLedger ?? 1000);
    case 'simulateTransaction': {
      const tx = new Transaction(params.transaction as string, NETWORK_PASSPHRASE);
      const op = tx.operations[0] as unknown as { type: string; func: xdr.HostFunction };
      if (op.type !== 'invokeHostFunction') {
        throw new Error(`adsumChainMock: unsupported operation type ${op.type}`);
      }
      const invoke = op.func.invokeContract();
      const contractId = Address.fromScAddress(invoke.contractAddress()).toString();
      const fn = invoke.functionName().toString();
      return simulateFor(contractId, fn, invoke.args(), scenario);
    }
    default:
      throw new Error(`adsumChainMock: unmocked JSON-RPC method ${method}`);
  }
}

// ---------------------------------------------------------------------------
// Nido resolver + misc host mocks
// ---------------------------------------------------------------------------

/** Matches `https://<label>.nido.fyi/.well-known/nido.json` for any label —
 *  `buildWellKnownUrl` (`src/lib/nidoResolver.ts`) lowercases the address
 *  into the subdomain, so the label is always `[a-z0-9]+` for a strkey. */
const NIDO_WELL_KNOWN = /^https:\/\/([a-z0-9]+)\.nido\.fyi\/\.well-known\/nido\.json(?:\?.*)?$/i;

/**
 * Installs route handlers on `page` for the Soroban RPC host, the Nido name
 * resolver, and (to keep the fast lane fully offline) Google Fonts. Install
 * BEFORE navigating to the page under test.
 */
export async function adsumChainMock(page: Page, scenario: AdsumScenario): Promise<void> {
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
      const result = await dispatch(body.method, body.params ?? {}, scenario);
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

  await page.route(NIDO_WELL_KNOWN, async (route) => {
    const match = NIDO_WELL_KNOWN.exec(route.request().url());
    const label = match?.[1] ?? '';
    const name = Object.entries(scenario.names ?? {}).find(
      ([addr]) => addr.toLowerCase() === label.toLowerCase(),
    )?.[1];
    if (!name) {
      await route.fulfill({ status: 404, body: 'not found' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ name, address: label, network: 'testnet' }),
    });
  });

  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
}
