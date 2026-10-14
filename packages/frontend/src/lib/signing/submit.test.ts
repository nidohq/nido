import { describe, it, expect, vi, afterEach } from "vitest";
import { relayerSubmitAndConfirm } from "./submit";
import { RelayerError, relayerOutcomeBlocksRetry } from "../relayerClient";
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

// Once the signed authorization has been POSTed, the relayer may already hold a
// usable authorization — so any failure past that point leaves the payment's
// outcome unknown. A fresh-payment retry (which signs a new authorization) must
// be blocked regardless of what the relayer did or did not say, because a
// malicious or faulty relayer can produce exactly these failures after
// accepting the authorization. The contract: such failures surface as a
// RelayerError whose code makes relayerOutcomeBlocksRetry() return true.
describe("relayerSubmitAndConfirm — post-send failures leave the outcome uncertain", () => {
  async function run(fetchImpl: (body: string) => Response | Promise<Response>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: unknown, init: { body: string }) => fetchImpl(init.body)),
    );
    return relayerSubmitAndConfirm(fakeSignedTx(), { baseUrl: "https://relay.test" }).catch(
      (e) => e as unknown,
    );
  }

  function assertBlocksRetry(err: unknown) {
    expect(err).toBeInstanceOf(RelayerError);
    // A plain-payment retry (no trusted on-chain reconciliation) stays blocked.
    expect(relayerOutcomeBlocksRetry((err as RelayerError).code)).toBe(true);
  }

  it("a relayer-reported failure after acceptance blocks retry whatever code it carries", async () => {
    // A relayer that received the authorization can still answer success:false
    // with an innocuous-looking code; that must not be taken as proof of a safe
    // non-event.
    const err = await run(
      () =>
        new Response(
          JSON.stringify({ success: false, data: { code: "RATE_LIMITED" }, error: "slow down" }),
          { status: 200 },
        ),
    );
    assertBlocksRetry(err);
  });

  it("a 200 with no transaction id blocks retry (acceptance without a handle)", async () => {
    const err = await run(
      () =>
        new Response(JSON.stringify({ data: { transactionId: null, hash: null, status: "pending" } }), {
          status: 200,
        }),
    );
    assertBlocksRetry(err);
  });

  it("a connection loss after sending blocks retry", async () => {
    const err = await run(() => {
      throw new TypeError("Failed to fetch");
    });
    assertBlocksRetry(err);
  });

  it("a non-JSON response after sending blocks retry", async () => {
    const err = await run(() => new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    assertBlocksRetry(err);
  });

  it("a trusted-reconcile caller may still proceed past the same failure", async () => {
    // Name claims re-check the registry themselves, so they are allowed to tell
    // a real failure from a false one and retry.
    const err = await run(
      () =>
        new Response(
          JSON.stringify({ success: false, data: { code: "RATE_LIMITED" }, error: "slow down" }),
          { status: 200 },
        ),
    );
    expect(err).toBeInstanceOf(RelayerError);
    expect(relayerOutcomeBlocksRetry((err as RelayerError).code, true)).toBe(false);
  });
});
