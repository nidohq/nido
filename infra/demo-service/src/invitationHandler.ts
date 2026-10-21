import QRCode from "qrcode";

export interface Invitation {
  code: string;
  url: string;
  qrDataUrl: string;
}

/** Builds the `/demo/start?invitationCode=...` URL a visitor scans, and the
 *  QR code that encodes it. */
export async function buildInvitation(code: string, frontendBaseUrl: string): Promise<Invitation> {
  const url = `${frontendBaseUrl.replace(/\/+$/, "")}/demo/start?invitationCode=${encodeURIComponent(code)}`;
  const qrDataUrl = await QRCode.toDataURL(url);
  return { code, url, qrDataUrl };
}
