import QRCode from "qrcode";

export function qrSvg(data: string, size = 188): Promise<string> {
  return QRCode.toString(data, {
    type: "svg",
    margin: 0,
    width: size,
    color: { dark: "#16140f", light: "#fffdf8" },
  });
}
