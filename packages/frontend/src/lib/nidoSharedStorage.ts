import { isContractId } from "@nidohq/passkey-sdk";
import type { PendingAccount } from "./myNidoModel";

const ACCOUNT_KEY = "nido:accounts";
const PENDING_KEY = "nido:pending";
const NAME_PREFIX = "nido:names:";
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

function normalizeContractId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const contractId = value.toUpperCase();
  return isContractId(contractId) ? contractId : null;
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

  const accounts = uniqueContractIds(readJson(store.getItem(ACCOUNT_KEY)));
  const active = new Set(accounts);
  const pending = normalizePending(readJson(store.getItem(PENDING_KEY)), active);
  const names: Record<string, string> = {};

  for (const contractId of [...accounts, ...pending.map((p) => p.contractId)]) {
    const name = store.getItem(`${NAME_PREFIX}${contractId}`);
    if (name && VALID_NAME_RE.test(name)) names[contractId] = name;
  }

  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key?.startsWith(NAME_PREFIX)) continue;
    const contractId = normalizeContractId(key.slice(NAME_PREFIX.length));
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

  store.setItem(ACCOUNT_KEY, JSON.stringify(after.accounts));
  store.setItem(PENDING_KEY, JSON.stringify(after.pending));
  for (const [contractId, name] of Object.entries(after.names)) {
    store.setItem(`${NAME_PREFIX}${contractId}`, name);
  }

  return true;
}

export function apexHostForHost(host: string): string {
  const parts = host.split(".");
  if (parts.length <= 1) return host;

  const [subdomain, ...restParts] = parts;
  const rest = restParts.join(".");
  const preview = subdomain.match(/--(?:pr-)?(\d+)$/);
  if (preview) return `${preview[1]}.${rest}`;
  if (/^\d+$/.test(subdomain)) return host;
  const legacyRoot = subdomain.match(/^pr-(\d+)$/);
  if (legacyRoot) return `${legacyRoot[1]}.${rest}`;
  if (rest.startsWith("localhost")) return rest;
  return parts.length > 2 ? rest : host;
}

export function sameNidoApexOrigin(origin: string, host: string): boolean {
  try {
    return apexHostForHost(new URL(origin).host) === apexHostForHost(host);
  } catch {
    return false;
  }
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
      if (event.origin !== bridge.origin) return;
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
