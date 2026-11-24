import { describe, it, expect, vi, afterEach } from "vitest";
import { Asset, Networks, rpc } from "@stellar/stellar-sdk";
import {
  RPC_URL, NETWORK_PASSPHRASE, NETWORK_NAME, NETWORK_LABEL, EXPLORER_BASE, NATIVE_SAC_ID, latestLedgerSequence,
} from "./network.js";

describe("network config", () => {
  it("targets testnet on a testnet build", () => {
    expect(NETWORK_PASSPHRASE).toBe(Networks.TESTNET);
    expect(NETWORK_NAME).toBe("testnet");
    expect(NETWORK_LABEL).toBe("Testnet");
    expect(RPC_URL).toBe("https://soroban-testnet.stellar.org");
    expect(EXPLORER_BASE).toBe("https://stellar.expert/explorer/testnet");
  });
  it("derives the native SAC id", () => {
    expect(NATIVE_SAC_ID).toBe(Asset.native().contractId(Networks.TESTNET));
  });
});

describe("network config — PUBLIC_STELLAR_NETWORK switching", () => {
  afterEach(() => {
    import.meta.env.PUBLIC_STELLAR_NETWORK = "testnet";
  });

  it("targets mainnet when PUBLIC_STELLAR_NETWORK=mainnet", async () => {
    import.meta.env.PUBLIC_STELLAR_NETWORK = "mainnet";
    vi.resetModules();
    const mod = await import("./network.js");
    expect(mod.NETWORK_NAME).toBe("mainnet");
    expect(mod.NETWORK_LABEL).toBe("Mainnet");
    expect(mod.NETWORK_PASSPHRASE).toBe(Networks.PUBLIC);
    expect(mod.RPC_URL).toBe("https://mainnet.sorobanrpc.com");
    expect(mod.EXPLORER_BASE).toBe("https://stellar.expert/explorer/public");
  });

  it("ignores case and surrounding whitespace", async () => {
    for (const [value, expected] of [["MAINNET", "mainnet"], ["Mainnet", "mainnet"], [" mainnet\n", "mainnet"], ["TESTNET", "testnet"], ["testnet ", "testnet"]]) {
      import.meta.env.PUBLIC_STELLAR_NETWORK = value;
      vi.resetModules();
      const mod = await import("./network.js");
      expect(mod.NETWORK_NAME).toBe(expected);
    }
  });

  it("has no default: unset or unrecognised, the module refuses to load", async () => {
    for (const value of [undefined, "", "  ", "staging", "main net", "testnet2"]) {
      if (value === undefined) delete (import.meta.env as Record<string, string | undefined>).PUBLIC_STELLAR_NETWORK;
      else import.meta.env.PUBLIC_STELLAR_NETWORK = value;
      vi.resetModules();
      await expect(import("./network.js")).rejects.toThrow(/PUBLIC_STELLAR_NETWORK must be "mainnet" or "testnet"/);
    }
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
