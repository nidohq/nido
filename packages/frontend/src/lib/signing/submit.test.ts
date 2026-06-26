import { describe, it, expect, vi, afterEach } from "vitest";
import { relayerSubmitAndConfirm } from "./submit";
import {
  TransactionBuilder,
  Networks,
  Account,
  Operation,
  Address,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";

afterEach(() => vi.restoreAllMocks());

// Minimal single-op invoke tx so extractFuncAndAuth() succeeds.
function fakeSignedTx() {
  const src = new Account(
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    "1",
  );
  const op = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(
          "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
        ).toScAddress(),
        functionName: "noop",
        args: [nativeToScVal(1, { type: "u32" })],
      }),
    ),
    auth: [],
  });
  return new TransactionBuilder(src, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(op)
    .setTimeout(0)
    .build();
}

describe("relayerSubmitAndConfirm", () => {
  it("submits {func,auth} and resolves the confirmed hash", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: unknown, init: { body: string }) => {
        calls.push(JSON.parse(init.body));
        const body =
          calls.length === 1
            ? {
                data: {
                  transactionId: "tx1",
                  hash: null,
                  status: "submitted",
                },
              }
            : {
                data: {
                  transactionId: "tx1",
                  hash: "abc123",
                  status: "confirmed",
                },
              };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    const out = await relayerSubmitAndConfirm(fakeSignedTx(), {
      baseUrl: "https://relay.test",
    });
    expect(out).toEqual({ hash: "abc123" });
    const firstCall = calls[0] as { params: { func: string; auth: string[] } };
    expect(firstCall.params).toHaveProperty("func");
    expect(firstCall.params).toHaveProperty("auth");
  });
});
