import { afterEach, describe, expect, it, vi } from "vitest";
import { Account, Address, StrKey } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";

const h = vi.hoisted(() => ({
  simSource: "",
  getAccount: null as any,
  simulateTransaction: null as any,
  setupPublicKey: null as any,
}));

vi.mock("../network.js", () => ({
  RPC_URL: "https://rpc.invalid",
  NETWORK_PASSPHRASE: "stub-passphrase",
  get RELAYER_SIM_SOURCE() {
    return h.simSource;
  },
}));
vi.mock("../policyChainFetch.js", () => ({
  // A validly-checksummed placeholder contract id — Operation.invokeContractFunction
  // parses `contract` through Address, which rejects anything that doesn't
  // pass StrKey's checksum, unlike a plain string-shaped id would suggest.
  fetchFactoryAddress: async () => "CCDFSERLB6QRNCO3CUWG4ZR22VKXIGH4MQO4BWMN4KSY36GTJJP5JPZ3",
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
// Stub just `perch.setupPublicKey` — the real one derives real Ed25519 key
// material, and `@stellar/stellar-sdk`'s partial mock above only intercepts
// *this* file's import of it, not setupKey.ts's separate one, so without
// this stub the real derivation runs against a half-mocked sibling module
// and throws. Stubbing it also lets the tests below assert on exactly what
// predictAddress() passes through — the thing a previous version of this
// file got wrong (it passed the raw salt to get_c_address instead of the
// setup key's public key, mismatching new-account/'s reserveNidoAddress()
// and silently binding invite codes to the wrong address).
vi.mock("@nidohq/passkey-sdk", async (importOriginal) => {
  const orig = (await importOriginal()) as typeof import("@nidohq/passkey-sdk");
  return {
    ...orig,
    perch: {
      ...orig.perch,
      setupPublicKey: (secret: Uint8Array) => h.setupPublicKey(secret),
    },
  };
});

import { hex2buf } from "@nidohq/passkey-sdk";
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
    const setupPk = Buffer.alloc(32, 9);
    h.setupPublicKey = vi.fn(() => setupPk);

    await expect(predictAddress(SALT_HEX)).resolves.toBe(PREDICTED);
    expect(h.getAccount).toHaveBeenCalledWith(SIM_SOURCE);
    // The regression this guards against: get_c_address must be called with
    // the setup key's PUBLIC key (perch.setupPublicKey(salt)), the same
    // derivation new-account/'s reserveNidoAddress() uses — not the raw
    // salt bytes, which would predict a different address than the one
    // actually created and silently bind the wrong address to the invite
    // code.
    expect(h.setupPublicKey).toHaveBeenCalledWith(hex2buf(SALT_HEX));
  });

  it("surfaces a simulation error instead of a predicted address", async () => {
    h.simSource = SIM_SOURCE;
    h.getAccount = vi.fn(async (addr: string) => new Account(addr, "0"));
    h.simulateTransaction = vi.fn(async () => ({ error: "stub-sim-error" }));
    h.setupPublicKey = vi.fn(() => Buffer.alloc(32, 9));

    await expect(predictAddress(SALT_HEX)).rejects.toThrow(/Address prediction failed/);
  });
});
