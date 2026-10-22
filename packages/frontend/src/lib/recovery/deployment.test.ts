import { describe, it, expect, afterEach, vi } from "vitest";
import { perch } from "@nidohq/passkey-sdk";

const ENV = import.meta.env as Record<string, string | undefined>;

describe("perchDeployment()", () => {
  afterEach(() => {
    delete ENV.PUBLIC_PERCH_DEPLOYMENT;
    delete ENV.PUBLIC_STELLAR_NETWORK;
    vi.resetModules();
  });

  it("defaults to perch.TESTNET on a testnet build with no override", async () => {
    ENV.PUBLIC_STELLAR_NETWORK = "testnet";
    vi.resetModules();
    const { perchDeployment } = await import("./deployment.js");
    expect(perchDeployment()).toEqual(perch.TESTNET);
  });

  it("has no default on a mainnet build with no override (no perch.MAINNET exists yet)", async () => {
    ENV.PUBLIC_STELLAR_NETWORK = "mainnet";
    vi.resetModules();
    const { perchDeployment, requireDeployment } = await import("./deployment.js");
    expect(perchDeployment()).toBeUndefined();
    expect(() => requireDeployment()).toThrow(/no perch deployment/i);
  });

  it("'none' disables recovery regardless of network", async () => {
    ENV.PUBLIC_STELLAR_NETWORK = "testnet";
    ENV.PUBLIC_PERCH_DEPLOYMENT = "none";
    vi.resetModules();
    const { perchDeployment } = await import("./deployment.js");
    expect(perchDeployment()).toBeUndefined();
  });

  it("an explicit manifest override wins on any network", async () => {
    ENV.PUBLIC_STELLAR_NETWORK = "mainnet";
    ENV.PUBLIC_PERCH_DEPLOYMENT = JSON.stringify(perch.TESTNET);
    vi.resetModules();
    const { perchDeployment } = await import("./deployment.js");
    expect(perchDeployment()).toEqual(perch.TESTNET);
  });
});
