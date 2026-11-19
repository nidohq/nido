// The sign-in list hand-off: how an account reaches the apex's sign-in list
// in a browser that keeps the storage bridge's storage apart from the apex's
// (WebKit: Safari and every browser on iOS; see nidoSharedStorage.ts).
//
// The account's page passes once through the apex's top-level page
// `/new-account/finish/`, which records the account in the apex's own storage
// and returns to the account's wallet. Any site can link to that page, so
// everything in its URL is untrusted:
//
// - The apex lists only an address in its own pending list, one this browser
//   reserved there, and only once the chain shows it is exactly the account
//   `create_account` makes for the passkey key in the link
//   (`verifyNewNidoAccount`, the check nidoSwitcher.ts trusts to promote a
//   pending account).
// - It returns only to that account's own pages, picked from a fixed set by
//   `next`, or for a name claim to the claimed name's page, built from a
//   validated name. Never to a URL taken from the link.
//
// The return carries the outcome in its URL too, which any site can also link
// to. The account origin therefore sends a single-use nonce it keeps in its
// own storage, the apex returns it, and the account origin takes an outcome
// only with that nonce (nidoSharedStorage.ts `takeSignInListReturn`).

import { accountUrl } from "@nidohq/passkey-sdk/url";
import { buildClaimReturnUrl, parseReturnIntent } from "./claimFlow";
import { isContractStrKey } from "./address";
import {
  apexHostForHost,
  issueHandoffNonce,
  ownAccount,
  SIGNIN_LIST_NONCE_PARAM,
  SIGNIN_LIST_RETURN_PARAM,
} from "./nidoSharedStorage";

export const HANDOFF_PATH = "/new-account/finish/";

/** Where the hand-off returns on the account's own origin. */
const NEXT_PATHS = { account: "/account/", recovery: "/security/recovery/" } as const;
export type HandoffNext = keyof typeof NEXT_PATHS;

export interface Handoff {
  contractId: string;
  /** The account's passkey public key (65-byte SEC1), or null if the link's is unusable. */
  publicKey: Uint8Array | null;
  next: HandoffNext;
  /** A name being claimed (claimFlow.ts): the hand-off returns to its page. */
  claimName: string | null;
  /** The account origin's nonce, returned to it with the outcome. */
  nonce: string | null;
}

/** `not-listed`: the apex will not list this address, now or on another try.
 *  `unverified`: it would, but the chain check did not pass this time. */
export type HandoffOutcome = "listed" | "not-listed" | "unverified";

const PUBLIC_KEY_HEX_RE = /^04[0-9a-f]{128}$/i;
const NONCE_RE = /^[0-9a-f]{32}$/;

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * From an account origin, when about to open it: the apex hand-off URL for
 * `contractId`, or null on the apex itself. `then` is the setup's claim
 * return intent, if any. Each URL carries a new nonce, kept in `store`, which
 * replaces the last.
 */
export function handoffUrl(
  location: Pick<Location, "protocol" | "host">,
  h: { contractId: string; publicKeyHex: string; next: HandoffNext; then?: string | null },
  store: Pick<Storage, "setItem"> = localStorage,
): string | null {
  const apex = apexHostForHost(location.host);
  if (apex === location.host) return null;
  const params = new URLSearchParams({
    c: h.contractId,
    pk: h.publicKeyHex,
    next: h.next,
    n: issueHandoffNonce(h.contractId, store),
  });
  if (h.then) params.set("then", h.then);
  return `${location.protocol}//${apex}${HANDOFF_PATH}#${params}`;
}

/** This origin's own account and the passkey key it registered for it. Null
 *  when this is not an account origin or it holds no passkey record. */
function ownPasskey(
  location: Pick<Location, "host">,
  store: Pick<Storage, "getItem">,
): { contractId: string; publicKeyHex: string } | null {
  const contractId = ownAccount(location);
  const publicKeyHex = contractId ? store.getItem(`passkey:${contractId}:publicKey`) : null;
  return contractId && publicKeyHex ? { contractId, publicKeyHex } : null;
}

/** Whether this origin's pages can hand their own account to the apex
 *  ({@link ownHandoffUrl}). */
export function canHandOffOwn(
  location: Pick<Location, "host">,
  store: Pick<Storage, "getItem"> = localStorage,
): boolean {
  return ownPasskey(location, store) !== null;
}

/**
 * From an account origin's own pages (the sign-in list notice), when about
 * to open it: the hand-off for this origin's account, with the passkey key
 * this origin registered for it. Null where {@link canHandOffOwn} is false.
 */
export function ownHandoffUrl(
  location: Pick<Location, "protocol" | "host">,
  store: Pick<Storage, "getItem" | "setItem"> = localStorage,
): string | null {
  const own = ownPasskey(location, store);
  return own && handoffUrl(location, { ...own, next: "account" }, store);
}

/** Read a hand-off link's fragment. Null unless it names a valid contract address. */
export function parseHandoff(hash: string): Handoff | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const contractId = params.get("c")?.toUpperCase() ?? "";
  if (!isContractStrKey(contractId)) return null;
  const pk = params.get("pk") ?? "";
  return {
    contractId,
    publicKey: PUBLIC_KEY_HEX_RE.test(pk) ? hexBytes(pk) : null,
    next: params.get("next") === "recovery" ? "recovery" : "account",
    claimName: parseReturnIntent(params.get("then"))?.name ?? null,
    nonce: NONCE_RE.test(params.get("n") ?? "") ? params.get("n") : null,
  };
}

export interface HandoffDeps {
  /** The apex's active accounts. */
  accounts(): string[];
  /** The apex's unfinished setups: addresses this browser reserved here. */
  unfinished(): { contractId: string }[];
  /** Resolve only if `contractId` is the account create_account makes for `publicKey`. */
  verify(contractId: string, publicKey: Uint8Array): Promise<void>;
  /** Move `contractId` from the pending list to the active one. */
  activate(contractId: string): void;
}

/** On the apex: list the hand-off's account if the rules above allow it. */
export async function completeHandoff(h: Handoff, deps: HandoffDeps): Promise<HandoffOutcome> {
  if (deps.accounts().includes(h.contractId)) return "listed";
  if (!h.publicKey || !deps.unfinished().some((p) => p.contractId === h.contractId)) return "not-listed";
  try {
    await deps.verify(h.contractId, h.publicKey);
  } catch {
    return "unverified";
  }
  deps.activate(h.contractId);
  return "listed";
}

/** On the apex: where the hand-off returns, carrying its outcome and the
 *  account origin's nonce. */
export function handoffReturnUrl(
  location: Pick<Location, "protocol" | "host">,
  h: Handoff,
  outcome: HandoffOutcome,
): string {
  const params = new URLSearchParams({ [SIGNIN_LIST_RETURN_PARAM]: outcome });
  if (h.nonce) params.set(SIGNIN_LIST_NONCE_PARAM, h.nonce);
  const result = `#${params}`;
  if (h.claimName) {
    return `${buildClaimReturnUrl({ apexHost: location.host, name: h.claimName, contractId: h.contractId, protocol: location.protocol })}${result}`;
  }
  return `${location.protocol}${accountUrl(location.host, h.contractId, NEXT_PATHS[h.next])}${result}`;
}
