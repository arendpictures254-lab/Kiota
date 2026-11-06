/**
 * Reading a QR code: the phone's own detector (BarcodeDetector, in Chrome on Android) when there
 * is one, otherwise jsQR (loaded only when needed, about 45 KB).
 */

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };

let native: Detector | null | undefined;

async function nativeDetector(): Promise<Detector | null> {
  if (native !== undefined) return native;
  const BD = (
    globalThis as unknown as {
      BarcodeDetector?: {
        new (o: { formats: string[] }): Detector;
        getSupportedFormats?: () => Promise<string[]>;
      };
    }
  ).BarcodeDetector;
  try {
    native =
      BD && (await BD.getSupportedFormats?.())?.includes("qr_code")
        ? new BD({ formats: ["qr_code"] })
        : null;
  } catch {
    native = null;
  }
  return native;
}

const canvas = () => document.createElement("canvas");

/** Read a QR code from a video frame or an image; null if none is found. */
export async function decodeQr(
  source: HTMLVideoElement | HTMLImageElement | ImageBitmap,
): Promise<string | null> {
  const det = await nativeDetector();
  if (det) {
    try {
      const found = await det.detect(source);
      if (found[0]?.rawValue) return found[0].rawValue;
    } catch {
      // fall through to jsQR
    }
  }
  const w = "videoWidth" in source ? source.videoWidth : source.width;
  const h = "videoHeight" in source ? source.videoHeight : source.height;
  if (!w || !h) return null;
  const scale = Math.min(1, 1000 / Math.max(w, h));
  const c = canvas();
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const jsQR = (await import("jsqr")).default;
  return jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

/** Read a QR code from a photo (the "use a photo" fallback). */
export async function decodeFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    return await decodeQr(bitmap);
  } finally {
    bitmap.close();
  }
}

/**
 * Load the reader as soon as the gate opens, so scanning still works if the connection drops
 * before the first scan (a script cannot be fetched offline).
 */
export function preloadDecoder() {
  void nativeDetector().then((det) => (det ? null : import("jsqr")));
}
