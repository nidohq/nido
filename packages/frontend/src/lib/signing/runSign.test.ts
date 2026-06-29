// packages/frontend/src/lib/signing/runSign.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../walletSign.js", () => ({ signTransactionXdr: vi.fn(async () => "SIGNEDXDR") }));
vi.mock("./submit", () => ({ relayerSubmitAndConfirm: vi.fn(async () => ({ hash: "dapphash" })) }));
vi.mock("../primaryPasskeySigner", () => ({ signAndSubmit: vi.fn(async () => ({ hash: "ownhash" })) }));
vi.mock("./operationBuilders", () => ({ buildOperation: vi.fn(async () => ({ __op: true })) }));
vi.mock("@stellar/stellar-sdk", async (orig) => {
  const real = await orig<any>();
  return { ...real, TransactionBuilder: { ...real.TransactionBuilder, fromXDR: () => ({ __tx: true }) } };
});

import { runSign } from "./runSign";
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
    });
    expect(out).toEqual({ hash: "dapphash" });
  });
});
