import { describe, expect, it } from "vitest";
import { createNido } from "./createNido.js";

describe("createNido", () => {
  it("keeps apex hosts intact", () => {
    expect(createNido("nido.fyi")).toMatch(/^\/\/nido\.fyi\/new-account\/\?setup=1#salt=[0-9a-f]{64}$/);
  });

  it("keeps numeric preview root hosts intact", () => {
    expect(createNido("85.nido.fyi")).toMatch(/^\/\/85\.nido\.fyi\/new-account\/\?setup=1#salt=[0-9a-f]{64}$/);
  });

  it("normalizes legacy preview root hosts to numeric roots", () => {
    expect(createNido("pr-85.nido.fyi")).toMatch(/^\/\/85\.nido\.fyi\/new-account\/\?setup=1#salt=[0-9a-f]{64}$/);
  });

  it("keeps setup on the testnet apex", () => {
    expect(createNido("test.nido.fyi")).toMatch(/^\/\/test\.nido\.fyi\/new-account\/\?setup=1#salt=[0-9a-f]{64}$/);
    expect(createNido("cabc.test.nido.fyi")).toMatch(/^\/\/test\.nido\.fyi\/new-account\/\?setup=1#salt=[0-9a-f]{64}$/);
    expect(createNido("85.test.nido.fyi")).toMatch(/^\/\/85\.test\.nido\.fyi\/new-account\/\?setup=1#salt=[0-9a-f]{64}$/);
  });

  it("keeps loopback dev hosts intact", () => {
    expect(createNido("localhost:4321")).toMatch(/^\/\/localhost:4321\/new-account\//);
    expect(createNido("127.0.0.1:4321")).toMatch(/^\/\/127\.0\.0\.1:4321\/new-account\//);
  });

  it("strips account subdomains before setup", () => {
    expect(createNido("cabc.nido.fyi")).toMatch(/^\/\/nido\.fyi\/new-account\/\?setup=1#salt=[0-9a-f]{64}$/);
  });
});
