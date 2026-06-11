import { describe, it, expect } from "vitest";
import { describeSignRequest } from "./signRequestSummary.js";

const HASH = "a1b2c3d4e5f6";

describe("describeSignRequest", () => {
  it("recognizes a name claim when the sign hash matches the stored claim hash", () => {
    expect(
      describeSignRequest({ signHash: HASH, claimHash: HASH, claimName: "alice" }),
    ).toEqual({ kind: "name-claim", name: "alice" });
  });

  it("falls back to generic when the sign hash does not match the stored claim", () => {
    expect(
      describeSignRequest({
        signHash: "deadbeef",
        claimHash: HASH,
        claimName: "alice",
      }),
    ).toEqual({ kind: "generic" });
  });

  it("is generic when there is no stored claim hash", () => {
    expect(
      describeSignRequest({ signHash: HASH, claimHash: null, claimName: "alice" }),
    ).toEqual({ kind: "generic" });
  });

  it("is generic when there is no stored claim name", () => {
    expect(
      describeSignRequest({ signHash: HASH, claimHash: HASH, claimName: null }),
    ).toEqual({ kind: "generic" });
  });

  it("matches case-insensitively (hex casing must not break recognition)", () => {
    expect(
      describeSignRequest({
        signHash: HASH.toUpperCase(),
        claimHash: HASH,
        claimName: "alice",
      }),
    ).toEqual({ kind: "name-claim", name: "alice" });
  });

  it("tolerates surrounding whitespace on the hashes", () => {
    expect(
      describeSignRequest({
        signHash: `  ${HASH}  `,
        claimHash: HASH,
        claimName: "alice",
      }),
    ).toEqual({ kind: "name-claim", name: "alice" });
  });

  it("never recognizes a claim when both hashes are empty (no false positive on blanks)", () => {
    expect(
      describeSignRequest({ signHash: "", claimHash: "", claimName: "alice" }),
    ).toEqual({ kind: "generic" });
  });
});
