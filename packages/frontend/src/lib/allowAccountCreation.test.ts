import { describe, it, expect } from "vitest";
import { allowAccountCreation } from "./allowAccountCreation";

describe("allowAccountCreation", () => {
  it.each([
    "nido.fyi",
    "alice.nido.fyi",
    "cabc.nido.fyi",
    "test.nido.fyi",
    "alice.test.nido.fyi",
    "localhost",
    "127.0.0.1",
  ])("is open on %s", (hostname) => {
    expect(allowAccountCreation(hostname)).toBe(true);
  });

  it.each([
    "nido-1am.pages.dev",
    "evil-nido.fyi",
    "nido.fyi.evil.com",
    "nidofyi",
    "example.com",
  ])("stays coming soon on %s", (hostname) => {
    expect(allowAccountCreation(hostname)).toBe(false);
  });
});
