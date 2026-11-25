import { describe, expect, it } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import { existingNidoTarget } from "./existingNido";

const C = StrKey.encodeContract(Buffer.alloc(32, 7));
const G = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 5));
const c = C.toLowerCase();

describe("existingNidoTarget", () => {
  it("sends a contract address to its account page on the account's own address", () => {
    expect(existingNidoTarget("nido.fyi", C)).toBe(`//${c}.nido.fyi/account/`);
    expect(existingNidoTarget("test.nido.fyi", C)).toBe(`//${c}.test.nido.fyi/account/`);
    expect(existingNidoTarget("nido.localhost:4321", C)).toBe(`//${c}.nido.localhost:4321/account/`);
  });

  it("accepts a lowercase address and surrounding whitespace", () => {
    expect(existingNidoTarget("nido.fyi", `  ${c}\n`)).toBe(`//${c}.nido.fyi/account/`);
  });

  it("works from an account's own address too, not only the apex", () => {
    const other = StrKey.encodeContract(Buffer.alloc(32, 9)).toLowerCase();
    expect(existingNidoTarget(`${other}.nido.fyi`, C)).toBe(`//${c}.nido.fyi/account/`);
  });

  it("refuses anything that isn't a valid contract address", () => {
    expect(existingNidoTarget("nido.fyi", "")).toBeNull();
    expect(existingNidoTarget("nido.fyi", "alice")).toBeNull();
    expect(existingNidoTarget("nido.fyi", G)).toBeNull(); // a G… account
    expect(existingNidoTarget("nido.fyi", C.slice(0, -1))).toBeNull(); // too short
    expect(existingNidoTarget("nido.fyi", `${C.slice(0, -1)}A`)).toBeNull(); // bad checksum
  });

  it("refuses a C-prefixed, 56-character string that would point at another host", () => {
    const crafted = `C${"a".repeat(44)}.evil.com/x`;
    expect(crafted).toHaveLength(56);
    expect(existingNidoTarget("nido.fyi", crafted)).toBeNull();
  });
});
