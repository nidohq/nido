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
import { ModuleType, } from '@creit.tech/stellar-wallets-kit';
import { connectUrl, signTransactionUrl, signMessageUrl, signAuthEntryUrl, apexOrigin, accountOrigin, } from './urls.js';
import { parseConnectReturn, parseSignReturn, loadCachedAddress, saveCachedAddress, clearCachedAddress, } from './handover.js';
import { openCeremonyPopup } from './redirect.js';
export const G2C_ID = 'g2c';
const DEFAULT_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
/**
 * A 1x1 transparent-ish g2c mark. Inline data-URI so the module has no asset
 * dependency. Replace with the production logo when available.
 */
const G2C_ICON = 'data:image/svg+xml;base64,' +
    btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1a6b3a"/><text x="16" y="22" font-family="sans-serif" font-size="16" font-weight="700" fill="#e0e0e0" text-anchor="middle">g2c</text></svg>`);
export class G2cModule {
    moduleType = ModuleType.HOT_WALLET;
    productId = G2C_ID;
    productName = 'g2c (passkey)';
    productUrl;
    productIcon = G2C_ICON;
    base;
    networkPassphrase;
    dappOriginOverride;
    returnUrlOverride;
    constructor(params) {
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
    async isAvailable() {
        return true;
    }
    async getNetwork() {
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
    async getAddress(params) {
        const cached = loadCachedAddress();
        if (cached)
            return { address: cached };
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
        if (!result)
            throw new Error('g2c: the connect window returned no result.');
        if (result.status === 'cancelled')
            throw new Error('g2c: account selection was cancelled.');
        if (result.status === 'error')
            throw new Error(`g2c: ${result.error}`);
        saveCachedAddress(result.address);
        return { address: result.address };
    }
    async signTransaction(xdr, opts) {
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
    async signMessage(message, opts) {
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
    async signAuthEntry(authEntry, opts) {
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
    async disconnect() {
        clearCachedAddress();
    }
    // onChange has no async state to report for a redirect wallet; intentionally
    // omitted (it's optional on the interface).
    // --- internals ---
    dappOrigin() {
        return this.dappOriginOverride ?? window.location.origin;
    }
    returnUrl() {
        return this.returnUrlOverride ?? window.location.href;
    }
    /** Use the explicit `opts.address`, else the cached one, else prompt the picker. */
    async resolveAccount(address) {
        if (address)
            return address;
        const cached = loadCachedAddress();
        if (cached)
            return cached;
        return (await this.getAddress()).address;
    }
    async runSign(url, account) {
        const { search } = await openCeremonyPopup(url, accountOrigin(this.base, account));
        const result = parseSignReturn(search);
        if (!result)
            throw new Error('g2c: the sign window returned no result.');
        if (result.status === 'cancelled')
            throw new Error('g2c: signing was cancelled.');
        if (result.status === 'error')
            throw new Error(`g2c: ${result.error}`);
        return result.result;
    }
}
//# sourceMappingURL=module.js.map