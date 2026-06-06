import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchExpertPage, ExpertUnavailableError } from "./expertSource.js";
import fixture from "./__fixtures__/expert-tx-testnet.json";

const ADDR = "CCA2KXEUA4EQW3NL4QRCIZ2VRMA7V6A54DHXPA4RBTAGH72PCCYT5MSA";
afterEach(() => vi.restoreAllMocks());

describe("fetchExpertPage", () => {
  it("maps records to rows and parses the next cursor", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fixture), { status: 200 }),
    );
    const page = await fetchExpertPage(ADDR, null);
    expect(page.source).toBe("expert");
    expect(page.partial).toBe(false);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.nextCursor).toBe("12235399753646080"); // from _links.next.href in the fixture
    expect(page.items.every((r) => r.explorerUrl.includes("/tx/"))).toBe(true);
    const received = page.items.find((r) => r.kind === "payment" && r.direction === "in");
    expect(received).toBeDefined();
    expect(received!.amount).toBe("9,990");
    expect(received!.asset).toBe("XLM");
  });

  it("throws ExpertUnavailableError on 402 (the fallback trigger)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 402 }));
    await expect(fetchExpertPage(ADDR, null)).rejects.toBeInstanceOf(ExpertUnavailableError);
  });

  it("throws ExpertUnavailableError on 429", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429 }));
    await expect(fetchExpertPage(ADDR, null)).rejects.toBeInstanceOf(ExpertUnavailableError);
  });

  it("sends the cursor when paginating", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }));
    await fetchExpertPage(ADDR, "999");
    expect(String(spy.mock.calls[0][0])).toContain("cursor=999");
  });
});
