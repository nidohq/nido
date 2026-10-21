import { describe, expect, it } from "vitest";
import { buildInvitation } from "../src/invitationHandler.js";

describe("buildInvitation", () => {
  it("builds the /demo/start URL with the code embedded", async () => {
    const invitation = await buildInvitation("ABC123", "https://nido.fyi");
    expect(invitation.url).toBe("https://nido.fyi/demo/start?invitationCode=ABC123");
  });

  it("strips a trailing slash from the base URL", async () => {
    const invitation = await buildInvitation("ABC123", "https://nido.fyi/");
    expect(invitation.url).toBe("https://nido.fyi/demo/start?invitationCode=ABC123");
  });

  it("encodes the QR code as a PNG data URL", async () => {
    const invitation = await buildInvitation("ABC123", "https://nido.fyi");
    expect(invitation.qrDataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });
});
