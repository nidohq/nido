import { describe, it, expect } from "vitest";
import { buildMyNidoModel } from "./myNidoModel.js";

const nameOf = (names: Record<string, string>) => (id: string) =>
  names[id] ?? null;

describe("buildMyNidoModel", () => {
  it("is empty when there are no accounts and no pending", () => {
    const m = buildMyNidoModel([], [], () => null);
    expect(m.state).toBe("empty");
    expect(m.rows).toEqual([]);
  });

  it("is 'single' for exactly one active account", () => {
    const m = buildMyNidoModel(["CABC"], [], nameOf({ CABC: "alice" }));
    expect(m.state).toBe("single");
    expect(m.rows).toEqual([
      { contractId: "CABC", name: "alice", status: "active" },
    ]);
  });

  it("is 'multi' for two or more active accounts", () => {
    const m = buildMyNidoModel(["CABC", "CDEF"], [], () => null);
    expect(m.state).toBe("multi");
    expect(m.rows.map((r) => r.contractId)).toEqual(["CABC", "CDEF"]);
    expect(m.rows.every((r) => r.status === "active")).toBe(true);
  });

  it("lists active rows before pending rows and carries the resume key", () => {
    const m = buildMyNidoModel(
      ["CABC"],
      [{ contractId: "CPEND", secretKey: "S123" }],
      nameOf({ CABC: "alice" }),
    );
    expect(m.state).toBe("multi"); // 1 active + 1 pending = 2 rows
    expect(m.rows).toEqual([
      { contractId: "CABC", name: "alice", status: "active" },
      { contractId: "CPEND", name: null, status: "pending", resumeKey: "S123" },
    ]);
  });

  it("shows the create-card (empty) but still lists pending-only accounts", () => {
    const m = buildMyNidoModel(
      [],
      [{ contractId: "CPEND", secretKey: "S123" }],
      () => null,
    );
    expect(m.state).toBe("empty");
    expect(m.rows).toEqual([
      { contractId: "CPEND", name: null, status: "pending", resumeKey: "S123" },
    ]);
  });

  it("does not duplicate a pending account that is also active", () => {
    const m = buildMyNidoModel(
      ["CABC"],
      [{ contractId: "CABC", secretKey: "S123" }],
      () => null,
    );
    expect(m.state).toBe("single");
    expect(m.rows).toEqual([
      { contractId: "CABC", name: null, status: "active" },
    ]);
  });
});
