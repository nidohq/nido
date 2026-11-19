// The storage bridge page imports this module, so it imports only the SDK's
// storage and url modules, never the SDK's main entry: the bridge must answer
// within moments on a slow phone, and the main entry is a 2 MB chunk.
import { nidoKey } from "@nidohq/passkey-sdk/storage";
import { accountUrl, isReservedName, splitHost, stripSubdomain } from "@nidohq/passkey-sdk/url";
import type { PendingAccount } from "./myNidoModel";
import { isContractStrKey } from "./address";
import { isLoopbackHttpHost } from "./loopbackHost";

// The passkey-sdk's account-list keys (saveAccount, savePendingAccount,
// saveAccountName), in this build's network namespace.
const accountKey = () => nidoKey("accounts");
const pendingKey = () => nidoKey("pending");
const namePrefix = () => nidoKey("names:");
const VALID_NAME_RE = /^[a-z][a-z0-9]{0,14}$/;
export const NIDO_STORAGE_REQUEST = "nido:storage:request:v1";
export const NIDO_STORAGE_RESPONSE = "nido:storage:response:v1";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "key" | "length">;

export interface NidoAccountSnapshot {
  accounts: string[];
  pending: PendingAccount[];
  names: Record<string, string>;
}

export interface NidoStorageRequest {
  type: typeof NIDO_STORAGE_REQUEST;
  id: string;
  snapshot: NidoAccountSnapshot;
}

export interface NidoStorageResponse {
  type: typeof NIDO_STORAGE_RESPONSE;
  id: string;
  snapshot: NidoAccountSnapshot;
  /** The bridge could not see the apex's own storage, so it stored nothing
   *  and its (empty) snapshot says nothing about the apex. */
  separated?: true;
}

// A full StrKey check (version byte and checksum), not a length-and-prefix
// test: ids from the bridge are rendered by the account switcher.
function normalizeContractId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const contractId = value.toUpperCase();
  return isContractStrKey(contractId) ? contractId : null;
}

function uniqueContractIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const contractIds: string[] = [];
  for (const value of values) {
    const contractId = normalizeContractId(value);
    if (!contractId || seen.has(contractId)) continue;
    seen.add(contractId);
    contractIds.push(contractId);
  }
  return contractIds;
}

function readJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizePending(values: unknown, active = new Set<string>()): PendingAccount[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const pending: PendingAccount[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const contractId = normalizeContractId(record.contractId);
    if (!contractId || active.has(contractId) || seen.has(contractId)) continue;
    const setupKey =
      typeof record.setupKey === "string" && record.setupKey.length > 0
        ? record.setupKey
        : typeof record.secretKey === "string" && record.secretKey.length > 0
          ? record.secretKey
          : null;
    seen.add(contractId);
    // An entry without a secret is a setup whose secret expired: the address
    // stays so the setup can still be shown and finished.
    pending.push(setupKey ? { contractId, setupKey } : { contractId });
  }
  return pending;
}

function normalizeNames(values: unknown): Record<string, string> {
  if (!values || typeof values !== "object") return {};
  const names: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const contractId = normalizeContractId(key);
    if (!contractId || typeof value !== "string" || !VALID_NAME_RE.test(value)) continue;
    names[contractId] = value;
  }
  return names;
}

function normalizeSnapshot(snapshot: Partial<NidoAccountSnapshot> | null | undefined): NidoAccountSnapshot {
  const accounts = uniqueContractIds(Array.isArray(snapshot?.accounts) ? snapshot.accounts : []);
  const active = new Set(accounts);
  return {
    accounts,
    pending: normalizePending(snapshot?.pending, active),
    names: normalizeNames(snapshot?.names),
  };
}

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

// --- Whose storage a framed page sees -------------------------------------------
//
// WebKit (Safari, and every browser on iOS) gives a frame whose origin differs
// from the top page's its own localStorage, apart from that origin's real
// storage, even when both are one site (`nido.fyi` framed by `<c>.nido.fyi`).
// A bridge framed that way would store what it is sent where the apex never
// reads it, and answer as if it had. Every top-level wallet page marks its
// origin's storage (StorageNetwork.astro), and no framed page writes the mark,
// so a framed page that can't see it knows its storage is not the origin's.

/** Set in an origin's storage by its top-level wallet pages. Not a `nido:`
 *  key: passkey-sdk moves every un-namespaced `nido:` key into
 *  `nido:testnet:` (`moveLegacyNidoKeys`), and the mark is for every network. */
export const FIRST_PARTY_KEY = "nido-first-party";

/** Mark this origin's storage as its own: only from a top-level page. */
export function markFirstPartyStorage(win: Window = window, store: StorageLike | null = storageOrNull()): void {
  if (!store || win.top !== win) return;
  try {
    if (store.getItem(FIRST_PARTY_KEY) === null) store.setItem(FIRST_PARTY_KEY, "1");
  } catch {
    /* storage full or blocked: the bridge then reports itself separated */
  }
}

function seesFirstPartyMark(store: Pick<Storage, "getItem">): boolean {
  return store.getItem(FIRST_PARTY_KEY) !== null;
}

export function localNidoSnapshot(store: StorageLike | null = storageOrNull()): NidoAccountSnapshot {
  if (!store) return { accounts: [], pending: [], names: {} };

  const accounts = uniqueContractIds(readJson(store.getItem(accountKey())));
  const active = new Set(accounts);
  const pending = normalizePending(readJson(store.getItem(pendingKey())), active);
  const names: Record<string, string> = {};

  for (const contractId of [...accounts, ...pending.map((p) => p.contractId)]) {
    const name = store.getItem(`${namePrefix()}${contractId}`);
    if (name && VALID_NAME_RE.test(name)) names[contractId] = name;
  }

  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key?.startsWith(namePrefix())) continue;
    const contractId = normalizeContractId(key.slice(namePrefix().length));
    const name = key ? store.getItem(key) : null;
    if (contractId && name && VALID_NAME_RE.test(name)) names[contractId] = name;
  }

  return { accounts, pending, names };
}

function stableSnapshot(snapshot: NidoAccountSnapshot): string {
  return JSON.stringify({
    accounts: snapshot.accounts,
    pending: snapshot.pending,
    names: Object.fromEntries(Object.entries(snapshot.names).sort(([a], [b]) => a.localeCompare(b))),
  });
}

export function mergeNidoSnapshot(
  incoming: Partial<NidoAccountSnapshot> | null | undefined,
  store: StorageLike | null = storageOrNull(),
): boolean {
  if (!store) return false;

  const before = localNidoSnapshot(store);
  const next = normalizeSnapshot(incoming);
  const accounts = uniqueContractIds([...before.accounts, ...next.accounts]);
  const active = new Set(accounts);
  const pendingById = new Map<string, PendingAccount>();

  for (const pending of [...before.pending, ...next.pending]) {
    // This origin's own entry wins: one whose secret expired here stays
    // secret-less rather than take another origin's copy of the secret.
    if (active.has(pending.contractId) || pendingById.has(pending.contractId)) continue;
    pendingById.set(pending.contractId, pending);
  }

  const after: NidoAccountSnapshot = {
    accounts,
    pending: [...pendingById.values()],
    names: { ...before.names, ...next.names },
  };

  if (stableSnapshot(before) === stableSnapshot(after)) return false;

  store.setItem(accountKey(), JSON.stringify(after.accounts));
  store.setItem(pendingKey(), JSON.stringify(after.pending));
  for (const [contractId, name] of Object.entries(after.names)) {
    store.setItem(`${namePrefix()}${contractId}`, name);
  }

  return true;
}

/**
 * Multi-label public suffixes (eTLDs) under which every host is a SEPARATE
 * site. The storage bridge shares data within one apex, so the computed apex
 * must never be one of these — otherwise `apexHostForHost("evil.pages.dev")`
 * would be `pages.dev`, making every `*.pages.dev` site share one apex and read
 * each other's pending setup salts / inject accounts. (A full Public Suffix
 * List is overkill here; this covers the hosting platforms Nido is deployed
 * to or previewed on.) Getting this set wrong is a cross-site data leak, so
 * treat it as security-critical.
 */
const PUBLIC_SUFFIXES = new Set([
  "pages.dev",
  "workers.dev",
  "github.io",
  "gitlab.io",
  "vercel.app",
  "netlify.app",
  "web.app",
  "firebaseapp.com",
]);

/**
 * The host the storage bridge for `host` lives on: the apex in production, the
 * `<N>.<apex>` preview root in a preview (`stripSubdomain`, which reads the apex
 * from the known-apex list, so `cabc.test.nido.fyi` shares `test.nido.fyi` and
 * never `nido.fyi`).
 */
export function apexHostForHost(host: string): string {
  const apex = stripSubdomain(host);
  // Never collapse to a bare public suffix: treat such a host as its OWN apex
  // so, e.g., `nido-xyz.pages.dev` and `evil.pages.dev` are different apexes.
  return PUBLIC_SUFFIXES.has(apex.split(":")[0]) ? host : apex;
}

/**
 * Who is asking the storage bridge. Only two kinds of page share the apex's
 * account list: an account origin (`<c-address>.<apex>`), which is entitled to
 * its own setup entry, and a name origin (`<name>.<apex>`), which is entitled
 * to nothing secret.
 */
export type BridgeRequester = { kind: "account"; contractId: string } | { kind: "name" };

const ACCOUNT_LABEL_RE = /^c[a-z2-7]{55}$/;

/** `origin` as a URL, when it is https (plain http only on a loopback dev host). */
function secureOrigin(origin: string): URL | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHttpHost(url.hostname)) ? url : null;
}

/**
 * Classify a bridge requester's origin, or refuse it (null). The origin must
 * be https (plain http only on a loopback dev host), sit one label below the
 * same apex as the bridge, and have the label shape of an account address or
 * a registered name. Anything else — another scheme, the apex itself, a
 * built-in dApp or service host, a deeper subdomain, another site — is refused.
 */
export function bridgeRequester(origin: string, bridgeHost: string): BridgeRequester | null {
  const url = secureOrigin(origin);
  if (!url) return null;
  const apex = apexHostForHost(bridgeHost);
  if (url.host === apex || apexHostForHost(url.host) !== apex) return null;
  // Reducing to the bridge's apex puts the requester exactly one label below
  // it (preview accounts are `<label>--<N>.<apex>`); that label is its kind.
  const { label } = splitHost(url.host);
  if (!label) return null;

  if (ACCOUNT_LABEL_RE.test(label)) {
    const contractId = label.toUpperCase();
    return isContractStrKey(contractId) ? { kind: "account", contractId } : null;
  }
  // A reserved label (a built-in dApp, the relayer, ...) is not a wallet page;
  // any other name-shaped label is a registered name's wallet origin.
  if (VALID_NAME_RE.test(label) && !isReservedName(label)) return { kind: "name" };
  return null;
}

/**
 * What the bridge sends a requester: the account list and cached names, and
 * at most one setup entry — the requester's own. Other accounts' setup keys
 * never leave the apex.
 */
export function snapshotForRequester(
  snapshot: NidoAccountSnapshot,
  requester: BridgeRequester,
): NidoAccountSnapshot {
  return {
    accounts: snapshot.accounts,
    pending:
      requester.kind === "account"
        ? snapshot.pending.filter((p) => p.contractId === requester.contractId)
        : [],
    names: snapshot.names,
  };
}

/**
 * What the bridge accepts from a requester: an account origin may report its
 * own address (as active or as pending setup) and its own name; a name origin
 * reports nothing. Entries about any other account are dropped, so one origin
 * cannot plant accounts or setup keys that every other origin then trusts.
 */
export function contributionFromRequester(
  incoming: Partial<NidoAccountSnapshot> | null | undefined,
  requester: BridgeRequester,
): NidoAccountSnapshot {
  if (requester.kind !== "account") return { accounts: [], pending: [], names: {} };
  const own = requester.contractId;
  const next = normalizeSnapshot(incoming);
  return {
    accounts: next.accounts.filter((id) => id === own),
    pending: next.pending.filter((p) => p.contractId === own),
    names: own in next.names ? { [own]: next.names[own] } : {},
  };
}

/**
 * The bridge's message handler, minus the DOM: answer only a well-formed
 * request from an approved origin that came from the window embedding the
 * bridge. Returns the response to post back to `origin`, or null to ignore.
 * A bridge that can't see the apex's first-party mark stores nothing and
 * answers `separated`.
 */
export function answerBridgeRequest(
  message: { origin: string; data: unknown; fromParent: boolean },
  bridgeHost: string,
  store: StorageLike | null = storageOrNull(),
): NidoStorageResponse | null {
  if (!message.fromParent) return null;
  const requester = bridgeRequester(message.origin, bridgeHost);
  if (!requester) return null;
  const data = message.data as Partial<NidoStorageRequest> | null;
  if (data?.type !== NIDO_STORAGE_REQUEST || typeof data.id !== "string") return null;

  if (!store || !seesFirstPartyMark(store)) {
    return {
      type: NIDO_STORAGE_RESPONSE,
      id: data.id,
      snapshot: { accounts: [], pending: [], names: {} },
      separated: true,
    };
  }
  mergeNidoSnapshot(contributionFromRequester(data.snapshot, requester), store);
  return {
    type: NIDO_STORAGE_RESPONSE,
    id: data.id,
    snapshot: snapshotForRequester(localNidoSnapshot(store), requester),
  };
}

function bridgeUrl(location: Pick<Location, "protocol" | "host">): string | null {
  const apexHost = apexHostForHost(location.host);
  return apexHost === location.host ? null : `${location.protocol}//${apexHost}/nido-storage-bridge/`;
}

/** How long a sync waits for the bridge to answer. The bridge page is small,
 *  but a phone on a weak connection can still take seconds to fetch it. */
export const BRIDGE_ANSWER_BUDGET_MS = 10_000;
/** Once the bridge page has loaded, the request is sent again at this
 *  interval until it answers, in case the first message arrived before the
 *  page was listening. The bridge answers repeats idempotently. */
const BRIDGE_RESEND_MS = 1_000;

/**
 * Ask the page at `url`, loaded in a hidden iframe, and wait for its answer.
 * `request(id)` builds the message: it is sent once the frame has loaded and
 * again every {@link BRIDGE_RESEND_MS}. `read` turns a message from that frame
 * carrying the same id into the answer, or returns undefined to keep waiting.
 * Resolves null when no answer came within `timeoutMs`. The iframe stays
 * until then.
 */
function askFramedPage<M extends { id: string }, T>(
  url: string,
  request: (id: string) => object,
  read: (data: M) => T | undefined,
  timeoutMs: number,
): Promise<T | null> {
  const origin = new URL(url).origin;
  return new Promise((resolve) => {
    const id = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const iframe = document.createElement("iframe");
    let settled = false;
    let resend: number | undefined;

    function finish(answer: T | null) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.clearInterval(resend);
      window.removeEventListener("message", onMessage);
      iframe.remove();
      resolve(answer);
    }

    function send() {
      iframe.contentWindow?.postMessage(request(id), origin);
    }

    function onMessage(event: MessageEvent<M | null>) {
      if (event.origin !== origin || event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (data?.id !== id) return;
      const answer = read(data);
      if (answer !== undefined) finish(answer);
    }

    const timer = window.setTimeout(() => finish(null), timeoutMs);
    iframe.hidden = true;
    iframe.style.display = "none";
    iframe.src = url;
    iframe.addEventListener("load", () => {
      send();
      resend = window.setInterval(send, BRIDGE_RESEND_MS);
    });
    window.addEventListener("message", onMessage);
    document.body.appendChild(iframe);
  });
}

export interface BridgeSyncResult {
  /** The bridge answered, which it does only after storing what was sent,
   *  unless it was `separated`. */
  answered: boolean;
  /** This origin's own list changed from what the apex sent back. */
  changed: boolean;
  /** The bridge answered that it can't see the apex's own storage (this
   *  browser keeps a framed page's storage apart): nothing was stored, and no
   *  sync from this page can reach the apex's list. */
  separated: boolean;
}

// --- What the apex has confirmed ---------------------------------------------
//
// An account origin records what the apex last confirmed holding for its own
// account ("pending" or "active"). While its own state differs from that, the
// account is missing from (or stale in) the apex's sign-in list, and syncing
// keeps retrying until the apex answers.

type OwnStatus = "pending" | "active";
const confirmedKey = (contractId: string) => nidoKey(`bridge:confirmed:${contractId}`);
/** Set when the apex's hand-off answered that it will not list this origin's
 *  account; removed by a bridge sync that reaches the apex's list. */
const refusedKey = (contractId: string) => nidoKey(`bridge:refused:${contractId}`);

/** This origin's own account, when this is an account origin under an apex. */
export function ownAccount(location: Pick<Location, "host">): string | null {
  if (apexHostForHost(location.host) === location.host) return null;
  const { label } = splitHost(location.host);
  if (!label || !ACCOUNT_LABEL_RE.test(label)) return null;
  const contractId = label.toUpperCase();
  return isContractStrKey(contractId) ? contractId : null;
}

function ownStatus(snapshot: NidoAccountSnapshot, contractId: string): OwnStatus | null {
  if (snapshot.accounts.includes(contractId)) return "active";
  if (snapshot.pending.some((p) => p.contractId === contractId)) return "pending";
  return null;
}

/**
 * Whether this origin holds its own account in a state the apex has not yet
 * confirmed: the account is not (or not yet as active) in the sign-in list.
 */
export function bridgeSyncNeeded(
  location: Pick<Location, "host"> = window.location,
  store: StorageLike | null = storageOrNull(),
): boolean {
  if (!store) return false;
  const own = ownAccount(location);
  if (!own) return false;
  const status = ownStatus(localNidoSnapshot(store), own);
  return status !== null && store.getItem(confirmedKey(own)) !== status;
}

/** The hash parameter the apex's sign-in list hand-off (signInListHandoff.ts)
 *  returns with: `listed` once the apex's own list holds the account,
 *  `not-listed` when the apex will not list it (this browser did not reserve
 *  the address there), `unverified` when the chain check did not pass. */
export const SIGNIN_LIST_RETURN_PARAM = "nido-signin-list";

/**
 * On a page the sign-in list hand-off returned to: drop its parameter from
 * the URL and, when the apex reports this origin's own active account
 * listed, record that as confirmed, which a separated bridge never can. When
 * the apex reports it will not list this origin's account, record that too:
 * the hand-off is not offered again while the bridge stays separated
 * ({@link signInListRefused}). Any site can link here with the parameter; the
 * most a forged one does is hide the "Not in your sign-in list yet" notice
 * for an account this origin already holds as active, or its "Add it" button.
 */
export function takeSignInListReturn(
  win: Pick<Window, "location" | "history"> = window,
  store: StorageLike | null = storageOrNull(),
): void {
  const hash = win.location.hash.replace(/^#/, "");
  if (!hash) return;
  const params = new URLSearchParams(hash);
  const result = params.get(SIGNIN_LIST_RETURN_PARAM);
  if (result === null) return;
  params.delete(SIGNIN_LIST_RETURN_PARAM);
  const rest = params.toString();
  win.history.replaceState(
    win.history.state,
    "",
    `${win.location.pathname}${win.location.search}${rest ? `#${rest}` : ""}`,
  );
  const own = ownAccount(win.location);
  if (!own || !store) return;
  if (result === "not-listed") store.setItem(refusedKey(own), "1");
  else if (result === "listed" && ownStatus(localNidoSnapshot(store), own) === "active") {
    store.setItem(confirmedKey(own), "active");
  }
}

/**
 * Whether the apex's hand-off refused this origin's own account and no bridge
 * sync has reached the apex's list since. With a separated bridge, nothing
 * from this browser can add the account to the sign-in list.
 */
export function signInListRefused(
  location: Pick<Location, "host"> = window.location,
  store: Pick<Storage, "getItem"> | null = storageOrNull(),
): boolean {
  const own = ownAccount(location);
  return !!own && !!store && store.getItem(refusedKey(own)) !== null;
}

/**
 * Exchange account lists with the apex through its storage bridge (a hidden
 * iframe of `<apex>/nido-storage-bridge/`): send this origin's snapshot, which
 * the apex merges into its sign-in list, and merge back what it answers. The
 * iframe stays until the bridge answers or `timeoutMs` passes; on an answer,
 * this origin records what the answer shows the apex holding for its own
 * account, and forgets an earlier hand-off refusal. A `separated` answer is
 * neither merged nor recorded. Resolves
 * `{ answered: false }` on the apex itself, where there is nothing to sync.
 */
export function syncNidoStorageViaBridge(timeoutMs = BRIDGE_ANSWER_BUDGET_MS): Promise<BridgeSyncResult> {
  const unanswered: BridgeSyncResult = { answered: false, changed: false, separated: false };
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(unanswered);
  }

  const url = bridgeUrl(window.location);
  if (!url) return Promise.resolve(unanswered);
  const own = ownAccount(window.location);

  return askFramedPage<NidoStorageResponse, BridgeSyncResult>(
    url,
    (id) => ({ type: NIDO_STORAGE_REQUEST, id, snapshot: localNidoSnapshot() }) satisfies NidoStorageRequest,
    (data) => {
      if (data.type !== NIDO_STORAGE_RESPONSE) return undefined;
      if (data.separated === true) return { answered: true, changed: false, separated: true };
      const changed = mergeNidoSnapshot(data.snapshot);
      // Record what the answer shows the apex holding, not what this origin
      // sent last: resends share one id, so the answer can be to an earlier
      // send that still carried the account as pending.
      const confirmed = own ? ownStatus(normalizeSnapshot(data.snapshot), own) : null;
      const store = storageOrNull();
      if (own && store) {
        store.removeItem(refusedKey(own));
        if (confirmed) store.setItem(confirmedKey(own), confirmed);
      }
      return { answered: true, changed, separated: false };
    },
    timeoutMs,
  ).then((result) => result ?? unanswered);
}

// --- Syncing until the apex confirms ------------------------------------------

export type BridgeSyncStatus =
  /** Nothing of this origin's own is waiting for the apex. */
  | "confirmed"
  /** A sync is running and this origin's own account is not confirmed yet. */
  | "syncing"
  /** The last sync did not confirm the account; another is scheduled, unless
   *  the bridge is {@link bridgeSeparated}. */
  | "unconfirmed";

/** Delays between syncs that left this origin's own account unconfirmed;
 *  the last one repeats for as long as the page stays open. */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

let syncInFlight: Promise<BridgeSyncResult> | null = null;
let retryTimer: number | undefined;
let failedSyncs = 0;
let resyncedOnAnswer = false;
let separated = false;
let status: BridgeSyncStatus = "confirmed";
const statusListeners = new Set<(status: BridgeSyncStatus) => void>();
let wakeListenersAttached = false;

function setStatus(next: BridgeSyncStatus) {
  if (next === status) return;
  status = next;
  statusListeners.forEach((listener) => listener(next));
}

/** Whether the last sync's bridge answered that it can't see the apex's own
 *  storage. The account then reaches the sign-in list only through a
 *  top-level visit to the apex (signInListHandoff.ts). */
export function bridgeSeparated(): boolean {
  return separated;
}

/** Follow this page's sync status; `listener` is called now and on each change.
 *  Returns a function that stops following. */
export function onBridgeSyncStatus(listener: (status: BridgeSyncStatus) => void): () => void {
  statusListeners.add(listener);
  listener(status);
  return () => statusListeners.delete(listener);
}

function attachWakeListeners() {
  if (wakeListenersAttached) return;
  wakeListenersAttached = true;
  // Coming back online, or back to the tab, is a good moment to try again.
  const retryNow = () => {
    if (status === "unconfirmed") void requestBridgeSync();
  };
  window.addEventListener("online", retryNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") retryNow();
  });
}

/**
 * Sync with the apex now (joining a sync already running), and keep syncing in
 * the background, with growing delays, until the apex has confirmed this
 * origin's own account. Every page load that calls it retries an account the
 * apex never confirmed. Follow progress with {@link onBridgeSyncStatus}.
 */
export function requestBridgeSync(): Promise<BridgeSyncResult> {
  if (syncInFlight) return syncInFlight;
  window.clearTimeout(retryTimer);
  attachWakeListeners();
  if (bridgeSyncNeeded()) setStatus("syncing");
  syncInFlight = syncNidoStorageViaBridge().then((result) => {
    syncInFlight = null;
    separated = result.separated;
    if (!bridgeSyncNeeded()) {
      failedSyncs = 0;
      resyncedOnAnswer = false;
      setStatus("confirmed");
    } else if (result.separated) {
      // No sync from this page can reach the apex's list, so none is
      // scheduled; coming back to the tab still tries once more.
      setStatus("unconfirmed");
    } else if (result.answered && !resyncedOnAnswer) {
      // Answered, but this origin's own state may have moved on meanwhile:
      // sync again at once, once. An answer that still does not confirm the
      // account after that waits like an unanswered sync.
      resyncedOnAnswer = true;
      void requestBridgeSync();
    } else {
      setStatus("unconfirmed");
      const delay = RETRY_DELAYS_MS[Math.min(failedSyncs, RETRY_DELAYS_MS.length - 1)];
      failedSyncs++;
      retryTimer = window.setTimeout(() => void requestBridgeSync(), delay);
    }
    return result;
  });
  return syncInFlight;
}

// --- Ownership probe (apex -> account origin) ----------------------------------
//
// The passkey record for an account (`passkey:<C>:*`) lives in its own
// origin's storage, which the apex can't read. The apex learns whether this
// browser holds one by framing the account origin's bridge page, which answers
// its apex parent, and nobody else, with yes, no, or unknown. A framed page in
// WebKit sees storage apart from its origin's real storage (see "Whose
// storage a framed page sees" above), where a missing record proves nothing:
// it answers no only when it sees the origin's own storage.

export const NIDO_OWNER_REQUEST = "nido:owner:request:v1";
export const NIDO_OWNER_RESPONSE = "nido:owner:response:v1";

export interface NidoOwnerRequest {
  type: typeof NIDO_OWNER_REQUEST;
  id: string;
}

export interface NidoOwnerResponse {
  type: typeof NIDO_OWNER_RESPONSE;
  id: string;
  contractId: string;
  /** null: this frame can't see the origin's own storage, so it can't tell. */
  hasPasskey: boolean | null;
}

/** Whether `origin` is the apex this account `host` belongs to, over https
 *  (plain http only on a loopback dev host). */
function isOwnApex(origin: string, host: string): boolean {
  const url = secureOrigin(origin);
  return !!url && url.host === apexHostForHost(host) && url.host !== host;
}

/**
 * Whether a framed page's `store` is its origin's own storage: it holds the
 * first-party mark, or any wallet data. Storage kept apart for a frame starts
 * empty, and on an account origin nothing framed writes to it (the probe
 * below only reads), so wallet data there shows the origin's own storage,
 * including one last visited before top-level pages set the mark.
 */
function seesOwnStorage(store: StorageLike): boolean {
  if (seesFirstPartyMark(store)) return true;
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith("nido:") || key?.startsWith("passkey:")) return true;
  }
  return false;
}

/**
 * The account origin's half of the ownership probe, minus the DOM: answer a
 * well-formed request from the embedding window, when that window is this
 * account's own apex, with whether this origin holds the account's passkey
 * record: yes when the record is there, no only when this frame sees the
 * origin's own storage and the record isn't, otherwise unknown (null).
 * Returns null to ignore the message.
 */
export function answerOwnerProbe(
  message: { origin: string; data: unknown; fromParent: boolean },
  host: string,
  store: StorageLike | null = storageOrNull(),
): NidoOwnerResponse | null {
  if (!message.fromParent) return null;
  const contractId = ownAccount({ host });
  if (!contractId || !isOwnApex(message.origin, host)) return null;
  const data = message.data as Partial<NidoOwnerRequest> | null;
  if (data?.type !== NIDO_OWNER_REQUEST || typeof data.id !== "string") return null;
  const hasRecord =
    !!store?.getItem(`passkey:${contractId}:credentialId`) && !!store?.getItem(`passkey:${contractId}:publicKey`);
  const hasPasskey = hasRecord ? true : store && seesOwnStorage(store) ? false : null;
  return { type: NIDO_OWNER_RESPONSE, id: data.id, contractId, hasPasskey };
}

/**
 * What the bridge page answers, whichever host serves it: on the apex it is
 * the storage bridge for account and name origins; on an account origin it
 * answers its apex's ownership probe. Returns the message to post back to
 * `origin`, or null to stay silent.
 */
export function answerBridgePageMessage(
  message: { origin: string; data: unknown; fromParent: boolean },
  host: string,
): NidoStorageResponse | NidoOwnerResponse | null {
  return apexHostForHost(host) === host ? answerBridgeRequest(message, host) : answerOwnerProbe(message, host);
}

/** What an account origin answered the ownership probe: it holds the passkey
 *  record, it doesn't, or its frame can't see its own storage (`separated`),
 *  which no later probe from this browser will answer differently. */
export type OwnershipAnswer = boolean | "separated";

/**
 * From the apex: whether this browser holds the passkey record for
 * `contractId` on that account's own origin. Resolves `null` when the account
 * origin did not answer within `timeoutMs`.
 */
export function probeAccountOwnership(
  contractId: string,
  timeoutMs = BRIDGE_ANSWER_BUDGET_MS,
): Promise<OwnershipAnswer | null> {
  if (typeof window === "undefined" || typeof document === "undefined") return Promise.resolve(null);
  return askFramedPage<NidoOwnerResponse, OwnershipAnswer>(
    `${window.location.protocol}${accountUrl(window.location.host, contractId, "/nido-storage-bridge/")}`,
    (id) => ({ type: NIDO_OWNER_REQUEST, id }) satisfies NidoOwnerRequest,
    (data) => {
      if (data.type !== NIDO_OWNER_RESPONSE || data.contractId !== contractId) return undefined;
      if (data.hasPasskey === null) return "separated";
      return typeof data.hasPasskey === "boolean" ? data.hasPasskey : undefined;
    },
    timeoutMs,
  );
}
