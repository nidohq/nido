/**
 * `NidoModule` — a `@creit.tech/stellar-wallets-kit` module that surfaces a
 * Nido passkey smart account in the kit's wallet picker, so any dApp using the
 * kit can use Nido with no Nido-specific code.
 *
 * Architecture (mirrors the existing delegate handover): the wallet lives at
 * `<c-address>.<base>`, the dApp lives at its own origin, and every privileged
 * action is a redirect+return ceremony:
 *   - `getAddress`  → apex `/connect/` account picker, returns the C-address.
 *   - `signTransaction` / `signMessage` / `signAuthEntry`
 *                   → `<c-address>.<base>/sign/`, runs the primary-passkey
 *                     ceremony and returns the signed artifact.
 * The round-trip uses a popup that posts the result back (`redirect.ts`); the
 * URL building and result parsing are pure (`urls.ts` / `handover.ts`).
 *
 * The chosen address is cached in the dApp origin's localStorage (it's a
 * non-secret identifier). `getAddress` still opens the picker on every call
 * (passing the cached address as `previous` so it's highlighted, and so the
 * picker can fast-path single-account devices) — the cache exists for
 * `skipRequestAccess: true` reads and to resolve the account for signing.
 */

import {
  type ModuleInterface,
  ModuleType,
} from '@creit.tech/stellar-wallets-kit';

import {
  connectUrl,
  signTransactionUrl,
  signMessageUrl,
  signAuthEntryUrl,
  apexOrigin,
  accountOrigin,
} from './urls.js';
import {
  parseConnectReturn,
  parseSignReturn,
  loadCachedAddress,
  saveCachedAddress,
  clearCachedAddress,
} from './handover.js';
import { openCeremonyPopup } from './redirect.js';

export const NIDO_ID = 'nido';

/**
 * `error.name` of the rejection thrown when the user hits "Use a different
 * account" on the sign page. The sign ceremony is structurally bound to one
 * account (the WebAuthn rpId is its subdomain), so switching mid-sign is
 * impossible; the module clears the cached address and rejects with this
 * error so the dApp can react: re-run connect (`kit.getAddress()` /
 * `requestAccess`) to let the user pick another account, then rebuild the
 * transaction for the new holder.
 */
export const ACCOUNT_SWITCH_REQUESTED = 'ACCOUNT_SWITCH_REQUESTED';

/** Thrown by sign methods when the user asks to switch accounts mid-ceremony. */
export class AccountSwitchRequestedError extends Error {
  constructor() {
    super(
      'Nido: the user wants to sign with a different account. ' +
        'Re-run connect to let them pick one, then retry.',
    );
    this.name = ACCOUNT_SWITCH_REQUESTED;
  }
}

const DEFAULT_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

/**
 * Nido Nest-Ring mark. Inline data-URI so the module has no asset dependency.
 */
const NIDO_ICON =
  'data:image/svg+xml;base64,' +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" rx="26" fill="#FFF8F0"/><circle cx="60" cy="60" r="34" fill="none" stroke="#F25C2A" stroke-width="6" stroke-dasharray="14 9" stroke-linecap="round"/><circle cx="60" cy="60" r="23" fill="none" stroke="#F5A623" stroke-width="6" stroke-dasharray="11 8" stroke-linecap="round"/><circle cx="60" cy="60" r="9" fill="#0E9AA8"/></svg>',
  );

export interface NidoModuleParams {
  /**
   * The Nido deployment base domain, e.g. `nido.example.xyz`. May carry an
   * explicit scheme for local dev (`http://localhost:4321`). Required: the
   * module runs at the dApp origin and can't infer it.
   */
  base: string;
  /** Network passphrase to request when signing. Defaults to testnet. */
  networkPassphrase?: string;
  /** Override the dApp origin used in handover URLs (defaults to `window.location.origin`). */
  dappOrigin?: string;
  /**
   * Override the return URL the wallet sends the user back to. Defaults to the
   * current page; the popup posts the result back regardless, so this only
   * matters for the full-page-redirect fallback.
   */
  returnUrl?: string;
}

export class NidoModule implements ModuleInterface {
  moduleType: ModuleType = ModuleType.HOT_WALLET;
  productId: string = NIDO_ID;
  productName: string = 'Nido';
  productUrl: string;
  productIcon: string = NIDO_ICON;

  private base: string;
  private networkPassphrase: string;
  private dappOriginOverride?: string;
  private returnUrlOverride?: string;

  constructor(params: NidoModuleParams) {
    if (!params?.base) {
      throw new Error('NidoModule requires a `base` domain (e.g. "nido.example.xyz").');
    }
    this.base = params.base;
    this.networkPassphrase = params.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE;
    this.dappOriginOverride = params.dappOrigin;
    this.returnUrlOverride = params.returnUrl;
    this.productUrl = apexOrigin(this.base);
  }

  /** Nido is a hosted wallet — always available; no extension to install. */
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getNetwork(): Promise<{ network: string; networkPassphrase: string }> {
    return {
      network: this.networkPassphrase === DEFAULT_NETWORK_PASSPHRASE ? 'testnet' : 'unknown',
      networkPassphrase: this.networkPassphrase,
    };
  }

  /**
   * Return the user's selected smart-account C-address.
   *
   * Always opens the apex `/connect/` picker (so users with several accounts
   * can switch on every reconnect), passing the cached address as `previous`
   * so the picker highlights it — and, when the device has exactly one
   * account and it matches, auto-confirms without showing UI. Pass
   * `skipRequestAccess: true` to read the cache only (throws if empty rather
   * than prompting). The SEP-43 `path` param is accepted but unused — there
   * is no derivation path to select; the picker is always shown instead.
   */
  async getAddress(params?: { path?: string; skipRequestAccess?: boolean }): Promise<{ address: string }> {
    const cached = loadCachedAddress();
    if (params?.skipRequestAccess) {
      if (cached) return { address: cached };
      throw new Error('Nido: no account connected. Call getAddress without skipRequestAccess to pick one.');
    }

    const url = connectUrl({
      base: this.base,
      dappOrigin: this.dappOrigin(),
      returnUrl: this.returnUrl(),
      previous: cached ?? undefined,
    });
    const { search } = await openCeremonyPopup(url, apexOrigin(this.base));
    const result = parseConnectReturn(search);
    if (!result) throw new Error('Nido: the connect window returned no result.');
    if (result.status === 'cancelled') throw new Error('Nido: account selection was cancelled.');
    if (result.status === 'error') throw new Error(`Nido: ${result.error}`);

    saveCachedAddress(result.address);
    return { address: result.address };
  }

  /**
   * Sign (or submit) a transaction via the Nido sign page.
   *
   * Returns a SEP-43-compatible `{ signedTxXdr; signerAddress? }` object.
   * For classic wallets (G-address paths) `signedTxXdr` is the signed XDR and
   * the dApp should submit it normally.
   *
   * For smart-account paths the Nido relayer may submit the transaction
   * on-chain and return `submitted: true` with the transaction hash in
   * `signedTxXdr`. When `submitted` is `true` the dApp MUST NOT re-broadcast —
   * use `signedTxXdr` as the transaction hash to track or display the result.
   */
  async signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string; path?: string },
  ): Promise<{ signedTxXdr: string; signerAddress?: string; submitted?: true }> {
    const account = await this.resolveAccount(opts?.address);
    const url = signTransactionUrl({
      base: this.base,
      account,
      xdr,
      networkPassphrase: opts?.networkPassphrase ?? this.networkPassphrase,
      dappOrigin: this.dappOrigin(),
      returnUrl: this.returnUrl(),
    });
    const { result, submitted } = await this.runSign(url, account);
    return submitted
      ? { signedTxXdr: result, signerAddress: account, submitted: true }
      : { signedTxXdr: result, signerAddress: account };
  }

  async signMessage(
    message: string,
    opts?: { networkPassphrase?: string; address?: string; path?: string },
  ): Promise<{ signedMessage: string; signerAddress?: string }> {
    const account = await this.resolveAccount(opts?.address);
    const url = signMessageUrl({
      base: this.base,
      account,
      message,
      dappOrigin: this.dappOrigin(),
      returnUrl: this.returnUrl(),
    });
    const { result } = await this.runSign(url, account);
    return { signedMessage: result, signerAddress: account };
  }

  async signAuthEntry(
    authEntry: string,
    opts?: { networkPassphrase?: string; address?: string; path?: string },
  ): Promise<{ signedAuthEntry: string; signerAddress?: string }> {
    const account = await this.resolveAccount(opts?.address);
    const url = signAuthEntryUrl({
      base: this.base,
      account,
      authEntry,
      networkPassphrase: opts?.networkPassphrase ?? this.networkPassphrase,
      dappOrigin: this.dappOrigin(),
      returnUrl: this.returnUrl(),
    });
    const { result } = await this.runSign(url, account);
    return { signedAuthEntry: result, signerAddress: account };
  }

  /** The kit calls this on disconnect; drop the cached address. */
  async disconnect(): Promise<void> {
    clearCachedAddress();
  }

  // onChange has no async state to report for a redirect wallet; intentionally
  // omitted (it's optional on the interface).

  // --- internals ---

  private dappOrigin(): string {
    return this.dappOriginOverride ?? window.location.origin;
  }

  private returnUrl(): string {
    return this.returnUrlOverride ?? window.location.href;
  }

  /** Use the explicit `opts.address`, else the cached one, else prompt the picker. */
  private async resolveAccount(address?: string): Promise<string> {
    if (address) return address;
    const cached = loadCachedAddress();
    if (cached) return cached;
    return (await this.getAddress()).address;
  }

  private async runSign(url: string, account: string): Promise<{ result: string; submitted: boolean }> {
    const { search } = await openCeremonyPopup(url, accountOrigin(this.base, account));
    const parsed = parseSignReturn(search);
    if (!parsed) throw new Error('Nido: the sign window returned no result.');
    if (parsed.status === 'cancelled') throw new Error('Nido: signing was cancelled.');
    if (parsed.status === 'switch-account') {
      // The user wants another account. Forget the bound one so the next
      // connect doesn't fast-path back to it, and reject with a distinct,
      // documented error the dApp can catch (re-run connect, rebuild the tx).
      clearCachedAddress();
      throw new AccountSwitchRequestedError();
    }
    if (parsed.status === 'error') throw new Error(`Nido: ${parsed.error}`);
    // `ok` → caller should submit; `submitted` → relayer already submitted.
    return { result: parsed.result, submitted: parsed.status === 'submitted' };
  }
}
