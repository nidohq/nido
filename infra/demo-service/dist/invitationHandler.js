import QRCode from "qrcode";
/** Builds the `/demo/start?invitationCode=...` URL a visitor scans, and the
 *  QR code that encodes it. */
export async function buildInvitation(code, frontendBaseUrl) {
    const url = `${frontendBaseUrl.replace(/\/+$/, "")}/demo/start?invitationCode=${encodeURIComponent(code)}`;
    const qrDataUrl = await QRCode.toDataURL(url);
    return { code, url, qrDataUrl };
}
//# sourceMappingURL=invitationHandler.js.map