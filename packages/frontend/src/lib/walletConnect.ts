/**
 * walletConnect.ts — a reusable, vanilla-TS wallet-connect helper that mirrors
 * the stellar-scaffold-frontend LOGIN pattern, adapted to g2c and ported from
 * React to vanilla TS.
 *
 * Architecture (mirrors the scaffold):
 *   - ONE kit instance, initialised once, with g2c registered ALONGSIDE the
 *     standard wallets so g2c shows up in the kit's selector modal.
 *   - `connect()` opens the kit's selector modal; on a wallet being selected the
 *     kit sets the active module + fetches the address. We then persist
 *     `walletId` + `walletAddress` to localStorage.
 *   - The session is restored from localStorage on load (and re-checked on
 *     window focus) — a lighter alternative to the scaffold's 1s React polling.
 *   - `signTransaction(xdr, opts)` delegates to the kit's active module.
 *   - A per-wallet behaviour/warnings table is surfaced as UI warnings.
 *
 * KIT VERSION NOTE (v2.2.0, NOT the scaffold's v1.9.5):
 *   - `StellarWalletsKit.init({ modules, selectedWalletId?, network?, ... })` is
 *     STATIC (no `new StellarWalletsKit(...)`).
 *   - The selector modal is `StellarWalletsKit.authModal({ container? })` — it
 *     resolves `{ address }` after internally selecting the module AND fetching
 *     the address. There is NO v1-style `openModal({ onWalletSelected })`. On
 *     the user closing the modal it REJECTS with `{ code: -1, message: "The
 *     user closed the modal." }`.
 *   - `allowAllModules()` does NOT exist in v2.2.0 (it was a v1 helper). We
 *     instead expose `standardModules()` which instantiates the common
 *     no-arg standard modules (Freighter, xBull, Albedo, LOBSTR, Rabet, Hana).
 *   - `fetchAddress()` runs the active module's connect flow; `getAddress()`
 *     only reads the cached active address and throws when empty.
 *
 * The DOM-free logic (session store, warning lookup, the selector→connect
 * orchestration with an injectable kit) is exported separately so it can be
 * unit-tested without a browser. The thin module-level wrappers bind that logic
 * to the real `StellarWalletsKit` + `window`/`localStorage`.
 */

import { StellarWalletsKit, type ModuleInterface } from '@creit.tech/stellar-wallets-kit';
import { G2cModule, G2C_ID } from '@g2c/stellar-wallets-kit-module';

export { G2C_ID };

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const SESSION_KEY = 'g2c:walletSession';

// ---------------------------------------------------------------------------
// Session store (pure — read/write/clear localStorage). Mirrors the scaffold's
// `walletId` + `walletAddress` persistence.
// ---------------------------------------------------------------------------

export interface WalletSession {
  /** The selected module's productId (e.g. "g2c", "freighter"). */
  walletId: string;
  /** The connected account address (C-address for g2c, G-address for classic). */
  walletAddress: string;
}

/** Minimal Storage shape so the store is testable with a fake. */
export type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): SessionStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Read the persisted session, or null if absent/corrupt. */
export function readSession(store: SessionStorage | null = defaultStorage()): WalletSession | null {
  if (!store) return null;
  const raw = store.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WalletSession>;
    if (parsed && typeof parsed.walletId === 'string' && typeof parsed.walletAddress === 'string') {
      return { walletId: parsed.walletId, walletAddress: parsed.walletAddress };
    }
  } catch {
    /* corrupt entry — fall through and treat as no session */
  }
  return null;
}

/** Persist the session. */
export function writeSession(
  session: WalletSession,
  store: SessionStorage | null = defaultStorage(),
): void {
  store?.setItem(SESSION_KEY, JSON.stringify(session));
}

/** Clear any persisted session. */
export function clearSession(store: SessionStorage | null = defaultStorage()): void {
  store?.removeItem(SESSION_KEY);
}

// ---------------------------------------------------------------------------
// Per-wallet behaviour / warnings table (adapted from the scaffold). Surfaced
// by the wallet button as UI warnings.
// ---------------------------------------------------------------------------

export interface WalletBehavior {
  /** "standard" wallets connect inline; "popup-always" always open a popup/redirect. */
  kind: 'standard' | 'popup-always';
  /** Whether the wallet implements a usable `getNetwork()`. */
  supportsGetNetwork: boolean;
  /** Optional human-facing warning to show when this wallet is selected. */
  warning?: string;
  /** Optional help URL for the warning. */
  helpUrl?: string;
}

const WALLET_BEHAVIOR: Record<string, WalletBehavior> = {
  [G2C_ID]: {
    kind: 'popup-always',
    supportsGetNetwork: true,
    warning:
      'Nido opens a popup to your account subdomain for every connect and signature (passkey ceremony). Allow popups for this site.',
  },
  freighter: { kind: 'standard', supportsGetNetwork: true },
  xbull: { kind: 'standard', supportsGetNetwork: true },
  albedo: {
    kind: 'popup-always',
    supportsGetNetwork: true,
    warning: 'Albedo signs in a popup window. Allow popups for this site.',
  },
  lobstr: {
    kind: 'standard',
    supportsGetNetwork: true,
    warning: 'LOBSTR only supports a single account; make sure the right one is active.',
  },
  rabet: { kind: 'standard', supportsGetNetwork: true },
  hana: { kind: 'standard', supportsGetNetwork: true },
};

const DEFAULT_BEHAVIOR: WalletBehavior = { kind: 'standard', supportsGetNetwork: false };

/** Look up the behaviour/warning record for a wallet id (case-insensitive). */
export function warningsFor(walletId: string | null | undefined): WalletBehavior {
  if (!walletId) return DEFAULT_BEHAVIOR;
  return WALLET_BEHAVIOR[walletId.toLowerCase()] ?? DEFAULT_BEHAVIOR;
}

/** Is this the g2c smart-account wallet (C-address oriented)? */
export function isG2cWallet(walletId: string | null | undefined): boolean {
  return walletId === G2C_ID;
}

// ---------------------------------------------------------------------------
// Selector → connect orchestration (pure, kit injectable for tests).
//
// The kit's `authModal()` both selects the module and fetches the address, so
// the orchestration is: open the modal → read which module ended up active →
// build + persist the session. We accept a minimal kit surface so tests can
// pass a mock.
// ---------------------------------------------------------------------------

export interface KitLike {
  authModal(params?: { container?: HTMLElement }): Promise<{ address: string }>;
  readonly selectedModule: { productId: string };
  setWallet(id: string): void;
  disconnect(): Promise<void>;
  signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string; path?: string },
  ): Promise<{ signedTxXdr: string; signerAddress?: string }>;
}

/**
 * Open the selector modal and resolve the resulting session, persisting it to
 * `store`. Pure orchestration over an injected `kit` — no direct DOM/window use.
 */
export async function connectWith(
  kit: KitLike,
  store: SessionStorage | null = defaultStorage(),
  container?: HTMLElement,
): Promise<WalletSession> {
  const { address } = await kit.authModal(container ? { container } : undefined);
  const walletId = kit.selectedModule.productId;
  const session: WalletSession = { walletId, walletAddress: address };
  writeSession(session, store);
  return session;
}

/**
 * Restore a previously persisted session by re-selecting the module in the kit
 * (so subsequent `signTransaction` uses the right wallet). Does NOT re-open the
 * picker or re-fetch the address — it trusts the stored address (a non-secret
 * identifier). Returns null if there was no session or the module is no longer
 * registered.
 */
export function restoreWith(
  kit: Pick<KitLike, 'setWallet'>,
  store: SessionStorage | null = defaultStorage(),
): WalletSession | null {
  const session = readSession(store);
  if (!session) return null;
  try {
    kit.setWallet(session.walletId);
  } catch {
    // Module no longer registered — drop the stale session.
    clearSession(store);
    return null;
  }
  return session;
}

// ---------------------------------------------------------------------------
// Module-level singleton wrappers (bind the pure logic to the real kit).
// ---------------------------------------------------------------------------

export interface InitWalletKitParams {
  /**
   * The g2c deployment base (apex) origin, e.g. `https://mysoroban.xyz` or
   * `http://localhost:4321`. If omitted, derived from `window.location`.
   */
  base?: string;
  /** Network passphrase. Defaults to testnet. */
  networkPassphrase?: string;
  /** Extra/override modules to register alongside g2c + the standard set. */
  extraModules?: ModuleInterface[];
  /**
   * Replace the standard module set entirely (still keeps g2c first). When
   * omitted, the default standard set is loaded lazily from `./walletModules`.
   */
  standardModuleSet?: ModuleInterface[];
}

let inited = false;

/** Derive the g2c apex origin from the current page if `base` wasn't given. */
function deriveBase(): string {
  // The page may live on a subdomain (e.g. status-message.<apex>); take the
  // last two labels as the apex. Falls back to the full origin for localhost.
  const { protocol, hostname, port } = window.location;
  const labels = hostname.split('.');
  const apexHost = labels.length > 2 ? labels.slice(-2).join('.') : hostname;
  const portPart = port ? `:${port}` : '';
  return `${protocol}//${apexHost}${portPart}`;
}

/**
 * Initialise the kit ONCE with g2c registered alongside the standard wallets so
 * g2c appears IN the picker. Idempotent — repeat calls are no-ops. The standard
 * wallet SDKs are imported lazily so this module's pure logic stays importable
 * (and unit-testable) without pulling them in.
 */
export async function initWalletKit(params: InitWalletKitParams = {}): Promise<void> {
  if (inited) return;
  const networkPassphrase = params.networkPassphrase ?? TESTNET_PASSPHRASE;
  const base = params.base ?? deriveBase();

  const standard =
    params.standardModuleSet ?? (await import('./walletModules.js')).standardModules();
  const modules: ModuleInterface[] = [
    new G2cModule({ base, networkPassphrase }),
    ...standard,
    ...(params.extraModules ?? []),
  ];

  StellarWalletsKit.init({ modules });
  inited = true;
}

/** Open the selector modal, connect, and persist the session. */
export async function connect(container?: HTMLElement): Promise<WalletSession> {
  return connectWith(StellarWalletsKit as unknown as KitLike, defaultStorage(), container);
}

/** Clear the persisted session and tell the kit to disconnect. */
export async function disconnect(): Promise<void> {
  clearSession();
  try {
    await StellarWalletsKit.disconnect();
  } catch {
    /* nothing connected in this kit instance — local clear already done */
  }
}

/** Read the persisted session (no kit interaction). */
export function getSession(): WalletSession | null {
  return readSession();
}

/**
 * Restore a persisted session into the live kit (re-selects the module). Call
 * once on load. Returns the session or null.
 */
export function restore(): WalletSession | null {
  return restoreWith(StellarWalletsKit as unknown as KitLike, defaultStorage());
}

/** Sign a transaction XDR with the active wallet (SEP-43: sign, not submit). */
export async function signTransaction(
  xdr: string,
  opts?: { networkPassphrase?: string; address?: string; path?: string },
): Promise<{ signedTxXdr: string; signerAddress?: string }> {
  return StellarWalletsKit.signTransaction(xdr, opts);
}
