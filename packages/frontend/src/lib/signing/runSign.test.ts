// packages/frontend/src/lib/signing/runSign.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../walletSign.js", () => ({ signTransactionXdr: vi.fn(async () => "SIGNEDXDR") }));
vi.mock("./submit", () => ({ relayerSubmitAndConfirm: vi.fn(async () => ({ hash: "dapphash" })) }));
vi.mock("../primaryPasskeySigner", () => ({
  signAndSubmit: vi.fn(async () => ({ hash: "ownhash" })),
  submitWithoutAuth: vi.fn(async () => ({ hash: "gchash" })),
}));
vi.mock("./operationBuilders", () => ({
  buildOperationChecked: vi.fn(async (d: { type: string }) => ({ operation: { __op: d.type }, checks: Promise.resolve() })),
}));
vi.mock("@stellar/stellar-sdk", async (orig) => {
  const real = await orig<any>();
  return { ...real, TransactionBuilder: { ...real.TransactionBuilder, fromXDR: () => ({ __tx: true }) } };
});

import { runSign } from "./runSign";
import { signTransactionXdr } from "../walletSign.js";
import { signAndSubmit, submitWithoutAuth } from "../primaryPasskeySigner";
const C1 = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

describe("runSign", () => {
  beforeEach(() => vi.clearAllMocks());
  it("own action: builds op, signs+submits, returns hash", async () => {
    const out = await runSign({
      v: 1, kind: "name-claim", account: C1,
      operation: { type: "register", name: "alice" },
      title: "t", submitMode: "relayer", returnTarget: { type: "route", url: "/x" },
    });
    expect(out).toEqual({ hash: "ownhash" });
  });
  it("dapp raw-xdr: signs then relayer-submits, returns hash", async () => {
    const out = await runSign({
      v: 1, kind: "dapp-tx", account: C1,
      operation: { type: "raw-xdr", xdr: "RAW" },
      title: "t", submitMode: "return-to-dapp",
      returnTarget: { type: "dapp", origin: "https://x" },
    }, { reviewedInvocationXdr: "TREE" });
    expect(out).toEqual({ hash: "dapphash" });
    expect(signTransactionXdr).toHaveBeenCalledWith(
      expect.objectContaining({ txXdr: "RAW", reviewedInvocationXdr: "TREE" }),
    );
  });
  it("dapp raw-xdr: refuses to sign a transaction whose authorization wasn't reviewed", async () => {
    await expect(
      runSign({
        v: 1, kind: "dapp-tx", account: C1,
        operation: { type: "raw-xdr", xdr: "RAW" },
        title: "t", submitMode: "return-to-dapp",
        returnTarget: { type: "dapp", origin: "https://x" },
      }),
    ).rejects.toThrow(/wasn't reviewed/);
    expect(signTransactionXdr).not.toHaveBeenCalled();
  });

  const scopeReq = (adminFollowUp?: object) => ({
    v: 1 as const, kind: "session-grant" as const, account: C1,
    operation: {
      type: "apply-scope" as const, scope: 7, origin: "https://game.example", docJson: "{}", prevDocHash: null,
      ...(adminFollowUp ? { adminFollowUp: adminFollowUp as never } : {}),
    },
    title: "t", submitMode: "relayer" as const, returnTarget: { type: "route" as const, url: "/x" },
  });
  const follow = { docJson: "{}", prevDocJson: "{}", expectedRevision: "3", moved: ["guess"] };

  it("an app approval moving older rules: the scope, then the admin document, two confirmations", async () => {
    const out = await runSign(scopeReq(follow));
    expect(out).toEqual({ hash: "ownhash" });
    expect(vi.mocked(signAndSubmit).mock.calls.map(([a]) => a.operation)).toEqual([
      { __op: "apply-scope" },
      { __op: "apply-policy-doc" },
    ]);
  });
  it("a failed second step leaves the approval done, with a notice", async () => {
    vi.mocked(signAndSubmit)
      .mockResolvedValueOnce({ hash: "ownhash" } as never)
      .mockRejectedValueOnce(new Error("Passkey signing was cancelled."));
    const out = await runSign(scopeReq(follow));
    expect(out.hash).toBe("ownhash");
    expect(out.notice).toMatch(/still in your admin document too \(Passkey signing was cancelled\.\)/);
  });
  it("an app approval with nothing to move signs once", async () => {
    await runSign(scopeReq());
    expect(signAndSubmit).toHaveBeenCalledTimes(1);
  });
  it("cleaning up a wiped scope signs nothing", async () => {
    const out = await runSign({
      v: 1, kind: "session-revoke", account: C1,
      operation: { type: "gc-scope", scope: 7, origin: null },
      title: "t", submitMode: "relayer", returnTarget: { type: "route", url: "/x" },
    });
    expect(out).toEqual({ hash: "gchash" });
    expect(submitWithoutAuth).toHaveBeenCalledWith(expect.objectContaining({ operation: { __op: "gc-scope" } }));
    expect(signAndSubmit).not.toHaveBeenCalled();
  });
});
