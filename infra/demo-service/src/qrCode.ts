import QRCode from "qrcode";

export async function buildQrCode(url: string): Promise<string> {
  return QRCode.toDataURL(url);
}
