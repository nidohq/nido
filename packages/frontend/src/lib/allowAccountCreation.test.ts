import { describe, expect, it } from "vitest";
import { allowAccountCreation } from "./allowAccountCreation";

describe("allowAccountCreation", () => {
  it("is open on the testnet apex and its subdomains", () => {
    expect(allowAccountCreation("test.nido.fyi")).toBe(true);
    expect(allowAccountCreation("alice.test.nido.fyi")).toBe(true);
  });

  it("is open on the local development apex and its subdomains", () => {
    expect(allowAccountCreation("nido.localhost")).toBe(true);
    expect(allowAccountCreation("cabc.nido.localhost")).toBe(true);
  });

  it("stays closed on mainnet and on hosts that are not Nido's", () => {
    expect(allowAccountCreation("nido.fyi")).toBe(false);
    expect(allowAccountCreation("alice.nido.fyi")).toBe(false);
    expect(allowAccountCreation("nido-xyz.pages.dev")).toBe(false);
    expect(allowAccountCreation("localhost")).toBe(false);
  });
});
