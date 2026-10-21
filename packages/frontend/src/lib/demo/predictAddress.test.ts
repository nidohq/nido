import { afterEach, describe, expect, it, vi } from "vitest";
import { Account, Address, StrKey } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";

const h = vi.hoisted(() => ({
  simSource: "",
  getAccount: null as any,
  simulateTransaction: null as any,
}));

vi.mock("../network.js", () => ({
  RPC_URL: "https://rpc.invalid",
  NETWORK_PASSPHRASE: "stub-passphrase",
  get RELAYER_SIM_SOURCE() {
    return h.simSource;
  },
}));
vi.mock("../policyChainFetch.js", () => ({
  fetchFactoryAddress: async () => "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
}));
vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const orig = (await importOriginal()) as typeof import("@stellar/stellar-sdk");
  return {
    ...orig,
    rpc: {
      ...orig.rpc,
      Server: class {
        getAccount = (addr: string) => h.getAccount(addr);
        simulateTransaction = (...args: unknown[]) => h.simulateTransaction(...args);
      },
    },
  };
});

import { predictAddress } from "./predictAddress.js";

const SIM_SOURCE = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const PREDICTED = StrKey.encodeContract(Buffer.alloc(32, 3));
const SALT_HEX = "ab".repeat(32);

afterEach(() => {
  vi.restoreAllMocks();
  h.simSource = "";
});

describe("predictAddress", () => {
  it("fails closed when the relayer sim source isn't configured", async () => {
    h.simSource = "";
    h.getAccount = vi.fn();
    h.simulateTransaction = vi.fn();

    await expect(predictAddress(SALT_HEX)).rejects.toThrow(/not configured/);
    expect(h.getAccount).not.toHaveBeenCalled();
  });

  it("returns the predicted address from a successful simulation", async () => {
    h.simSource = SIM_SOURCE;
    h.getAccount = vi.fn(async (addr: string) => new Account(addr, "0"));
    h.simulateTransaction = vi.fn(async () => ({
      result: { retval: Address.fromString(PREDICTED).toScVal() },
    }));

    await expect(predictAddress(SALT_HEX)).resolves.toBe(PREDICTED);
    expect(h.getAccount).toHaveBeenCalledWith(SIM_SOURCE);
  });

  it("surfaces a simulation error instead of a predicted address", async () => {
    h.simSource = SIM_SOURCE;
    h.getAccount = vi.fn(async (addr: string) => new Account(addr, "0"));
    h.simulateTransaction = vi.fn(async () => ({ error: "stub-sim-error" }));

    await expect(predictAddress(SALT_HEX)).rejects.toThrow(/Address prediction failed/);
  });
});
