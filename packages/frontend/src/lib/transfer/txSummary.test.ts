import { describe, it, expect } from "vitest";
import {
  Account,
  Address,
  Asset,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { describeHostFunction, describeOperation, describeTransaction } from "./txSummary";
import { buildSendOperation } from "./buildSend";

const SMART = StrKey.encodeContract(Buffer.alloc(32, 0xaa));
const DEST = StrKey.encodeContract(Buffer.alloc(32, 0xbb));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 0xee));
const REGISTRY = StrKey.encodeContract(Buffer.alloc(32, 0x12));
const G = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x11));

describe("describeOperation", () => {
  it("decodes a smart-account execute->transfer into a transfer summary", () => {
    const op = buildSendOperation({
      smartAccount: SMART,
      tokenContractId: TOKEN,
      destination: DEST,
      amount: 7_000_000n,
    });
    expect(describeOperation(op)).toEqual({
      kind: "transfer",
      token: TOKEN,
      from: SMART,
      to: DEST,
      amount: 7_000_000n,
    });
  });

  it("decodes a bare token transfer(from, to, amount)", () => {
    const op = Operation.invokeContractFunction({
      contract: TOKEN,
      function: "transfer",
      args: [
        Address.fromString(SMART).toScVal(),
        Address.fromString(DEST).toScVal(),
        nativeToScVal(123n, { type: "i128" }),
      ],
    });
    expect(describeOperation(op)).toEqual({
      kind: "transfer",
      token: TOKEN,
      from: SMART,
      to: DEST,
      amount: 123n,
    });
  });

  it("falls back to a generic invoke summary for other contract calls", () => {
    const op = Operation.invokeContractFunction({
      contract: TOKEN,
      function: "mint",
      args: [Address.fromString(DEST).toScVal()],
    });
    expect(describeOperation(op)).toEqual({
      kind: "invoke",
      contract: TOKEN,
      fn: "mint",
      argsCount: 1,
    });
  });

  it("decodes a name-registry register(account, name) into a name-register summary", () => {
    const op = Operation.invokeContractFunction({
      contract: REGISTRY,
      function: "register",
      args: [
        Address.fromString(SMART).toScVal(),
        nativeToScVal("alice", { type: "string" }),
      ],
    });
    expect(describeOperation(op)).toEqual({
      kind: "name-register",
      contract: REGISTRY,
      account: SMART,
      name: "alice",
    });
  });

  it("falls back to a generic invoke when register's args aren't (address, string)", () => {
    const op = Operation.invokeContractFunction({
      contract: REGISTRY,
      function: "register",
      args: [
        Address.fromString(SMART).toScVal(),
        nativeToScVal(42n, { type: "i128" }), // not a name string
      ],
    });
    expect(describeOperation(op)).toEqual({
      kind: "invoke",
      contract: REGISTRY,
      fn: "register",
      argsCount: 2,
    });
  });

  it("falls back to 'other' for non-invoke operations", () => {
    const op = Operation.payment({
      destination: G,
      asset: Asset.native(),
      amount: "5",
    });
    const s = describeOperation(op);
    expect(s.kind).toBe("other");
  });
});

const CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

function invoke(fn: string, args: xdr.ScVal[]): xdr.HostFunction {
  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: Address.fromString(CONTRACT).toScAddress(),
      functionName: fn,
      args,
    }),
  );
}

describe("describeHostFunction — context rules", () => {
  it("summarizes remove_context_rule(id)", () => {
    const fn = invoke("remove_context_rule", [nativeToScVal(7, { type: "u32" })]);
    expect(describeHostFunction(fn)).toEqual({ kind: "session-revoke", contract: CONTRACT, ruleId: 7 });
  });
});

describe("describeTransaction", () => {
  it("parses a transaction XDR and summarizes its operations", () => {
    const source = new Account(G, "0");
    const op = buildSendOperation({
      smartAccount: SMART,
      tokenContractId: TOKEN,
      destination: DEST,
      amount: 9n,
    });
    const tx = new TransactionBuilder(source, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(op)
      .setTimeout(0)
      .build();

    const summary = describeTransaction(tx.toXDR(), Networks.TESTNET);
    expect(summary.ops).toEqual([
      { kind: "transfer", token: TOKEN, from: SMART, to: DEST, amount: 9n },
    ]);
  });
});
