import { afterEach, describe, expect, it, vi } from "vitest";
import { printReceipt } from "./printer.js";

describe("printReceipt", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs the visit id and address", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    printReceipt("visit-1", { address: "CADDRESS", status: "funded", createdAt: 0 });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("visit-1"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("CADDRESS"));
  });
});
