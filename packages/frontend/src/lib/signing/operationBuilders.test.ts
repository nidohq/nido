/**
 * Round-trip tests for buildOperation: descriptor → xdr.Operation → OpSummary.
 *
 * Network access: the `register` and `add-context-rule` / `remove-context-rule`
 * branches call fetchRegistryAddress and (for add/remove) SmartAccountClient
 * which simulates against RPC. In the jsdom test environment there is no live
 * network, so:
 *
 *   - `register`: fetchRegistryAddress falls back to the hardcoded
 *     REGISTRY_FALLBACKS["name-registry"] address when the RPC is unreachable,
 *     so buildOperation returns a valid xdr.Operation without any mock needed.
 *
 *   - `add-context-rule` / `remove-context-rule`: SmartAccountClient.add_context_rule
 *     and .remove_context_rule call simulateTransaction against RPC, which will
 *     fail in jsdom. These branches are verified by code inspection and covered
 *     indirectly through integration tests — they are NOT unit-tested here
 *     (no vi.stubGlobal fetch mock exists for them).
 *
 *   - `transfer`: buildSendOperation is pure (no network), so the round-trip
 *     test runs without any mock.
 */

import { describe, it, expect, vi } from "vitest";
import { buildOperation } from "./operationBuilders";
import { describeOperation } from "../transfer/txSummary";
import { xdr } from "@stellar/stellar-sdk";

const C1 = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
// Valid C-addresses for token and recipient in transfer tests.
// CBQKB6… is the testnet factory address (known-good C-address from REGISTRY_FALLBACKS).
// CDVVRZ… is the testnet name-registry address (also from REGISTRY_FALLBACKS).
const TOKEN = "CBQKB6GYPO7P2CGDKN7KYLEFEBBN6FY5NXZJ7HNR43ZK2DDOU5N7NCV5";
const TO = "CDVVRZAVXTUQLS5LCGUP3H26RGOIUFKNE2UEJ6CAWYMBWY5LNORF6POX";

describe("buildOperation", () => {
  describe("register", () => {
    it("builds a register op that decodes to a name-register summary", async () => {
      // fetchRegistryAddress will fail to reach RPC in jsdom and fall back to
      // REGISTRY_FALLBACKS["name-registry"] (a valid testnet C-address).
      // Console.warn is expected — suppress it so test output stays clean.
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const op = await buildOperation({ type: "register", name: "alice" }, C1);
        const summary = describeOperation(op);
        expect(summary).toMatchObject({ kind: "name-register", account: C1, name: "alice" });
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe("transfer", () => {
    it("builds a transfer op that decodes to a transfer summary", async () => {
      const amountRaw = "10000000"; // 1 XLM in stroops
      const op = await buildOperation(
        { type: "transfer", token: TOKEN, to: TO, amountRaw },
        C1,
      );
      const summary = describeOperation(op);
      expect(summary).toMatchObject({
        kind: "transfer",
        token: TOKEN,
        from: C1,
        to: TO,
        amount: BigInt(amountRaw),
      });
    });

    it("accepts bigint-as-string amountRaw", async () => {
      const op = await buildOperation(
        { type: "transfer", token: TOKEN, to: TO, amountRaw: "99999999999" },
        C1,
      );
      const summary = describeOperation(op);
      expect(summary).toMatchObject({ kind: "transfer", amount: 99999999999n });
    });
  });

  describe("register — dispatches correctly", () => {
    it("returns an invokeHostFunction xdr.Operation", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const op = await buildOperation({ type: "register", name: "bob" }, C1);
        // Verify it's a proper XDR operation with an invokeHostFunction body.
        expect(op).toBeInstanceOf(xdr.Operation);
        const body = op.body();
        expect(body.switch()).toEqual(xdr.OperationType.invokeHostFunction());
        const ic = body.invokeHostFunctionOp().hostFunction().invokeContract();
        expect(ic.functionName().toString()).toBe("register");
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
