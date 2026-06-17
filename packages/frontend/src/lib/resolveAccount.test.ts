import { describe, it, expect, vi } from "vitest";
import {
  resolveAccountFromHostname,
  resolveAccountAddress,
} from "./resolveAccount.js";

const C = "CCV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XMCW";

describe("resolveAccountFromHostname", () => {
  it("returns the contract ID directly on a contract-ID subdomain", async () => {
    const resolveName = vi.fn();

    const address = await resolveAccountFromHostname(
      `${C.toLowerCase()}.nido.fyi`,
      resolveName,
    );

    expect(address).toBe(C);
    expect(resolveName).not.toHaveBeenCalled();
  });

  it("strips a numeric preview suffix from a contract-ID subdomain", async () => {
    const resolveName = vi.fn();

    const address = await resolveAccountFromHostname(
      `${C.toLowerCase()}--24.nido.fyi`,
      resolveName,
    );

    expect(address).toBe(C);
    expect(resolveName).not.toHaveBeenCalled();
  });

  it("strips a legacy preview suffix from a contract-ID subdomain", async () => {
    const resolveName = vi.fn();

    const address = await resolveAccountFromHostname(
      `${C.toLowerCase()}--pr-24.nido.fyi`,
      resolveName,
    );

    expect(address).toBe(C);
    expect(resolveName).not.toHaveBeenCalled();
  });

  it("resolves a name subdomain through the registry", async () => {
    const resolveName = vi.fn().mockResolvedValue(C);

    const address = await resolveAccountFromHostname("joe.nido.fyi", resolveName);

    expect(resolveName).toHaveBeenCalledWith("joe");
    expect(address).toBe(C);
  });

  it("resolves a name subdomain with a numeric preview suffix", async () => {
    const resolveName = vi.fn().mockResolvedValue(C);

    const address = await resolveAccountFromHostname(
      "joe--24.nido.fyi",
      resolveName,
    );

    expect(resolveName).toHaveBeenCalledWith("joe");
    expect(address).toBe(C);
  });

  it("resolves a name subdomain with a legacy preview suffix", async () => {
    const resolveName = vi.fn().mockResolvedValue(C);

    const address = await resolveAccountFromHostname(
      "joe--pr-24.nido.fyi",
      resolveName,
    );

    expect(resolveName).toHaveBeenCalledWith("joe");
    expect(address).toBe(C);
  });

  it("returns null for an unregistered name", async () => {
    const resolveName = vi.fn().mockResolvedValue(null);

    const address = await resolveAccountFromHostname("ghost.nido.fyi", resolveName);

    expect(address).toBe(null);
  });

  it("returns null when registry resolution throws", async () => {
    const resolveName = vi.fn().mockRejectedValue(new Error("rpc down"));

    const address = await resolveAccountFromHostname("joe.nido.fyi", resolveName);

    expect(address).toBe(null);
  });

  it("returns null on a bare host with no subdomain", async () => {
    const resolveName = vi.fn();

    const address = await resolveAccountFromHostname("localhost", resolveName);

    expect(address).toBe(null);
    expect(resolveName).not.toHaveBeenCalled();
  });

  it("returns null on a reserved dApp subdomain", async () => {
    const resolveName = vi.fn();

    const address = await resolveAccountFromHostname(
      "status-message.nido.fyi",
      resolveName,
    );

    expect(address).toBe(null);
    expect(resolveName).not.toHaveBeenCalled();
  });
});

describe("resolveAccountAddress", () => {
  it("memoizes: concurrent callers share one in-flight resolution", () => {
    // jsdom's default hostname is localhost, so this resolves to null without
    // touching the network — identity of the promise is what's under test.
    expect(resolveAccountAddress()).toBe(resolveAccountAddress());
  });
});
