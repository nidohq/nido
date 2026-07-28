import { describe, it, expect } from "vitest";
import type { ChainRule } from "@nidohq/passkey-sdk";
import { findBackstopRule, isSelfAdminRule } from "./mlDsaEnroll.js";

const ACCOUNT = "CACCOUNTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const MLDSA = "CB6JLLB3B52C6WJ5BH3JUVLAXWWV7KIPE6JW5N3BBNWCF5XB4E7F74UK";
const WEBAUTHN = "CACVGSAHYFBXY4LJKWW5B57LAAXHCZVDZOANUTYPLNV6HHQI4Q35EGMY";
const DAPP = "CDAPPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function rule(overrides: Partial<ChainRule>): ChainRule {
  return {
    ruleId: 1,
    contextType: { kind: "call-contract", contract: ACCOUNT },
    name: "pq-backstop",
    signers: [{ kind: "external", verifier: MLDSA, publicKey: new Uint8Array(32) }],
    policies: [],
    validUntil: null,
    ...overrides,
  };
}

describe("isSelfAdminRule", () => {
  it("claims a policy-less CallContract(self) rule", () => {
    expect(isSelfAdminRule(rule({}), ACCOUNT)).toBe(true);
  });

  it("rejects session-key shapes (other-contract target)", () => {
    expect(
      isSelfAdminRule(rule({ contextType: { kind: "call-contract", contract: DAPP } }), ACCOUNT),
    ).toBe(false);
  });

  it("rejects self-scoped rules that carry policies (multisig recovery)", () => {
    expect(isSelfAdminRule(rule({ policies: ["CPOLICY"] }), ACCOUNT)).toBe(false);
  });

  it("rejects the Default rule", () => {
    expect(isSelfAdminRule(rule({ contextType: { kind: "default" } }), ACCOUNT)).toBe(false);
  });
});

describe("findBackstopRule", () => {
  it("finds the rule whose single external signer uses the ML-DSA verifier", () => {
    const rules = [
      rule({ ruleId: 0, contextType: { kind: "default" } }),
      rule({ ruleId: 2, contextType: { kind: "call-contract", contract: DAPP } }),
      rule({ ruleId: 3 }),
    ];
    expect(findBackstopRule(rules, ACCOUNT, MLDSA)?.ruleId).toBe(3);
  });

  it("ignores self-admin rules on a different verifier", () => {
    const rules = [
      rule({
        signers: [{ kind: "external", verifier: WEBAUTHN, publicKey: new Uint8Array(65) }],
      }),
    ];
    expect(findBackstopRule(rules, ACCOUNT, MLDSA)).toBeNull();
  });

  it("ignores multi-signer and delegated-signer rules", () => {
    const twoSigners = rule({
      signers: [
        { kind: "external", verifier: MLDSA, publicKey: new Uint8Array(32) },
        { kind: "external", verifier: WEBAUTHN, publicKey: new Uint8Array(65) },
      ],
    });
    const delegated = rule({ signers: [{ kind: "delegated", address: DAPP }] });
    expect(findBackstopRule([twoSigners, delegated], ACCOUNT, MLDSA)).toBeNull();
  });
});
