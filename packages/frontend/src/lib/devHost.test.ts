import { describe, expect, it } from "vitest";
import { devRedirectHost } from "./devHost";

describe("devRedirectHost", () => {
  it("moves bare loopback hosts to nido.localhost, keeping the port", () => {
    expect(devRedirectHost("localhost:4321")).toBe("nido.localhost:4321");
    expect(devRedirectHost("127.0.0.1:4321")).toBe("nido.localhost:4321");
    expect(devRedirectHost("[::1]:4321")).toBe("nido.localhost:4321");
    expect(devRedirectHost("localhost")).toBe("nido.localhost");
  });

  it("moves an old-topology subdomain under nido.localhost", () => {
    expect(devRedirectHost("cabc.localhost:4321")).toBe("cabc.nido.localhost:4321");
    expect(devRedirectHost("Status-Message.LOCALHOST:4321")).toBe("status-message.nido.localhost:4321");
  });

  it("leaves the dev topology alone", () => {
    expect(devRedirectHost("nido.localhost:4321")).toBeNull();
    expect(devRedirectHost("cabc.nido.localhost:4321")).toBeNull();
    expect(devRedirectHost("alice--24.nido.localhost:4321")).toBeNull();
  });

  it("leaves non-loopback hosts alone", () => {
    expect(devRedirectHost("moss:4321")).toBeNull();
    expect(devRedirectHost("192.168.1.20:4321")).toBeNull();
    expect(devRedirectHost("localhost.evil.example:4321")).toBeNull();
  });
});
