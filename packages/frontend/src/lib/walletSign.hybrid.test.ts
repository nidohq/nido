import { describe, it, expect } from "vitest";
import { classifyRuleSigners } from "./walletSign.js";

const WEBAUTHN = "CACVGSAHYFBXY4LJKWW5B57LAAXHCZVDZOANUTYPLNV6HHQI4Q35EGMY";
const MLDSA = "CB6JLLB3B52C6WJ5BH3JUVLAXWWV7KIPE6JW5N3BBNWCF5XB4E7F74UK";

const passkey = { verifier: WEBAUTHN, publicKey: new Uint8Array(65).fill(4) };
const commitment = new Uint8Array(32).fill(7);
const mlDsa = { verifier: MLDSA, publicKey: commitment };

describe("classifyRuleSigners", () => {
  it("splits a hybrid rule into one passkey and one ML-DSA signer", () => {
    const c = classifyRuleSigners([passkey, mlDsa], commitment);
    expect(c.passkeys).toEqual([passkey]);
    expect(c.mlDsa).toEqual([mlDsa]);
    expect(c.error).toBeNull();
  });

  it("a pure-passkey rule has no ML-DSA signers and no error even without a backstop", () => {
    const c = classifyRuleSigners([passkey, { verifier: WEBAUTHN, publicKey: new Uint8Array(65) }], null);
    expect(c.mlDsa).toHaveLength(0);
    expect(c.passkeys).toHaveLength(2);
    expect(c.error).toBeNull();
  });

  it("flags 'no-backstop' when an ML-DSA signer is present but no local key", () => {
    expect(classifyRuleSigners([passkey, mlDsa], null).error).toBe("no-backstop");
  });

  it("flags 'wrong-backstop' when the local commitment doesn't match the rule's ML-DSA signer", () => {
    const otherCommitment = new Uint8Array(32).fill(9);
    expect(classifyRuleSigners([passkey, mlDsa], otherCommitment).error).toBe("wrong-backstop");
  });
});
