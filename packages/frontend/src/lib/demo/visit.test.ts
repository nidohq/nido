import { afterEach, describe, expect, it, vi } from "vitest";
import { eventTokenMatches, registerDemoVisit } from "./visit.js";

describe("eventTokenMatches", () => {
  it("passes when no token is configured", () => {
    expect(eventTokenMatches("", null)).toBe(true);
    expect(eventTokenMatches("", "anything")).toBe(true);
  });

  it("requires an exact match when a token is configured", () => {
    expect(eventTokenMatches("secret", "secret")).toBe(true);
    expect(eventTokenMatches("secret", "wrong")).toBe(false);
    expect(eventTokenMatches("secret", null)).toBe(false);
  });
});

describe("registerDemoVisit", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is a no-op when no demo service is configured", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(registerDemoVisit("", "CADDRESS")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the address and returns the parsed visit", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ visit: "abc123" }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await registerDemoVisit("https://demo.example/", "CADDRESS");

    expect(result).toEqual({ visit: "abc123" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://demo.example/visits",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ address: "CADDRESS" }),
      }),
    );
  });

  it("throws when the demo service rejects the registration", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));

    await expect(registerDemoVisit("https://demo.example", "CADDRESS")).rejects.toThrow(/500/);
  });
});
