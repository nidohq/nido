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
import { isContractId } from '@g2c/passkey-sdk';
/** Strip a leading scheme if present; returns `[scheme | null, host]`. */
function splitScheme(base) {
    const m = base.match(/^([a-z]+):\/\/(.+)$/i);
    if (m)
        return [m[1], m[2]];
    return [null, base];
}
/**
 * If `host` is a g2c PR-preview base (`pr-<N>.<apex>`), return `["<N>", apex]`;
 * otherwise `[null, host]`.
 *
 * g2c encodes preview deployments into a single subdomain level so wildcard
 * TLS still matches: the account page in a preview lives at
 * `<c-address>--pr-<N>.<apex>`, NOT `<c-address>.pr-<N>.<apex>`. The base this
 * module is configured with (derived from the dApp's own host via
 * `stripSubdomain`) collapses to the bare `pr-<N>.<apex>` form in previews, so
 * we have to re-expand it here when building the per-account origin.
 */
function splitPreview(host) {
    const parts = host.split('.');
    if (parts.length <= 1)
        return [null, host];
    const m = parts[0].match(/^pr-(\d+)$/);
    if (m)
        return [m[1], parts.slice(1).join('.')];
    return [null, host];
}
/**
 * The apex origin for the g2c deployment, e.g. `https://g2c.example.xyz`.
 * If `base` already carries a scheme (handy for `http://localhost:4321` in
 * dev) it's preserved; otherwise `https` is assumed.
 */
export function apexOrigin(base) {
    const [scheme, host] = splitScheme(base);
    return `${scheme ?? 'https'}://${host}`;
}
/**
 * The wallet origin for a specific smart account: the lowercased C-address as
 * a subdomain of the base. This is where the primary-passkey ceremony must run
 * so WebAuthn's `rpId` matches the credential registered at that subdomain.
 */
export function accountOrigin(base, account) {
    if (!isContractId(account)) {
        throw new Error(`accountOrigin: not a contract id: ${account}`);
    }
    const [scheme, host] = splitScheme(base);
    const acc = account.toLowerCase();
    const [preview, apex] = splitPreview(host);
    // In a preview the account lives at `<acc>--pr-<N>.<apex>` (one subdomain
    // level) so wildcard TLS + the WebAuthn rpId both still match; in production
    // it's simply `<acc>.<host>`.
    const accountHost = preview ? `${acc}--pr-${preview}.${apex}` : `${acc}.${host}`;
    return `${scheme ?? 'https'}://${accountHost}`;
}
/**
 * The apex account picker. The user chooses a smart account; the picker
 * returns its C-address (non-secret) to `returnUrl`.
 */
export function connectUrl(p) {
    const u = new URL('/connect/', apexOrigin(p.base));
    u.searchParams.set('dapp', p.dappOrigin);
    u.searchParams.set('return', p.returnUrl);
    return u.toString();
}
/** The per-account transaction-signing ceremony URL. */
export function signTransactionUrl(p) {
    const u = new URL('/sign/', accountOrigin(p.base, p.account));
    u.searchParams.set('kind', 'tx');
    u.searchParams.set('xdr', p.xdr);
    if (p.networkPassphrase)
        u.searchParams.set('network', p.networkPassphrase);
    u.searchParams.set('dapp', p.dappOrigin);
    u.searchParams.set('return', p.returnUrl);
    return u.toString();
}
/** The per-account arbitrary-message-signing ceremony URL. */
export function signMessageUrl(p) {
    const u = new URL('/sign/', accountOrigin(p.base, p.account));
    u.searchParams.set('kind', 'message');
    u.searchParams.set('message', p.message);
    u.searchParams.set('dapp', p.dappOrigin);
    u.searchParams.set('return', p.returnUrl);
    return u.toString();
}
/** The per-account auth-entry-signing ceremony URL. */
export function signAuthEntryUrl(p) {
    const u = new URL('/sign/', accountOrigin(p.base, p.account));
    u.searchParams.set('kind', 'authEntry');
    u.searchParams.set('authEntry', p.authEntry);
    if (p.networkPassphrase)
        u.searchParams.set('network', p.networkPassphrase);
    u.searchParams.set('dapp', p.dappOrigin);
    u.searchParams.set('return', p.returnUrl);
    return u.toString();
}
//# sourceMappingURL=urls.js.map