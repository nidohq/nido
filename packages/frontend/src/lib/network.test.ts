import { describe, it, expect } from "vitest";
import { Asset, Networks } from "@stellar/stellar-sdk";
import { RPC_URL, NETWORK_PASSPHRASE, NETWORK_NAME, EXPERT_API_BASE, EXPLORER_BASE, NATIVE_SAC_ID } from "./network.js";

describe("network config", () => {
  it("targets testnet", () => {
    expect(NETWORK_PASSPHRASE).toBe(Networks.TESTNET);
    expect(NETWORK_NAME).toBe("testnet");
    expect(RPC_URL).toBe("https://soroban-testnet.stellar.org");
    expect(EXPERT_API_BASE).toBe("https://api.stellar.expert/explorer/testnet");
    expect(EXPLORER_BASE).toBe("https://stellar.expert/explorer/testnet");
  });
  it("derives the native SAC id", () => {
    expect(NATIVE_SAC_ID).toBe(Asset.native().contractId(Networks.TESTNET));
  });
});
