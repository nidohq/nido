import { describe, it, expect } from "vitest";
import { avatarBackground } from "./avatarStyle.js";

describe("avatarBackground", () => {
  it("is deterministic for a given seed", () => {
    expect(avatarBackground("alice")).toBe(avatarBackground("alice"));
  });

  it("produces valid in-range hues (never NaN) across many seeds", () => {
    const seeds = ["alice", "nido", "bob", "", ">>>edge"].concat(
      Array.from({ length: 300 }, (_, i) => "seed" + i),
    );
    for (const seed of seeds) {
      const css = avatarBackground(seed);
      const hues = [...css.matchAll(/hsl\((\d+(?:\.\d+)?)\s/g)].map((m) =>
        Number(m[1]),
      );
      expect(hues.length).toBe(2);
      for (const h of hues) {
        expect(Number.isNaN(h)).toBe(false);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(360);
      }
    }
  });

  it("returns a radial-gradient string", () => {
    expect(avatarBackground("nido")).toMatch(/^radial-gradient\(/);
  });
});
