import "server-only";

import QRCode from "qrcode";

/** The pass token as a QR code (SVG), sized for a phone camera at arm's length. */
export function passQrSvg(token: string) {
  return QRCode.toString(token, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
}

/** The same as a PNG data URL (for tests and downloads). */
export function passQrPng(token: string) {
  return QRCode.toDataURL(token, { errorCorrectionLevel: "M", margin: 2, scale: 8 });
}
