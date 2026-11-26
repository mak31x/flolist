import type { UploadMime } from "@flolist/shared";
import { encodeCanvas, loadImage } from "../files/resize.ts";

export interface PixelArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Profile photos are stored as one square image this size (D-037). */
export const AVATAR_SIZE = 512;

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

  return encodeCanvas(canvas, 0.9);
}
