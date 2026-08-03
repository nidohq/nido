import { describe, it, expect } from "vitest";
import type { ChainRule } from "@nidohq/passkey-sdk";
import { isHybridRule, soloPasskeyDefaultRules } from "./mlDsaParanoid.js";

const MLDSA = "CB6JLLB3B52C6WJ5BH3JUVLAXWWV7KIPE6JW5N3BBNWCF5XB4E7F74UK";
const WEBAUTHN = "CACVGSAHYFBXY4LJKWW5B57LAAXHCZVDZOANUTYPLNV6HHQI4Q35EGMY";

const passkeySigner = { kind: "external" as const, verifier: WEBAUTHN, publicKey: new Uint8Array(65) };
const mlDsaSigner = { kind: "external" as const, verifier: MLDSA, publicKey: new Uint8Array(32) };

function rule(overrides: Partial<ChainRule>): ChainRule {
  return {
    ruleId: 2,
    contextType: { kind: "default" },
    name: "paranoid",
    signers: [passkeySigner, mlDsaSigner],
    policies: [],
    validUntil: null,
    ...overrides,
  };
}

describe("isHybridRule", () => {
  it("claims a policy-less Default rule with passkey + ML-DSA signers", () => {
    expect(isHybridRule(rule({}), MLDSA)).toBe(true);
  });

  it("rejects single-signer, policied, non-default, and double-ML-DSA shapes", () => {
    expect(isHybridRule(rule({ signers: [passkeySigner] }), MLDSA)).toBe(false);
    expect(isHybridRule(rule({ policies: ["CPOLICY"] }), MLDSA)).toBe(false);
    expect(
      isHybridRule(rule({ contextType: { kind: "call-contract", contract: WEBAUTHN } }), MLDSA),
    ).toBe(false);
    expect(isHybridRule(rule({ signers: [mlDsaSigner, mlDsaSigner] }), MLDSA)).toBe(false);
    expect(
      isHybridRule(rule({ signers: [passkeySigner, { kind: "delegated", address: WEBAUTHN }] }), MLDSA),
    ).toBe(false);
  });
});

describe("soloPasskeyDefaultRules", () => {
  it("splits passkey-only Default rules into removable vs policy-blocked, ignoring hybrid and self-admin rules", () => {
    const rules: ChainRule[] = [
      rule({ ruleId: 0, name: "default", signers: [passkeySigner] }),
      rule({ ruleId: 1, name: "spending", signers: [passkeySigner], policies: ["CPOLICY"] }),
      rule({ ruleId: 2 }), // hybrid — has an ML-DSA signer, not solo
      rule({
        ruleId: 3,
        name: "pq-backstop",
        contextType: { kind: "call-contract", contract: "CACCOUNT" },
        signers: [mlDsaSigner],
      }),
    ];
    const { removable, blocked } = soloPasskeyDefaultRules(rules, MLDSA);
    expect(removable.map((r) => r.ruleId)).toEqual([0]);
    expect(blocked.map((r) => r.ruleId)).toEqual([1]);
  });
});
