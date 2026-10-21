import { describe, expect, it } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import { isContractStrKey } from "./address.js";

describe("isContractStrKey", () => {
  const id = StrKey.encodeContract(Buffer.alloc(32, 7));

  it("accepts a contract address", () => {
    expect(isContractStrKey(id)).toBe(true);
  });

  it("refuses a bad checksum, an account address and a wrong version byte", () => {
    expect(isContractStrKey(`${id.slice(0, -1)}${id.endsWith("A") ? "B" : "A"}`)).toBe(false);
    expect(isContractStrKey(StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7)))).toBe(false);
    // Same body and a valid checksum, but a liquidity-pool version byte.
    expect(isContractStrKey(StrKey.encodeLiquidityPool(Buffer.alloc(32, 7)))).toBe(false);
  });

  it("refuses lowercase, wrong length and markup", () => {
    expect(isContractStrKey(id.toLowerCase())).toBe(false);
    expect(isContractStrKey(id.slice(1))).toBe(false);
    expect(isContractStrKey(`C"><b>${"A".repeat(50)}`)).toBe(false);
  });
});
