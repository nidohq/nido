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
import { type ModuleInterface, ModuleType } from '@creit.tech/stellar-wallets-kit';
export declare const G2C_ID = "g2c";
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
export declare class G2cModule implements ModuleInterface {
    moduleType: ModuleType;
    productId: string;
    productName: string;
    productUrl: string;
    productIcon: string;
    private base;
    private networkPassphrase;
    private dappOriginOverride?;
    private returnUrlOverride?;
    constructor(params: G2cModuleParams);
    /** g2c is a hosted wallet — always available; no extension to install. */
    isAvailable(): Promise<boolean>;
    getNetwork(): Promise<{
        network: string;
        networkPassphrase: string;
    }>;
    /**
     * Return the user's selected smart-account C-address. Uses the dApp-origin
     * cache when present; otherwise opens the apex `/connect/` picker. Pass
     * `skipRequestAccess: true` to read the cache only (throws if empty rather
     * than prompting).
     */
    getAddress(params?: {
        path?: string;
        skipRequestAccess?: boolean;
    }): Promise<{
        address: string;
    }>;
    signTransaction(xdr: string, opts?: {
        networkPassphrase?: string;
        address?: string;
        path?: string;
    }): Promise<{
        signedTxXdr: string;
        signerAddress?: string;
    }>;
    signMessage(message: string, opts?: {
        networkPassphrase?: string;
        address?: string;
        path?: string;
    }): Promise<{
        signedMessage: string;
        signerAddress?: string;
    }>;
    signAuthEntry(authEntry: string, opts?: {
        networkPassphrase?: string;
        address?: string;
        path?: string;
    }): Promise<{
        signedAuthEntry: string;
        signerAddress?: string;
    }>;
    /** The kit calls this on disconnect; drop the cached address. */
    disconnect(): Promise<void>;
    private dappOrigin;
    private returnUrl;
    /** Use the explicit `opts.address`, else the cached one, else prompt the picker. */
    private resolveAccount;
    private runSign;
}
//# sourceMappingURL=module.d.ts.map