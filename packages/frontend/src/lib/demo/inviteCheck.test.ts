import { afterEach, describe, expect, it, vi } from "vitest";
import { checkInvitationCode } from "./inviteCheck.js";

describe("checkInvitationCode", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws when no invite service is configured", async () => {
    await expect(checkInvitationCode("", "", "ABC123", "CADDRESS")).rejects.toThrow(
      /PUBLIC_INVITE_SERVICE_URL/,
    );
  });

  it("posts the code and address, with the api key header, and returns ok on success", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, status: "claimed" }) }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await checkInvitationCode("https://invite.example", "secret-key", "ABC123", "CADDRESS");

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://invite.example/codes/ABC123/check",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "secret-key" }),
        body: JSON.stringify({ address: "CADDRESS" }),
      }),
    );
  });

  it("omits the x-api-key header when no key is configured", async () => {
    const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    await checkInvitationCode("https://invite.example", "", "ABC123", "CADDRESS");

    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init.headers).not.toHaveProperty("x-api-key");
  });

  it("surfaces the service's rejection reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ ok: false, reason: "expired" }) })),
    );

    await expect(checkInvitationCode("https://invite.example", "", "ABC123", "CADDRESS")).resolves.toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("falls back to service_error on an unrecognized or unparsable rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => { throw new Error("not json"); } })));

    await expect(checkInvitationCode("https://invite.example", "", "ABC123", "CADDRESS")).resolves.toEqual({
      ok: false,
      reason: "service_error",
    });
  });
});
