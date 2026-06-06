import { describe, it, expect } from "vitest";
import { decodeExpertRecord } from "./decodeTx.js";
import fixture from "./__fixtures__/expert-tx-testnet.json";

const records = (fixture as any)._embedded.records;
// Record index 2 is the create_account tx: signer_registered + context_rule_added + transfer.
const createAccount = records[2];

describe("decodeExpertRecord", () => {
  it("pulls txHash + ts straight from the record", () => {
    const d = decodeExpertRecord(createAccount);
    expect(d.txHash).toBe(createAccount.hash);
    expect(d.ts).toBe(createAccount.ts);
  });

  it("extracts the top-level invoked fn from the envelope", () => {
    expect(decodeExpertRecord(createAccount).invokedFn).toBe("create_account");
  });

  it("extracts V4 contract events incl. the funding transfer", () => {
    const names = decodeExpertRecord(createAccount).events.map((e) => e.topics[0]);
    expect(names).toContain("transfer");
    expect(names).toContain("context_rule_added");
    const transfer = decodeExpertRecord(createAccount).events.find((e) => e.topics[0] === "transfer")!;
    expect(typeof transfer.data).toBe("bigint");
    expect(transfer.topics[3]).toBe("native");
    expect(transfer.contractId).toBe("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
  });

  it("never throws on a record (returns events: [] on undecodable meta)", () => {
    expect(() => decodeExpertRecord({ hash: "x", ts: 1, body: "@bad@", meta: "@bad@" } as any)).not.toThrow();
  });
});
