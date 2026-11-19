// @vitest-environment-options {"url": "https://cabaeaqcaibaeaqcaibaeaqcaibaeaqcaibaeaqcaibaeaqcaibafnsz.nido.fyi/account/"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  answerBridgeRequest,
  bridgeSeparated,
  bridgeSyncNeeded,
  FIRST_PARTY_KEY,
  onBridgeSyncStatus,
  requestBridgeSync,
  syncNidoStorageViaBridge,
  type BridgeSyncStatus,
  type NidoStorageRequest,
} from "./nidoSharedStorage.js";

// This page is the account origin of OWN, under the apex nido.fyi. The test
// plays the apex's bridge page with its own storage and the real bridge
// handler, so what the account origin records is checked against what the
// apex actually stored.
const OWN = "CABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNSZ";
const APEX = "https://nido.fyi";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

/** The apex's own storage, as its top-level pages leave it: marked first-party. */
function apexStorage(): MemoryStorage {
  const store = new MemoryStorage();
  store.setItem(FIRST_PARTY_KEY, "1");
  return store;
}

/** Start a sync and return the bridge iframe plus every request it was sent. */
function startSync() {
  const sent: NidoStorageRequest[] = [];
  const result = syncNidoStorageViaBridge();
  const iframe = document.querySelector("iframe")!;
  vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation((data: unknown) => {
    sent.push(structuredClone(data) as NidoStorageRequest);
  });
  iframe.dispatchEvent(new Event("load"));
  return { result, iframe, sent };
}

/** The apex's bridge page answers `request`, as the deployed page does. */
function bridgeAnswers(iframe: HTMLIFrameElement, request: NidoStorageRequest, apexStore: Storage | null) {
  const answer = answerBridgeRequest({ origin: window.location.origin, data: request, fromParent: true }, "nido.fyi", apexStore);
  window.dispatchEvent(new MessageEvent("message", { data: answer, origin: APEX, source: iframe.contentWindow }));
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("what an account origin records the apex has confirmed", () => {
  it("records the status the apex stored, not one sent after the request it answered", async () => {
    // The address is reserved: this origin holds its own account as pending.
    localStorage.setItem("nido:testnet:pending", JSON.stringify([{ contractId: OWN, setupKey: "salt" }]));
    const { result, iframe, sent } = startSync();
    expect(sent).toHaveLength(1);

    // The account is activated while the bridge is still slow to answer, and
    // the next resend carries it as active.
    localStorage.setItem("nido:testnet:accounts", JSON.stringify([OWN]));
    localStorage.setItem("nido:testnet:pending", "[]");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent).toHaveLength(2);

    // Only the first (pending) request reaches the apex before it answers.
    const apexStore = apexStorage();
    bridgeAnswers(iframe, sent[0]!, apexStore);
    await expect(result).resolves.toMatchObject({ answered: true });

    expect(JSON.parse(apexStore.getItem("nido:testnet:accounts") ?? "[]")).toEqual([]);
    expect(localStorage.getItem(`nido:testnet:bridge:confirmed:${OWN}`)).toBe("pending");
    expect(bridgeSyncNeeded()).toBe(true);
  });

  it("records active once the apex holds the account as active", async () => {
    localStorage.setItem("nido:testnet:accounts", JSON.stringify([OWN]));
    const { result, iframe, sent } = startSync();

    const apexStore = apexStorage();
    bridgeAnswers(iframe, sent[0]!, apexStore);
    await expect(result).resolves.toMatchObject({ answered: true });

    expect(JSON.parse(apexStore.getItem("nido:testnet:accounts")!)).toEqual([OWN]);
    expect(localStorage.getItem(`nido:testnet:bridge:confirmed:${OWN}`)).toBe("active");
    expect(bridgeSyncNeeded()).toBe(false);
  });
});

/** Answer every bridge iframe the page opens within `ms`, from `apexStore`.
 *  Returns the iframes answered. */
async function answerEveryBridge(apexStore: Storage, ms: number): Promise<Set<HTMLIFrameElement>> {
  const answered = new Set<HTMLIFrameElement>();
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    const iframe = document.querySelector("iframe");
    if (iframe && !answered.has(iframe)) {
      answered.add(iframe);
      const sent: NidoStorageRequest[] = [];
      vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation((data: unknown) => {
        sent.push(structuredClone(data) as NidoStorageRequest);
      });
      iframe.dispatchEvent(new Event("load"));
      bridgeAnswers(iframe, sent[0]!, apexStore);
    }
    await vi.advanceTimersByTimeAsync(100);
  }
  return answered;
}

// These share the module's background-sync state, so each leaves no sync in
// flight for the next.
describe("background sync when the apex never holds the account", () => {
  it("records nothing and stops syncing when the bridge can't see the apex's storage", async () => {
    // WebKit: the framed bridge's storage is apart from the apex's, without
    // its first-party mark. It once answered "stored" from there.
    localStorage.setItem("nido:testnet:accounts", JSON.stringify([OWN]));
    let status: BridgeSyncStatus | undefined;
    const stopFollowing = onBridgeSyncStatus((next) => (status = next));

    const separatedStore = new MemoryStorage();
    void requestBridgeSync();
    const answered = await answerEveryBridge(separatedStore, 70_000);
    stopFollowing();

    expect(answered.size).toBe(1);
    expect(separatedStore.length).toBe(0);
    expect(status).toBe("unconfirmed");
    expect(bridgeSeparated()).toBe(true);
    expect(localStorage.getItem(`nido:testnet:bridge:confirmed:${OWN}`)).toBeNull();
    expect(bridgeSyncNeeded()).toBe(true);
  });

  it("backs off instead of reloading the bridge in a loop", async () => {
    localStorage.setItem("nido:testnet:accounts", JSON.stringify([OWN]));
    let status: BridgeSyncStatus | undefined;
    const stopFollowing = onBridgeSyncStatus((next) => (status = next));

    // The apex's bridge sees the apex's storage but cannot write to it: it
    // stores nothing and answers every request with an empty snapshot.
    class ReadOnlyStorage extends MemoryStorage {
      constructor() {
        super();
        super.setItem(FIRST_PARTY_KEY, "1");
      }
      setItem() {}
    }
    const readOnly = new ReadOnlyStorage();
    const answered = new Set<HTMLIFrameElement>();
    void requestBridgeSync();
    for (let elapsed = 0; elapsed < 5_000; elapsed += 100) {
      const iframe = document.querySelector("iframe");
      if (iframe && !answered.has(iframe)) {
        answered.add(iframe);
        const sent: NidoStorageRequest[] = [];
        vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation((data: unknown) => {
          sent.push(structuredClone(data) as NidoStorageRequest);
        });
        iframe.dispatchEvent(new Event("load"));
        bridgeAnswers(iframe, sent[0]!, readOnly);
      }
      await vi.advanceTimersByTimeAsync(100);
    }
    stopFollowing();

    expect(answered.size).toBeGreaterThanOrEqual(2);
    expect(answered.size).toBeLessThanOrEqual(4);
    expect(status).toBe("unconfirmed");
    expect(bridgeSeparated()).toBe(false);
    expect(localStorage.getItem(`nido:testnet:bridge:confirmed:${OWN}`)).toBeNull();
  });
});
