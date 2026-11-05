/**
 * buildOperation for the app-scope descriptors: the invocation each one
 * builds (contract, function, arguments), and apply-scope's re-read of the
 * scope record right before signing. The chain reads are stubbed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Networks, StrKey, scValToNative, type xdr } from "@stellar/stellar-sdk";
import { canonicalJson, docHash, perch } from "@nidohq/passkey-sdk";

const scope = vi.fn();
vi.mock("../policy/appGrantLoad.js", () => ({
  accountScopes: () => ({ scope }),
  loadScopeChecks: async () => ({ admin: null, excluded: [CONTROLLER], adminKeys: [] }),
}));
vi.mock("../policy/docPolicyFetch.js", () => ({
  fetchDocLimits: async () => ({ maxSigners: 8, maxRules: 10, maxCanonicalBytes: 8192, maxRuleNameBytes: 20 }),
  fetchAppliedDocument: async () => ({ revision: 0n, json: undefined }),
}));

const { buildOperation } = await import("./operationBuilders");

const contract = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));
const ACCOUNT = contract(1);
const CONTROLLER = contract(5);
const ORIGIN = "https://game.example";
const ID = perch.appScopeCandidates(ORIGIN)[0]!;

function call(op: xdr.Operation) {
  const fn = op.body().invokeHostFunctionOp().hostFunction().invokeContract();
  return {
    contract: StrKey.encodeContract(fn.contractAddress().contractId() as unknown as Buffer),
    fn: fn.functionName().toString(),
    args: fn.args().map((a) => scValToNative(a)),
  };
}

const doc = perch.upsertAppRules(
  null,
  ORIGIN,
  { verifier: contract(2), key: "04" + "cd".repeat(64) },
  [{ name: "guess", scope: { type: "contract", address: contract(3) }, functions: ["guess"] }],
  Networks.TESTNET,
);

beforeEach(() => scope.mockReset());

describe("buildOperation: app scopes", () => {
  it("remove-scope is remove_scope(scope) on the account", async () => {
    expect(call(await buildOperation({ type: "remove-scope", scope: ID, origin: ORIGIN }, ACCOUNT))).toEqual({
      contract: ACCOUNT,
      fn: "remove_scope",
      args: [ID],
    });
  });

  it("gc-scope is gc_scope(scope) on the account", async () => {
    expect(call(await buildOperation({ type: "gc-scope", scope: ID, origin: null }, ACCOUNT))).toEqual({
      contract: ACCOUNT,
      fn: "gc_scope",
      args: [ID],
    });
  });

  it("apply-scope is apply_scope(scope, the canonical bytes) while the scope is as reviewed", async () => {
    scope.mockResolvedValue(null);
    const op = await buildOperation(
      { type: "apply-scope", scope: ID, origin: ORIGIN, docJson: canonicalJson(doc), prevDocHash: null },
      ACCOUNT,
    );
    const c = call(op);
    expect([c.contract, c.fn, c.args[0]]).toEqual([ACCOUNT, "apply_scope", ID]);
    expect(Buffer.from(c.args[1] as Uint8Array).toString("utf8")).toBe(canonicalJson(doc));
  });

  it("apply-scope refuses when the scope changed after the review", async () => {
    scope.mockResolvedValue({ gen: 0n, docHash: docHash(doc), rules: [] });
    await expect(
      buildOperation({ type: "apply-scope", scope: ID, origin: ORIGIN, docJson: canonicalJson(doc), prevDocHash: null }, ACCOUNT),
    ).rejects.toThrow(/changed after this page read them/);
  });

  it("apply-scope refuses a document the account would refuse", async () => {
    scope.mockResolvedValue(null);
    const reach = perch.upsertAppRules(
      null,
      ORIGIN,
      { verifier: contract(2), key: "04" + "cd".repeat(64) },
      [{ name: "reach", scope: { type: "contract", address: CONTROLLER } }],
      Networks.TESTNET,
    );
    await expect(
      buildOperation({ type: "apply-scope", scope: ID, origin: ORIGIN, docJson: canonicalJson(reach), prevDocHash: null }, ACCOUNT),
    ).rejects.toThrow(/recovery/);
  });
});
