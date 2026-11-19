import { describe, expect, it, vi } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import {
  canHandOffOwn,
  completeHandoff,
  handoffReturnUrl,
  handoffUrl,
  ownHandoffUrl,
  parseHandoff,
  type Handoff,
  type HandoffDeps,
} from "./signInListHandoff";

const C = StrKey.encodeContract(Buffer.alloc(32, 7));
const OTHER = StrKey.encodeContract(Buffer.alloc(32, 8));
const c = C.toLowerCase();
const KEY = `04${"ab".repeat(64)}`;
const APEX = { protocol: "https:", host: "nido.fyi" };

function apex(state: { accounts?: string[]; unfinished?: string[]; verifies?: boolean } = {}) {
  const accounts = [...(state.accounts ?? [])];
  const unfinished = [...(state.unfinished ?? [])];
  const verify = vi.fn(async () => {
    if (state.verifies === false) throw new Error("not this passkey's account");
  });
  const deps: HandoffDeps = {
    accounts: () => accounts,
    unfinished: () => unfinished.map((contractId) => ({ contractId })),
    verify,
    activate: (id) => {
      unfinished.splice(unfinished.indexOf(id), 1);
      accounts.push(id);
    },
  };
  return { deps, accounts, verify };
}

const handoff = (over: Partial<Handoff> = {}): Handoff => ({
  contractId: C,
  publicKey: new Uint8Array(65).fill(4),
  next: "account",
  claimName: null,
  nonce: null,
  ...over,
});

/** An account origin's storage: what it holds, and what a hand-off link adds. */
function originStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
  };
}
const NONCE_KEY = `nido:testnet:bridge:handoff:${C}`;

describe("the hand-off link an account origin opens", () => {
  it("goes to the apex's hand-off page with the account, its key and where to return", () => {
    const store = originStore();
    const url = handoffUrl(
      { protocol: "https:", host: `${c}.nido.fyi` },
      { contractId: C, publicKeyHex: KEY, next: "recovery" },
      store,
    );
    const nonce = store.values.get(NONCE_KEY)!;
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(url).toBe(`https://nido.fyi/new-account/finish/#c=${C}&pk=${KEY}&next=recovery&n=${nonce}`);
    expect(parseHandoff(new URL(url!).hash)).toEqual({
      contractId: C,
      publicKey: Uint8Array.from(Buffer.from(KEY, "hex")),
      next: "recovery",
      claimName: null,
      nonce,
    });
  });

  it("carries a new nonce each time, the origin keeping only the latest", () => {
    const store = originStore();
    const open = () =>
      parseHandoff(
        new URL(handoffUrl({ protocol: "https:", host: `${c}.nido.fyi` }, { contractId: C, publicKeyHex: KEY, next: "account" }, store)!)
          .hash,
      )!.nonce;
    const first = open();
    const second = open();
    expect(second).not.toBe(first);
    expect(store.values.get(NONCE_KEY)).toBe(second);
  });

  it("stays under a preview's own root", () => {
    expect(
      handoffUrl(
        { protocol: "https:", host: `${c}--362.test.nido.fyi` },
        { contractId: C, publicKeyHex: KEY, next: "account" },
        originStore(),
      ),
    ).toMatch(/^https:\/\/362\.test\.nido\.fyi\/new-account\/finish\/#/);
  });

  it("is not made on the apex itself", () => {
    const store = originStore();
    expect(handoffUrl(APEX, { contractId: C, publicKeyHex: KEY, next: "account" }, store)).toBeNull();
    expect(store.values.size).toBe(0);
  });

  it("is made from this origin's own passkey record, or not at all", () => {
    const own = { protocol: "https:", host: `${c}.nido.fyi` };
    const store = originStore({ [`passkey:${C}:publicKey`]: KEY });
    // Asking whether it can be made issues no nonce.
    expect(canHandOffOwn(own, store)).toBe(true);
    expect(store.values.has(NONCE_KEY)).toBe(false);
    expect(ownHandoffUrl(own, store)).toBe(
      `https://nido.fyi/new-account/finish/#c=${C}&pk=${KEY}&next=account&n=${store.values.get(NONCE_KEY)}`,
    );

    const empty = originStore();
    expect(canHandOffOwn(own, empty)).toBe(false);
    expect(ownHandoffUrl(own, empty)).toBeNull();
    expect(canHandOffOwn({ host: "alice.nido.fyi" }, store)).toBe(false);
    expect(ownHandoffUrl({ protocol: "https:", host: "alice.nido.fyi" }, store)).toBeNull();
    expect(empty.values.size).toBe(0);
  });
});

describe("reading a hand-off link (untrusted)", () => {
  it("refuses a link without a valid contract address", () => {
    expect(parseHandoff("")).toBeNull();
    expect(parseHandoff("#c=GABC")).toBeNull();
    expect(parseHandoff(`#c=${C.slice(0, -1)}A`)).toBeNull();
  });

  it("keeps only a well-formed passkey key, a known return page and a claimable name", () => {
    const h = parseHandoff(`#c=${c}&pk=zz&next=https://evil.example/&then=claim:Ab`);
    expect(h).toEqual({ contractId: C, publicKey: null, next: "account", claimName: "ab", nonce: null });
    expect(parseHandoff(`#c=${C}&n=${"0".repeat(31)}`)?.nonce).toBeNull();
    expect(parseHandoff(`#c=${C}&n=${"g".repeat(32)}`)?.nonce).toBeNull();
    expect(parseHandoff(`#c=${C}&then=https://evil.example/`)?.claimName).toBeNull();
    expect(parseHandoff(`#c=${C}&then=claim:www`)?.claimName).toBeNull();
  });
});

describe("what the apex lists", () => {
  it("lists an address it reserved once the chain shows it is this passkey's account", async () => {
    const { deps, accounts, verify } = apex({ unfinished: [C] });
    await expect(completeHandoff(handoff(), deps)).resolves.toBe("listed");
    expect(accounts).toEqual([C]);
    expect(verify).toHaveBeenCalledWith(C, handoff().publicKey);
  });

  it("never lists an address this browser didn't reserve here", async () => {
    const { deps, accounts, verify } = apex({ unfinished: [OTHER] });
    await expect(completeHandoff(handoff(), deps)).resolves.toBe("not-listed");
    expect(accounts).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it("never lists one the chain doesn't confirm, or one without a usable key", async () => {
    const refused = apex({ unfinished: [C], verifies: false });
    await expect(completeHandoff(handoff(), refused.deps)).resolves.toBe("unverified");
    expect(refused.accounts).toEqual([]);

    const keyless = apex({ unfinished: [C] });
    await expect(completeHandoff(handoff({ publicKey: null }), keyless.deps)).resolves.toBe("not-listed");
    expect(keyless.verify).not.toHaveBeenCalled();
  });

  it("reports an account already listed without asking the chain", async () => {
    const { deps, verify } = apex({ accounts: [C] });
    await expect(completeHandoff(handoff({ publicKey: null }), deps)).resolves.toBe("listed");
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("where the hand-off returns", () => {
  it("to the account's own page, chosen by `next`", () => {
    expect(handoffReturnUrl(APEX, handoff(), "listed")).toBe(`https://${c}.nido.fyi/account/#nido-signin-list=listed`);
    expect(handoffReturnUrl(APEX, handoff({ next: "recovery" }), "not-listed")).toBe(
      `https://${c}.nido.fyi/security/recovery/#nido-signin-list=not-listed`,
    );
    expect(handoffReturnUrl({ protocol: "https:", host: "362.test.nido.fyi" }, handoff(), "listed")).toBe(
      `https://${c}--362.test.nido.fyi/account/#nido-signin-list=listed`,
    );
  });

  it("with the account origin's nonce beside the outcome", () => {
    const nonce = "0123456789abcdef".repeat(2);
    expect(handoffReturnUrl(APEX, handoff({ nonce }), "listed")).toBe(
      `https://${c}.nido.fyi/account/#nido-signin-list=listed&nido-signin-nonce=${nonce}`,
    );
  });

  it("to the claimed name's page for a name claim", () => {
    expect(handoffReturnUrl(APEX, handoff({ claimName: "alice" }), "listed")).toBe(
      `https://alice.nido.fyi/account/?account=${C}#nido-signin-list=listed`,
    );
  });
});
