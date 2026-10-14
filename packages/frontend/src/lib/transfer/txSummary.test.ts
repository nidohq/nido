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

/** Build `contract.execute(token, "transfer", [from, to, amount])` — the smart-
 *  account transfer-wrapper shape, but with the invoked contract and inner
 *  `from` parameterised so masquerade variants can be constructed. */
function executeTransferOp(
  contract: string,
  token: string,
  from: string,
  to: string,
  amount: bigint,
): xdr.Operation {
  return Operation.invokeContractFunction({
    contract,
    function: "execute",
    args: [
      Address.fromString(token).toScVal(),
      nativeToScVal("transfer", { type: "string" }),
      xdr.ScVal.scvVec([
        Address.fromString(from).toScVal(),
        Address.fromString(to).toScVal(),
        nativeToScVal(amount, { type: "i128" }),
      ]),
    ],
  });
}

describe("describeOperation", () => {
  it("decodes a smart-account execute->transfer into a transfer summary when bound to the account", () => {
    const op = buildSendOperation({
      smartAccount: SMART,
      tokenContractId: TOKEN,
      destination: DEST,
      amount: 7_000_000n,
    });
    expect(describeOperation(op, SMART)).toEqual({
      kind: "transfer",
      token: TOKEN,
      from: SMART,
      to: DEST,
      amount: 7_000_000n,
    });
  });

  it("does NOT decode execute->transfer when the invoked contract is not the account (masquerade guard)", () => {
    // A foreign/malicious contract (EVIL) exposes execute(token,"transfer",…)
    // with the selected account as `from`. Bound to the account, this must NOT
    // render as a verified transfer — the user would otherwise approve a
    // "verified XLM transfer" while authorizing EVIL.execute().
    const EVIL = StrKey.encodeContract(Buffer.alloc(32, 0xcc));
    const op = executeTransferOp(EVIL, TOKEN, SMART, DEST, 7_000_000n);
    const s = describeOperation(op, SMART);
    expect(s.kind).toBe("invoke");
    expect(s).toMatchObject({ kind: "invoke", contract: EVIL, fn: "execute" });
  });

  it("does NOT decode execute->transfer when `from` is not the account", () => {
    const EVICTIM = StrKey.encodeContract(Buffer.alloc(32, 0xdd));
    const op = executeTransferOp(SMART, TOKEN, EVICTIM, DEST, 7_000_000n);
    expect(describeOperation(op, SMART).kind).toBe("invoke");
  });

  it("does NOT decode execute->transfer without a bound account", () => {
    const op = buildSendOperation({
      smartAccount: SMART,
      tokenContractId: TOKEN,
      destination: DEST,
      amount: 7_000_000n,
    });
    // No account to bind to → cannot vouch for the wrapper → generic invoke.
    expect(describeOperation(op).kind).toBe("invoke");
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
    expect(describeOperation(op, SMART, REGISTRY)).toEqual({
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
    expect(describeOperation(op, SMART, REGISTRY)).toEqual({
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

// A semantic preview ("Registers the name …", "Grants a session key …") asserts
// something about the on-chain effect, so it is only honest for the specific
// contract whose effect we know: the configured name registry, or the selected
// account's own policy entry points. A same-named method on any other contract
// must read as an unverified generic call — otherwise an attacker-controlled
// contract could expose register()/add_context_rule()/remove_context_rule() and
// be reviewed as a benign action while the authorization the user signs does
// something else entirely.
describe("describeOperation — semantic previews require provenance (anti-masquerade)", () => {
  const FOREIGN = StrKey.encodeContract(Buffer.alloc(32, 0x99));

  function removeRuleOp(contract: string): xdr.Operation {
    return Operation.invokeContractFunction({
      contract,
      function: "remove_context_rule",
      args: [nativeToScVal(7, { type: "u32" })],
    });
  }

  function addRuleOp(contract: string): xdr.Operation {
    return Operation.invokeContractFunction({
      contract,
      function: "add_context_rule",
      args: [
        nativeToScVal({
          context_type: { tag: "CallContract", values: [DEST] },
          name: "session",
          valid_until: 1234,
          signers: [],
          policies: [],
        }),
      ],
    });
  }

  function registerOp(contract: string): xdr.Operation {
    return Operation.invokeContractFunction({
      contract,
      function: "register",
      args: [Address.fromString(SMART).toScVal(), nativeToScVal("alice", { type: "string" })],
    });
  }

  it("does NOT render register() on a foreign contract as a name registration", () => {
    const s = describeOperation(registerOp(FOREIGN), SMART, REGISTRY);
    expect(s).toMatchObject({ kind: "invoke", contract: FOREIGN, fn: "register" });
  });

  it("does NOT render register() as a name registration when no registry is known", () => {
    // Without a trusted registry id to compare against, a register call cannot
    // be vouched for — it must read as a generic call, not a name registration.
    const s = describeOperation(registerOp(REGISTRY), SMART);
    expect(s).toMatchObject({ kind: "invoke", fn: "register" });
  });

  it("does NOT render remove_context_rule on a foreign contract as a session revoke", () => {
    const s = describeOperation(removeRuleOp(FOREIGN), SMART, REGISTRY);
    expect(s).toMatchObject({ kind: "invoke", contract: FOREIGN, fn: "remove_context_rule" });
  });

  it("does NOT render add_context_rule on a foreign contract as a session grant", () => {
    const s = describeOperation(addRuleOp(FOREIGN), SMART, REGISTRY);
    expect(s).toMatchObject({ kind: "invoke", contract: FOREIGN, fn: "add_context_rule" });
  });

  it("renders the account's OWN remove_context_rule as a session revoke", () => {
    expect(describeOperation(removeRuleOp(SMART), SMART, REGISTRY)).toMatchObject({
      kind: "session-revoke",
      contract: SMART,
      ruleId: 7,
    });
  });

  it("renders the account's OWN add_context_rule as a session grant", () => {
    expect(describeOperation(addRuleOp(SMART), SMART, REGISTRY)).toMatchObject({
      kind: "session-grant",
      contract: SMART,
    });
  });

  it("decodes a foreign register inside a full dApp transaction as a generic call", () => {
    const source = new Account(G, "0");
    const tx = new TransactionBuilder(source, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(registerOp(FOREIGN))
      .setTimeout(0)
      .build();
    const summary = describeTransaction(tx.toXDR(), Networks.TESTNET, SMART, REGISTRY);
    expect(summary.ops[0]).toMatchObject({ kind: "invoke", contract: FOREIGN, fn: "register" });
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
  it("summarizes the account's own remove_context_rule(id)", () => {
    const fn = invoke("remove_context_rule", [nativeToScVal(7, { type: "u32" })]);
    // CONTRACT is the selected account here, so its own rule-removal is a
    // recognized session revoke.
    expect(describeHostFunction(fn, CONTRACT)).toEqual({
      kind: "session-revoke",
      contract: CONTRACT,
      ruleId: 7,
    });
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

    const summary = describeTransaction(tx.toXDR(), Networks.TESTNET, SMART);
    expect(summary.ops).toEqual([
      { kind: "transfer", token: TOKEN, from: SMART, to: DEST, amount: 9n },
    ]);
  });
});
