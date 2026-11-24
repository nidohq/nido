import { describe, expect, it } from "vitest";
import { devRedirectHost } from "./devHost";

const C = `c${"a".repeat(55)}`;

describe("devRedirectHost", () => {
  it("moves bare loopback hosts to nido.localhost, keeping the port", () => {
    expect(devRedirectHost("localhost:4321")).toBe("nido.localhost:4321");
    expect(devRedirectHost("127.0.0.1:4321")).toBe("nido.localhost:4321");
    expect(devRedirectHost("[::1]:4321")).toBe("nido.localhost:4321");
    expect(devRedirectHost("localhost")).toBe("nido.localhost");
  });

  it("moves an old-topology account host under nido.localhost", () => {
    expect(devRedirectHost(`${C}.localhost:4321`)).toBe(`${C}.nido.localhost:4321`);
    expect(devRedirectHost(`${C.toUpperCase()}.LOCALHOST:4321`)).toBe(`${C}.nido.localhost:4321`);
  });

  it("leaves every other .localhost label where it is", () => {
    expect(devRedirectHost("dapp.localhost:4321")).toBeNull();
    expect(devRedirectHost("status-message.localhost:4321")).toBeNull();
    expect(devRedirectHost("alice--24.localhost:4321")).toBeNull();
    expect(devRedirectHost("cabc.localhost:4321")).toBeNull();
    expect(devRedirectHost(`${C}a.localhost:4321`)).toBeNull();
    expect(devRedirectHost(`dapp.${C}.localhost:4321`)).toBeNull();
  });

  it("leaves the dev topology alone", () => {
    expect(devRedirectHost("nido.localhost:4321")).toBeNull();
    expect(devRedirectHost(`${C}.nido.localhost:4321`)).toBeNull();
    expect(devRedirectHost("alice--24.nido.localhost:4321")).toBeNull();
  });

  it("leaves non-loopback hosts alone", () => {
    expect(devRedirectHost("moss:4321")).toBeNull();
    expect(devRedirectHost("192.168.1.20:4321")).toBeNull();
    expect(devRedirectHost("localhost.evil.example:4321")).toBeNull();
  });
});
