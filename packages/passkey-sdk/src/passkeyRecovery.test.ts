import { describe, expect, it } from "vitest";
import { p256 } from "@noble/curves/nist.js";
import { buildSyntheticAssertion } from "./syntheticAssertion.js";
import {
  intersectCandidates,
  recoverP256PublicKeys,
  webauthnSignedDigest,
} from "./passkeyRecovery.js";
import { buf2hex } from "./encoding.js";

/** Sign `payload32` with a synthetic passkey and return the assertion. */
async function assertion(priv: Uint8Array, payload32: Uint8Array) {
  const a = await buildSyntheticAssertion(priv, payload32);
  return a;
}

describe("recoverP256PublicKeys", () => {
  it("recovers candidates containing the true key from one assertion", async () => {
    const priv = p256.utils.randomSecretKey();
    const truth = buf2hex(p256.getPublicKey(priv, false));

    const payload = new Uint8Array(32).fill(7);
    const { authenticatorData, clientDataJSON, signature } = await assertion(
      priv,
      payload,
    );

    const candidates = await recoverP256PublicKeys(
      authenticatorData,
      clientDataJSON,
      signature,
    );

    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates.length).toBeLessThanOrEqual(2);
    expect(candidates.every((k) => k.byteLength === 65)).toBe(true);
    expect(candidates.every((k) => k[0] === 0x04)).toBe(true);
    expect(candidates.map(buf2hex)).toContain(truth);
  });

  it("intersecting two assertions yields the unique true key", async () => {
    const priv = p256.utils.randomSecretKey();
    const truth = buf2hex(p256.getPublicKey(priv, false));

    const a1 = await assertion(priv, new Uint8Array(32).fill(7));
    const a2 = await assertion(priv, new Uint8Array(32).fill(9));

    const set1 = await recoverP256PublicKeys(
      a1.authenticatorData,
      a1.clientDataJSON,
      a1.signature,
    );
    const set2 = await recoverP256PublicKeys(
      a2.authenticatorData,
      a2.clientDataJSON,
      a2.signature,
    );

    const key = intersectCandidates([set1, set2]);
    expect(key).not.toBeNull();
    expect(buf2hex(key!)).toBe(truth);
  });

  it("a single assertion is ambiguous (intersection of one set is not unique)", async () => {
    const priv = p256.utils.randomSecretKey();
    const a1 = await assertion(priv, new Uint8Array(32).fill(7));
    const set1 = await recoverP256PublicKeys(
      a1.authenticatorData,
      a1.clientDataJSON,
      a1.signature,
    );
    // Two candidates from one assertion cannot be disambiguated.
    if (set1.length === 2) {
      expect(intersectCandidates([set1])).toBeNull();
    }
  });

  it("intersection rejects a key from a different passkey", async () => {
    const priv = p256.utils.randomSecretKey();
    const other = p256.utils.randomSecretKey();

    const a1 = await assertion(priv, new Uint8Array(32).fill(7));
    const b1 = await assertion(other, new Uint8Array(32).fill(9));

    const set1 = await recoverP256PublicKeys(
      a1.authenticatorData,
      a1.clientDataJSON,
      a1.signature,
    );
    const setOther = await recoverP256PublicKeys(
      b1.authenticatorData,
      b1.clientDataJSON,
      b1.signature,
    );

    // Different keys → empty/non-unique intersection, never a false positive.
    const key = intersectCandidates([set1, setOther]);
    if (key) {
      expect(buf2hex(key)).not.toBe(buf2hex(p256.getPublicKey(priv, false)));
    }
  });

  it("rejects a non-64-byte signature", async () => {
    await expect(
      recoverP256PublicKeys(new Uint8Array(37), new Uint8Array(1), new Uint8Array(70)),
    ).rejects.toThrow(/64-byte/);
  });

  it("webauthnSignedDigest matches the synthetic assertion's signed message", async () => {
    const priv = p256.utils.randomSecretKey();
    const { authenticatorData, clientDataJSON, signature } = await assertion(
      priv,
      new Uint8Array(32).fill(3),
    );
    const digest = await webauthnSignedDigest(authenticatorData, clientDataJSON);
    expect(digest.byteLength).toBe(32);
    // The synthetic signature must verify against this digest.
    expect(p256.verify(signature, digest, p256.getPublicKey(priv, false), { prehash: false })).toBe(
      true,
    );
  });
});
