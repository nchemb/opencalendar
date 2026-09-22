import QRCode from "qrcode";

export async function qrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { type: "png", width: 512, margin: 2 });
}

export async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", width: 512, margin: 2 });
}
