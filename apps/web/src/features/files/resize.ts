import type { ImageMime } from "@flolist/shared";

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      reject(new Error("Couldn't read that image"));
    };
    img.src = src;
  });
}

export function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

/** WebP where the engine can encode it; WebKit can't, so JPEG there (D-038). */
export async function encodeCanvas(
  canvas: HTMLCanvasElement,
  quality = 0.88,
): Promise<{ blob: Blob; mime: ImageMime }> {
  const webp = await toBlob(canvas, "image/webp", quality);
  if (webp?.type === "image/webp") return { blob: webp, mime: "image/webp" };
  const jpeg = await toBlob(canvas, "image/jpeg", quality);
  if (!jpeg) throw new Error("Couldn't encode the image");
  return { blob: jpeg, mime: "image/jpeg" };
}

/**
 * Scales an image down so its longer edge is at most `maxEdge` and re-encodes it (list covers,
 * D-028's resizing done in the browser). Smaller images are re-encoded at their own size.
 */
export async function downscaleImage(
  file: Blob,
  maxEdge: number,
): Promise<{ blob: Blob; mime: ImageMime; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas isn't available");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, width, height);
    return { ...(await encodeCanvas(canvas)), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
