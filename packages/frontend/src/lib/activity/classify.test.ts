import { describe, it, expect } from "vitest";
import { groupTxRows } from "./classify.js";
import type { DecodedTx } from "./types.js";

const SELF = "CCA2KXEUA4EQW3NL4QRCIZ2VRMA7V6A54DHXPA4RBTAGH72PCCYT5MSA";
const OTHER = "GCQZN6KXTEATCRNES3ZPTPZV4NNVK7CZKA6RHLMP2HPWP7SPDN7MFGBS";
const SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

function tx(events: DecodedTx["events"], extra: Partial<DecodedTx> = {}): DecodedTx {
  return { txHash: "HASH", ts: 1780258391, events, ...extra };
}

describe("groupTxRows", () => {
  it("classifies an incoming transfer", () => {
    const rows = groupTxRows(
      tx([{ contractId: SAC, topics: ["transfer", OTHER, SELF, "native"], data: 99900000000n }]),
      SELF,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "HASH:transfer:0", kind: "payment", direction: "in",
      title: "Received", amount: "9,990", asset: "XLM", counterparty: OTHER,
    });
    expect(rows[0].subtitle).toContain("GCQZ");
  });

  it("classifies an outgoing transfer", () => {
    const rows = groupTxRows(
      tx([{ contractId: SAC, topics: ["transfer", SELF, OTHER, "native"], data: 5000000n }]),
      SELF,
    );
    expect(rows[0]).toMatchObject({ kind: "payment", direction: "out", title: "Sent", amount: "0.5", asset: "XLM" });
  });

  it("reads the amount from a muxed transfer's struct data { amount, to_muxed_id }", () => {
    const rows = groupTxRows(
      tx([{ contractId: SAC, topics: ["transfer", OTHER, SELF, "native"], data: { amount: 10000000n, to_muxed_id: 42n } }]),
      SELF,
    );
    expect(rows[0]).toMatchObject({ kind: "payment", direction: "in", amount: "1" });
  });

  it("skips a transfer whose data is undecodable instead of throwing", () => {
    expect(() =>
      groupTxRows(tx([{ contractId: SAC, topics: ["transfer", OTHER, SELF, "native"], data: null }]), SELF),
    ).not.toThrow();
    // no payment row, and the tx never drops — falls back to a generic row
    const rows = groupTxRows(tx([{ contractId: SAC, topics: ["transfer", OTHER, SELF, "native"], data: null }]), SELF);
    expect(rows.every((r) => r.kind !== "payment")).toBe(true);
    expect(rows).toHaveLength(1);
  });

  it("collapses account-creation admin events into one row but keeps the funding payment", () => {
    const rows = groupTxRows(
      tx([
        { contractId: SELF, topics: ["signer_registered", 0], data: {} },
        { contractId: SELF, topics: ["context_rule_added", 0], data: { name: "default" } },
        { contractId: SAC, topics: ["transfer", OTHER, SELF, "native"], data: 99900000000n },
      ]),
      SELF,
    );
    expect(rows.map((r) => r.kind).sort()).toEqual(["payment", "rule"]);
    const admin = rows.find((r) => r.kind === "rule")!;
    expect(admin.id).toBe("HASH");
    expect(admin.title).toMatch(/rule|created/i);
  });

  it("maps signer + policy events and collapses a tx's admin events to the highest priority", () => {
    expect(groupTxRows(tx([{ contractId: SELF, topics: ["signer_added", 1], data: {} }]), SELF)[0].title).toBe("Added a signer");
    expect(groupTxRows(tx([{ contractId: SELF, topics: ["policy_removed", 1], data: {} }]), SELF)[0].title).toBe("Removed a policy");
    // rule (priority 4) wins over signer (3) when both fire in one tx (e.g. recovery setup)
    const rec = groupTxRows(
      tx([
        { contractId: SELF, topics: ["context_rule_added", 2], data: { name: "recovery" } },
        { contractId: SELF, topics: ["signer_added", 2], data: {} },
      ]),
      SELF,
    );
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ kind: "rule", title: "Created a rule" });
  });

  it("falls back to a generic row for unrecognized events, never dropping a tx", () => {
    expect(groupTxRows(tx([]), SELF)[0]).toMatchObject({ kind: "other", title: "Contract activity" });
    const generic = groupTxRows(tx([{ contractId: SELF, topics: ["mystery_event"], data: {} }]), SELF);
    expect(generic).toHaveLength(1);
    expect(generic[0].kind).toBe("other");
  });
});
