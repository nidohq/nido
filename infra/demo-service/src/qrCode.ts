import QRCode from "qrcode";

export async function buildQrCode(url: string) {
    const qrDataUrl = await QRCode.toDataURL(url);
    return qrDataUrl
}