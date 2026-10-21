export type OperationDescriptor =
  | { type: "register"; name: string }
  | { type: "transfer"; token: string; to: string; amountRaw: string; decimals?: number; code?: string }
  | {
      type: "add-context-rule";
      target: string;
      signerPublicKeyHex: string;
      verifierAddress: string;
      validUntil: number | null;
      limit?: { stroops: string; periodLedgers: number } | null;
      label?: string;
      /** Human-readable expiry label set by the caller (e.g. "7 days", "Until revoked").
       *  /sign/ uses this instead of computing a date from the ledger sequence. */
      expiryLabel?: string;
    }
  | { type: "remove-context-rule"; ruleId: number; target: string }
  | {
      /** Apply a perch policy document (the doc-based session-grant flow).
       *  The doc is the source of truth — scope, signers, functions, expiry,
       *  and cap all live in `docJson`, so nothing here is editable at /sign/
       *  (adjustments happen on the delegate-doc page, before the handoff).
       *  Every policy write is an `apply_doc` — a whole-document REPLACE —
       *  so `docJson` is the full updated document, and `prevDocJson` lets
       *  /sign/ show exactly what changes vs the currently applied one. */
      type: "apply-policy-doc";
      /** Canonical doc JSON — the exact bytes `apply_doc` receives (and the
       *  bytes whose sha256 is the doc_hash shown to the user). */
      docJson: string;
      /** Canonical JSON of the CURRENTLY applied document at request-build
       *  time; absent on a first apply. Display-only (the diff panel). */
      prevDocJson?: string;
      /** The configuration revision (decimal) `docJson` was composed from.
       *  The apply names it as `expected_revision`, so it lands only if the
       *  account hasn't changed since. REQUIRED: a request that omits it is
       *  refused, never silently rebound to the revision read
       *  at signing time — that rebinding would let an older stashed document
       *  overwrite intervening rule changes while still passing the on-chain
       *  stale-revision check. */
      expectedRevision: string;
      /** Human-readable expiry label (e.g. "24 hours"), as for add-context-rule. */
      expiryLabel?: string;
    }
  | { type: "raw-xdr"; xdr: string };

export type SignKind =
  | "name-claim" | "transfer" | "session-grant" | "session-revoke" | "dapp-tx" | "generic";

export type SubmitMode = "relayer" | "return-to-dapp";

export type EditableControl = {
  field: "spending-limit";
  initialStroops: string | null;
  initialPeriod: "day" | "week" | "30d";
};

export type ReturnTarget =
  | { type: "route"; url: string }
  // `successQuery` overrides the default submitted-marker query a dApp return
  // appends on success. ADDITIVE: when absent (the dapp-tx path), /sign/ keeps
  // appending `?nido_submitted=<hash>&kind=tx`. The session-grant caller sets
  // it to `?delegation=ok` so the existing `delegationHandover.readDelegationReturn`
  // contract keeps working unchanged.
  | { type: "dapp"; origin: string; returnUrl?: string; successQuery?: string };

export interface SignRequest {
  v: 1;
  kind: SignKind;
  account: string;
  operation: OperationDescriptor;
  title: string;
  subtitle?: string;
  submitMode: SubmitMode;
  editable?: EditableControl[];
  returnTarget: ReturnTarget;
  networkPassphrase?: string;
}

import { stripSubdomain } from "@nidohq/passkey-sdk";
import { isLoopbackHttpHost } from "../loopbackHost.js";

export { isLoopbackHttpHost };

const KEY = (id: string) => `nido:signreq:${id}`;

export function stashSignRequest(req: SignRequest, store: Storage = sessionStorage): string {
  const id = crypto.randomUUID();
  store.setItem(KEY(id), JSON.stringify(req));
  return id;
}

export function loadSignRequest(id: string, store: Storage = sessionStorage): SignRequest | null {
  const raw = store.getItem(KEY(id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SignRequest;
    if (!parsed || parsed.v !== 1) return null;
    // An apply-policy-doc request must name the revision it was composed
    // from. Refuse one that omits it rather than letting the builder rebind
    // it to the revision read at signing time (which would defeat the
    // stale-document protection).
    const op = parsed.operation;
    if (
      op && op.type === "apply-policy-doc" &&
      (typeof op.expectedRevision !== "string" || op.expectedRevision.length === 0)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Remove a stashed SignRequest (F3 — back/forward replay hygiene).
 *
 *  Called from /sign/ ONLY after a successful submit, never on load: a failed
 *  attempt must stay retryable. After consumption the entry is gone, so a
 *  back-button to `/sign/?req=<id>` reloads nothing rather than re-submitting
 *  the same request. */
export function clearSignRequest(id: string, store: Storage = sessionStorage): void {
  store.removeItem(KEY(id));
}

/** Strip a trailing `:port` from a host string, yielding the bare hostname.
 *  IPv6 literals aren't used by this app, so a simple last-colon split is fine. */
function hostnameOf(host: string): string {
  const i = host.lastIndexOf(":");
  return i === -1 ? host : host.slice(0, i);
}

/** Validate a route-return URL and normalise it (F1 — XSS / open-redirect guard).
 *
 *  Returns the URL string only when it resolves (against `base`) to an http(s)
 *  location on the SAME ACCOUNT ROOT as `base` — the apex itself, or one label
 *  below it (`stripSubdomain`, which reads the apex from the known-apex list).
 *  Everything else (including `javascript:`, `data:`, foreign origins, another
 *  Nido apex such as `test.nido.fyi` from `nido.fyi`, protocol-relative
 *  `//evil`, and userinfo tricks) is rejected. Used at the /sign/ sink (fall
 *  back to /account/).
 *
 *  Why not strict same-origin? Name-claim returns from `<contractid>.<apex>`
 *  to `<name>.<apex>` (`/account/?namepasskey=1`, to fire moment-B passkey
 *  registration), a cross-subdomain hop the unified /sign/ surface depends on.
 *  It builds its destination with `accountUrl(stripSubdomain(host), …)`, so the
 *  allowlist is derived the SAME way (`stripSubdomain(base.host)`).
 *
 *  SECURITY: parse with the WHATWG `URL` so backslash / userinfo / whitespace
 *  tricks are normalised before the hostname check. The roots are compared
 *  whole, so `evil-nido.fyi` and `nido.fyi.evil.com` never match `nido.fyi`.
 *  http is permitted only for localhost/127.0.0.1 (dev).
 *
 *  `base` lets callers resolve relative URLs (e.g. `/account/`) and supplies the
 *  current host whose parent domain forms the allowlist — pass
 *  `window.location.origin` in the browser. */
export function safeRouteUrl(url: string | null | undefined, base: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, base);
    const baseUrl = new URL(base);

    // Loopback hosts may be served over http during dev; everything else must be https.
    if (u.protocol === "https:") {
      // ok
    } else if (u.protocol === "http:" && isLoopbackHttpHost(u.hostname)) {
      // ok (dev)
    } else {
      return null;
    }

    // Same account root as the current host. `stripSubdomain` reduces a host to
    // its account root (apex in prod, the `<N>.<apex>` preview root in previews,
    // `localhost:<port>` in dev), so preview siblings like `<name>--24.<apex>`
    // share their root and production never reaches into a preview.
    const root = hostnameOf(stripSubdomain(baseUrl.host));
    return hostnameOf(stripSubdomain(u.host)) === root ? u.href : null;
  } catch {
    return null;
  }
}

/** Normalise an absolute URL to its ORIGIN iff it is a usable dApp origin:
 *  https anywhere, or http only for loopback dev hosts (localhost, any
 *  `*.localhost` subdomain, 127.0.0.1 — see {@link isLoopbackHttpHost}).
 *  Returns null for malformed, relative, or disallowed-scheme
 *  (`javascript:`/`data:`/…) inputs.
 *
 *  Unlike `safeRouteUrl`, this deliberately does NOT restrict to the same
 *  parent domain — a dApp is legitimately a FOREIGN origin. It only enforces a
 *  well-formed http(s) scheme, so it is the right check for the cross-app
 *  signing return, where `safeRouteUrl`'s same-parent-domain rule would wrongly
 *  reject every real dApp. */
export function httpOrigin(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return u.origin;
    if (u.protocol === "http:" && isLoopbackHttpHost(u.hostname)) {
      return u.origin;
    }
    return null;
  } catch {
    return null;
  }
}

/** Why a request naming `requested` as its network can't be signed by a
 *  wallet on `walletNetwork`, or undefined when it names none or the wallet's
 *  own. The `network` a dApp passes is only a claim; a signature made for
 *  another network's passphrase would be valid there, not here. */
export function networkProblem(
  requested: string | null | undefined,
  walletNetwork: string,
): string | undefined {
  if (requested == null || requested === "" || requested === walletNetwork) return undefined;
  return "This request is for a different Stellar network than this wallet, so Nido won't sign it.";
}

/** Why a dApp origin / return pair was rejected, for the page's error copy. */
export type DappReturnError = 'missing-dapp' | 'malformed-dapp' | 'bad-return';

/**
 * Validate a `dapp` origin and optional same-origin `return` URL for the
 * connect/sign/delegate ceremonies, using the hardened {@link httpOrigin}
 * scheme check at the ENTRY point (the matching sink guard lives in the kit
 * module's `resolveReturnRedirect`).
 *
 * Rejects `javascript:`/`data:`/`blob:`/opaque-origin values — a bare
 * `new URL(dapp).origin` returns the string `"null"` for those, which is
 * truthy and compares equal to a second opaque origin, so the historical
 * inline validators let a `javascript:` callback through. Returns the
 * normalised origin on success.
 */
export function validateDappReturn(
  dappOrigin: string | null | undefined,
  returnUrl: string | null | undefined,
): { origin: string } | { error: DappReturnError } {
  if (!dappOrigin) return { error: 'missing-dapp' };
  const origin = httpOrigin(dappOrigin);
  if (!origin) return { error: 'malformed-dapp' };
  if (returnUrl) {
    if (httpOrigin(returnUrl) !== origin) return { error: 'bad-return' };
  }
  return { origin };
}

export function signRequestFromParams(params: URLSearchParams, account: string | null): SignRequest | null {
  if (!account) return null;
  const kind = params.get("kind") ?? "tx";
  if (kind !== "tx") return null; // message/authEntry keep their own (non-submitting) path
  const xdr = params.get("xdr");
  const dapp = params.get("dapp");
  if (!xdr || !dapp) return null;
  const ret = params.get("return") ?? undefined;
  const network = params.get("network") ?? undefined;

  // Validate the dApp origin + return at the SOURCE (defence in depth — the
  // /sign/ page re-validates the same way at consume time). A dApp is a foreign
  // origin by design, so `safeRouteUrl` does NOT apply here; instead require:
  //   - `dapp` is a well-formed http(s) origin (rejects javascript:/data:/malformed);
  //   - if a `return` URL is given, it is SAME-ORIGIN as `dapp`.
  // This closes the spoof-origin / exfiltrate-signature vector (a page passing
  // dapp=<trusted>&return=<attacker> so /sign/ displays the trusted name while
  // the signature is posted to the attacker): the mismatch is rejected right
  // here, so a hostile SignRequest is never stashed in the first place. The
  // normalised origin (not the raw param) is what gets displayed downstream.
  const origin = httpOrigin(dapp);
  if (!origin) return null;
  if (ret !== undefined && httpOrigin(ret) !== origin) return null;

  return {
    v: 1, kind: "dapp-tx", account,
    operation: { type: "raw-xdr", xdr },
    title: "Confirm it's you",
    // F8: the /sign/ lead is the fixed sentence "<origin> wants this account to
    // sign a <subtitle>." — so the subtitle must be the bare NOUN, not a full
    // sentence, or the copy doubles ("…sign a <dapp> wants this account to…").
    subtitle: "transaction",
    submitMode: "return-to-dapp",
    returnTarget: { type: "dapp", origin, returnUrl: ret },
    networkPassphrase: network,
  };
}
