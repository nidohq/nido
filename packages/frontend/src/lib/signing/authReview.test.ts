import { describe, expect, it } from "vitest";
import { Address, Networks, StrKey, hash, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import {
  AUTH_ENTRY_MAX_LIFETIME_LEDGERS,
  accountAuthEntry,
  authEntryExpiryProblem,
  authTreeProblem,
  describeAuthTree,
  renderAuthTree,
  reviewAuthEntry,
} from "./authReview.js";

const ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 1));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 2));
const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 3));
const OTHER = StrKey.encodeContract(Buffer.alloc(32, 4));

function call(contract: string, fn: string, args: xdr.ScVal[], subs: xdr.SorobanAuthorizedInvocation[] = []) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(contract).toScAddress(),
        functionName: fn,
        args,
      }),
    ),
    subInvocations: subs,
  });
}

const transfer = call(TOKEN, "transfer", [
  new Address(ACCOUNT).toScVal(),
  new Address(OTHER).toScVal(),
  nativeToScVal(5n, { type: "i128" }),
]);
const swap = call(ROUTER, "swap", [nativeToScVal(1, { type: "u32" })], [transfer]);
const applyDoc = call(ACCOUNT, "apply_doc", [nativeToScVal("{}", { type: "string" })]);

function preimage(
  invocation: xdr.SorobanAuthorizedInvocation,
  opts: { network?: string; expiration?: number } = {},
): string {
  return xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(opts.network ?? Networks.TESTNET)),
      nonce: xdr.Int64.fromString("7"),
      signatureExpirationLedger: opts.expiration ?? 1000,
      invocation,
    }),
  ).toXDR("base64");
}

describe("describeAuthTree", () => {
  it("decodes the whole tree, sub-calls included", () => {
    const tree = describeAuthTree(swap, ACCOUNT);
    expect(tree.contract).toBe(ROUTER);
    expect(tree.call).toMatchObject({ kind: "invoke", fn: "swap" });
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]!.call).toMatchObject({ kind: "transfer", token: TOKEN, to: OTHER, amount: 5n });
  });
});

describe("authTreeProblem", () => {
  it("allows calls on other contracts", () => {
    expect(authTreeProblem(describeAuthTree(swap, ACCOUNT), ACCOUNT)).toBeUndefined();
  });

  it("refuses a call on the account itself, at the root", () => {
    expect(authTreeProblem(describeAuthTree(applyDoc, ACCOUNT), ACCOUNT)).toMatch(/its own "apply_doc"/);
  });

  it("refuses a call on the account itself nested under another contract", () => {
    const nested = call(ROUTER, "call", [], [call(ACCOUNT, "schedule_upgrade", [])]);
    expect(authTreeProblem(describeAuthTree(nested, ACCOUNT), ACCOUNT)).toMatch(/schedule_upgrade/);
  });

  it("refuses the account's own transfer wrapper", () => {
    const execute = call(ACCOUNT, "execute", [
      new Address(TOKEN).toScVal(),
      nativeToScVal("transfer", { type: "symbol" }),
      nativeToScVal([new Address(ACCOUNT).toScVal(), new Address(OTHER).toScVal(), nativeToScVal(1n, { type: "i128" })]),
    ]);
    expect(authTreeProblem(describeAuthTree(execute, ACCOUNT), ACCOUNT)).toMatch(/"execute"/);
  });

  it("refuses a contract deployment in the account's name", () => {
    const deploy = new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractHostFn(
        new xdr.CreateContractArgs({
          contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
            new xdr.ContractIdPreimageFromAddress({
              address: new Address(ACCOUNT).toScAddress(),
              salt: Buffer.alloc(32),
            }),
          ),
          executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32)),
        }),
      ),
      subInvocations: [],
    });
    expect(authTreeProblem(describeAuthTree(deploy, ACCOUNT), ACCOUNT)).toMatch(/deploy a contract/);
  });
});

describe("reviewAuthEntry", () => {
  it("accepts a Soroban authorization for this network and returns its tree and expiry", () => {
    const res = reviewAuthEntry(preimage(swap, { expiration: 1234 }), ACCOUNT, Networks.TESTNET);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.review.expirationLedger).toBe(1234);
      expect(res.review.tree.children[0]!.call.kind).toBe("transfer");
    }
  });

  it("refuses an authorization for another network", () => {
    const res = reviewAuthEntry(preimage(swap, { network: Networks.PUBLIC }), ACCOUNT, Networks.TESTNET);
    expect(res).toEqual({ ok: false, reason: expect.stringMatching(/different Stellar network/) });
  });

  it("refuses a preimage of another envelope type", () => {
    const other = xdr.HashIdPreimage.envelopeTypeContractId(
      new xdr.HashIdPreimageContractId({
        networkId: hash(Buffer.from(Networks.TESTNET)),
        contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
          new xdr.ContractIdPreimageFromAddress({
            address: new Address(ACCOUNT).toScAddress(),
            salt: Buffer.alloc(32),
          }),
        ),
      }),
    ).toXDR("base64");
    expect(reviewAuthEntry(other, ACCOUNT, Networks.TESTNET)).toEqual({
      ok: false,
      reason: expect.stringMatching(/isn't a Soroban authorization entry/),
    });
  });

  it("refuses an unreadable payload", () => {
    expect(reviewAuthEntry("not xdr", ACCOUNT, Networks.TESTNET).ok).toBe(false);
  });

  it("refuses an authorization of a call on the account itself", () => {
    expect(reviewAuthEntry(preimage(applyDoc), ACCOUNT, Networks.TESTNET)).toEqual({
      ok: false,
      reason: expect.stringMatching(/apply_doc/),
    });
  });
});

describe("authEntryExpiryProblem", () => {
  it("accepts an expiry inside the window", () => {
    expect(authEntryExpiryProblem(1100, 1000)).toBeUndefined();
    expect(authEntryExpiryProblem(1000 + AUTH_ENTRY_MAX_LIFETIME_LEDGERS, 1000)).toBeUndefined();
  });

  it("refuses an expired authorization", () => {
    expect(authEntryExpiryProblem(1000, 1000)).toMatch(/expired/);
  });

  it("refuses one valid for longer than the cap", () => {
    expect(authEntryExpiryProblem(1001 + AUTH_ENTRY_MAX_LIFETIME_LEDGERS, 1000)).toMatch(/expires sooner/);
  });
});

describe("accountAuthEntry", () => {
  function entry(address: string): xdr.SorobanAuthorizationEntry {
    return new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: new Address(address).toScAddress(),
          nonce: xdr.Int64.fromString("1"),
          signatureExpirationLedger: 0,
          signature: xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: swap,
    });
  }

  it("returns the account's own entry", () => {
    const e = entry(ACCOUNT);
    expect(accountAuthEntry([e], ACCOUNT)).toBe(e);
  });

  it("refuses when the first entry belongs to someone else, or there is none", () => {
    expect(() => accountAuthEntry([entry(OTHER)], ACCOUNT)).toThrow(/doesn't ask this account/);
    expect(() => accountAuthEntry([], ACCOUNT)).toThrow(/doesn't ask this account/);
  });
});

describe("renderAuthTree", () => {
  it("renders every level and escapes decoded text", () => {
    const evil = call(ROUTER, "x<img>", [], [transfer]);
    const html = renderAuthTree(describeAuthTree(evil, ACCOUNT), "a <b>consequence</b>");
    expect(html).toContain("x&lt;img&gt;");
    expect(html).not.toContain("<img>");
    expect(html).toContain("Moves");
    expect(html).toContain("a &lt;b&gt;consequence&lt;/b&gt;");
  });
});
