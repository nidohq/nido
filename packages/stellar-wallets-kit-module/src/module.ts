/**
 * `G2cModule` — a `@creit.tech/stellar-wallets-kit` module that surfaces a
 * g2c passkey smart-account in the kit's wallet picker, so any dApp using the
 * kit can use g2c with no g2c-specific code.
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
 * non-secret identifier), so repeat `getAddress` calls don't re-prompt the
 * picker unless `skipRequestAccess` is false and nothing is cached.
 */

import {
  type ModuleInterface,
  type IOnChangeEvent,
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

export const G2C_ID = 'g2c';

const DEFAULT_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

/**
 * A 1x1 transparent-ish g2c mark. Inline data-URI so the module has no asset
 * dependency. Replace with the production logo when available.
 */
const G2C_ICON =
  'data:image/svg+xml;base64,' +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1a6b3a"/><text x="16" y="22" font-family="sans-serif" font-size="16" font-weight="700" fill="#e0e0e0" text-anchor="middle">g2c</text></svg>`,
  );

export interface G2cModuleParams {
  /**
   * The g2c deployment base domain, e.g. `g2c.example.xyz`. May carry an
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

export class G2cModule implements ModuleInterface {
  moduleType: ModuleType = ModuleType.HOT_WALLET;
  productId: string = G2C_ID;
  productName: string = 'g2c (passkey)';
  productUrl: string;
  productIcon: string = G2C_ICON;

  private base: string;
  private networkPassphrase: string;
  private dappOriginOverride?: string;
  private returnUrlOverride?: string;

  constructor(params: G2cModuleParams) {
    if (!params?.base) {
      throw new Error('G2cModule requires a `base` domain (e.g. "g2c.example.xyz").');
    }
    this.base = params.base;
    this.networkPassphrase = params.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE;
    this.dappOriginOverride = params.dappOrigin;
    this.returnUrlOverride = params.returnUrl;
    this.productUrl = apexOrigin(this.base);
  }

  /** g2c is a hosted wallet — always available; no extension to install. */
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
   * Return the user's selected smart-account C-address. Uses the dApp-origin
   * cache when present; otherwise opens the apex `/connect/` picker. Pass
   * `skipRequestAccess: true` to read the cache only (throws if empty rather
   * than prompting).
   */
  async getAddress(params?: { path?: string; skipRequestAccess?: boolean }): Promise<{ address: string }> {
    const cached = loadCachedAddress();
    if (cached) return { address: cached };
    if (params?.skipRequestAccess) {
      throw new Error('g2c: no account connected. Call getAddress without skipRequestAccess to pick one.');
    }

    const url = connectUrl({
      base: this.base,
      dappOrigin: this.dappOrigin(),
      returnUrl: this.returnUrl(),
    });
    const { search } = await openCeremonyPopup(url, apexOrigin(this.base));
    const result = parseConnectReturn(search);
    if (!result) throw new Error('g2c: the connect window returned no result.');
    if (result.status === 'cancelled') throw new Error('g2c: account selection was cancelled.');
    if (result.status === 'error') throw new Error(`g2c: ${result.error}`);

    saveCachedAddress(result.address);
    return { address: result.address };
  }

  async signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string; path?: string },
  ): Promise<{ signedTxXdr: string; signerAddress?: string }> {
    const account = await this.resolveAccount(opts?.address);
    const url = signTransactionUrl({
      base: this.base,
      account,
      xdr,
      networkPassphrase: opts?.networkPassphrase ?? this.networkPassphrase,
      dappOrigin: this.dappOrigin(),
      returnUrl: this.returnUrl(),
    });
    const signed = await this.runSign(url, account);
    return { signedTxXdr: signed, signerAddress: account };
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
    const signed = await this.runSign(url, account);
    return { signedMessage: signed, signerAddress: account };
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
    const signed = await this.runSign(url, account);
    return { signedAuthEntry: signed, signerAddress: account };
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

  private async runSign(url: string, account: string): Promise<string> {
    const { search } = await openCeremonyPopup(url, accountOrigin(this.base, account));
    const result = parseSignReturn(search);
    if (!result) throw new Error('g2c: the sign window returned no result.');
    if (result.status === 'cancelled') throw new Error('g2c: signing was cancelled.');
    if (result.status === 'error') throw new Error(`g2c: ${result.error}`);
    return result.result;
  }
}
