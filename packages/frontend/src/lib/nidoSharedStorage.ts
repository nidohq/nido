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

function storageOrNull(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
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

/**
 * Classify a bridge requester's origin, or refuse it (null). The origin must
 * be https (plain http only on a loopback dev host), sit one label below the
 * same apex as the bridge, and have the label shape of an account address or
 * a registered name. Anything else — another scheme, the apex itself, a
 * built-in dApp or service host, a deeper subdomain, another site — is refused.
 */
export function bridgeRequester(origin: string, bridgeHost: string): BridgeRequester | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHttpHost(url.hostname))) {
    return null;
  }
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

  mergeNidoSnapshot(contributionFromRequester(data.snapshot, requester), store);
  return {
    type: NIDO_STORAGE_RESPONSE,
    id: data.id,
    snapshot: snapshotForRequester(localNidoSnapshot(store), requester),
  };
}

function bridgeTarget(location: Pick<Location, "protocol" | "host">): { origin: string; url: string } | null {
  const apexHost = apexHostForHost(location.host);
  if (apexHost === location.host) return null;
  const origin = `${location.protocol}//${apexHost}`;
  return { origin, url: `${origin}/nido-storage-bridge/` };
}

/** How long a sync waits for the bridge to answer. The bridge page is small,
 *  but a phone on a weak connection can still take seconds to fetch it. */
export const BRIDGE_ANSWER_BUDGET_MS = 10_000;
/** Once the bridge page has loaded, the request is sent again at this
 *  interval until it answers, in case the first message arrived before the
 *  page was listening. The bridge answers repeats idempotently. */
const BRIDGE_RESEND_MS = 1_000;

export interface BridgeSyncResult {
  /** The apex answered, which it does only after storing what was sent. */
  answered: boolean;
  /** This origin's own list changed from what the apex sent back. */
  changed: boolean;
}

// --- What the apex has confirmed ---------------------------------------------
//
// An account origin records what the apex last confirmed holding for its own
// account ("pending" or "active"). While its own state differs from that, the
// account is missing from (or stale in) the apex's sign-in list, and syncing
// keeps retrying until the apex answers.

type OwnStatus = "pending" | "active";
const confirmedKey = (contractId: string) => nidoKey(`bridge:confirmed:${contractId}`);

/** This origin's own account, when this is an account origin under an apex. */
function ownAccount(location: Pick<Location, "host">): string | null {
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

/**
 * Exchange account lists with the apex through its storage bridge (a hidden
 * iframe of `<apex>/nido-storage-bridge/`): send this origin's snapshot, which
 * the apex merges into its sign-in list, and merge back what it answers. The
 * iframe stays until the bridge answers or `timeoutMs` passes; on an answer,
 * this origin records what the apex now holds for its own account. Resolves
 * `{ answered: false }` on the apex itself, where there is nothing to sync.
 */
export function syncNidoStorageViaBridge(timeoutMs = BRIDGE_ANSWER_BUDGET_MS): Promise<BridgeSyncResult> {
  const unanswered: BridgeSyncResult = { answered: false, changed: false };
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(unanswered);
  }

  const target = bridgeTarget(window.location);
  if (!target) return Promise.resolve(unanswered);
  const bridge = target;

  return new Promise((resolve) => {
    const id = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const iframe = document.createElement("iframe");
    const own = ownAccount(window.location);
    let settled = false;
    let sentStatus: OwnStatus | null = null;
    let resend: number | undefined;

    function finish(result: BridgeSyncResult) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.clearInterval(resend);
      window.removeEventListener("message", onMessage);
      iframe.remove();
      resolve(result);
    }

    function send() {
      const snapshot = localNidoSnapshot();
      sentStatus = own ? ownStatus(snapshot, own) : null;
      iframe.contentWindow?.postMessage(
        { type: NIDO_STORAGE_REQUEST, id, snapshot } satisfies NidoStorageRequest,
        bridge.origin,
      );
    }

    function onMessage(event: MessageEvent<NidoStorageResponse>) {
      if (event.origin !== bridge.origin || event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (data?.type !== NIDO_STORAGE_RESPONSE || data.id !== id) return;
      const changed = mergeNidoSnapshot(data.snapshot);
      const store = storageOrNull();
      if (own && sentStatus && store) store.setItem(confirmedKey(own), sentStatus);
      finish({ answered: true, changed });
    }

    const timer = window.setTimeout(() => finish(unanswered), timeoutMs);
    iframe.hidden = true;
    iframe.style.display = "none";
    iframe.src = bridge.url;
    iframe.addEventListener("load", () => {
      send();
      resend = window.setInterval(send, BRIDGE_RESEND_MS);
    });
    window.addEventListener("message", onMessage);
    document.body.appendChild(iframe);
  });
}

// --- Syncing until the apex confirms ------------------------------------------

export type BridgeSyncStatus =
  /** Nothing of this origin's own is waiting for the apex. */
  | "confirmed"
  /** A sync is running and this origin's own account is not confirmed yet. */
  | "syncing"
  /** The last sync got no answer; another is scheduled. */
  | "unconfirmed";

/** Delays between unanswered syncs while this origin's own account is
 *  unconfirmed; the last one repeats for as long as the page stays open. */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

let syncInFlight: Promise<BridgeSyncResult> | null = null;
let retryTimer: number | undefined;
let failedSyncs = 0;
let status: BridgeSyncStatus = "confirmed";
const statusListeners = new Set<(status: BridgeSyncStatus) => void>();
let wakeListenersAttached = false;

function setStatus(next: BridgeSyncStatus) {
  if (next === status) return;
  status = next;
  statusListeners.forEach((listener) => listener(next));
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
    if (!bridgeSyncNeeded()) {
      failedSyncs = 0;
      setStatus("confirmed");
    } else if (result.answered) {
      // Answered, but this origin's own state moved on meanwhile.
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
// its apex parent, and nobody else, with yes or no.

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
  hasPasskey: boolean;
}

/** Whether `origin` is the apex this account `host` belongs to, over https
 *  (plain http only on a loopback dev host). */
function isOwnApex(origin: string, host: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHttpHost(url.hostname))) {
    return false;
  }
  return url.host === apexHostForHost(host) && url.host !== host;
}

/**
 * The account origin's half of the ownership probe, minus the DOM: answer a
 * well-formed request from the embedding window, when that window is this
 * account's own apex, with whether this origin holds the account's passkey
 * record. Returns null to ignore the message.
 */
export function answerOwnerProbe(
  message: { origin: string; data: unknown; fromParent: boolean },
  host: string,
  store: Pick<Storage, "getItem"> | null = storageOrNull(),
): NidoOwnerResponse | null {
  if (!message.fromParent || !store) return null;
  const contractId = ownAccount({ host });
  if (!contractId || !isOwnApex(message.origin, host)) return null;
  const data = message.data as Partial<NidoOwnerRequest> | null;
  if (data?.type !== NIDO_OWNER_REQUEST || typeof data.id !== "string") return null;
  const hasPasskey =
    !!store.getItem(`passkey:${contractId}:credentialId`) && !!store.getItem(`passkey:${contractId}:publicKey`);
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

/**
 * From the apex: whether this browser holds the passkey record for
 * `contractId` on that account's own origin. Resolves `null` when the account
 * origin did not answer within `timeoutMs`.
 */
export function probeAccountOwnership(
  contractId: string,
  timeoutMs = BRIDGE_ANSWER_BUDGET_MS,
): Promise<boolean | null> {
  if (typeof window === "undefined" || typeof document === "undefined") return Promise.resolve(null);
  const url = `${window.location.protocol}${accountUrl(window.location.host, contractId, "/nido-storage-bridge/")}`;
  const origin = new URL(url).origin;

  return new Promise((resolve) => {
    const id = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const iframe = document.createElement("iframe");
    let settled = false;
    let resend: number | undefined;

    function finish(answer: boolean | null) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.clearInterval(resend);
      window.removeEventListener("message", onMessage);
      iframe.remove();
      resolve(answer);
    }

    function send() {
      iframe.contentWindow?.postMessage({ type: NIDO_OWNER_REQUEST, id } satisfies NidoOwnerRequest, origin);
    }

    function onMessage(event: MessageEvent<NidoOwnerResponse>) {
      if (event.origin !== origin || event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (data?.type !== NIDO_OWNER_RESPONSE || data.id !== id || data.contractId !== contractId) return;
      finish(data.hasPasskey === true);
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
