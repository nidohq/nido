import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RelayerError,
  extractFuncAndAuth,
  submitSorobanTransaction,
  waitForConfirmation,
} from "./relayerClient";
import { Account, Address, Networks, Operation, TransactionBuilder, nativeToScVal } from "@stellar/stellar-sdk";

const BASE = "https://relayer.test";

/** Stub global fetch with a canned response (answers every call, not just one). */
function stubFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("submitSorobanTransaction", () => {
  it("POSTs {params:{func,auth,skipWait}} to /relay and parses a flat data payload", async () => {
    const fetchMock = stubFetch(200, {
      success: true,
      data: { transactionId: "tx_1", hash: null, status: "pending" },
      error: null,
    });
    const res = await submitSorobanTransaction({ func: "AAA=", auth: ["BBB="] }, BASE);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/relay`, expect.objectContaining({ method: "POST" }));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      params: { func: "AAA=", auth: ["BBB="], skipWait: true },
    });
    expect(res).toEqual({ transactionId: "tx_1", hash: null, status: "pending" });
  });

  it("unwraps the v1.5.0 data.result nesting", async () => {
    stubFetch(200, {
      success: true,
      data: { result: { transactionId: "tx_2", hash: "abc", status: "confirmed" } },
      error: null,
    });
    const res = await submitSorobanTransaction({ func: "AAA=", auth: [] }, BASE);
    expect(res.transactionId).toBe("tx_2");
    expect(res.status).toBe("confirmed");
  });

  it("throws RelayerError with the plugin code on success:false", async () => {
    stubFetch(400, {
      success: false,
      data: { code: "AUTH_EXPIRY_TOO_SHORT", details: { margin: 1 } },
      error: "Auth expiry too short",
    });
    await expect(submitSorobanTransaction({ func: "AAA=", auth: [] }, BASE)).rejects.toBeInstanceOf(RelayerError);
    await expect(submitSorobanTransaction({ func: "AAA=", auth: [] }, BASE)).rejects.toMatchObject({
      name: "RelayerError",
      code: "AUTH_EXPIRY_TOO_SHORT",
      message: "Auth expiry too short",
    });
  });

  it("throws RelayerError on non-JSON responses", async () => {
    const fn = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    });
    vi.stubGlobal("fetch", fn);
    await expect(submitSorobanTransaction({ func: "AAA=", auth: [] }, BASE)).rejects.toMatchObject({
      name: "RelayerError",
    });
  });

  it("throws on an unrecognized payload shape instead of degrading silently", async () => {
    stubFetch(200, { success: true, data: { somethingElse: true }, error: null });
    await expect(submitSorobanTransaction({ func: "AAA=", auth: [] }, BASE)).rejects.toMatchObject({
      name: "RelayerError",
      message: "Unrecognized relayer payload",
    });
  });

  it("throws 'Relayer not configured' on an empty baseUrl without fetching", async () => {
    const fn = vi.fn();
    vi.stubGlobal("fetch", fn);
    await expect(submitSorobanTransaction({ func: "AAA=", auth: [] }, "")).rejects.toMatchObject({
      name: "RelayerError",
      message: "Relayer not configured (PUBLIC_RELAYER_URL is empty)",
    });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("waitForConfirmation", () => {
  it("polls getTransaction until confirmed", async () => {
    const responses = [
      { success: true, data: { transactionId: "tx_3", hash: null, status: "submitted" }, error: null },
      { success: true, data: { transactionId: "tx_3", hash: "deadbeef", status: "confirmed" }, error: null },
    ];
    const fn = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => responses.shift(),
    }));
    vi.stubGlobal("fetch", fn);
    const res = await waitForConfirmation("tx_3", BASE, { intervalMs: 1, maxAttempts: 5 });
    expect(res.hash).toBe("deadbeef");
    expect(fn).toHaveBeenCalledTimes(2);
    const firstInit = fn.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(firstInit.body as string)).toEqual({ params: { getTransaction: { transactionId: "tx_3" } } });
  });

  it("throws ONCHAIN_FAILED on terminal failed status", async () => {
    stubFetch(200, { success: true, data: { transactionId: "tx_4", hash: null, status: "failed" }, error: null });
    await expect(waitForConfirmation("tx_4", BASE, { intervalMs: 1, maxAttempts: 2 })).rejects.toMatchObject({
      code: "ONCHAIN_FAILED",
    });
  });

  it("throws ONCHAIN_FAILED on terminal expired status", async () => {
    stubFetch(200, { success: true, data: { transactionId: "tx_6", hash: null, status: "expired" }, error: null });
    await expect(waitForConfirmation("tx_6", BASE, { intervalMs: 1, maxAttempts: 2 })).rejects.toMatchObject({
      code: "ONCHAIN_FAILED",
    });
  });

  it("throws WAIT_TIMEOUT when attempts are exhausted", async () => {
    stubFetch(200, { success: true, data: { transactionId: "tx_5", hash: null, status: "pending" }, error: null });
    await expect(waitForConfirmation("tx_5", BASE, { intervalMs: 1, maxAttempts: 2 })).rejects.toMatchObject({
      code: "WAIT_TIMEOUT",
    });
  });

  it("attaches the last poll response to the WAIT_TIMEOUT error", async () => {
    stubFetch(200, {
      success: true,
      data: { transactionId: "tx_7", hash: "feedface", status: "submitted" },
      error: null,
    });
    await expect(waitForConfirmation("tx_7", BASE, { intervalMs: 1, maxAttempts: 2 })).rejects.toMatchObject({
      code: "WAIT_TIMEOUT",
      details: { transactionId: "tx_7", hash: "feedface", status: "submitted" },
    });
  });

  it("rides out transient poll failures and resumes (tx already in flight)", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls <= 4) throw new TypeError("fetch failed");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { transactionId: "tx_8", hash: "cafebabe", status: "confirmed" },
          error: null,
        }),
      };
    });
    vi.stubGlobal("fetch", fn);
    const res = await waitForConfirmation("tx_8", BASE, { intervalMs: 1, maxAttempts: 10 });
    expect(res.hash).toBe("cafebabe");
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("gives up as WAIT_TIMEOUT after 5 consecutive poll failures", async () => {
    const fn = vi.fn().mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fn);
    await expect(waitForConfirmation("tx_9", BASE, { intervalMs: 1, maxAttempts: 50 })).rejects.toMatchObject({
      code: "WAIT_TIMEOUT",
      message: expect.stringMatching(/Lost contact/),
    });
    expect(fn).toHaveBeenCalledTimes(5);
  });
});

describe("extractFuncAndAuth", () => {
  it("pulls base64 HostFunction + auth entries from a built invoke tx", () => {
    const source = new Account("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7", "1");
    const op = Operation.invokeContractFunction({
      contract: "CD5FK6CQ7QIZ5ONARG36Y53ERI5PIBGELSJUTD7OXYLK6EQAS4N3TFBV",
      function: "update_message",
      args: [nativeToScVal("hi", { type: "string" }), Address.fromString(source.accountId()).toScVal()],
    });
    const tx = new TransactionBuilder(source, { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(op)
      .setTimeout(0)
      .build();
    const { func, auth } = extractFuncAndAuth(tx);
    expect(typeof func).toBe("string");
    expect(func.length).toBeGreaterThan(0);
    expect(auth).toEqual([]);
  });
});
