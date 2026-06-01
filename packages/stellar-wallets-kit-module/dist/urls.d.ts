/**
 * Pure URL construction for the g2c stellar-wallets-kit module.
 *
 * The module runs at the *dApp* origin, so — unlike the wallet's own pages —
 * it can't derive the g2c base domain from `window.location`. The base is
 * supplied as configuration (e.g. `g2c.example.xyz` or `http://localhost:4321`)
 * and these helpers turn it into the apex `/connect/` picker URL and the
 * per-account `<c-address>.<base>/sign/` ceremony URL.
 *
 * Mirrors the redirect+return pattern established by `delegationHandover.ts`:
 * every URL carries the dApp `origin` and a same-origin `return` URL so the
 * wallet can hand control back and the dApp can verify the response came from
 * the origin it expects.
 */
/**
 * The apex origin for the g2c deployment, e.g. `https://g2c.example.xyz`.
 * If `base` already carries a scheme (handy for `http://localhost:4321` in
 * dev) it's preserved; otherwise `https` is assumed.
 */
export declare function apexOrigin(base: string): string;
/**
 * The wallet origin for a specific smart account: the lowercased C-address as
 * a subdomain of the base. This is where the primary-passkey ceremony must run
 * so WebAuthn's `rpId` matches the credential registered at that subdomain.
 */
export declare function accountOrigin(base: string, account: string): string;
export interface ConnectUrlParams {
    /** g2c base domain (optionally scheme-prefixed). */
    base: string;
    /** The dApp's own origin, surfaced to the user at the picker. */
    dappOrigin: string;
    /** Same-origin URL the picker should send the user back to. */
    returnUrl: string;
}
/**
 * The apex account picker. The user chooses a smart account; the picker
 * returns its C-address (non-secret) to `returnUrl`.
 */
export declare function connectUrl(p: ConnectUrlParams): string;
export interface SignTxUrlParams {
    base: string;
    /** Selected smart-account C-address. */
    account: string;
    /** Transaction XDR (base64) to sign. */
    xdr: string;
    /** Network passphrase the dApp wants the tx signed for. */
    networkPassphrase?: string;
    dappOrigin: string;
    returnUrl: string;
}
/** The per-account transaction-signing ceremony URL. */
export declare function signTransactionUrl(p: SignTxUrlParams): string;
export interface SignMessageUrlParams {
    base: string;
    account: string;
    message: string;
    dappOrigin: string;
    returnUrl: string;
}
/** The per-account arbitrary-message-signing ceremony URL. */
export declare function signMessageUrl(p: SignMessageUrlParams): string;
export interface SignAuthEntryUrlParams {
    base: string;
    account: string;
    /** Base64 XDR of a `HashIdPreimageSorobanAuthorization`. */
    authEntry: string;
    networkPassphrase?: string;
    dappOrigin: string;
    returnUrl: string;
}
/** The per-account auth-entry-signing ceremony URL. */
export declare function signAuthEntryUrl(p: SignAuthEntryUrlParams): string;
//# sourceMappingURL=urls.d.ts.map