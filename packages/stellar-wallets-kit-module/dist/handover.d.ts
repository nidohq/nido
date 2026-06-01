/**
 * Pure parsing + caching helpers for the redirect/return handover.
 *
 * The wallet hands control back to the dApp by redirecting to the `return`
 * URL with query params. These functions read those params off a query string
 * (so they're trivially unit-testable: pass `window.location.search`) and the
 * cache helpers persist the user's chosen C-address in the dApp origin's
 * localStorage. The address is non-secret — it's only an identifier — so
 * caching it at the dApp origin is fine.
 */
export type ConnectReturn = {
    status: 'ok';
    address: string;
} | {
    status: 'cancelled';
} | {
    status: 'error';
    error: string;
};
/**
 * Read the result of a `/connect/` ceremony off a query string. Returns
 * `null` if the query carries none of the connect params (i.e. this wasn't a
 * return navigation from the picker).
 */
export declare function parseConnectReturn(search: string): ConnectReturn | null;
export type SignKind = 'tx' | 'message' | 'authEntry';
export type SignReturn = {
    status: 'ok';
    kind: SignKind;
    result: string;
} | {
    status: 'cancelled';
} | {
    status: 'error';
    error: string;
};
/**
 * Read the result of a `/sign/` ceremony off a query string. `result` is the
 * signed XDR / message / auth-entry depending on `kind`. Returns `null` if the
 * query carries none of the sign params.
 */
export declare function parseSignReturn(search: string): SignReturn | null;
/**
 * Load the C-address the user last selected for this dApp origin, or `null`.
 */
export declare function loadCachedAddress(): string | null;
/** Cache the user's selected C-address at this dApp origin. */
export declare function saveCachedAddress(address: string): void;
/** Forget the cached address (e.g. on an explicit disconnect). */
export declare function clearCachedAddress(): void;
//# sourceMappingURL=handover.d.ts.map