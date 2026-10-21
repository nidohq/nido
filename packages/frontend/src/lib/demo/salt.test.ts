import { describe, expect, it } from "vitest";
import { generateSaltHex } from "./salt.js";

describe("generateSaltHex", () => {
  it("returns a 32-byte hex string", () => {
    expect(generateSaltHex()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is random — two calls don't collide", () => {
    expect(generateSaltHex()).not.toBe(generateSaltHex());
  });
});
