import { describe, it, expect, vi, afterEach } from "vitest";
import { loadActivityPage } from "./history.js";
import * as expert from "./expertSource.js";
import * as rpcSrc from "./rpcSource.js";
import type { ActivityItem } from "./types.js";

const ADDR = "CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S";
const item = (id: string, ts: number): ActivityItem =>
  ({ id, txHash: id, timestamp: ts, kind: "other", title: "x", explorerUrl: "u" });
afterEach(() => vi.restoreAllMocks());

describe("loadActivityPage", () => {
  it("returns the Expert page when Expert works", async () => {
    vi.spyOn(expert, "fetchExpertPage").mockResolvedValue({
      items: [item("a", 2), item("b", 1)], nextCursor: "c1", source: "expert", partial: false,
    });
    const page = await loadActivityPage({ address: ADDR });
    expect(page.source).toBe("expert");
    expect(page.nextCursor).toBe("c1");
    expect(page.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("falls back to RPC when Expert is unavailable", async () => {
    vi.spyOn(expert, "fetchExpertPage").mockRejectedValue(new expert.ExpertUnavailableError(402));
    const rpcSpy = vi.spyOn(rpcSrc, "fetchRpcRecent").mockResolvedValue({
      items: [item("a", 1)], nextCursor: null, source: "rpc", partial: true,
    });
    const page = await loadActivityPage({ address: ADDR });
    expect(rpcSpy).toHaveBeenCalledWith(ADDR);
    expect(page).toMatchObject({ source: "rpc", partial: true, nextCursor: null });
  });

  it("dedups by id and sorts by timestamp desc", async () => {
    vi.spyOn(expert, "fetchExpertPage").mockResolvedValue({
      items: [item("a", 1), item("a", 1), item("b", 5)], nextCursor: null, source: "expert", partial: false,
    });
    const page = await loadActivityPage({ address: ADDR });
    expect(page.items.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("does not fall back on a non-Expert error (paging cursor still works)", async () => {
    vi.spyOn(expert, "fetchExpertPage").mockRejectedValue(new Error("boom"));
    await expect(loadActivityPage({ address: ADDR, cursor: "c1" })).rejects.toThrow("boom");
  });

  it("does not fall back when Expert is unavailable mid-pagination (cursor present)", async () => {
    vi.spyOn(expert, "fetchExpertPage").mockRejectedValue(new expert.ExpertUnavailableError(402));
    const rpcSpy = vi.spyOn(rpcSrc, "fetchRpcRecent").mockResolvedValue({
      items: [], nextCursor: null, source: "rpc", partial: true,
    });
    await expect(loadActivityPage({ address: ADDR, cursor: "c1" })).rejects.toBeInstanceOf(expert.ExpertUnavailableError);
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});
