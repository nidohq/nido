import { describe, it, expect, vi, afterEach } from "vitest";
import { putFriendSignature, listFriendSignatures } from "./relayClient.js";

afterEach(() => vi.restoreAllMocks());

const BASE = "https://relay.nido.fyi";

describe("relayClient", () => {
  it("PUTs a blob to /sig/:friend?bucket=", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await putFriendSignature(BASE, "KEYABC", "CFRIEND", "theblob");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [u, init] = fetchMock.mock.calls[0];
    expect(u).toBe("https://relay.nido.fyi/sig/CFRIEND?bucket=KEYABC");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe("theblob");
  });
  it("throws on a non-2xx PUT", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 413 })));
    await expect(putFriendSignature(BASE, "KEYABC", "CFRIEND", "x")).rejects.toThrow();
  });
  it("lists signed friend blobs", async () => {
    const body = JSON.stringify({ signed: [{ friend: "CFRIEND", blob: "b1" }] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    const out = await listFriendSignatures(BASE, "KEYABC");
    expect(out).toEqual([{ friend: "CFRIEND", blob: "b1" }]);
  });
  it("returns [] when the bucket is empty", async () => {
    const body = JSON.stringify({ signed: [] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    expect(await listFriendSignatures(BASE, "KEYABC")).toEqual([]);
  });
});
