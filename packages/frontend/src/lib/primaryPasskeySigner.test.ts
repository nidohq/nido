import { describe, it, expect } from "vitest";
import { signAndSubmit } from "./primaryPasskeySigner";
describe("signAndSubmit surface", () => {
  it("is callable with onProgress in its args type", () => {
    const ref: Parameters<typeof signAndSubmit>[0] = {
      account: "C", operation: {}, onProgress: (p) => void p.phase,
    };
    expect(typeof signAndSubmit).toBe("function");
    expect(ref.onProgress).toBeTypeOf("function");
  });
});
