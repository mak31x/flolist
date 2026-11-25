import type { UploadMime } from "@flolist/shared";

export interface PixelArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Profile photos are stored as one square image this size (D-037). */
export const AVATAR_SIZE = 512;

function loadImage(src: string): Promise<HTMLImageElement> {
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

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

/**
 * Crops `area` out of the image and scales it to AVATAR_SIZE². WebP where the engine can
 * encode it; WebKit can't, so it falls back to JPEG there.
 */
export async function cropToAvatar(
  src: string,
  area: PixelArea,
): Promise<{ blob: Blob; mime: UploadMime }> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas isn't available");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

  const webp = await toBlob(canvas, "image/webp", 0.9);
  if (webp?.type === "image/webp") return { blob: webp, mime: "image/webp" };
  const jpeg = await toBlob(canvas, "image/jpeg", 0.9);
  if (!jpeg) throw new Error("Couldn't encode the photo");
  return { blob: jpeg, mime: "image/jpeg" };
}
