import { describe, it, expect } from "vitest";
import { parseRule, selectRemovableSigner } from "./policyChainFetch.js";
import type { ChainSigner } from "@nidohq/passkey-sdk";

// These fixtures mirror exactly what `scValToNative(scv)` (NO type hint) returns
// for a ContextRule: structs → plain objects with snake_case keys, Soroban enums
// → tag-first arrays, bytes → Uint8Array. Decoding raw is the fix for #3: the
// typed bindings call `scValToNative(scv, ContextRuleTypeDef)` (strict) which
// throws "Type … was not vec, but … is" when an account's on-chain rule shape
// predates the regenerated bindings. Raw decode is lenient and never throws.

describe("parseRule (raw scValToNative decode)", () => {
  it("maps a default-context recovery rule with external + delegated signers", () => {
    const rule = parseRule({
      id: 1,
      context_type: ["Default"],
      name: "recovery",
      signers: [
        ["External", "CVERIFIER", new Uint8Array([1, 2, 3, 4])],
        ["Delegated", "CFRIEND"],
      ],
      policies: ["CPOLICY"],
      valid_until: null,
    });
    expect(rule.ruleId).toBe(1);
    expect(rule.contextType).toEqual({ kind: "default" });
    expect(rule.name).toBe("recovery");
    expect(rule.signers).toEqual([
      {
        kind: "external",
        verifier: "CVERIFIER",
        publicKey: new Uint8Array([1, 2, 3, 4]),
      },
      { kind: "delegated", address: "CFRIEND" },
    ]);
    expect(rule.policies).toEqual(["CPOLICY"]);
    expect(rule.validUntil).toBeNull();
  });

  it("maps a call-contract context and coerces a bigint valid_until", () => {
    const rule = parseRule({
      id: 2,
      context_type: ["CallContract", "CTARGET"],
      name: "scoped",
      signers: [],
      policies: [],
      valid_until: 4500n,
    });
    expect(rule.contextType).toEqual({
      kind: "call-contract",
      contract: "CTARGET",
    });
    expect(rule.validUntil).toBe(4500);
  });

  it("maps a create-contract context with wasm bytes; absent valid_until is null", () => {
    const rule = parseRule({
      id: 3,
      context_type: ["CreateContract", new Uint8Array([9, 9])],
      name: "deployer",
      signers: [],
      policies: [],
      valid_until: undefined,
    });
    expect(rule.contextType).toEqual({
      kind: "create-contract",
      wasm: new Uint8Array([9, 9]),
    });
    expect(rule.validUntil).toBeNull();
  });
});

describe("selectRemovableSigner (recovery: pick the lost device's key)", () => {
  const ext = (pk: number[]): ChainSigner => ({
    kind: "external",
    verifier: "CVERIFIER",
    publicKey: new Uint8Array(pk),
  });
  const friend = (addr: string): ChainSigner => ({ kind: "delegated", address: addr });

  it("returns the lone external signer with its aligned signer_id", () => {
    // signers/signer_ids are positionally aligned; the friend at index 0 must be
    // skipped and the external's OWN id (7), not its array index (1), returned.
    const got = selectRemovableSigner([friend("CFRIEND"), ext([1, 2, 3])], [3, 7]);
    expect(got).toEqual({ ok: true, signerId: 7, publicKey: new Uint8Array([1, 2, 3]) });
  });

  it("reports 'none' when there is no external signer to remove", () => {
    expect(selectRemovableSigner([friend("CA"), friend("CB")], [0, 1])).toEqual({
      ok: false,
      reason: "none",
    });
  });

  it("reports 'multiple' (with a count) when more than one external signer exists", () => {
    expect(selectRemovableSigner([ext([1]), ext([2])], [4, 5])).toEqual({
      ok: false,
      reason: "multiple",
      count: 2,
    });
  });

  it("reports 'unreadable' when the external signer's id is missing", () => {
    // signer_ids shorter than signers (e.g. an unexpected on-chain shape) →
    // id is undefined → we refuse to guess rather than send a bogus remove.
    expect(selectRemovableSigner([friend("CFRIEND"), ext([1])], [0])).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });
});
