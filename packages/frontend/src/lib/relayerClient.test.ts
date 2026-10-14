import { describe, it, expect } from "vitest";
import { DEFAULT_EXPIRATION_OFFSET } from "@nidohq/passkey-sdk";
import { RELAYER_EXPIRATION_OFFSET } from "./network";
import { relayerOutcomeBlocksRetry, signatureExpirationOffset } from "./relayerClient";

// The auth digest `__check_auth` recomputes binds the signature-expiration
// ledger. `buildAuthHash` and the signature injector(s) MUST be handed the SAME
// offset or the digests diverge and every signature is rejected. Centralising
// the offset behind `signatureExpirationOffset` is what guarantees that; these
// tests pin the two branches and, crucially, that the non-relayer branch equals
// the SDK's own injector default (so a value built here matches a signature the
// SDK injector expires with its default).
describe("signatureExpirationOffset (relayer/offset parity)", () => {
  it("uses the tight relayer window when the relayer is active", () => {
    expect(signatureExpirationOffset(true)).toBe(RELAYER_EXPIRATION_OFFSET);
  });

  it("non-relayer offset equals the SDK injector default (frontend/SDK parity)", () => {
    // The regression this guards: if the frontend's non-relayer offset ever
    // diverged from the SDK's injector default, a hash built here would not
    // match a signature the SDK injector expires with its (unspecified →
    // default) offset, and __check_auth would reject it.
    expect(signatureExpirationOffset(false)).toBe(DEFAULT_EXPIRATION_OFFSET);
  });

  it("relayer window is strictly tighter than the default (leaves the browser)", () => {
    expect(RELAYER_EXPIRATION_OFFSET).toBeLessThan(DEFAULT_EXPIRATION_OFFSET);
  });
});

describe("relayerOutcomeBlocksRetry (duplicate-payment guard)", () => {
  it("blocks a fresh-payment retry while the outcome is still in flight", () => {
    expect(relayerOutcomeBlocksRetry("WAIT_TIMEOUT")).toBe(true);
  });

  it("blocks a fresh-payment retry on a relayer-reported failure (not trusted chain evidence)", () => {
    // A lying/faulty relayer reporting failure must not let the wallet pay again.
    expect(relayerOutcomeBlocksRetry("ONCHAIN_FAILED")).toBe(true);
  });

  it("allows a relayer-reported failure through when the caller reconciles on-chain itself", () => {
    // e.g. a name claim re-checked against the registry can tell a real failure
    // from a false one, so it may proceed.
    expect(relayerOutcomeBlocksRetry("ONCHAIN_FAILED", true)).toBe(false);
  });

  it("does not block ordinary (non-relayer) errors", () => {
    expect(relayerOutcomeBlocksRetry(undefined)).toBe(false);
    expect(relayerOutcomeBlocksRetry("SOME_OTHER")).toBe(false);
  });

  it("blocks a fresh-payment retry when submission began but its outcome is unknown", () => {
    // Any failure after the signed authorization was sent (connection loss,
    // non-JSON, acceptance without a handle, a relayer-reported failure) is
    // uncertain: the relayer may already hold a usable authorization.
    expect(relayerOutcomeBlocksRetry("SUBMIT_UNKNOWN")).toBe(true);
  });

  it("lets a trusted-reconcile caller proceed past an unknown submission outcome", () => {
    expect(relayerOutcomeBlocksRetry("SUBMIT_UNKNOWN", true)).toBe(false);
  });
});
