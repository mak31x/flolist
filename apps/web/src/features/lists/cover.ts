import { fileUrl, type ListCover } from "@flolist/shared";
import { covers } from "../../shell/covers.ts";

/** Uploaded covers are scaled to this longer edge before upload (D-028 resizing, in the browser). */
export const COVER_MAX_EDGE = 2400;

/** Where a cover's image comes from. */
export function coverSrc(cover: ListCover): string | null {
  if (!cover) return null;
  return "builtin" in cover ? covers[cover.builtin] : fileUrl(cover.fileId);
}
