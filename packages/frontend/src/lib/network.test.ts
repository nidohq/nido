import { describe, it, expect, vi, afterEach } from "vitest";
import { Asset, Networks, rpc } from "@stellar/stellar-sdk";
import {
  RPC_URL, NETWORK_PASSPHRASE, NETWORK_NAME, EXPLORER_BASE, NATIVE_SAC_ID, latestLedgerSequence,
} from "./network.js";

describe("network config", () => {
  it("targets testnet", () => {
    expect(NETWORK_PASSPHRASE).toBe(Networks.TESTNET);
    expect(NETWORK_NAME).toBe("testnet");
    expect(RPC_URL).toBe("https://soroban-testnet.stellar.org");
    expect(EXPLORER_BASE).toBe("https://stellar.expert/explorer/testnet");
  });
  it("derives the native SAC id", () => {
    expect(NATIVE_SAC_ID).toBe(Asset.native().contractId(Networks.TESTNET));
  });
});

describe("latestLedgerSequence", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads the tip's sequence without decoding the ledger it closed", async () => {
    // XDR this SDK can't decode, as when the tip holds someone's protocol 27
    // AddressV2 credential: getLatestLedger() throws on it.
    const raw = { id: "", sequence: 5_077_970, protocolVersion: "29", closeTime: "0", headerXdr: "AAAABw==", metadataXdr: "AAAABw==" };
    vi.spyOn(rpc.Server.prototype, "_getLatestLedger").mockResolvedValue(raw as never);
    const server = new rpc.Server(RPC_URL);
    await expect(server.getLatestLedger()).rejects.toThrow();
    await expect(latestLedgerSequence(server)).resolves.toBe(5_077_970);
  });
});
