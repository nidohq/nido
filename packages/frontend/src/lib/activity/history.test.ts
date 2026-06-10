import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { loadActivityPage } from "./history.js";
import * as rpcSrc from "./rpcSource.js";
import * as curated from "../assets/curated.js";
import type { ActivityItem } from "./types.js";

const ADDR = "CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S";
const KNOWN = new Set(["CSAC"]);
const item = (id: string, ts: number): ActivityItem =>
  ({ id, txHash: id, timestamp: ts, kind: "other", title: "x", explorerUrl: "u" });
beforeEach(() => vi.spyOn(curated, "fetchCuratedSacIds").mockResolvedValue(KNOWN));
afterEach(() => vi.restoreAllMocks());

describe("loadActivityPage", () => {
  it("returns the RPC page, passing the curated SAC set through for verification", async () => {
    const spy = vi.spyOn(rpcSrc, "fetchRpcRecent").mockResolvedValue({
      items: [item("a", 2), item("b", 1)],
    });
    const page = await loadActivityPage({ address: ADDR });
    expect(page.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(spy).toHaveBeenCalledWith(ADDR, undefined, KNOWN);
  });

  it("dedups by id and sorts by timestamp desc", async () => {
    vi.spyOn(rpcSrc, "fetchRpcRecent").mockResolvedValue({
      items: [item("a", 1), item("a", 1), item("b", 5)],
    });
    const page = await loadActivityPage({ address: ADDR });
    expect(page.items.map((i) => i.id)).toEqual(["b", "a"]);
  });
});
