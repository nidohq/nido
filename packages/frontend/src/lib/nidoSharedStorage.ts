import { isReservedName, nidoKey, splitHost, stripSubdomain } from "@nidohq/passkey-sdk";
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
    if (!setupKey) continue;
    seen.add(contractId);
    pending.push({ contractId, setupKey });
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

export function syncNidoStorageViaBridge(timeoutMs = 1000): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(false);
  }

  const target = bridgeTarget(window.location);
  if (!target) return Promise.resolve(false);
  const bridge = target;

  return new Promise((resolve) => {
    const id = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const iframe = document.createElement("iframe");
    let settled = false;

    function finish(changed: boolean) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      iframe.remove();
      resolve(changed);
    }

    function onMessage(event: MessageEvent<NidoStorageResponse>) {
      if (event.origin !== bridge.origin || event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (data?.type !== NIDO_STORAGE_RESPONSE || data.id !== id) return;
      finish(mergeNidoSnapshot(data.snapshot));
    }

    const timer = window.setTimeout(() => finish(false), timeoutMs);
    iframe.hidden = true;
    iframe.style.display = "none";
    iframe.src = bridge.url;
    iframe.addEventListener("load", () => {
      iframe.contentWindow?.postMessage(
        {
          type: NIDO_STORAGE_REQUEST,
          id,
          snapshot: localNidoSnapshot(),
        } satisfies NidoStorageRequest,
        bridge.origin,
      );
    });
    iframe.addEventListener("error", () => finish(false));
    window.addEventListener("message", onMessage);
    document.body.appendChild(iframe);
  });
}
